import * as K from "./bank";
import { type Actor, LIMITS } from "./bank";
import { fail } from "./errors";
import { runEod } from "./eod";
import { type Bank, type Role, ROLES, type Staff } from "./model";
import { formatINR, type Paise } from "./money";
import { round2 } from "./rules";

// Every operation the API accepts, who may run it, and when it needs a second person. An operation
// over its limit is not refused: it is checked (by running it on a copy of the books), queued, and
// posted only when a manager authorises it. The maker can never authorise their own entry.

type Who = Role | "customer";
type Args = Record<string, unknown>;

interface Op {
  label: string;
  who: Who[];
  run: (b: Bank, a: Actor, x: Args) => unknown;
  /** When this returns something, the operation waits for authorisation */
  check?: (b: Bank, a: Actor, x: Args) => { summary: string; amount: Paise } | null;
  /** For operations that don't write their own audit line */
  describe?: (b: Bank, x: Args) => string;
}

const S = (v: unknown) => String(v ?? "");
const N = (v: unknown) => Number(v);
const CHECKERS: Role[] = ["manager", "admin"];
const isChecker = (a: Actor) => CHECKERS.includes(a.role as Role);

export const OPS: Record<string, Op> = {
  // Customers
  createCustomer: { label: "Create customer", who: ["officer", "manager", "admin"], run: (b, a, x) => K.createCustomer(b, a, x) },
  verifyKyc: { label: "Verify KYC", who: ["officer", "manager"], run: (b, a, x) => K.verifyKyc(b, a, S(x.cif)) },
  setTaxExempt: { label: "Form 15G/15H", who: ["officer", "manager"], run: (b, a, x) => K.setTaxExempt(b, a, S(x.cif), Boolean(x.exempt)) },
  enableNetbanking: {
    label: "Enable net banking",
    who: ["officer", "manager"],
    run: (b, a, x) => {
      const c = K.customer(b, S(x.cif));
      if (c.kyc !== "verified") fail("Verify KYC before enabling net banking.");
      c.netbanking = { passwordHash: S(x.passwordHash) };
      K.audit(b, a, "Net banking enabled", `CIF ${c.cif}`);
      return { cif: c.cif };
    },
  },

  // Accounts
  openAccount: { label: "Open account", who: ["officer", "manager"], run: (b, a, x) => K.openAccount(b, a, { cif: S(x.cif), type: S(x.type) as "SB" | "CA", nominee: S(x.nominee) }) },
  freezeAccount: { label: "Freeze account", who: ["manager", "admin"], run: (b, a, x) => K.setAccountStatus(b, a, S(x.account), "frozen", S(x.reason)) },
  activateAccount: { label: "Activate account", who: ["manager", "officer"], run: (b, a, x) => K.setAccountStatus(b, a, S(x.account), "active", S(x.reason)) },
  setLien: { label: "Mark lien", who: ["manager"], run: (b, a, x) => K.setLien(b, a, S(x.account), N(x.amount)) },
  setOdLimit: { label: "Overdraft limit", who: ["manager"], run: (b, a, x) => K.setOdLimit(b, a, S(x.account), N(x.amount)) },
  closeAccount: { label: "Close account", who: ["officer", "manager"], run: (b, a, x) => K.closeAccount(b, a, S(x.account)) },

  // Counter
  cashDeposit: {
    label: "Cash deposit",
    who: ["teller", "manager"],
    run: (b, a, x) => K.cashDeposit(b, a, { account: S(x.account), amount: N(x.amount), narration: S(x.narration) }),
    check: (b, a, x) => (!isChecker(a) && N(x.amount) >= LIMITS.cash ? { summary: `Cash deposit ${formatINR(N(x.amount))} into ${S(x.account)}`, amount: N(x.amount) } : null),
    describe: (b, x) => `${formatINR(N(x.amount))} into ${S(x.account)}`,
  },
  cashWithdrawal: {
    label: "Cash withdrawal",
    who: ["teller", "manager"],
    run: (b, a, x) => K.cashWithdrawal(b, a, { account: S(x.account), amount: N(x.amount), narration: S(x.narration) }),
    check: (b, a, x) => (!isChecker(a) && N(x.amount) > LIMITS.cashWithdrawal ? { summary: `Cash withdrawal ${formatINR(N(x.amount))} from ${S(x.account)}`, amount: N(x.amount) } : null),
    describe: (b, x) => `${formatINR(N(x.amount))} from ${S(x.account)}`,
  },
  transfer: {
    label: "Transfer",
    who: ["teller", "officer", "manager", "customer"],
    run: (b, a, x) => K.transfer(b, a, { from: S(x.from), to: S(x.to), amount: N(x.amount), narration: S(x.narration) }),
    check: (b, a, x) => (a.role !== "customer" && !isChecker(a) && N(x.amount) > LIMITS.transfer ? { summary: `Transfer ${formatINR(N(x.amount))} from ${S(x.from)} to ${S(x.to)}`, amount: N(x.amount) } : null),
    describe: (b, x) => `${formatINR(N(x.amount))} ${S(x.from)} → ${S(x.to)}`,
  },
  remit: {
    label: "NEFT / RTGS / IMPS",
    who: ["teller", "manager", "customer"],
    run: (b, a, x) => K.remit(b, a, { from: S(x.from), mode: S(x.mode) as "NEFT", beneficiary: S(x.beneficiary), beneficiaryAccount: S(x.beneficiaryAccount), ifsc: S(x.ifsc), amount: N(x.amount), narration: S(x.narration) }),
    check: (b, a, x) => (a.role !== "customer" && !isChecker(a) && N(x.amount) > LIMITS.transfer ? { summary: `${S(x.mode)} ${formatINR(N(x.amount))} to ${S(x.beneficiary)}`, amount: N(x.amount) } : null),
    describe: (b, x) => `${S(x.mode)} ${formatINR(N(x.amount))} from ${S(x.from)} to ${S(x.beneficiary)} (${S(x.ifsc).toUpperCase()})`,
  },
  inward: {
    label: "Inward remittance",
    who: ["teller", "manager"],
    run: (b, a, x) => K.inward(b, a, { account: S(x.account), amount: N(x.amount), mode: (S(x.mode) || "NEFT") as "NEFT", remitter: S(x.remitter) || "Remitter" }),
    describe: (b, x) => `${formatINR(N(x.amount))} into ${S(x.account)} from ${S(x.remitter)}`,
  },

  // Deposits
  openFd: {
    label: "Open fixed deposit",
    who: ["officer", "manager", "customer"],
    run: (b, a, x) => K.openFd(b, a, { cif: a.role === "customer" ? a.cif! : S(x.cif), amount: N(x.amount), days: x.days ? N(x.days) : undefined, months: x.months ? N(x.months) : undefined, payout: S(x.payout) as "cumulative", from: S(x.from), autoRenew: Boolean(x.autoRenew) }),
  },
  openRd: { label: "Open recurring deposit", who: ["officer", "manager", "customer"], run: (b, a, x) => K.openRd(b, a, { cif: a.role === "customer" ? a.cif! : S(x.cif), installment: N(x.installment), months: N(x.months), from: S(x.from) }) },
  payRd: { label: "RD instalment", who: ["teller", "officer", "manager", "customer"], run: (b, a, x) => K.payRdInstallment(b, a, S(x.id)), describe: (b, x) => S(x.id) },
  closeDeposit: { label: "Close deposit early", who: ["officer", "manager", "customer"], run: (b, a, x) => K.closeDepositEarly(b, a, S(x.id)) },

  // Loans
  applyLoan: {
    label: "Loan application",
    who: ["credit", "officer", "manager", "customer"],
    run: (b, a, x) => K.applyLoan(b, a, { cif: a.role === "customer" ? a.cif! : S(x.cif), product: S(x.product), amount: N(x.amount), months: N(x.months), purpose: S(x.purpose), collateralKind: S(x.collateralKind), collateralValue: N(x.collateralValue), existingEmi: N(x.existingEmi) }),
  },
  appraiseLoan: { label: "Appraise loan", who: ["credit", "manager"], run: (b, a, x) => K.appraiseLoan(b, a, S(x.id)) },
  sanctionLoan: {
    label: "Sanction loan",
    who: ["credit", "manager"],
    run: (b, a, x) => K.sanctionLoan(b, a, { id: S(x.id), note: S(x.note) }),
    check: (b, a, x) => {
      if (isChecker(a)) return null;
      const app = b.applications.find((p) => p.id === S(x.id));
      if (!app) return null;
      if (app.amount > LIMITS.loanSanction) return { summary: `Sanction ${app.id}: ${formatINR(app.amount)}, above the credit officer's ${formatINR(LIMITS.loanSanction)} limit`, amount: app.amount };
      if (app.appraisal && app.appraisal.recommend !== "approve") return { summary: `Sanction ${app.id} against the appraisal (${app.appraisal.recommend})`, amount: app.amount };
      return null;
    },
  },
  rejectLoan: { label: "Reject loan", who: ["credit", "manager"], run: (b, a, x) => K.rejectLoan(b, a, { id: S(x.id), note: S(x.note) }) },
  disburseLoan: { label: "Disburse loan", who: ["credit", "manager"], run: (b, a, x) => K.disburseLoan(b, a, { id: S(x.id), account: S(x.account) }) },
  repayLoan: {
    label: "Loan repayment",
    who: ["teller", "credit", "manager", "customer"],
    run: (b, a, x) => K.repayLoan(b, a, { id: S(x.id), amount: N(x.amount), from: S(x.from) || undefined, cash: Boolean(x.cash) && a.role !== "customer" }),
    describe: (b, x) => `${formatINR(N(x.amount))} to ${S(x.id)}${x.cash ? " in cash" : ""}`,
  },
  forecloseLoan: { label: "Foreclose loan", who: ["credit", "manager", "customer"], run: (b, a, x) => K.forecloseLoan(b, a, { id: S(x.id), from: S(x.from) || undefined }) },

  // Treasury
  setPolicyRates: {
    label: "Policy rates",
    who: ["treasury", "admin"],
    run: (b, a, x) => {
      const p = b.rates.policy;
      const before = { ...p };
      for (const k of ["repo", "sdf", "msf", "bankRate", "crr", "slr"] as const) {
        if (x[k] === undefined || x[k] === "") continue;
        const v = N(x[k]);
        if (!(v >= 0 && v < 50)) fail(`${k.toUpperCase()} should be a percentage.`);
        p[k] = round2(v);
      }
      if (!(p.sdf <= p.repo && p.repo <= p.msf)) fail("The repo rate sits between the SDF (floor) and the MSF (ceiling).");
      const changed = (Object.keys(p) as (keyof typeof p)[]).filter((k) => p[k] !== before[k]).map((k) => `${k} ${before[k]}% → ${p[k]}%`);
      K.audit(b, a, "Policy rates updated", changed.join(", ") || "No change");
      const repriced = before.repo !== p.repo ? K.repriceFloating(b, a) : 0;
      return { policy: p, repriced };
    },
  },
  setRates: {
    label: "Rate card",
    who: ["treasury", "admin"],
    run: (b, a, x) => {
      const r = b.rates;
      if (Array.isArray(x.fd)) r.fd = (x.fd as { from: number; to: number; rate: number }[]).map((f) => ({ from: N(f.from), to: N(f.to), rate: round2(N(f.rate)) }));
      if (Array.isArray(x.sb)) r.sb = (x.sb as { upto: number | null; rate: number }[]).map((s) => ({ upto: s.upto === null ? null : N(s.upto), rate: round2(N(s.rate)) }));
      if (x.seniorExtra !== undefined) r.seniorExtra = round2(N(x.seniorExtra));
      if (x.prematurePenalty !== undefined) r.prematurePenalty = round2(N(x.prematurePenalty));
      if (x.odRate !== undefined) r.odRate = round2(N(x.odRate));
      if (x.product && typeof x.product === "object") {
        const p = K.product(b, S((x.product as Args).code));
        const y = x.product as Args;
        if (y.spread !== undefined) p.spread = round2(N(y.spread));
        if (y.fixedRate !== undefined) p.fixedRate = round2(N(y.fixedRate));
        if (y.processingFeePct !== undefined) p.processingFeePct = round2(N(y.processingFeePct));
      }
      for (const f of r.fd) if (!(f.rate >= 0 && f.rate < 20 && f.from <= f.to)) fail("Check the FD card: each row needs a tenure range and a rate.");
      K.audit(b, a, "Rate card updated", "Deposit and loan rates");
      return r;
    },
  },
  callDeal: {
    label: "Call money deal",
    who: ["treasury"],
    run: (b, a, x) => K.callDeal(b, a, { side: S(x.side) as "borrow", counterparty: S(x.counterparty), amount: N(x.amount), rate: N(x.rate), days: N(x.days) || 1 }),
    check: (b, a, x) => (N(x.amount) > LIMITS.callDeal ? { summary: `Call money ${S(x.side)} ${formatINR(N(x.amount))} with ${S(x.counterparty)} at ${N(x.rate)}%`, amount: N(x.amount) } : null),
  },
  buyGsec: { label: "Buy G-Sec", who: ["treasury"], run: (b, a, x) => K.buyGsec(b, a, { security: S(x.security), amount: N(x.amount), coupon: N(x.coupon), maturity: S(x.maturity) }) },
  sellGsec: { label: "Sell G-Sec", who: ["treasury"], run: (b, a, x) => K.sellGsec(b, a, S(x.id)) },
  remitCash: { label: "Currency chest", who: ["treasury", "manager"], run: (b, a, x) => K.remitCash(b, a, { direction: S(x.direction) as "toRbi", amount: N(x.amount) }) },

  // Operations
  runEod: {
    label: "End of day",
    who: ["manager", "admin"],
    run: (b, a, x) => {
      const days = Math.min(400, Math.max(1, Math.floor(N(x.days) || 1)));
      const waiting = b.approvals.filter((p) => p.status === "pending").length;
      if (waiting && !x.force) fail(`${waiting} transaction${waiting === 1 ? " is" : "s are"} waiting for authorisation. Authorise or reject ${waiting === 1 ? "it" : "them"} before closing the day.`, 409);
      return runEod(b, a, days);
    },
  },

  // Administration
  createStaff: {
    label: "Create user",
    who: ["admin"],
    run: (b, a, x) => {
      const username = S(x.username).trim().toLowerCase();
      if (!/^[a-z][a-z0-9.]{2,23}$/.test(username)) fail("User IDs are 3 to 24 letters, digits or dots.");
      if (b.staff.some((s) => s.username === username)) fail("That user ID is taken.");
      if (!(S(x.role) in ROLES)) fail("Choose a role.");
      const s: Staff = { id: `U${K.seq(b, "staff", 100)}`, username, name: S(x.name).trim() || username, role: S(x.role) as Role, branch: S(x.branch) || b.branches[0].code, passwordHash: S(x.passwordHash), active: true };
      b.staff.push(s);
      K.audit(b, a, "User created", `${s.username} (${ROLES[s.role].label})`);
      return { id: s.id };
    },
  },
  setStaffActive: {
    label: "Enable or disable user",
    who: ["admin"],
    run: (b, a, x) => {
      const s = b.staff.find((u) => u.id === S(x.id)) ?? fail("No such user.");
      if (s.id === a.id) fail("You can't disable yourself.");
      s.active = Boolean(x.active);
      K.audit(b, a, s.active ? "User enabled" : "User disabled", s.username);
      return { id: s.id };
    },
  },
  addBranch: {
    label: "Add branch",
    who: ["admin"],
    run: (b, a, x) => {
      const name = S(x.name).trim();
      if (!name) fail("Name the branch.");
      const code = String(b.branches.length + 1).padStart(4, "0");
      const br = { code, name, city: S(x.city).trim() || name, ifsc: `${b.code}0${code.padStart(6, "0")}` };
      b.branches.push(br);
      K.audit(b, a, "Branch added", `${br.name} ${br.ifsc}`);
      return br;
    },
  },
};

