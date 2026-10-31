import { type Actor, available, capitalFunds, customer, isSenior, overdue, quoteClosure, quoteForeclosure } from "./bank";
import { addMonths, daysBetween } from "./dates";
import { fail } from "./errors";
import { type Bank, CHART, G, LOAN_GL, ROLES } from "./model";
import { amortise, CALL_LIMITS, CLASS_LABEL, fdMaturity, isNpa, loanRate, rdMaturity } from "./rules";
import { treasuryPosition } from "./seed";

// What each screen needs, read from the books. Staff see the bank; a customer in net banking sees
// only their own accounts.

type Params = Record<string, string>;
const gl = (b: Bank, code: string) => b.gl[code] ?? 0;
const nameOf = (b: Bank, cif: string) => b.customers.find((c) => c.cif === cif)?.name ?? cif;

export function bankInfo(b: Bank) {
  return { id: b.id, code: b.code, name: b.name, date: b.date, sandbox: b.sandbox, branches: b.branches };
}

export function userInfo(b: Bank, a: Actor) {
  return { id: a.id, name: a.name, role: a.role, roleLabel: a.role === "customer" ? "Customer" : a.role === "system" ? "System" : ROLES[a.role].label, cif: a.cif };
}

/** For the sandbox's "switch user" menu */
export function people(b: Bank) {
  return {
    staff: b.staff.filter((s) => s.active).map((s) => ({ id: s.id, username: s.username, name: s.name, role: s.role, roleLabel: ROLES[s.role].label })),
    customers: b.customers.filter((c) => c.netbanking).map((c) => ({ cif: c.cif, name: c.name })),
  };
}

const STAFF_VIEWS: Record<string, (b: Bank, a: Actor, p: Params) => unknown> = {
  overview,
  customers: (b, a, p) => {
    const q = (p.q ?? "").toLowerCase().trim();
    return b.customers
      .filter((c) => !q || c.name.toLowerCase().includes(q) || c.cif.includes(q) || c.pan.toLowerCase().includes(q) || c.mobile.includes(q))
      .map((c) => ({ cif: c.cif, name: c.name, pan: c.pan, mobile: c.mobile, kyc: c.kyc, risk: c.risk, branch: c.branch, senior: isSenior(c, b.date), createdOn: c.createdOn, accounts: b.accounts.filter((x) => x.cif === c.cif && x.status !== "closed").length }));
  },
  customer: (b, a, p) => customerView(b, p.cif),
  accounts: (b) =>
    b.accounts.map((x) => ({ id: x.id, type: x.type, name: nameOf(b, x.cif), cif: x.cif, balance: x.balance, available: available(x), status: x.status, branch: x.branch, odLimit: x.odLimit, lien: x.lien })),
  account: (b, a, p) => accountView(b, p.id),
  deposits: (b) =>
    b.deposits.map((d) => ({ id: d.id, kind: d.kind, name: nameOf(b, d.cif), cif: d.cif, balance: d.balance, principal: d.principal, installment: d.installment, rate: d.rate, openedOn: d.openedOn, maturityOn: d.maturityOn, status: d.status, payout: d.payout, installmentsPaid: d.installmentsPaid, months: d.months })),
  deposit: (b, a, p) => depositView(b, p.id),
  loans: (b) => ({
    loans: b.loans.map((l) => ({ id: l.id, product: l.product, name: nameOf(b, l.cif), cif: l.cif, sanctioned: l.sanctioned, outstanding: l.outstanding, overdue: overdue(l), emi: l.emi, rate: l.rate, dpd: l.dpd, assetClass: l.assetClass, status: l.status, nextDueOn: l.nextDueOn })),
    applications: b.applications.map((x) => ({ ...x, name: nameOf(b, x.cif) })).reverse(),
    products: b.rates.products.map((p) => ({ ...p, rate: loanRate(p, b.rates.policy) })),
  }),
  loan: (b, a, p) => loanView(b, p.id),
  application: (b, a, p) => {
    const x = b.applications.find((y) => y.id === p.id) ?? fail("No such application.", 404);
    const c = customer(b, x.cif);
    return { application: x, customer: { cif: c.cif, name: c.name, pan: c.pan, monthlyIncome: c.monthlyIncome, kyc: c.kyc, occupation: c.occupation }, accounts: b.accounts.filter((y) => y.cif === c.cif && y.status === "active").map((y) => ({ id: y.id, type: y.type })), product: b.rates.products.find((q) => q.code === x.product) };
  },
  approvals: (b) => ({ pending: b.approvals.filter((x) => x.status === "pending"), recent: b.approvals.filter((x) => x.status !== "pending").slice(-30).reverse() }),
  treasury,
  rates: (b) => b.rates,
  ledger,
  journal: (b, a, p) => {
    const date = p.date || b.date;
    const days = [...new Set(b.vouchers.map((v) => v.date))].slice(-60).reverse();
    return { date, days, vouchers: b.vouchers.filter((v) => v.date === date).reverse(), chart: CHART };
  },
  reports,
  audit: (b, a, p) => {
    if (!["auditor", "admin", "manager"].includes(a.role)) fail("The audit trail is for auditors and managers.", 403);
    const q = (p.q ?? "").toLowerCase();
    return b.audit.filter((e) => !q || `${e.action} ${e.detail} ${e.name}`.toLowerCase().includes(q)).slice(-400).reverse();
  },
  eod: (b) => ({ date: b.date, runs: b.eod.slice(-30).reverse(), pending: b.approvals.filter((x) => x.status === "pending").length }),
  admin: (b, a) => {
    if (a.role !== "admin") fail("Administration is for administrators.", 403);
    return { staff: b.staff.map((s) => ({ id: s.id, username: s.username, name: s.name, role: s.role, branch: s.branch, active: s.active, roleLabel: ROLES[s.role].label })), branches: b.branches, roles: ROLES };
  },
};

