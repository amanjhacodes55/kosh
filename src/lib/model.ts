import type { Paise } from "./money";
import type { AssetClass, RateBook } from "./rules";

// One bank's books. Each bank is a tenant with its own branches, staff, customers, products, rates
// and ledger; nothing is shared between banks.

export type Role = "admin" | "manager" | "officer" | "teller" | "credit" | "treasury" | "auditor";

export const ROLES: Record<Role, { label: string; blurb: string }> = {
  admin: { label: "Administrator", blurb: "Users, branches, products and rates; end of day" },
  manager: { label: "Branch manager", blurb: "Authorises transactions over limits; end of day" },
  officer: { label: "Customer service officer", blurb: "Onboarding, KYC, accounts and deposits" },
  teller: { label: "Teller", blurb: "Cash, transfers and payments at the counter" },
  credit: { label: "Credit officer", blurb: "Loan applications, appraisal, sanction and disbursal" },
  treasury: { label: "Treasury dealer", blurb: "CRR and SLR, call money, investments, policy rates" },
  auditor: { label: "Auditor", blurb: "Read-only: ledgers, reports and the audit trail" },
};

export interface Branch {
  code: string;
  name: string;
  city: string;
  ifsc: string;
}

export interface Staff {
  id: string;
  username: string;
  name: string;
  role: Role;
  branch: string;
  passwordHash: string;
  active: boolean;
}

export type RiskCategory = "low" | "medium" | "high";

export interface Customer {
  cif: string;
  name: string;
  dob: string;
  pan: string;
  aadhaarLast4: string;
  mobile: string;
  email: string;
  address: string;
  occupation: string;
  monthlyIncome: Paise;
  kyc: "pending" | "verified";
  risk: RiskCategory;
  /** Form 15G (under 60) or 15H (60 and over) on file: no TDS this year */
  taxExempt: boolean;
  branch: string;
  createdOn: string;
  netbanking: { passwordHash: string } | null;
}

export type CasaType = "SB" | "CA";
export type AccountStatus = "active" | "frozen" | "dormant" | "closed";

export interface Account {
  id: string;
  cif: string;
  type: CasaType;
  branch: string;
  openedOn: string;
  balance: Paise;
  /** Marked against the balance, e.g. as security for a loan; can't be withdrawn */
  lien: Paise;
  /** Current accounts may run into overdraft up to this */
  odLimit: Paise;
  status: AccountStatus;
  /** Interest earned (savings) or charged (overdraft) but not yet posted, in fractional paise */
  accrued: number;
  lastActivity: string;
  nominee: string;
}

export type DepositKind = "FD" | "RD";

export interface Deposit {
  id: string;
  cif: string;
  kind: DepositKind;
  branch: string;
  openedOn: string;
  maturityOn: string;
  rate: number;
  /** FD: the amount placed (grows as interest compounds into it). RD: instalments paid so far. */
  balance: Paise;
  principal: Paise;
  /** RD only */
  installment: Paise;
  months: number;
  installmentsPaid: number;
  nextDueOn: string;
  payments: { on: string; amount: Paise }[];
  payout: "cumulative" | "quarterly";
  linkedAccount: string;
  /** Quarterly-payout deposits: interest paid out to the linked account so far */
  interestPaid: Paise;
  autoRenew: boolean;
  accrued: number;
  status: "active" | "matured" | "closed";
  closedOn: string;
  closedAmount: Paise;
}

export interface LoanDemand {
  dueOn: string;
  principal: Paise;
  interest: Paise;
  paidPrincipal: Paise;
  paidInterest: Paise;
}

export interface Loan {
  id: string;
  cif: string;
  product: string;
  branch: string;
  applicationId: string;
  sanctioned: Paise;
  disbursedOn: string;
  outstanding: Paise; // principal not yet repaid, including principal that is due
  rate: number;
  rateType: "floating" | "fixed";
  /** Floating loans reprice to repo + spread when the RBI moves the repo rate */
  spread: number;
  months: number;
  emi: Paise;
  firstDueOn: string;
  nextDueOn: string;
  /** Instalments demanded so far */
  raised: number;
  /** Instalments not yet paid in full */
  demands: LoanDemand[];
  charges: Paise; // unpaid charges (bounce charges and GST)
  linkedAccount: string;
  collateral: { kind: string; value: Paise } | null;
  assetClass: AssetClass;
  dpd: number;
  npaSince: string;
  provision: Paise;
  status: "active" | "closed";
  closedOn: string;
}

