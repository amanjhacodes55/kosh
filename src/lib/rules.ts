import { addMonths, daysBetween, monthsBetween } from "./dates";
import type { Paise } from "./money";

// The banking arithmetic, kept free of state so every rule can be tested on its own. Rates are
// percentages per annum (7.25 means 7.25% p.a.). Amounts are paise; fractions are rounded only at
// the end. docs/banking-rules.md walks through each formula.

// ---------------------------------------------------------------------------------------------
// Rate configuration

export interface RateBucket {
  /** Tenure in days, inclusive at both ends */
  from: number;
  to: number;
  rate: number;
}

export interface SbSlab {
  /** Balances up to this many paise earn `rate`; the last slab has upto = null */
  upto: Paise | null;
  rate: number;
}

export interface PolicyRates {
  repo: number;
  sdf: number; // standing deposit facility, the floor of the corridor
  msf: number; // marginal standing facility, the ceiling
  bankRate: number;
  crr: number; // cash reserve ratio, % of NDTL
  slr: number; // statutory liquidity ratio, % of NDTL
}

export interface LoanProduct {
  code: string;
  name: string;
  /** floating: repo + spread (an external-benchmark lending rate); fixed: the rate itself */
  rateType: "floating" | "fixed";
  spread: number;
  fixedRate: number;
  maxTenureMonths: number;
  /** Largest loan as % of the collateral's value; 0 for unsecured */
  maxLtv: number;
  processingFeePct: number;
  /** Penalty on foreclosure; RBI bars it on floating-rate loans to individuals */
  foreclosurePct: number;
  secured: boolean;
}

export interface RateBook {
  policy: PolicyRates;
  sb: SbSlab[];
  fd: RateBucket[];
  seniorExtra: number;
  prematurePenalty: number;
  odRate: number;
  products: LoanProduct[];
  tds: { rate: number; noPanRate: number; threshold: Paise; seniorThreshold: Paise };
}

// Starting values: the RBI's policy rates after the 2025 cuts, and a card typical of large Indian
// banks. Every number here can be changed from Treasury > Rates.
export function defaultRates(): RateBook {
  return {
    policy: { repo: 5.5, sdf: 5.25, msf: 5.75, bankRate: 5.75, crr: 3.0, slr: 18.0 },
    sb: [
      { upto: 10_00_000_00, rate: 2.7 },
      { upto: null, rate: 3.0 },
    ],
    fd: [
      { from: 7, to: 45, rate: 3.5 },
      { from: 46, to: 179, rate: 5.25 },
      { from: 180, to: 210, rate: 6.0 },
      { from: 211, to: 364, rate: 6.25 },
      { from: 365, to: 729, rate: 6.8 },
      { from: 730, to: 1094, rate: 7.0 },
      { from: 1095, to: 1824, rate: 6.75 },
      { from: 1825, to: 3650, rate: 6.5 },
    ],
    seniorExtra: 0.5,
    prematurePenalty: 0.5,
    odRate: 10.5,
    products: [
      { code: "HL", name: "Home loan", rateType: "floating", spread: 2.65, fixedRate: 0, maxTenureMonths: 360, maxLtv: 80, processingFeePct: 0.35, foreclosurePct: 0, secured: true },
      { code: "AL", name: "Auto loan", rateType: "fixed", spread: 0, fixedRate: 9.15, maxTenureMonths: 84, maxLtv: 85, processingFeePct: 0.5, foreclosurePct: 2, secured: true },
      { code: "PL", name: "Personal loan", rateType: "fixed", spread: 0, fixedRate: 11.45, maxTenureMonths: 72, maxLtv: 0, processingFeePct: 1.5, foreclosurePct: 3, secured: false },
      { code: "GL", name: "Gold loan", rateType: "fixed", spread: 0, fixedRate: 9.0, maxTenureMonths: 36, maxLtv: 75, processingFeePct: 0.25, foreclosurePct: 0, secured: true },
      { code: "BL", name: "MSME business loan", rateType: "floating", spread: 4.25, fixedRate: 0, maxTenureMonths: 120, maxLtv: 70, processingFeePct: 1, foreclosurePct: 0, secured: true },
    ],
    // Section 194A: 10% once a customer's deposit interest passes the year's threshold (20% with no PAN)
    tds: { rate: 10, noPanRate: 20, threshold: 50_000_00, seniorThreshold: 1_00_000_00 },
  };
}