export function view(b: Bank, a: Actor, name: string, p: Params) {
  if (a.role === "customer") return customerViews(b, a, name, p);
  const fn = STAFF_VIEWS[name] ?? fail("Unknown view.", 404);
  return fn(b, a, p);
}

// ---------------------------------------------------------------------------------------------

function overview(b: Bank) {
  const t = treasuryPosition(b);
  const deposits = -(gl(b, G.sb) + gl(b, G.ca) + gl(b, G.fd) + gl(b, G.rd));
  const casa = -(gl(b, G.sb) + gl(b, G.ca));
  const active = b.loans.filter((l) => l.status === "active");
  const advances = active.reduce((s, l) => s + l.outstanding, 0) + gl(b, G.od);
  const npa = active.filter((l) => isNpa(l.assetClass));
  const gross = npa.reduce((s, l) => s + l.outstanding, 0);
  const npaProvision = npa.reduce((s, l) => s + l.provision, 0);
  const byClass: Record<string, number> = {};
  for (const l of active) byClass[l.assetClass] = (byClass[l.assetClass] ?? 0) + l.outstanding;
  const byProduct = Object.entries(LOAN_GL).map(([code, g]) => ({ code, name: b.rates.products.find((p) => p.code === code)?.name ?? code, amount: gl(b, g) })).filter((x) => x.amount > 0);
  const income = CHART.filter((c) => c.type === "income").reduce((s, c) => s - gl(b, c.code), 0);
  const expense = CHART.filter((c) => c.type === "expense").reduce((s, c) => s + gl(b, c.code), 0);
  const todays = b.txns.filter((x) => x.date === b.date);
  // deposits and advances at each month end, from the statements and the ledger journal
  return {
    date: b.date,
    deposits,
    casa,
    casaRatio: deposits ? Math.round((casa / deposits) * 1000) / 10 : 0,
    mix: [
      { label: "Savings", amount: -gl(b, G.sb) },
      { label: "Current", amount: -gl(b, G.ca) },
      { label: "Fixed", amount: -gl(b, G.fd) },
      { label: "Recurring", amount: -gl(b, G.rd) },
    ],
    advances,
    cdRatio: deposits ? Math.round((advances / deposits) * 1000) / 10 : 0,
    grossNpa: gross,
    grossNpaPct: advances ? Math.round((gross / advances) * 10000) / 100 : 0,
    netNpaPct: advances ? Math.round(((gross - npaProvision) / Math.max(1, advances - npaProvision)) * 10000) / 100 : 0,
    pcr: gross ? Math.round((npaProvision / gross) * 1000) / 10 : 100,
    byClass: Object.entries(byClass).map(([c, amount]) => ({ cls: c, label: CLASS_LABEL[c as keyof typeof CLASS_LABEL], amount })),
    byProduct,
    profit: income - expense,
    reserves: { crrRequired: t.crrRequired, crrHeld: t.crrHeld, slrRequired: t.slrRequired, slrHeld: t.slrHeld, ndtl: t.ndtl },
    policy: b.rates.policy,
    cash: gl(b, G.cash),
    customers: b.customers.length,
    accounts: b.accounts.filter((a) => a.status !== "closed").length,
    pending: b.approvals.filter((x) => x.status === "pending").length,
    applications: b.applications.filter((x) => ["applied", "appraised", "sanctioned"].includes(x.status)).length,
    today: { count: todays.length, credits: todays.filter((x) => x.amount > 0).reduce((s, x) => s + x.amount, 0), debits: -todays.filter((x) => x.amount < 0).reduce((s, x) => s + x.amount, 0) },
    lastEod: b.eod.at(-1) ?? null,
    activity: b.audit.slice(-8).reverse(),
    trend: trend(b),
  };
}