export type ApplicationStatus = "applied" | "appraised" | "sanctioned" | "disbursed" | "rejected";

export interface LoanApplication {
  id: string;
  cif: string;
  product: string;
  amount: Paise;
  months: number;
  purpose: string;
  collateral: { kind: string; value: Paise } | null;
  existingEmi: Paise;
  status: ApplicationStatus;
  appliedOn: string;
  appraisal: import("./rules").Appraisal | null;
  rate: number;
  decisionNote: string;
  loanId: string;
  by: string;
}

export type Channel = "CASH" | "TRANSFER" | "NEFT" | "RTGS" | "IMPS" | "NACH" | "SYSTEM";

/** A line on a customer's statement */
export interface Txn {
  id: string;
  date: string;
  at: number;
  account: string;
  /** Positive is a credit to the customer, negative a debit */
  amount: Paise;
  balance: Paise;
  narration: string;
  channel: Channel;
  voucher: string;
  by: string;
}

export interface VoucherLine {
  gl: string;
  dr: Paise;
  cr: Paise;
}

/** A balanced double-entry posting to the general ledger */
export interface Voucher {
  id: string;
  date: string;
  at: number;
  narration: string;
  lines: VoucherLine[];
  by: string;
}

export interface CallDeal {
  id: string;
  side: "borrow" | "lend";
  counterparty: string;
  amount: Paise;
  rate: number;
  days: number;
  dealtOn: string;
  maturesOn: string;
  status: "open" | "settled";
  interest: Paise;
  by: string;
}

export interface Investment {
  id: string;
  security: string;
  faceValue: Paise;
  coupon: number;
  maturity: string;
  boughtOn: string;
}

export interface Approval {
  id: string;
  op: string;
  args: Record<string, unknown>;
  summary: string;
  amount: Paise;
  maker: string;
  makerName: string;
  createdAt: number;
  date: string;
  status: "pending" | "approved" | "rejected";
  checker: string;
  checkerName: string;
  note: string;
  reason: string;
}

export interface AuditEntry {
  at: number;
  date: string;
  user: string;
  name: string;
  role: string;
  action: string;
  detail: string;
}

export interface EodRun {
  date: string;
  at: number;
  by: string;
  steps: { step: string; detail: string }[];
}

export interface Bank {
  id: string;
  code: string;
  name: string;
  sandbox: boolean;
  createdAt: number;
  date: string;
  branches: Branch[];
  staff: Staff[];
  customers: Customer[];
  accounts: Account[];
  deposits: Deposit[];
  loans: Loan[];
  applications: LoanApplication[];
  txns: Txn[];
  vouchers: Voucher[];
  /** Ledger balances: debits positive, credits negative */
  gl: Record<string, Paise>;
  rates: RateBook;
  callDeals: CallDeal[];
  investments: Investment[];
  approvals: Approval[];
  audit: AuditEntry[];
  eod: EodRun[];
  /** Interest posted, and TDS deducted, per customer in the current financial year */
  fy: { year: string; interest: Record<string, Paise>; tds: Record<string, Paise> };
  /** Cash transactions of ₹10 lakh or more, for the cash transaction report to FIU-IND */
  ctr: { date: string; account: string; cif: string; amount: Paise; kind: "deposit" | "withdrawal" }[];
  seq: Record<string, number>;
}

// ---------------------------------------------------------------------------------------------
// Chart of accounts

export type GlType = "asset" | "liability" | "equity" | "income" | "expense";

