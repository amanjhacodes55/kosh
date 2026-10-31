import { describe, expect, test } from "vitest";
import * as K from "@/lib/bank";
import { runEod } from "@/lib/eod";
import { type Bank, G, LOAN_GL } from "@/lib/model";
import { rupees } from "@/lib/money";
import { authorise, execute } from "@/lib/ops";
import { newBank, seedSandbox, treasuryPosition } from "@/lib/seed";

const fresh = () => newBank({ id: "b1", code: "KAVB", name: "Kaveri National Bank", date: "2026-04-01", sandbox: false, adminHash: "x" });
const admin: K.Actor = { id: "U100", name: "Admin", role: "admin" };

/** The ledger must agree with every sub-ledger, to the paisa */
function reconcile(b: Bank) {
  // "|| 0" turns the -0 that negating an empty balance gives into 0
  const gl = (c: string) => b.gl[c] || 0;
  const neg = (c: string) => -gl(c) || 0;
  const live = (s: string) => s !== "closed";
  expect(Object.values(b.gl).reduce((s, v) => s + v, 0)).toBe(0);
  expect(neg(G.sb)).toBe(b.accounts.filter((a) => a.type === "SB" && live(a.status)).reduce((s, a) => s + a.balance, 0));
  expect(neg(G.ca)).toBe(b.accounts.filter((a) => a.type === "CA").reduce((s, a) => s + Math.max(0, a.balance), 0));
  expect(gl(G.od)).toBe(b.accounts.filter((a) => a.type === "CA").reduce((s, a) => s + Math.max(0, -a.balance), 0));
  expect(neg(G.fd)).toBe(b.deposits.filter((d) => d.kind === "FD" && d.status === "active").reduce((s, d) => s + d.balance, 0));
  expect(neg(G.rd)).toBe(b.deposits.filter((d) => d.kind === "RD" && d.status === "active").reduce((s, d) => s + d.balance, 0));
  const accruals = b.accounts.filter((a) => a.type === "SB").reduce((s, a) => s + Math.round(a.accrued), 0) + b.deposits.filter((d) => d.status === "active").reduce((s, d) => s + Math.round(d.accrued), 0);
  expect(neg(G.interestPayable)).toBe(accruals);
  for (const [code, glCode] of Object.entries(LOAN_GL)) expect(gl(glCode)).toBe(b.loans.filter((l) => l.product === code).reduce((s, l) => s + l.outstanding, 0));
  const unpaid = (l: Bank["loans"][number]) => l.demands.reduce((s, d) => s + d.interest - d.paidInterest, 0);
  expect(gl(G.interestReceivable)).toBe(b.loans.reduce((s, l) => s + unpaid(l) + l.charges, 0));
  expect(neg(G.suspense)).toBe(b.loans.filter((l) => l.npaSince).reduce((s, l) => s + unpaid(l), 0));
  expect(neg(G.provisions)).toBe(b.loans.reduce((s, l) => s + l.provision, 0));
  expect(gl(G.callLent)).toBe(b.callDeals.filter((d) => d.status === "open" && d.side === "lend").reduce((s, d) => s + d.amount, 0));
  expect(neg(G.callBorrowed)).toBe(b.callDeals.filter((d) => d.status === "open" && d.side === "borrow").reduce((s, d) => s + d.amount, 0));
  expect(gl(G.gsec)).toBe(b.investments.reduce((s, i) => s + i.faceValue, 0));
  for (const a of b.accounts) {
    const last = b.txns.filter((t) => t.account === a.id).at(-1);
    expect(last ? last.balance : 0).toBe(a.balance);
  }
}

function customerWithAccount(b: Bank, name = "Asha Rao", dob = "1990-01-01", pan = "ABCPR1234F") {
  const c = K.createCustomer(b, admin, { name, dob, pan, mobile: "9876543210" });
  K.verifyKyc(b, admin, c.cif);
  const a = K.openAccount(b, admin, { cif: c.cif, type: "SB" });
  K.cashDeposit(b, admin, { account: a.id, amount: rupees(500000) });
  return { c, a };
}