export const loanRate = (p: LoanProduct, policy: PolicyRates) => round2(p.rateType === "floating" ? policy.repo + p.spread : p.fixedRate);
export const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------------------------
// Deposits

/** The card rate for a term of `days`, plus the senior-citizen extra */
export function fdRate(card: RateBucket[], days: number, senior: boolean, seniorExtra: number) {
  const b = card.find((x) => days >= x.from && days <= x.to);
  if (!b) return null;
  return round2(b.rate + (senior ? seniorExtra : 0));
}

export function sbRate(slabs: SbSlab[], balance: Paise) {
  for (const s of slabs) if (s.upto === null || balance <= s.upto) return s.rate;
  return slabs.at(-1)?.rate ?? 0;
}

/** One day's interest on a balance, in fractional paise (actual/365) */
export const dayInterest = (balance: Paise, rate: number) => (balance * rate) / 36_500;

/**
 * What a fixed deposit pays. Cumulative deposits of six months or more compound quarterly, and the
 * broken period after the last full quarter earns simple interest; shorter ones earn simple
 * interest. Quarterly-payout deposits pay simple interest each quarter and return the principal.
 */
export function fdMaturity(principal: Paise, rate: number, start: string, end: string, payout: "cumulative" | "quarterly") {
  const days = daysBetween(start, end);
  if (payout === "quarterly" || days < 181) {
    const interest = Math.round((principal * rate * days) / 36_500);
    return { interest, maturity: payout === "quarterly" ? principal : principal + interest };
  }
  const quarters = Math.floor(monthsBetween(start, end) / 3);
  const broken = daysBetween(addMonths(start, quarters * 3), end);
  let amount = principal * Math.pow(1 + rate / 400, quarters);
  amount += (amount * rate * broken) / 36_500;
  const maturity = Math.round(amount);
  return { interest: maturity - principal, maturity };
}

/**
 * A recurring deposit compounds quarterly: the instalment paid k months before maturity grows to
 * I × (1 + r/400)^(k/3). This is the formula Indian banks publish for RD maturity.
 */
export function rdMaturity(installment: Paise, rate: number, months: number) {
  let total = 0;
  for (let k = 1; k <= months; k++) total += installment * Math.pow(1 + rate / 400, k / 3);
  const maturity = Math.round(total);
  return { maturity, interest: maturity - installment * months };
}

/** RD value for the instalments actually paid, each growing from its payment date to `on` */
export function rdValue(payments: { on: string; amount: Paise }[], rate: number, on: string) {
  let total = 0;
  for (const p of payments) total += p.amount * Math.pow(1 + rate / 400, monthsBetween(p.on, on) / 3);
  return Math.round(total);
}

/**
 * Premature closure: the rate for the period the deposit actually ran (never more than the
 * contracted rate), less the penalty. Nothing is paid on deposits closed within 7 days.
 */
export function prematureRate(card: RateBucket[], daysRun: number, contracted: number, senior: boolean, seniorExtra: number, penalty: number) {
  if (daysRun < 7) return 0;
  const forPeriod = fdRate(card, daysRun, senior, seniorExtra) ?? contracted;
  return round2(Math.max(0, Math.min(forPeriod, contracted) - penalty));
}

/**
 * TDS due on deposit interest. Once the customer's interest for the financial year passes the
 * threshold, tax is due on all of it; this returns what is still to be deducted after what was
 * already taken. Forms 15G/15H waive it.
 */
export function tdsDue(fyInterest: Paise, alreadyDeducted: Paise, who: { senior: boolean; pan: boolean; exempt: boolean }, cfg: RateBook["tds"]) {
  if (who.exempt) return 0;
  const threshold = who.senior ? cfg.seniorThreshold : cfg.threshold;
  if (fyInterest <= threshold) return 0;
  const rate = who.pan ? cfg.rate : cfg.noPanRate;
  return Math.max(0, Math.round((fyInterest * rate) / 100) - alreadyDeducted);
}

// ---------------------------------------------------------------------------------------------
// Loans