/** Deposits and advances at the end of each of the last six months, rebuilt from the vouchers */
function trend(b: Bank) {
  const dep = new Set<string>([G.sb, G.ca, G.fd, G.rd]);
  const adv = new Set<string>([...Object.values(LOAN_GL), G.od]);
  const months: string[] = [];
  for (let k = 5; k >= 0; k--) months.push(addMonths(`${b.date.slice(0, 8)}01`, -k).slice(0, 7));
  const moves = new Map<string, { d: number; a: number }>();
  for (const v of b.vouchers) {
    const m = v.date.slice(0, 7);
    const x = moves.get(m) ?? { d: 0, a: 0 };
    for (const l of v.lines) {
      if (dep.has(l.gl)) x.d += l.cr - l.dr;
      if (adv.has(l.gl)) x.a += l.dr - l.cr;
    }
    moves.set(m, x);
  }
  const sorted = [...moves.keys()].sort();
  return months.map((month) => {
    let deposits = 0, advances = 0;
    for (const m of sorted) {
      if (m > month) break;
      deposits += moves.get(m)!.d;
      advances += moves.get(m)!.a;
    }
    return { month, deposits, advances };
  });
}

function customerView(b: Bank, cif: string) {
  const c = customer(b, cif);
  const { netbanking, ...rest } = c;
  return {
    customer: { ...rest, senior: isSenior(c, b.date), netbanking: Boolean(netbanking) },
    accounts: b.accounts.filter((a) => a.cif === cif).map((a) => ({ ...a, available: available(a) })),
    deposits: b.deposits.filter((d) => d.cif === cif),
    loans: b.loans.filter((l) => l.cif === cif).map((l) => ({ ...l, overdue: overdue(l) })),
    applications: b.applications.filter((x) => x.cif === cif),
    tds: { year: b.fy.year, interest: b.fy.interest[cif] ?? 0, tds: b.fy.tds[cif] ?? 0 },
  };
}

function accountView(b: Bank, id: string) {
  const a = b.accounts.find((x) => x.id === id) ?? fail("No such account.", 404);
  const c = customer(b, a.cif);
  return {
    account: { ...a, available: available(a) },
    customer: { cif: c.cif, name: c.name, pan: c.pan, mobile: c.mobile, kyc: c.kyc },
    branch: b.branches.find((x) => x.code === a.branch),
    txns: b.txns.filter((t) => t.account === id).slice(-300).reverse(),
  };
}