export const CHART: { code: string; name: string; type: GlType; group: string }[] = [
  { code: "10101", name: "Cash in hand", type: "asset", group: "Cash and balances with RBI" },
  { code: "10201", name: "Balance with RBI", type: "asset", group: "Cash and balances with RBI" },
  { code: "10401", name: "Call and notice money lent", type: "asset", group: "Money at call and short notice" },
  { code: "10501", name: "Government securities", type: "asset", group: "Investments" },
  { code: "10601", name: "Home loans", type: "asset", group: "Advances" },
  { code: "10602", name: "Auto loans", type: "asset", group: "Advances" },
  { code: "10603", name: "Personal loans", type: "asset", group: "Advances" },
  { code: "10604", name: "Gold loans", type: "asset", group: "Advances" },
  { code: "10605", name: "MSME business loans", type: "asset", group: "Advances" },
  { code: "10650", name: "Overdrafts", type: "asset", group: "Advances" },
  { code: "10701", name: "Interest receivable on advances", type: "asset", group: "Other assets" },
  { code: "10901", name: "Premises and fixed assets", type: "asset", group: "Fixed assets" },
  { code: "20101", name: "Savings deposits", type: "liability", group: "Deposits" },
  { code: "20201", name: "Current deposits", type: "liability", group: "Deposits" },
  { code: "20301", name: "Fixed deposits", type: "liability", group: "Deposits" },
  { code: "20401", name: "Recurring deposits", type: "liability", group: "Deposits" },
  { code: "20501", name: "Interest payable on deposits", type: "liability", group: "Other liabilities" },
  { code: "20601", name: "Call and notice money borrowed", type: "liability", group: "Borrowings" },
  { code: "20701", name: "TDS payable", type: "liability", group: "Other liabilities" },
  { code: "20702", name: "GST payable", type: "liability", group: "Other liabilities" },
  { code: "20801", name: "Interest suspense (NPA)", type: "liability", group: "Other liabilities" },
  { code: "20901", name: "Provisions for loan losses", type: "liability", group: "Provisions" },
  { code: "30101", name: "Share capital", type: "equity", group: "Capital and reserves" },
  { code: "30201", name: "Reserves and surplus", type: "equity", group: "Capital and reserves" },
  { code: "40101", name: "Interest on advances", type: "income", group: "Interest earned" },
  { code: "40201", name: "Interest on call money lent", type: "income", group: "Interest earned" },
  { code: "40301", name: "Interest on investments", type: "income", group: "Interest earned" },
  { code: "40401", name: "Fees and charges", type: "income", group: "Other income" },
  { code: "50101", name: "Interest on savings deposits", type: "expense", group: "Interest expended" },
  { code: "50201", name: "Interest on term deposits", type: "expense", group: "Interest expended" },
  { code: "50301", name: "Interest on call money borrowed", type: "expense", group: "Interest expended" },
  { code: "50401", name: "Provisions for loan losses", type: "expense", group: "Provisions and contingencies" },
  { code: "50501", name: "Operating expenses", type: "expense", group: "Operating expenses" },
];

export const G = {
  cash: "10101",
  rbi: "10201",
  callLent: "10401",
  gsec: "10501",
  od: "10650",
  interestReceivable: "10701",
  premises: "10901",
  sb: "20101",
  ca: "20201",
  fd: "20301",
  rd: "20401",
  interestPayable: "20501",
  callBorrowed: "20601",
  tds: "20701",
  gst: "20702",
  suspense: "20801",
  provisions: "20901",
  capital: "30101",
  reserves: "30201",
  loanInterest: "40101",
  callIncome: "40201",
  investmentIncome: "40301",
  fees: "40401",
  sbInterest: "50101",
  tdInterest: "50201",
  callExpense: "50301",
  provisionExpense: "50401",
  opex: "50501",
} as const;

export const LOAN_GL: Record<string, string> = { HL: "10601", AL: "10602", PL: "10603", GL: "10604", BL: "10605" };

export const GST_RATE = 18;

// Counterparties for the call money market in the demo; fictional names
export const COUNTERPARTIES = [
  "Vindhya Co-operative Bank",
  "Konkan Gramin Bank",
  "Ganga Commercial Bank",
  "Malabar Trust Bank",
  "Satpura Bank",
  "Aravalli Finance Bank",
  "Primary dealer: Coromandel Securities",
];