export function emi(principal: Paise, rate: number, months: number): Paise {
  const r = rate / 1200;
  if (r === 0) return Math.ceil(principal / months);
  const f = Math.pow(1 + r, months);
  return Math.round((principal * r * f) / (f - 1));
}

export interface ScheduleRow {
  n: number;
  dueOn: string;
  opening: Paise;
  interest: Paise;
  principal: Paise;
  emi: Paise;
  closing: Paise;
}

/** Monthly reducing-balance amortisation; the last instalment clears whatever is left */
export function amortise(principal: Paise, rate: number, months: number, firstDue: string, fixedEmi = emi(principal, rate, months)): ScheduleRow[] {
  const rows: ScheduleRow[] = [];
  let open = principal;
  for (let n = 1; n <= months && open > 0; n++) {
    const interest = Math.round((open * rate) / 1200);
    let p = Math.min(open, fixedEmi - interest);
    if (n === months) p = open;
    rows.push({ n, dueOn: addMonths(firstDue, n - 1), opening: open, interest, principal: p, emi: p + interest, closing: open - p });
    open -= p;
  }
  return rows;
}

/** How many months a balance takes to clear at a given EMI (for a rate reset that keeps the EMI) */
export function monthsToRepay(principal: Paise, rate: number, monthly: Paise) {
  const r = rate / 1200;
  if (monthly <= principal * r) return Infinity;
  if (r === 0) return Math.ceil(principal / monthly);
  return Math.ceil(-Math.log(1 - (principal * r) / monthly) / Math.log(1 + r));
}

/** Fixed-obligation-to-income ratio, in % */
export const foir = (existingEmi: Paise, newEmi: Paise, monthlyIncome: Paise) => (monthlyIncome > 0 ? round2(((existingEmi + newEmi) / monthlyIncome) * 100) : Infinity);

/**
 * A credit-bureau score for the demo, derived from the PAN so the same customer always gets the
 * same answer. A real deployment calls CIBIL, Experian, Equifax or CRIF here.
 */