describe("accounts and payments", () => {
  test("KYC comes before accounts; PAN format and uniqueness", () => {
    const b = fresh();
    expect(() => K.createCustomer(b, admin, { name: "X Y Z", dob: "1990-01-01", pan: "BAD", mobile: "9876543210" })).toThrow(/PAN/);
    const c = K.createCustomer(b, admin, { name: "Asha Rao", dob: "1990-01-01", pan: "ABCPR1234F", mobile: "9876543210" });
    expect(() => K.openAccount(b, admin, { cif: c.cif, type: "SB" })).toThrow(/KYC/);
    expect(() => K.createCustomer(b, admin, { name: "Asha R", dob: "1990-01-01", pan: "ABCPR1234F", mobile: "9876543211" })).toThrow(/already exists/);
  });
  test("cash, transfers and remittances post to the ledger and statements", () => {
    const b = fresh();
    const { a } = customerWithAccount(b);
    const { a: a2 } = customerWithAccount(b, "Ravi Kumar", "1985-02-02", "BCDPK2345G");
    K.transfer(b, admin, { from: a.id, to: a2.id, amount: rupees(1000) });
    K.remit(b, { ...admin, role: "teller" }, { from: a.id, mode: "RTGS", beneficiary: "Vendor", beneficiaryAccount: "12345678", ifsc: "GNGB0001190", amount: rupees(300000) });
    expect(() => K.remit(b, admin, { from: a.id, mode: "RTGS", beneficiary: "V", beneficiaryAccount: "12345678", ifsc: "GNGB0001190", amount: rupees(1000) })).toThrow(/2,00,000/);
    expect(() => K.cashWithdrawal(b, admin, { account: a.id, amount: rupees(900000) })).toThrow(/Insufficient/);
    reconcile(b);
    // RTGS at a branch: ₹20 + GST
    expect(a.balance).toBe(rupees(500000 - 1000 - 300000 - 23.6));
  });
  test("frozen accounts refuse debits; liens hold funds", () => {
    const b = fresh();
    const { a } = customerWithAccount(b);
    K.setLien(b, admin, a.id, rupees(450000));
    expect(() => K.cashWithdrawal(b, admin, { account: a.id, amount: rupees(60000) })).toThrow(/Insufficient/);
    K.setAccountStatus(b, admin, a.id, "frozen");
    expect(() => K.cashWithdrawal(b, admin, { account: a.id, amount: rupees(100) })).toThrow(/frozen/);
  });
});

describe("maker-checker", () => {
  test("a teller's large withdrawal waits for a manager, and the maker can't approve it", () => {
    const b = fresh();
    const { a } = customerWithAccount(b);
    const teller: K.Actor = { id: "T1", name: "Teller", role: "teller" };
    const r = execute(b, teller, "cashWithdrawal", { account: a.id, amount: rupees(300000) });
    expect(r.pending).toBeTruthy();
    expect(a.balance).toBe(rupees(500000));
    expect(() => authorise(b, { ...teller, role: "manager" }, { id: r.pending!, approve: true })).toThrow(/different/);
    authorise(b, { id: "M1", name: "Manager", role: "manager" }, { id: r.pending!, approve: true });
    expect(a.balance).toBe(rupees(200000));
    expect(() => execute(b, teller, "callDeal", {})).toThrow(/role/);
    reconcile(b);
  });
  test("an operation that would fail is refused before it is queued", () => {
    const b = fresh();
    const { a } = customerWithAccount(b);
    expect(() => execute(b, { id: "T1", name: "T", role: "teller" }, "cashWithdrawal", { account: a.id, amount: rupees(900000) })).toThrow(/Insufficient/);
    expect(b.approvals).toHaveLength(0);
  });
});

describe("deposits through end of day", () => {
  test("an FD accrues daily, compounds at quarter end and pays the contracted maturity", () => {
    const b = fresh();
    const { c, a } = customerWithAccount(b);
    const fd = K.openFd(b, admin, { cif: c.cif, amount: rupees(100000), months: 12, payout: "cumulative", from: a.id });
    runEod(b, admin, 366);
    const d = b.deposits.find((x) => x.id === fd.id)!;
    expect(d.status).toBe("matured");
    expect(d.closedAmount).toBe(fd.projected.maturity);
    reconcile(b);
  });
  test("premature closure pays less and trues up the accruals", () => {
    const b = fresh();
    const { c, a } = customerWithAccount(b);
    const fd = K.openFd(b, admin, { cif: c.cif, amount: rupees(200000), months: 24, payout: "quarterly", from: a.id });
    runEod(b, admin, 200);
    const q = K.quoteClosure(b, fd.id);
    expect(q.rate).toBe(5.5);
    const r = K.closeDepositEarly(b, admin, fd.id);
    expect(r.paid).toBe(q.payable);
    reconcile(b);
  });
  test("RD instalments are collected by standing instruction", () => {
    const b = fresh();
    const { c, a } = customerWithAccount(b);
    const rd = K.openRd(b, admin, { cif: c.cif, installment: rupees(5000), months: 12, from: a.id });
    runEod(b, admin, 366);
    const d = b.deposits.find((x) => x.id === rd.id)!;
    expect(d.installmentsPaid).toBe(12);
    expect(d.status).toBe("matured");
    expect(Math.abs(d.closedAmount - rd.projected.maturity)).toBeLessThan(rupees(50));
    reconcile(b);
  });
});