function depositView(b: Bank, id: string) {
  const d = b.deposits.find((x) => x.id === id) ?? fail("No such deposit.", 404);
  const projected = d.kind === "FD" ? fdMaturity(d.principal, d.rate, d.openedOn, d.maturityOn, d.payout) : rdMaturity(d.installment, d.rate, d.months);
  return { deposit: d, name: nameOf(b, d.cif), projected, quote: d.status === "active" ? quoteClosure(b, d.id) : null, txns: b.txns.filter((t) => t.narration.includes(d.id)).reverse() };
}

function loanView(b: Bank, id: string) {
  const l = b.loans.find((x) => x.id === id) ?? fail("No such loan.", 404);
  const notDue = l.outstanding - l.demands.reduce((s, d) => s + d.principal - d.paidPrincipal, 0);
  const remaining = Math.max(1, l.months - l.raised);
  return {
    loan: { ...l, overdue: overdue(l) },
    name: nameOf(b, l.cif),
    product: b.rates.products.find((p) => p.code === l.product),
    schedule: l.status === "active" && notDue > 0 ? amortise(notDue, l.rate, remaining, l.nextDueOn, l.emi).slice(0, 360) : [],
    foreclosure: l.status === "active" ? quoteForeclosure(b, l.id) : null,
    txns: b.txns.filter((t) => t.narration.includes(l.id)).reverse(),
  };
}

function treasury(b: Bank) {
  const t = treasuryPosition(b);
  const cap = capitalFunds(b);
  const open = (side: string) => b.callDeals.filter((d) => d.status === "open" && d.side === side).reduce((s, d) => s + d.amount, 0);
  const today = b.callDeals.filter((d) => d.dealtOn === b.date);
  const vol = today.reduce((s, d) => s + d.amount, 0);
  return {
    position: t,
    policy: b.rates.policy,
    capitalFunds: cap,
    limits: {
      borrowDay: Math.round((cap * CALL_LIMITS.borrowDay) / 100),
      borrowAvg: Math.round((cap * CALL_LIMITS.borrowAvg) / 100),
      lendDay: Math.round((cap * CALL_LIMITS.lendDay) / 100),
      lendAvg: Math.round((cap * CALL_LIMITS.lendAvg) / 100),
      borrowed: open("borrow"),
      lent: open("lend"),
    },
    wacr: vol ? Math.round((today.reduce((s, d) => s + d.amount * d.rate, 0) / vol) * 100) / 100 : null,
    deals: b.callDeals.slice(-60).reverse(),
    investments: b.investments,
    cash: gl(b, G.cash),
    counterparties: ["Vindhya Co-operative Bank", "Konkan Gramin Bank", "Ganga Commercial Bank", "Malabar Trust Bank", "Satpura Bank", "Aravalli Finance Bank"],
  };
}

function ledger(b: Bank) {
  const rows = CHART.map((c) => ({ ...c, balance: gl(b, c.code) }));
  const income = rows.filter((r) => r.type === "income").reduce((s, r) => s - r.balance, 0);
  const expense = rows.filter((r) => r.type === "expense").reduce((s, r) => s + r.balance, 0);
  const group = (type: string, sign: number) => {
    const out: Record<string, { group: string; amount: number; items: { code: string; name: string; amount: number }[] }> = {};
    for (const r of rows.filter((x) => x.type === type)) {
      const g = (out[r.group] ??= { group: r.group, amount: 0, items: [] });
      g.amount += sign * r.balance;
      g.items.push({ code: r.code, name: r.name, amount: sign * r.balance });
    }
    return Object.values(out);
  };
  // provisions are shown netted off advances on the balance sheet, as banks publish it
  return {
    trial: rows,
    totals: { dr: rows.reduce((s, r) => s + Math.max(0, r.balance), 0), cr: rows.reduce((s, r) => s + Math.max(0, -r.balance), 0) },
    assets: group("asset", 1),
    liabilities: [...group("equity", -1), ...group("liability", -1), { group: "Profit for the period", amount: income - expense, items: [] }],
    income: group("income", -1),
    expenses: group("expense", 1),
    profit: income - expense,
  };
}