export function bureauScore(pan: string) {
  let h = 0;
  for (const c of pan.toUpperCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return 640 + (h % 211); // 640 to 850
}

export interface Appraisal {
  score: number;
  emi: Paise;
  foir: number;
  ltv: number | null;
  maxByIncome: Paise;
  checks: { label: string; ok: boolean; detail: string }[];
  recommend: "approve" | "refer" | "decline";
}

/** Underwriting: bureau score, FOIR within 55%, LTV within the product's cap, tenure within its max */
export function appraise(a: { amount: Paise; months: number; rate: number; monthlyIncome: Paise; existingEmi: Paise; collateral: Paise; pan: string }, p: LoanProduct): Appraisal {
  const score = bureauScore(a.pan);
  const e = emi(a.amount, a.rate, a.months);
  const f = foir(a.existingEmi, e, a.monthlyIncome);
  const ltv = p.secured && a.collateral > 0 ? round2((a.amount / a.collateral) * 100) : null;
  // the largest loan whose EMI keeps FOIR at 55%
  const room = Math.max(0, a.monthlyIncome * 0.55 - a.existingEmi);
  const unit = emi(100_000_00, a.rate, a.months);
  const maxByIncome = Math.floor((room / unit) * 100_000_00);
  const checks = [
    { label: "Credit score", ok: score >= 700, detail: `${score} (700 or more)` },
    { label: "FOIR", ok: f <= 55, detail: `${f}% of monthly income (55% or less)` },
    { label: "Tenure", ok: a.months <= p.maxTenureMonths, detail: `${a.months} months (up to ${p.maxTenureMonths})` },
  ];
  if (p.secured) checks.push({ label: "Loan to value", ok: ltv !== null && ltv <= p.maxLtv, detail: ltv === null ? "No collateral value given" : `${ltv}% (up to ${p.maxLtv}%)` });
  const failed = checks.filter((c) => !c.ok).length;
  const recommend = failed === 0 ? "approve" : failed === 1 && score >= 680 ? "refer" : "decline";
  return { score, emi: e, foir: f, ltv, maxByIncome, checks, recommend };
}

// ---------------------------------------------------------------------------------------------
// Asset classification (RBI's income recognition and asset classification norms)

export type AssetClass = "STD" | "SMA-0" | "SMA-1" | "SMA-2" | "SUB" | "D1" | "D2" | "D3" | "LOSS";

export const CLASS_LABEL: Record<AssetClass, string> = {
  STD: "Standard",
  "SMA-0": "SMA-0",
  "SMA-1": "SMA-1",
  "SMA-2": "SMA-2",
  SUB: "Sub-standard",
  D1: "Doubtful 1",
  D2: "Doubtful 2",
  D3: "Doubtful 3",
  LOSS: "Loss",
};

export const isNpa = (c: AssetClass) => ["SUB", "D1", "D2", "D3", "LOSS"].includes(c);

/**
 * Days past due decide the class while an account performs: 1 to 30 is SMA-0, 31 to 60 SMA-1,
 * 61 to 90 SMA-2, and past 90 it is a non-performing asset. An NPA then ages: sub-standard for
 * its first 12 months, doubtful after (D1 for a year, D2 for the next two, D3 beyond).
 */
export function classify(dpd: number, npaDays: number | null): AssetClass {
  if (npaDays !== null) {
    if (npaDays <= 365) return "SUB";
    if (npaDays <= 730) return "D1";
    if (npaDays <= 1460) return "D2";
    return "D3";
  }
  if (dpd > 90) return "SUB";
  if (dpd > 60) return "SMA-2";
  if (dpd > 30) return "SMA-1";
  if (dpd > 0) return "SMA-0";
  return "STD";
}

/** Provision as % of the outstanding. Unsecured exposures are provided in full once doubtful. */
export function provisionPct(c: AssetClass, secured: boolean) {
  switch (c) {
    case "STD":
    case "SMA-0":
    case "SMA-1":
    case "SMA-2":
      return 0.4;
    case "SUB":
      return secured ? 15 : 25;
    case "D1":
      return secured ? 25 : 100;
    case "D2":
      return secured ? 40 : 100;
    case "D3":
    case "LOSS":
      return 100;
  }
}

// ---------------------------------------------------------------------------------------------
// Treasury

export const moneyMarketInterest = (amount: Paise, rate: number, days: number) => Math.round((amount * rate * days) / 36_500);

/**
 * Prudential limits on the call money market for scheduled commercial banks, as % of capital
 * funds: borrowing up to 100% on a fortnightly average and 125% on any day; lending up to 25% on
 * average and 50% on any day.
 */
export const CALL_LIMITS = { borrowAvg: 100, borrowDay: 125, lendAvg: 25, lendDay: 50 };

export interface ReserveInputs {
  sb: Paise;
  ca: Paise;
  fd: Paise;
  rd: Paise;
  interestPayable: Paise;
  interbankLiabilities: Paise;
  interbankAssets: Paise;
  balanceWithRbi: Paise;
  cash: Paise;
  gsec: Paise;
}

/**
 * Net demand and time liabilities, and the CRR and SLR they call for. Demand: savings and current
 * deposits and interest payable; time: term deposits; plus what is owed to other banks less what
 * other banks owe. CRR is held as a balance with the RBI; SLR in cash and government securities.
 */
export function reserves(x: ReserveInputs, policy: PolicyRates) {
  const demand = x.sb + x.ca + x.interestPayable;
  const time = x.fd + x.rd;
  const ndtl = Math.max(0, demand + time + x.interbankLiabilities - x.interbankAssets);
  const crrRequired = Math.round((ndtl * policy.crr) / 100);
  const slrRequired = Math.round((ndtl * policy.slr) / 100);
  const slrHeld = x.cash + x.gsec;
  return {
    demand,
    time,
    ndtl,
    crrRequired,
    crrHeld: x.balanceWithRbi,
    crrSurplus: x.balanceWithRbi - crrRequired,
    crrPct: ndtl ? round2((x.balanceWithRbi / ndtl) * 100) : 0,
    // the CRR may dip to 90% of the requirement on any one day if the fortnight's average holds
    crrDailyMinimum: Math.round(crrRequired * 0.9),
    slrRequired,
    slrHeld,
    slrSurplus: slrHeld - slrRequired,
    slrPct: ndtl ? round2((slrHeld / ndtl) * 100) : 0,
  };
}