describe("loans through end of day", () => {
  test("EMIs collected by NACH; a borrower who stops paying becomes an NPA after 90 days", () => {
    const b = fresh();
    const { c, a } = customerWithAccount(b);
    const app = K.applyLoan(b, admin, { cif: c.cif, product: "PL", amount: rupees(300000), months: 24 });
    K.appraiseLoan(b, admin, app.id);
    K.sanctionLoan(b, admin, { id: app.id });
    const l = K.disburseLoan(b, admin, { id: app.id, account: a.id });
    runEod(b, admin, 95);
    expect(l.raised).toBe(3);
    expect(l.assetClass).toBe("STD");
    reconcile(b);
    // empty the account: the next EMIs bounce
    K.cashWithdrawal(b, admin, { account: a.id, amount: K.available(a) });
    runEod(b, admin, 70);
    expect(l.assetClass).toBe("SMA-1");
    expect(l.charges).toBeGreaterThan(0);
    runEod(b, admin, 60);
    expect(l.assetClass).toBe("SUB");
    expect(l.npaSince).not.toBe("");
    reconcile(b);
    // pays everything: upgraded, suspense released into income
    K.cashDeposit(b, admin, { account: a.id, amount: K.overdue(l) });
    K.repayLoan(b, admin, { id: l.id, amount: K.overdue(l) });
    runEod(b, admin, 1);
    expect(l.assetClass).toBe("STD");
    reconcile(b);
    // foreclose
    K.cashDeposit(b, admin, { account: a.id, amount: rupees(400000) });
    K.forecloseLoan(b, admin, { id: l.id });
    expect(l.status).toBe("closed");
    reconcile(b);
  });
  test("a repo cut reprices floating loans", () => {
    const b = fresh();
    const { c, a } = customerWithAccount(b);
    const app = K.applyLoan(b, admin, { cif: c.cif, product: "HL", amount: rupees(2000000), months: 240, collateralValue: rupees(4000000) });
    K.appraiseLoan(b, admin, app.id);
    K.sanctionLoan(b, admin, { id: app.id });
    const l = K.disburseLoan(b, admin, { id: app.id, account: a.id });
    const before = l.emi;
    execute(b, { id: "TR", name: "Dealer", role: "treasury" }, "setPolicyRates", { repo: 5.25, sdf: 5.0, msf: 5.5 });
    expect(l.rate).toBe(7.9);
    expect(l.emi).toBeLessThan(before);
  });
});

describe("treasury", () => {
  test("call money within prudential limits, settled at end of day", () => {
    const b = fresh();
    const dealer: K.Actor = { id: "TR", name: "Dealer", role: "treasury" };
    // capital funds ₹40 Cr: lending up to 50% (₹20 Cr) on any day
    expect(() => K.callDeal(b, dealer, { side: "lend", counterparty: "X", amount: rupees(21_00_00_000), rate: 5.5 })).toThrow(/limit/);
    const d = K.callDeal(b, dealer, { side: "borrow", counterparty: "X", amount: rupees(10_00_00_000), rate: 5.6 });
    runEod(b, admin, 1);
    expect(d.status).toBe("open");
    runEod(b, admin, 1);
    expect(d.status).toBe("settled");
    expect(b.gl[G.callExpense]).toBe(Math.round((rupees(10_00_00_000) * 5.6) / 36500));
    reconcile(b);
  });
});

describe("the sandbox", () => {
  test("five months of business reconcile, with an NPA and an SMA account", () => {
    const b = newBank({ id: "s", code: "KXYZ", name: "Kaveri National Bank", date: "2026-01-01", sandbox: true, adminHash: "h" });
    seedSandbox(b, "h", "2026-10-31");
    expect(b.date).toBe("2026-10-31");
    reconcile(b);
    const classes = b.loans.map((l) => l.assetClass);
    expect(classes).toContain("SUB");
    expect(classes.some((c) => c.startsWith("SMA"))).toBe(true);
    const t = treasuryPosition(b);
    expect(t.crrSurplus).toBeGreaterThanOrEqual(0);
    expect(t.slrSurplus).toBeGreaterThan(0);
    expect(JSON.stringify(b).length).toBeLessThan(4_000_000);
  });
});
