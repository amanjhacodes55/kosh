import { addDays, addMonths, ageOn, daysBetween, financialYear } from "./dates";
import { fail } from "./errors";
import { type Account, type Bank, type CasaType, type Channel, type Customer, type Deposit, G, GST_RATE, LOAN_GL, type Loan, type Role } from "./model";
import { formatINR, type Paise } from "./money";
import { appraise, emi, fdMaturity, fdRate, loanRate, moneyMarketInterest, prematureRate, rdMaturity, rdValue, round2, tdsDue, CALL_LIMITS } from "./rules";

// The engine: every operation a bank performs, as plain functions over one bank's books. Each one
// checks its inputs, posts a balanced voucher to the general ledger, and writes the matching lines
// to customers' statements, so the ledger and the accounts can never disagree. Callers (the API,
// end of day, the demo seed) run them inside a transaction on the store; see src/lib/store.ts.

export interface Actor {
  id: string;
  name: string;
  role: Role | "customer" | "system";
  cif?: string;
}

export const SYSTEM: Actor = { id: "system", name: "End of day", role: "system" };

// Limits above which a second person (a manager) has to authorise. See ops.ts.
export const LIMITS = {
  cashWithdrawal: 2_00_000_00,
  cash: 10_00_000_00,
  transfer: 25_00_000_00,
  loanSanction: 25_00_000_00,
  callDeal: 250_00_00_000_00,
  panForCash: 50_000_00,
  ctr: 10_00_000_00,
  rtgsMin: 2_00_000_00,
  impsMax: 5_00_000_00,
  bounceCharge: 500_00,
};

// ---------------------------------------------------------------------------------------------
// Lookups and small helpers

export function seq(b: Bank, key: string, start: number) {
  b.seq[key] = (b.seq[key] ?? start) + 1;
  return String(b.seq[key]);
}

export const customer = (b: Bank, cif: string) => b.customers.find((c) => c.cif === cif) ?? fail(`No customer with CIF ${cif}.`, 404);
export const account = (b: Bank, id: string) => b.accounts.find((a) => a.id === id) ?? fail(`No account ${id}.`, 404);
export const deposit = (b: Bank, id: string) => b.deposits.find((d) => d.id === id) ?? fail(`No deposit ${id}.`, 404);
export const loan = (b: Bank, id: string) => b.loans.find((l) => l.id === id) ?? fail(`No loan ${id}.`, 404);
export const product = (b: Bank, code: string) => b.rates.products.find((p) => p.code === code) ?? fail(`No loan product ${code}.`);

export const isSenior = (c: Customer, on: string) => ageOn(c.dob, on) >= 60;

/** What can be drawn: balance less any lien, plus the overdraft limit on a current account */
export const available = (a: Account) => a.balance - a.lien + (a.type === "CA" ? a.odLimit : 0);

export function audit(b: Bank, actor: Actor, action: string, detail: string, now = Date.now()) {
  b.audit.push({ at: now, date: b.date, user: actor.id, name: actor.name, role: actor.role, action, detail });
}

const positive = (n: unknown, what = "Amount") => {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0 || !Number.isInteger(v)) fail(`${what} must be more than zero.`);
  return v;
};

const gst = (fee: Paise) => Math.round((fee * GST_RATE) / 100);

// ---------------------------------------------------------------------------------------------
// Posting

type Entry = [gl: string, amount: number]; // debit positive, credit negative

/** Posts a balanced voucher; returns its id */
export function post(b: Bank, actor: Actor, narration: string, entries: Entry[], now = Date.now()) {
  const merged = new Map<string, number>();
  for (const [gl, amt] of entries) if (amt) merged.set(gl, (merged.get(gl) ?? 0) + Math.round(amt));
  const lines = [...merged].filter(([, v]) => v !== 0).map(([gl, v]) => ({ gl, dr: v > 0 ? v : 0, cr: v < 0 ? -v : 0 }));
  const sum = lines.reduce((s, l) => s + l.dr - l.cr, 0);
  if (sum !== 0) throw new Error(`Unbalanced voucher "${narration}": off by ${sum}`);
  if (!lines.length) return "";
  const id = `V${seq(b, "voucher", 100000)}`;
  b.vouchers.push({ id, date: b.date, at: now, narration, lines, by: actor.name });
  for (const l of lines) b.gl[l.gl] = (b.gl[l.gl] ?? 0) + l.dr - l.cr;
  return id;
}

/** Ledger entries for a change in a savings or current balance; overdrawn current accounts sit in Overdrafts */
function casaEntries(a: Account, delta: Paise): Entry[] {
  const gl = a.type === "SB" ? G.sb : G.ca;
  const after = a.balance + delta;
  const liability = Math.max(after, 0) - Math.max(a.balance, 0);
  const overdraft = Math.max(-after, 0) - Math.max(-a.balance, 0);
  const out: Entry[] = [];
  if (liability) out.push([gl, -liability]);
  if (overdraft) out.push([G.od, overdraft]);
  return out;
}

interface Movement {
  account: string;
  amount: Paise; // + credit to the customer, − debit
  narration?: string;
}

/**
 * The one way money moves: customer accounts and ledger heads together, in one balanced voucher.
 * Debits are checked against what the account can draw unless `force` (system debits such as
 * charges may take an account below zero only where an overdraft allows).
 */