// ---------------------------------------------------------------------------------------------

export function permitted(op: string, role: Who) {
  return Boolean(OPS[op]?.who.includes(role));
}

/** Runs an operation for a user, or queues it for authorisation */
export function execute(b: Bank, actor: Actor, op: string, args: Args): { result?: unknown; pending?: string } {
  const def = OPS[op] ?? fail("Unknown operation.", 404);
  if (!def.who.includes(actor.role as Who)) fail(`${def.label} isn't part of your role.`, 403);
  const hold = def.check?.(b, actor, args);
  if (hold) {
    // check it would go through today, so the manager isn't handed something that can't post
    def.run(structuredClone(b), actor, args);
    const id = `AU${K.seq(b, "approval", 1000)}`;
    b.approvals.push({ id, op, args, summary: hold.summary, amount: hold.amount, maker: actor.id, makerName: actor.name, createdAt: Date.now(), date: b.date, status: "pending", checker: "", checkerName: "", note: "", reason: "" });
    K.audit(b, actor, "Sent for authorisation", `${id}: ${hold.summary}`);
    return { pending: id };
  }
  const result = def.run(b, actor, args);
  if (def.describe) K.audit(b, actor, def.label, def.describe(b, args));
  return { result };
}

export function authorise(b: Bank, checker: Actor, x: { id: string; approve: boolean; note?: string }) {
  if (!isChecker(checker)) fail("Only a branch manager or administrator can authorise.", 403);
  const p = b.approvals.find((a) => a.id === x.id) ?? fail("No such request.", 404);
  if (p.status !== "pending") fail("It has already been dealt with.");
  if (p.maker === checker.id) fail("Maker and checker must be different people: someone else has to authorise this.", 403);
  const makerStaff = b.staff.find((s) => s.id === p.maker);
  const maker: Actor = makerStaff ? { id: makerStaff.id, name: makerStaff.name, role: makerStaff.role } : { id: p.maker, name: p.makerName, role: "teller" };
  p.checker = checker.id;
  p.checkerName = checker.name;
  if (!x.approve) {
    p.status = "rejected";
    p.reason = String(x.note ?? "") || "Not authorised";
    K.audit(b, checker, "Authorisation refused", `${p.id}: ${p.summary} (${p.reason})`);
    return { approval: p };
  }
  const def = OPS[p.op];
  const result = def.run(b, maker, p.args);
  p.status = "approved";
  p.note = String(x.note ?? "");
  if (def.describe) K.audit(b, maker, def.label, def.describe(b, p.args));
  K.audit(b, checker, "Authorised", `${p.id}: ${p.summary}`);
  return { approval: p, result };
}