function reports(b: Bank) {
  const active = b.loans.filter((l) => l.status === "active");
  const irac = active.map((l) => ({ id: l.id, name: nameOf(b, l.cif), product: l.product, outstanding: l.outstanding, overdue: overdue(l), dpd: l.dpd, cls: l.assetClass, label: CLASS_LABEL[l.assetClass], npaSince: l.npaSince, provision: l.provision }));
  // residual maturity buckets, as in the RBI's structural liquidity statement
  const buckets = [
    { label: "1–14 days", to: 14 },
    { label: "15–28 days", to: 28 },
    { label: "29 days–3 months", to: 91 },
    { label: "3–6 months", to: 182 },
    { label: "6–12 months", to: 365 },
    { label: "1–3 years", to: 1095 },
    { label: "3–5 years", to: 1825 },
    { label: "Over 5 years", to: Infinity },
  ];
  const alm = buckets.map((x) => ({ label: x.label, outflows: 0, inflows: 0 }));
  const put = (days: number, amt: number, side: "outflows" | "inflows") => {
    const i = buckets.findIndex((x) => days <= x.to);
    alm[i < 0 ? buckets.length - 1 : i][side] += amt;
  };
  for (const d of b.deposits.filter((x) => x.status === "active")) put(daysBetween(b.date, d.maturityOn), d.balance, "outflows");
  for (const c of b.callDeals.filter((x) => x.status === "open")) put(daysBetween(b.date, c.maturesOn), c.amount, c.side === "borrow" ? "outflows" : "inflows");
  for (const l of active) {
    const rows = amortise(l.outstanding, l.rate, Math.max(1, l.months - l.raised), l.nextDueOn, l.emi);
    for (const r of rows) put(daysBetween(b.date, r.dueOn), r.principal, "inflows");
  }
  // savings and current balances: treated as core (over 1 year) for 85%, volatile (1–14 days) for 15%
  const casa = -(gl(b, G.sb) + gl(b, G.ca));
  alm[0].outflows += Math.round(casa * 0.15);
  alm[5].outflows += Math.round(casa * 0.85);
  for (const i of b.investments) put(daysBetween(b.date, i.maturity), i.faceValue, "inflows");
  const tds = Object.keys(b.fy.interest).map((cif) => ({ cif, name: nameOf(b, cif), pan: b.customers.find((c) => c.cif === cif)?.pan ?? "", interest: b.fy.interest[cif], tds: b.fy.tds[cif] ?? 0, exempt: b.customers.find((c) => c.cif === cif)?.taxExempt ?? false }));
  return { irac, alm, tds, fy: b.fy.year, ctr: b.ctr.map((x) => ({ ...x, name: nameOf(b, x.cif) })).reverse() };
}

// ---------------------------------------------------------------------------------------------
// Net banking

function customerViews(b: Bank, a: Actor, name: string, p: Params) {
  const cif = a.cif!;
  const mine = (owner: string) => owner === cif || fail("Not yours.", 403);
  switch (name) {
    case "netbanking": {
      const v = customerView(b, cif);
      return { ...v, rates: { fd: b.rates.fd, seniorExtra: b.rates.seniorExtra, sb: b.rates.sb }, products: b.rates.products.map((x) => ({ code: x.code, name: x.name, rate: loanRate(x, b.rates.policy), secured: x.secured })), recent: b.txns.filter((t) => v.accounts.some((x) => x.id === t.account)).slice(-12).reverse(), date: b.date, ifsc: b.branches.find((x) => x.code === v.customer.branch)?.ifsc };
    }
    case "account": {
      const acc = b.accounts.find((x) => x.id === p.id) ?? fail("No such account.", 404);
      mine(acc.cif);
      return accountView(b, p.id);
    }
    case "deposit": {
      mine(b.deposits.find((x) => x.id === p.id)?.cif ?? "");
      return depositView(b, p.id);
    }
    case "loan": {
      mine(b.loans.find((x) => x.id === p.id)?.cif ?? "");
      return loanView(b, p.id);
    }
    default:
      return fail("Not available in net banking.", 403);
  }
}