export function book(
  b: Bank,
  actor: Actor,
  o: { narration: string; channel: Channel; moves: Movement[]; gl?: Entry[]; customerInitiated?: boolean; force?: boolean; now?: number },
) {
  const now = o.now ?? Date.now();
  const entries: Entry[] = [...(o.gl ?? [])];
  const staged = new Map<string, number>();
  for (const m of o.moves) {
    const a = account(b, m.account);
    if (a.status === "closed") fail(`Account ${a.id} is closed.`);
    const pending = staged.get(a.id) ?? 0;
    if (m.amount < 0) {
      if (a.status === "frozen") fail(`Account ${a.id} is frozen: debits are blocked.`);
      if (a.status === "dormant" && actor.role !== "system") fail(`Account ${a.id} is inoperative. Reactivate it after re-KYC first.`);
      if (!o.force && available(a) + pending + m.amount < 0) fail(`Insufficient funds in ${a.id}: ${formatINR(Math.max(0, available(a) + pending))} available.`);
    }
    entries.push(...casaEntries({ ...a, balance: a.balance + pending }, m.amount));
    staged.set(a.id, pending + m.amount);
  }
  const voucher = post(b, actor, o.narration, entries, now);
  for (const m of o.moves) {
    const a = account(b, m.account);
    a.balance += m.amount;
    if (o.customerInitiated !== false && actor.role !== "system") a.lastActivity = b.date;
    b.txns.push({
      id: `T${seq(b, "txn", 1000000)}`,
      date: b.date,
      at: now,
      account: a.id,
      amount: m.amount,
      balance: a.balance,
      narration: m.narration ?? o.narration,
      channel: o.channel,
      voucher,
      by: actor.name,
    });
  }
  return voucher;
}

// ---------------------------------------------------------------------------------------------
// Customers (CIF) and KYC

const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

export function createCustomer(b: Bank, actor: Actor, x: Record<string, unknown>) {
  const s = (k: string) => (typeof x[k] === "string" ? (x[k] as string).trim() : "");
  const name = s("name").replace(/\s+/g, " ");
  const pan = s("pan").toUpperCase();
  const aadhaar = s("aadhaar").replace(/\s/g, "");
  const mobile = s("mobile").replace(/\D/g, "").slice(-10);
  const dob = s("dob");
  if (name.length < 3) fail("Enter the customer's full name.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || ageOn(dob, b.date) < 0) fail("Enter a valid date of birth.");
  if (pan && !PAN.test(pan)) fail("PAN should look like ABCDE1234F.");
  if (pan && b.customers.some((c) => c.pan === pan)) fail(`A customer with PAN ${pan} already exists (one CIF per customer).`);
  if (aadhaar && !/^\d{12}$/.test(aadhaar)) fail("Aadhaar is 12 digits.");
  if (!/^[6-9]\d{9}$/.test(mobile)) fail("Enter a 10-digit mobile number.");
  const email = s("email").toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail("Enter a valid email address.");
  const risk = ["low", "medium", "high"].includes(s("risk")) ? (s("risk") as Customer["risk"]) : "low";
  const c: Customer = {
    cif: seq(b, "cif", 10_000_000),
    name,
    dob,
    pan,
    aadhaarLast4: aadhaar.slice(-4),
    mobile,
    email,
    address: s("address"),
    occupation: s("occupation") || "Salaried",
    monthlyIncome: Math.max(0, Math.round(Number(x.monthlyIncome) || 0)),
    kyc: "pending",
    risk,
    taxExempt: false,
    branch: s("branch") || b.branches[0].code,
    createdOn: b.date,
    netbanking: null,
  };
  b.customers.push(c);
  audit(b, actor, "Customer created", `CIF ${c.cif} ${c.name}`);
  return c;
}

export function verifyKyc(b: Bank, actor: Actor, cif: string) {
  const c = customer(b, cif);
  if (!c.pan && !c.aadhaarLast4) fail("KYC needs PAN or Aadhaar (officially valid documents).");
  c.kyc = "verified";
  audit(b, actor, "KYC verified", `CIF ${c.cif} ${c.name}`);
  return c;
}

export function setTaxExempt(b: Bank, actor: Actor, cif: string, exempt: boolean) {
  const c = customer(b, cif);
  c.taxExempt = exempt;
  audit(b, actor, exempt ? (isSenior(c, b.date) ? "Form 15H recorded" : "Form 15G recorded") : "Tax exemption removed", `CIF ${c.cif}`);
  return c;
}

// ---------------------------------------------------------------------------------------------
// Savings and current accounts

export function openAccount(b: Bank, actor: Actor, x: { cif: string; type: CasaType; nominee?: string; branch?: string }) {
  const c = customer(b, x.cif);
  if (c.kyc !== "verified") fail("Verify the customer's KYC before opening an account.");
  if (x.type !== "SB" && x.type !== "CA") fail("Choose savings (SB) or current (CA).");
  if (x.type === "SB" && b.accounts.some((a) => a.cif === c.cif && a.type === "SB" && a.status !== "closed")) fail("The customer already has a savings account here.");
  const a: Account = {
    id: `${x.type === "SB" ? "11" : "12"}${seq(b, "acct", 1000_0000_00)}`,
    cif: c.cif,
    type: x.type,
    branch: x.branch || c.branch,
    openedOn: b.date,
    balance: 0,
    lien: 0,
    odLimit: 0,
    status: "active",
    accrued: 0,
    lastActivity: b.date,
    nominee: (x.nominee ?? "").trim(),
  };
  b.accounts.push(a);
  audit(b, actor, "Account opened", `${a.type} ${a.id} for ${c.name}`);
  return a;
}

export function setAccountStatus(b: Bank, actor: Actor, id: string, status: "active" | "frozen", reason = "") {
  const a = account(b, id);
  if (a.status === "closed") fail("The account is closed.");
  a.status = status;
  if (status === "active") a.lastActivity = b.date;
  audit(b, actor, status === "frozen" ? "Account frozen" : "Account activated", `${a.id}${reason ? `: ${reason}` : ""}`);
  return a;
}

export function setLien(b: Bank, actor: Actor, id: string, amount: Paise) {
  const a = account(b, id);
  if (amount < 0 || amount > a.balance) fail("A lien can't be more than the balance.");
  a.lien = amount;
  audit(b, actor, "Lien marked", `${a.id}: ${formatINR(amount)}`);
  return a;
}

export function setOdLimit(b: Bank, actor: Actor, id: string, limit: Paise) {
  const a = account(b, id);
  if (a.type !== "CA") fail("Overdrafts are for current accounts.");
  if (limit < 0 || a.balance < -limit) fail("The limit can't be below what is already drawn.");
  a.odLimit = limit;
  audit(b, actor, "Overdraft limit set", `${a.id}: ${formatINR(limit)}`);
  return a;
}

export function closeAccount(b: Bank, actor: Actor, id: string) {
  const a = account(b, id);
  if (a.balance !== 0) fail("Pay out or transfer the balance before closing the account.");
  if (b.deposits.some((d) => d.linkedAccount === a.id && d.status === "active")) fail("Deposits are linked to this account.");
  if (b.loans.some((l) => l.linkedAccount === a.id && l.status === "active")) fail("A loan repays from this account.");
  a.status = "closed";
  audit(b, actor, "Account closed", a.id);
  return a;
}

// ---------------------------------------------------------------------------------------------
// Cash and payments

export function cashDeposit(b: Bank, actor: Actor, x: { account: string; amount: number; narration?: string }) {
  const amount = positive(x.amount);
  const a = account(b, x.account);
  const c = customer(b, a.cif);
  if (amount >= LIMITS.panForCash && !c.pan) fail("Cash of ₹50,000 or more needs the depositor's PAN (or Form 60).");
  const v = book(b, actor, { narration: x.narration || "Cash deposit", channel: "CASH", moves: [{ account: a.id, amount }], gl: [[G.cash, amount]] });
  if (amount >= LIMITS.ctr) b.ctr.push({ date: b.date, account: a.id, cif: a.cif, amount, kind: "deposit" });
  return { voucher: v, balance: a.balance };
}

export function cashWithdrawal(b: Bank, actor: Actor, x: { account: string; amount: number; narration?: string }) {
  const amount = positive(x.amount);
  const a = account(b, x.account);
  if ((b.gl[G.cash] ?? 0) < amount) fail("Not enough cash in the vault; ask treasury for a remittance from the currency chest.");
  const v = book(b, actor, { narration: x.narration || "Cash withdrawal", channel: "CASH", moves: [{ account: a.id, amount: -amount }], gl: [[G.cash, -amount]] });
  if (amount >= LIMITS.ctr) b.ctr.push({ date: b.date, account: a.id, cif: a.cif, amount, kind: "withdrawal" });
  return { voucher: v, balance: a.balance };
}

export function transfer(b: Bank, actor: Actor, x: { from: string; to: string; amount: number; narration?: string }) {
  const amount = positive(x.amount);
  if (x.from === x.to) fail("Choose two different accounts.");
  const from = account(b, x.from);
  const to = account(b, x.to);
  if (actor.role === "customer" && from.cif !== actor.cif) fail("You can only transfer from your own accounts.", 403);
  const toName = customer(b, to.cif).name;
  const fromName = customer(b, from.cif).name;
  const v = book(b, actor, {
    narration: x.narration || "Transfer",
    channel: "TRANSFER",
    moves: [
      { account: from.id, amount: -amount, narration: `${x.narration || "Transfer"} to ${toName} ${to.id}` },
      { account: to.id, amount, narration: `${x.narration || "Transfer"} from ${fromName} ${from.id}` },
    ],
  });
  return { voucher: v, balance: from.balance };
}

const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;

/** Outward NEFT, RTGS or IMPS: settles through the bank's current account with the RBI */
export function remit(b: Bank, actor: Actor, x: { from: string; mode: "NEFT" | "RTGS" | "IMPS"; beneficiary: string; beneficiaryAccount: string; ifsc: string; amount: number; narration?: string }) {
  const amount = positive(x.amount);
  const ifsc = String(x.ifsc ?? "").toUpperCase().trim();
  if (!["NEFT", "RTGS", "IMPS"].includes(x.mode)) fail("Choose NEFT, RTGS or IMPS.");
  if (!IFSC.test(ifsc)) fail("IFSC is 11 characters: 4 letters, a zero, then 6 letters or digits.");
  if (!/^\d{6,18}$/.test(String(x.beneficiaryAccount ?? ""))) fail("The beneficiary account number is 6 to 18 digits.");
  if (!String(x.beneficiary ?? "").trim()) fail("Enter the beneficiary's name.");
  if (x.mode === "RTGS" && amount < LIMITS.rtgsMin) fail("RTGS is for ₹2,00,000 and above; use NEFT or IMPS.");
  if (x.mode === "IMPS" && amount > LIMITS.impsMax) fail("IMPS is limited to ₹5,00,000 per transaction.");
  const from = account(b, x.from);
  if (actor.role === "customer" && from.cif !== actor.cif) fail("You can only pay from your own accounts.", 403);
  if (ifsc.startsWith(b.code)) {
    const to = b.accounts.find((a) => a.id === x.beneficiaryAccount);
    if (!to) fail("That IFSC is ours, but no such account exists here.");
    return transfer(b, actor, { from: from.id, to: to!.id, amount, narration: x.narration || `${x.mode} ${x.beneficiary}` });
  }
  // Online payments are free (RBI waived NEFT and RTGS charges for savings customers); at a branch, RTGS costs ₹20 to ₹45
  const fee = actor.role === "customer" || x.mode !== "RTGS" ? 0 : amount > 5_00_000_00 ? 45_00 : 20_00;
  const utr = `${b.code}${x.mode[0]}${b.date.replace(/-/g, "").slice(2)}${seq(b, "utr", 100000)}`;
  const narration = `${x.mode} to ${String(x.beneficiary).trim()} ${String(x.beneficiaryAccount).slice(-4).padStart(8, "x")} ${ifsc} UTR ${utr}`;
  const moves: Movement[] = [{ account: from.id, amount: -amount, narration }];
  if (fee) moves.push({ account: from.id, amount: -(fee + gst(fee)), narration: `${x.mode} charges incl. GST` });
  const v = book(b, actor, { narration, channel: x.mode, moves, gl: [[G.rbi, -amount], [G.fees, -fee], [G.gst, -gst(fee)]] });
  return { voucher: v, utr, balance: from.balance };
}

/** Inward credit from another bank (salary, a customer's own transfer in) */
export function inward(b: Bank, actor: Actor, x: { account: string; amount: number; mode: "NEFT" | "RTGS" | "IMPS"; remitter: string }) {
  const amount = positive(x.amount);
  const narration = `${x.mode} from ${x.remitter}`;
  const v = book(b, actor, { narration, channel: x.mode, moves: [{ account: x.account, amount }], gl: [[G.rbi, amount]], customerInitiated: false });
  return { voucher: v };
}

// ---------------------------------------------------------------------------------------------
// Term deposits

function fundFrom(b: Bank, actor: Actor, cif: string, from: string) {
  const a = account(b, from);
  if (a.cif !== cif) fail("Fund the deposit from the customer's own account.");
  return a;
}

export function openFd(b: Bank, actor: Actor, x: { cif: string; amount: number; days?: number; months?: number; payout?: "cumulative" | "quarterly"; from: string; autoRenew?: boolean }) {
  const c = customer(b, x.cif);
  if (c.kyc !== "verified") fail("Verify the customer's KYC first.");
  if (actor.role === "customer" && actor.cif !== c.cif) fail("Not your account.", 403);
  const amount = positive(x.amount);
  if (amount < 1_000_00) fail("The smallest fixed deposit is ₹1,000.");
  const maturityOn = x.months ? addMonths(b.date, Number(x.months)) : addDays(b.date, Number(x.days));
  const days = daysBetween(b.date, maturityOn);
  const senior = isSenior(c, b.date);
  const rate = fdRate(b.rates.fd, days, senior, b.rates.seniorExtra);
  if (rate === null) fail("Fixed deposits run from 7 days to 10 years.");
  const payout = x.payout === "quarterly" ? "quarterly" : "cumulative";
  const from = fundFrom(b, actor, c.cif, x.from);
  const d: Deposit = {
    id: `31${seq(b, "fd", 1000_0000_00)}`,
    cif: c.cif,
    kind: "FD",
    branch: c.branch,
    openedOn: b.date,
    maturityOn,
    rate: rate!,
    balance: amount,
    principal: amount,
    installment: 0,
    months: 0,
    installmentsPaid: 0,
    nextDueOn: "",
    payments: [],
    payout,
    linkedAccount: from.id,
    interestPaid: 0,
    autoRenew: Boolean(x.autoRenew),
    accrued: 0,
    status: "active",
    closedOn: "",
    closedAmount: 0,
  };
  book(b, actor, { narration: `Fixed deposit ${d.id} opened`, channel: "TRANSFER", moves: [{ account: from.id, amount: -amount }], gl: [[G.fd, -amount]] });
  b.deposits.push(d);
  audit(b, actor, "Fixed deposit opened", `${d.id} ${formatINR(amount)} at ${rate}% for ${days} days (${payout})`);
  return { ...d, projected: fdMaturity(amount, rate!, b.date, maturityOn, payout) };
}

export function openRd(b: Bank, actor: Actor, x: { cif: string; installment: number; months: number; from: string }) {
  const c = customer(b, x.cif);
  if (c.kyc !== "verified") fail("Verify the customer's KYC first.");
  if (actor.role === "customer" && actor.cif !== c.cif) fail("Not your account.", 403);
  const installment = positive(x.installment, "Instalment");
  if (installment < 100_00 || installment % 100_00) fail("Instalments are in multiples of ₹100.");
  const months = Number(x.months);
  if (!Number.isInteger(months) || months < 6 || months > 120) fail("Recurring deposits run 6 to 120 months.");
  const maturityOn = addMonths(b.date, months);
  const rate = fdRate(b.rates.fd, daysBetween(b.date, maturityOn), isSenior(c, b.date), b.rates.seniorExtra)!;
  const from = fundFrom(b, actor, c.cif, x.from);
  const d: Deposit = {
    id: `32${seq(b, "rd", 1000_0000_00)}`,
    cif: c.cif,
    kind: "RD",
    branch: c.branch,
    openedOn: b.date,
    maturityOn,
    rate,
    balance: 0,
    principal: 0,
    installment,
    months,
    installmentsPaid: 0,
    nextDueOn: b.date,
    payments: [],
    payout: "cumulative",
    linkedAccount: from.id,
    interestPaid: 0,
    autoRenew: false,
    accrued: 0,
    status: "active",
    closedOn: "",
    closedAmount: 0,
  };
  b.deposits.push(d);
  payRdInstallment(b, actor, d.id);
  audit(b, actor, "Recurring deposit opened", `${d.id} ${formatINR(installment)} a month for ${months} months at ${rate}%`);
  return { ...d, projected: rdMaturity(installment, rate, months) };
}

/** One RD instalment from the linked account; late instalments pay ₹1.50 per ₹100 per month late */
export function payRdInstallment(b: Bank, actor: Actor, id: string) {
  const d = deposit(b, id);
  if (d.kind !== "RD" || d.status !== "active") fail("That isn't an active recurring deposit.");
  if (d.installmentsPaid >= d.months) fail("Every instalment is paid.");
  const late = Math.max(0, Math.floor(daysBetween(d.nextDueOn, b.date) / 30));
  const penalty = Math.round((d.installment * 1.5 * late) / 100);
  const moves: Movement[] = [{ account: d.linkedAccount, amount: -d.installment, narration: `RD ${d.id} instalment ${d.installmentsPaid + 1} of ${d.months}` }];
  if (penalty) moves.push({ account: d.linkedAccount, amount: -penalty, narration: `RD ${d.id} late payment charge` });
  book(b, actor, { narration: `RD ${d.id} instalment`, channel: actor.role === "system" ? "NACH" : "TRANSFER", moves, gl: [[G.rd, -d.installment], [G.fees, -penalty]] });
  d.balance += d.installment;
  d.principal += d.installment;
  d.installmentsPaid++;
  d.payments.push({ on: b.date, amount: d.installment });
  d.nextDueOn = addMonths(d.openedOn, d.installmentsPaid);
  return d;
}

/** Interest booked so far on a deposit: capitalised or paid, plus today's accrual rounded */
const booked = (d: Deposit) => (d.kind === "FD" ? d.balance - d.principal : 0) + d.interestPaid + Math.round(d.accrued);

/** Deducts TDS on interest just paid or capitalised; returns the tax taken */
export function deductTds(b: Bank, d: Deposit, interest: Paise) {
  if (interest <= 0) return 0;
  const c = customer(b, d.cif);
  const fy = financialYear(b.date);
  if (b.fy.year !== fy) b.fy = { year: fy, interest: {}, tds: {} };
  b.fy.interest[c.cif] = (b.fy.interest[c.cif] ?? 0) + interest;
  const tax = tdsDue(b.fy.interest[c.cif], b.fy.tds[c.cif] ?? 0, { senior: isSenior(c, b.date), pan: Boolean(c.pan), exempt: c.taxExempt }, b.rates.tds);
  const take = Math.min(tax, interest);
  b.fy.tds[c.cif] = (b.fy.tds[c.cif] ?? 0) + take;
  return take;
}

/**
 * Closes a deposit at `rate`: the contracted rate at maturity, a reduced one when closed early.
 * The interest is worked out again from scratch and whatever was booked along the way is trued up,
 * so accrual rounding never leaks into what the customer receives.
 */
export function settleDeposit(b: Bank, actor: Actor, d: Deposit, rate: number, why: "maturity" | "premature") {
  const value = d.kind === "FD" ? d.principal + fdMaturity(d.principal, rate, d.openedOn, b.date, d.payout).interest : rdValue(d.payments, rate, b.date);
  const interest = value - d.principal; // total interest the deposit earned
  const payable = value - d.interestPaid;
  const trueUp = interest - booked(d);
  const tds = deductTds(b, d, Math.max(0, interest - (d.kind === "FD" ? d.balance - d.principal : 0) - d.interestPaid));
  const gl = d.kind === "FD" ? G.fd : G.rd;
  const narration = `${d.kind} ${d.id} ${why === "maturity" ? "matured" : "closed before maturity"}`;
  const entries: Entry[] = [[gl, d.balance], [G.interestPayable, Math.round(d.accrued)], [G.tdInterest, trueUp], [G.tds, -tds]];
  const net = payable - tds;
  let renewed: Deposit | null = null;
  if (why === "maturity" && d.autoRenew && d.kind === "FD") {
    renewed = renewFd(b, d, net);
    entries.push([G.fd, -net]);
    post(b, actor, `${narration}, renewed as ${renewed.id}`, entries);
  } else {
    book(b, actor, { narration, channel: "TRANSFER", moves: [{ account: d.linkedAccount, amount: net, narration: `${narration}${tds ? `, TDS ${formatINR(tds)}` : ""}` }], gl: entries, customerInitiated: false });
  }
  d.accrued = 0;
  d.status = why === "maturity" ? "matured" : "closed";
  d.closedOn = b.date;
  d.closedAmount = net;
  return { deposit: d, paid: net, interest, tds, rate, renewed };
}

function renewFd(b: Bank, old: Deposit, amount: Paise) {
  const days = daysBetween(old.openedOn, old.maturityOn);
  const c = customer(b, old.cif);
  const rate = fdRate(b.rates.fd, days, isSenior(c, b.date), b.rates.seniorExtra) ?? old.rate;
  const d: Deposit = { ...old, id: `31${seq(b, "fd", 1000_0000_00)}`, openedOn: b.date, maturityOn: addDays(b.date, days), rate, balance: amount, principal: amount, interestPaid: 0, accrued: 0, payments: [], status: "active", closedOn: "", closedAmount: 0 };
  b.deposits.push(d);
  return d;
}

export function closeDepositEarly(b: Bank, actor: Actor, id: string) {
  const d = deposit(b, id);
  if (d.status !== "active") fail("The deposit is already closed.");
  if (actor.role === "customer" && actor.cif !== d.cif) fail("Not your deposit.", 403);
  const c = customer(b, d.cif);
  const ran = daysBetween(d.openedOn, b.date);
  const rate = prematureRate(b.rates.fd, ran, d.rate, isSenior(c, d.openedOn), b.rates.seniorExtra, b.rates.prematurePenalty);
  const r = settleDeposit(b, actor, d, rate, "premature");
  audit(b, actor, "Deposit closed early", `${d.id}: ${ran} days at ${rate}% (contracted ${d.rate}%), paid ${formatINR(r.paid)}`);
  return r;
}

/** What closing a deposit today would pay, without closing it */
export function quoteClosure(b: Bank, id: string) {
  const d = deposit(b, id);
  const c = customer(b, d.cif);
  const ran = daysBetween(d.openedOn, b.date);
  const rate = prematureRate(b.rates.fd, ran, d.rate, isSenior(c, d.openedOn), b.rates.seniorExtra, b.rates.prematurePenalty);
  const value = d.kind === "FD" ? d.principal + fdMaturity(d.principal, rate, d.openedOn, b.date, d.payout).interest : rdValue(d.payments, rate, b.date);
  const atMaturity = d.kind === "FD" ? fdMaturity(d.principal, d.rate, d.openedOn, d.maturityOn, d.payout).maturity : rdMaturity(d.installment, d.rate, d.months).maturity;
  return { days: ran, rate, contracted: d.rate, penalty: b.rates.prematurePenalty, payable: value - d.interestPaid, atMaturity };
}

// ---------------------------------------------------------------------------------------------
// Loans: application, appraisal, sanction, disbursal, repayment

export function applyLoan(b: Bank, actor: Actor, x: { cif: string; product: string; amount: number; months: number; purpose?: string; collateralKind?: string; collateralValue?: number; existingEmi?: number }) {
  const c = customer(b, x.cif);
  if (actor.role === "customer" && actor.cif !== c.cif) fail("Not your account.", 403);
  const p = product(b, x.product);
  const amount = positive(x.amount);
  const months = Number(x.months);
  if (!Number.isInteger(months) || months < 6) fail("Choose a tenure of at least 6 months.");
  const value = Math.round(Number(x.collateralValue) || 0);
  if (p.secured && value <= 0) fail(`A ${p.name.toLowerCase()} needs the value of the security.`);
  const app = {
    id: `LA${seq(b, "app", 10000)}`,
    cif: c.cif,
    product: p.code,
    amount,
    months,
    purpose: String(x.purpose ?? "").trim() || p.name,
    collateral: p.secured ? { kind: String(x.collateralKind || (p.code === "GL" ? "Gold ornaments" : p.code === "AL" ? "Hypothecation of vehicle" : "Mortgage of property")), value } : null,
    existingEmi: Math.max(0, Math.round(Number(x.existingEmi) || 0)),
    status: "applied" as const,
    appliedOn: b.date,
    appraisal: null,
    rate: loanRate(p, b.rates.policy),
    decisionNote: "",
    loanId: "",
    by: actor.name,
  };
  b.applications.push(app);
  audit(b, actor, "Loan application", `${app.id} ${p.name} ${formatINR(amount)} for ${c.name}`);
  return app;
}

const application = (b: Bank, id: string) => b.applications.find((a) => a.id === id) ?? fail(`No application ${id}.`, 404);

export function appraiseLoan(b: Bank, actor: Actor, id: string) {
  const app = application(b, id);
  if (!["applied", "appraised"].includes(app.status)) fail("The application has moved past appraisal.");
  const c = customer(b, app.cif);
  if (c.kyc !== "verified") fail("Verify the customer's KYC first.");
  if (!c.pan) fail("A credit report needs the customer's PAN.");
  const p = product(b, app.product);
  app.rate = loanRate(p, b.rates.policy);
  // existing EMIs at this bank are added to what the applicant declared
  const ours = b.loans.filter((l) => l.cif === c.cif && l.status === "active").reduce((s, l) => s + l.emi, 0);
  app.appraisal = appraise({ amount: app.amount, months: app.months, rate: app.rate, monthlyIncome: c.monthlyIncome, existingEmi: app.existingEmi + ours, collateral: app.collateral?.value ?? 0, pan: c.pan }, p);
  app.status = "appraised";
  audit(b, actor, "Loan appraised", `${app.id}: score ${app.appraisal.score}, FOIR ${app.appraisal.foir}%, ${app.appraisal.recommend}`);
  return app;
}

export function sanctionLoan(b: Bank, actor: Actor, x: { id: string; note?: string }) {
  const app = application(b, x.id);
  if (app.status !== "appraised") fail("Appraise the application before sanctioning it.");
  app.status = "sanctioned";
  app.decisionNote = String(x.note ?? "");
  audit(b, actor, "Loan sanctioned", `${app.id} ${formatINR(app.amount)} at ${app.rate}%`);
  return app;
}

export function rejectLoan(b: Bank, actor: Actor, x: { id: string; note?: string }) {
  const app = application(b, x.id);
  if (["disbursed", "rejected"].includes(app.status)) fail("The application is already closed.");
  app.status = "rejected";
  app.decisionNote = String(x.note ?? "") || "Declined";
  audit(b, actor, "Loan rejected", `${app.id}: ${app.decisionNote}`);
  return app;
}

export function disburseLoan(b: Bank, actor: Actor, x: { id: string; account: string }) {
  const app = application(b, x.id);
  if (app.status !== "sanctioned") fail("Only sanctioned loans can be disbursed.");
  const a = account(b, x.account);
  if (a.cif !== app.cif) fail("Disburse into the borrower's own account.");
  const p = product(b, app.product);
  const fee = Math.round((app.amount * p.processingFeePct) / 100);
  const l: Loan = {
    id: `71${seq(b, "loan", 1000_0000_00)}`,
    cif: app.cif,
    product: p.code,
    branch: customer(b, app.cif).branch,
    applicationId: app.id,
    sanctioned: app.amount,
    disbursedOn: b.date,
    outstanding: app.amount,
    rate: app.rate,
    rateType: p.rateType,
    spread: p.spread,
    months: app.months,
    emi: emi(app.amount, app.rate, app.months),
    firstDueOn: addMonths(b.date, 1),
    nextDueOn: addMonths(b.date, 1),
    raised: 0,
    demands: [],
    charges: 0,
    linkedAccount: a.id,
    collateral: app.collateral,
    assetClass: "STD",
    dpd: 0,
    npaSince: "",
    provision: 0,
    status: "active",
    closedOn: "",
  };
  b.loans.push(l);
  book(b, actor, {
    narration: `${p.name} ${l.id} disbursed`,
    channel: "TRANSFER",
    moves: [
      { account: a.id, amount: app.amount, narration: `${p.name} ${l.id} disbursed` },
      { account: a.id, amount: -(fee + gst(fee)), narration: `Processing fee ${l.id} incl. GST` },
    ],
    gl: [[LOAN_GL[p.code], app.amount], [G.fees, -fee], [G.gst, -gst(fee)]],
    customerInitiated: false,
  });
  // standard-asset provision from day one
  const provision = Math.round((l.outstanding * 0.4) / 100);
  post(b, actor, `Standard asset provision ${l.id}`, [[G.provisionExpense, provision], [G.provisions, -provision]]);
  l.provision = provision;
  app.status = "disbursed";
  app.loanId = l.id;
  audit(b, actor, "Loan disbursed", `${l.id} ${formatINR(app.amount)} to ${a.id}, EMI ${formatINR(l.emi)}`);
  return l;
}

export const overdue = (l: Loan) => l.demands.reduce((s, d) => s + d.principal - d.paidPrincipal + d.interest - d.paidInterest, 0) + l.charges;

/**
 * Applies a repayment: charges first, then interest, then principal, oldest instalment first (the
 * usual order of appropriation). Anything left over prepays principal and shortens the tenure.
 */
export function repayLoan(b: Bank, actor: Actor, x: { id: string; amount: number; from?: string; cash?: boolean }, channel: Channel = x.cash ? "CASH" : "TRANSFER") {
  const l = loan(b, x.id);
  if (l.status !== "active") fail("The loan is closed.");
  if (actor.role === "customer" && actor.cif !== l.cif) fail("Not your loan.", 403);
  let left = positive(x.amount);
  const npa = l.npaSince !== "";
  const entries: Entry[] = [];
  const takeCharges = Math.min(left, l.charges);
  l.charges -= takeCharges;
  left -= takeCharges;
  entries.push([G.interestReceivable, -takeCharges]);
  let interest = 0;
  let principal = 0;
  for (const d of l.demands) {
    const i = Math.min(left, d.interest - d.paidInterest);
    d.paidInterest += i;
    left -= i;
    interest += i;
    const p = Math.min(left, d.principal - d.paidPrincipal);
    d.paidPrincipal += p;
    left -= p;
    principal += p;
  }
  // whatever is left prepays principal; the EMI stays, so the loan simply finishes sooner
  const prepaid = Math.min(left, l.outstanding - principal);
  principal += prepaid;
  left -= prepaid;
  if (left > 0) fail(`That is more than the loan needs: ${formatINR(x.amount - left)} clears it.`);
  l.outstanding -= principal;
  entries.push([G.interestReceivable, -interest], [LOAN_GL[l.product], -principal]);
  // interest on an NPA was held in suspense; it becomes income only when it is actually paid
  if (npa && interest) entries.push([G.suspense, interest], [G.loanInterest, -interest]);
  const amount = x.amount;
  const narration = `Repayment ${l.id}${prepaid ? `, ${formatINR(prepaid)} prepaid` : ""}`;
  if (x.cash) book(b, actor, { narration, channel: "CASH", moves: [], gl: [...entries, [G.cash, amount]] });
  else book(b, actor, { narration, channel, moves: [{ account: x.from || l.linkedAccount, amount: -amount }], gl: entries });
  l.demands = l.demands.filter((d) => d.paidInterest < d.interest || d.paidPrincipal < d.principal);
  refreshDpd(b, l);
  if (l.outstanding === 0 && overdue(l) === 0) closeLoan(b, actor, l);
  return { loan: l, interest, principal, charges: takeCharges, prepaid };
}

/** Clears everything: arrears, interest for the broken period, principal and any foreclosure charge */
export function quoteForeclosure(b: Bank, id: string) {
  const l = loan(b, id);
  const p = product(b, l.product);
  const lastDue = l.nextDueOn > b.date ? addMonths(l.nextDueOn, -1) : l.nextDueOn;
  const broken = Math.max(0, daysBetween(lastDue < l.disbursedOn ? l.disbursedOn : lastDue, b.date));
  const brokenInterest = Math.round((l.outstanding * l.rate * broken) / 36_500);
  const charge = l.rateType === "floating" ? 0 : Math.round((l.outstanding * p.foreclosurePct) / 100);
  return { arrears: overdue(l) - unpaidPrincipal(l), principal: l.outstanding, brokenInterest, charge, gst: gst(charge), total: overdue(l) - unpaidPrincipal(l) + l.outstanding + brokenInterest + charge + gst(charge) };
}
const unpaidPrincipal = (l: Loan) => l.demands.reduce((s, d) => s + d.principal - d.paidPrincipal, 0);

export function forecloseLoan(b: Bank, actor: Actor, x: { id: string; from?: string }) {
  const l = loan(b, x.id);
  if (actor.role === "customer" && actor.cif !== l.cif) fail("Not your loan.", 403);
  const q = quoteForeclosure(b, l.id);
  const from = account(b, x.from || l.linkedAccount);
  if (available(from) < q.total) fail(`Foreclosure needs ${formatINR(q.total)}; ${formatINR(available(from))} is available.`);
  // book the broken-period interest and the charge as dues, then repay the lot
  if (q.brokenInterest) {
    l.demands.push({ dueOn: b.date, principal: 0, interest: q.brokenInterest, paidPrincipal: 0, paidInterest: 0 });
    post(b, actor, `Broken-period interest ${l.id}`, [[G.interestReceivable, q.brokenInterest], [l.npaSince ? G.suspense : G.loanInterest, -q.brokenInterest]]);
  }
  if (q.charge) {
    l.charges += q.charge + q.gst;
    post(b, actor, `Foreclosure charge ${l.id}`, [[G.interestReceivable, q.charge + q.gst], [G.fees, -q.charge], [G.gst, -q.gst]]);
  }
  repayLoan(b, actor, { id: l.id, amount: q.total, from: from.id });
  audit(b, actor, "Loan foreclosed", `${l.id}: ${formatINR(q.total)}`);
  return { loan: l, ...q };
}

function closeLoan(b: Bank, actor: Actor, l: Loan) {
  l.status = "closed";
  l.closedOn = b.date;
  l.dpd = 0;
  l.assetClass = "STD";
  l.npaSince = "";
  if (l.provision) post(b, actor, `Provision released ${l.id}`, [[G.provisions, l.provision], [G.provisionExpense, -l.provision]]);
  l.provision = 0;
  audit(b, actor, "Loan closed", l.id);
}

export function refreshDpd(b: Bank, l: Loan) {
  const oldest = l.demands.find((d) => d.paidInterest < d.interest || d.paidPrincipal < d.principal);
  l.dpd = oldest ? Math.max(0, daysBetween(oldest.dueOn, b.date)) : 0;
}

/** Floating-rate loans move with the repo rate: the new rate applies and the EMI is reset over the remaining tenure */
export function repriceFloating(b: Bank, actor: Actor) {
  let n = 0;
  for (const l of b.loans) {
    if (l.status !== "active" || l.rateType !== "floating") continue;
    const rate = round2(b.rates.policy.repo + l.spread);
    if (rate === l.rate) continue;
    const remaining = Math.max(1, l.months - l.raised);
    l.rate = rate;
    l.emi = emi(l.outstanding - unpaidPrincipal(l), rate, remaining);
    n++;
  }
  if (n) audit(b, actor, "Floating loans repriced", `${n} loan${n === 1 ? "" : "s"} moved to repo ${b.rates.policy.repo}% + spread`);
  return n;
}

// ---------------------------------------------------------------------------------------------
// Treasury

export const capitalFunds = (b: Bank) => -((b.gl[G.capital] ?? 0) + (b.gl[G.reserves] ?? 0));

export function callDeal(b: Bank, actor: Actor, x: { side: "borrow" | "lend"; counterparty: string; amount: number; rate: number; days?: number }) {
  const amount = positive(x.amount);
  const rate = Number(x.rate);
  const days = Number(x.days ?? 1);
  if (!(rate > 0 && rate < 30)) fail("Enter the deal rate in % a year.");
  if (!Number.isInteger(days) || days < 1 || days > 14) fail("Call money is overnight; notice money runs 2 to 14 days.");
  if (!String(x.counterparty ?? "").trim()) fail("Choose the counterparty.");
  const cap = capitalFunds(b);
  const open = (side: string) => b.callDeals.filter((d) => d.status === "open" && d.side === side).reduce((s, d) => s + d.amount, 0);
  if (x.side === "borrow") {
    const limit = Math.round((cap * CALL_LIMITS.borrowDay) / 100);
    if (open("borrow") + amount > limit) fail(`Borrowing would reach ${formatINR(open("borrow") + amount)}, over the day limit of ${CALL_LIMITS.borrowDay}% of capital funds (${formatINR(limit)}).`);
  } else if (x.side === "lend") {
    const limit = Math.round((cap * CALL_LIMITS.lendDay) / 100);
    if (open("lend") + amount > limit) fail(`Lending would reach ${formatINR(open("lend") + amount)}, over the day limit of ${CALL_LIMITS.lendDay}% of capital funds (${formatINR(limit)}).`);
    if ((b.gl[G.rbi] ?? 0) < amount) fail("Not enough in the RBI current account to lend that.");
  } else fail("Choose borrow or lend.");
  const deal = {
    id: `CM${seq(b, "call", 1000)}`,
    side: x.side,
    counterparty: String(x.counterparty).trim(),
    amount,
    rate: round2(rate),
    days,
    dealtOn: b.date,
    maturesOn: addDays(b.date, days),
    status: "open" as const,
    interest: moneyMarketInterest(amount, rate, days),
    by: actor.name,
  };
  const name = days === 1 ? "Call money" : "Notice money";
  if (x.side === "borrow") post(b, actor, `${name} borrowed from ${deal.counterparty} ${deal.id}`, [[G.rbi, amount], [G.callBorrowed, -amount]]);
  else post(b, actor, `${name} lent to ${deal.counterparty} ${deal.id}`, [[G.callLent, amount], [G.rbi, -amount]]);
  b.callDeals.push(deal);
  const corridor = rate < b.rates.policy.sdf || rate > b.rates.policy.msf;
  audit(b, actor, `${name} ${x.side === "borrow" ? "borrowed" : "lent"}`, `${deal.id} ${formatINR(amount)} at ${deal.rate}% for ${days} day${days === 1 ? "" : "s"} with ${deal.counterparty}${corridor ? " (outside the SDF–MSF corridor)" : ""}`);
  return deal;
}

export function settleCall(b: Bank, actor: Actor, id: string) {
  const d = b.callDeals.find((x) => x.id === id) ?? fail("No such deal.");
  if (d.status !== "open") fail("The deal is settled.");
  if (d.side === "borrow") post(b, actor, `Call money repaid to ${d.counterparty} ${d.id}`, [[G.callBorrowed, d.amount], [G.callExpense, d.interest], [G.rbi, -(d.amount + d.interest)]]);
  else post(b, actor, `Call money received back from ${d.counterparty} ${d.id}`, [[G.rbi, d.amount + d.interest], [G.callLent, -d.amount], [G.callIncome, -d.interest]]);
  d.status = "settled";
  return d;
}

export function buyGsec(b: Bank, actor: Actor, x: { security: string; amount: number; coupon: number; maturity: string }) {
  const amount = positive(x.amount);
  if ((b.gl[G.rbi] ?? 0) < amount) fail("Not enough in the RBI current account.");
  const inv = { id: `GS${seq(b, "gsec", 100)}`, security: String(x.security || "GOI dated security").trim(), faceValue: amount, coupon: Number(x.coupon) || 7, maturity: String(x.maturity || addMonths(b.date, 120)), boughtOn: b.date };
  post(b, actor, `Bought ${inv.security} ${inv.id}`, [[G.gsec, amount], [G.rbi, -amount]]);
  b.investments.push(inv);
  audit(b, actor, "G-Sec bought", `${inv.security} ${formatINR(amount)}`);
  return inv;
}

export function sellGsec(b: Bank, actor: Actor, id: string) {
  const inv = b.investments.find((i) => i.id === id) ?? fail("No such holding.");
  post(b, actor, `Sold ${inv.security} ${inv.id}`, [[G.rbi, inv.faceValue], [G.gsec, -inv.faceValue]]);
  b.investments = b.investments.filter((i) => i.id !== id);
  audit(b, actor, "G-Sec sold", `${inv.security} ${formatINR(inv.faceValue)}`);
  return inv;
}

/** Moves cash between the branch vault and the RBI (through the currency chest) */
export function remitCash(b: Bank, actor: Actor, x: { direction: "toRbi" | "fromRbi"; amount: number }) {
  const amount = positive(x.amount);
  if (x.direction === "toRbi") {
    if ((b.gl[G.cash] ?? 0) < amount) fail("The vault doesn't hold that much cash.");
    post(b, actor, "Cash remitted to currency chest", [[G.rbi, amount], [G.cash, -amount]]);
  } else {
    if ((b.gl[G.rbi] ?? 0) < amount) fail("The RBI balance isn't that large.");
    post(b, actor, "Cash drawn from currency chest", [[G.cash, amount], [G.rbi, -amount]]);
  }
  audit(b, actor, "Cash remittance", `${x.direction === "toRbi" ? "Vault to RBI" : "RBI to vault"} ${formatINR(amount)}`);
  return { cash: b.gl[G.cash], rbi: b.gl[G.rbi] };
}
