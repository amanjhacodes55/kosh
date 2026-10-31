import * as K from "./bank";
import type { Actor } from "./bank";
import { addDays, daysBetween } from "./dates";
import { runEod } from "./eod";
import { type Bank, COUNTERPARTIES, G, type Role } from "./model";
import { rupees } from "./money";
import { defaultRates, reserves } from "./rules";

// A new bank's opening books, and the sample bank behind every sandbox: about five months of
// ordinary business replayed through the engine itself, one day at a time, with end of day run
// after each. Everything a sandbox shows (statements, interest, EMIs, an NPA, treasury deals) was
// produced by the same code a real bank would run.

export function newBank(x: { id: string; code: string; name: string; date: string; sandbox: boolean; adminHash: string; adminName?: string }): Bank {
  const b: Bank = {
    id: x.id,
    code: x.code,
    name: x.name,
    sandbox: x.sandbox,
    createdAt: Date.now(),
    date: x.date,
    branches: [{ code: "0001", name: "Main branch", city: "Mumbai", ifsc: `${x.code}0000001` }],
    staff: [{ id: "U100", username: "admin", name: x.adminName || "Administrator", role: "admin", branch: "0001", passwordHash: x.adminHash, active: true }],
    customers: [],
    accounts: [],
    deposits: [],
    loans: [],
    applications: [],
    txns: [],
    vouchers: [],
    gl: {},
    rates: defaultRates(),
    callDeals: [],
    investments: [],
    approvals: [],
    audit: [],
    eod: [],
    fy: { year: "", interest: {}, tds: {} },
    ctr: [],
    seq: { staff: 100 },
  };
  // Opening balance sheet: capital and reserves, represented by premises, cash, the RBI balance and gilts
  const actor: Actor = { id: "U100", name: "Opening balances", role: "admin" };
  K.post(b, actor, "Opening balances", [
    [G.premises, rupees(6_00_00_000)],
    [G.cash, rupees(4_00_00_000)],
    [G.rbi, rupees(4_00_00_000)],
    [G.gsec, rupees(26_00_00_000)],
    [G.capital, -rupees(25_00_00_000)],
    [G.reserves, -rupees(15_00_00_000)],
  ]);
  b.investments.push(
    { id: "GS101", security: "7.18% GS 2033", faceValue: rupees(16_00_00_000), coupon: 7.18, maturity: "2033-07-24", boughtOn: x.date },
    { id: "GS102", security: "7.10% GS 2034", faceValue: rupees(10_00_00_000), coupon: 7.1, maturity: "2034-04-08", boughtOn: x.date },
  );
  b.seq.gsec = 102;
  return b;
}

// A small deterministic random source, so every sandbox starts from the same story
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

const STAFF: { username: string; name: string; role: Role; branch: string }[] = [
  { username: "rmehta", name: "Rohan Mehta", role: "manager", branch: "0001" },
  { username: "pnair", name: "Priya Nair", role: "officer", branch: "0001" },
  { username: "skumar", name: "Sanjay Kumar", role: "teller", branch: "0001" },
  { username: "fsheikh", name: "Farah Sheikh", role: "credit", branch: "0001" },
  { username: "viyer", name: "Vikram Iyer", role: "treasury", branch: "0001" },
  { username: "ldsouza", name: "Leena D'Souza", role: "auditor", branch: "0001" },
];

interface Person {
  key: string;
  name: string;
  dob: string;
  pan: string;
  occupation: string;
  income: number; // rupees a month
  salary?: { amount: number; from: string; stopsOn?: number };
  type?: "CA";
  risk?: "low" | "medium" | "high";
  exempt?: boolean;
}

const PEOPLE: Person[] = [
  { key: "ananya", name: "Ananya Sharma", dob: "1993-08-14", pan: "BQRPS4821K", occupation: "Salaried: product designer", income: 1_45_000, salary: { amount: 1_45_000, from: "Lumen Softworks Pvt Ltd" } },
  { key: "rahul", name: "Rahul Verma", dob: "1996-02-02", pan: "AKZPV7710D", occupation: "Salaried: software engineer", income: 2_10_000, salary: { amount: 2_10_000, from: "Nimbus Cloud India Pvt Ltd" } },
  { key: "meera", name: "Meera Iyer", dob: "1958-11-21", pan: "AFHPI3302M", occupation: "Retired: pensioner", income: 62_000, salary: { amount: 62_000, from: "Pension: CPAO" } },
  { key: "kabir", name: "Kabir Singh", dob: "1984-05-30", pan: "BMVPS9184Q", occupation: "Self-employed: architect", income: 3_80_000 },
  { key: "fatima", name: "Fatima Begum", dob: "1962-01-17", pan: "AWXPB1209H", occupation: "Retired: teacher", income: 48_000, exempt: true },
  { key: "arjun", name: "Dr. Arjun Reddy", dob: "1981-09-09", pan: "ANSPR5521C", occupation: "Self-employed: physician", income: 4_50_000 },
  { key: "neha", name: "Neha Gupta", dob: "1990-12-03", pan: "BTGPG6650E", occupation: "Salaried: chartered accountant", income: 1_70_000, salary: { amount: 1_70_000, from: "Rao & Mistry LLP" } },
  { key: "suresh", name: "Suresh Patil", dob: "1975-03-25", pan: "AQLPP8823F", occupation: "Agriculture: horticulture", income: 70_000 },
  { key: "divya", name: "Divya Menon", dob: "1991-06-19", pan: "BDXPM2290L", occupation: "Salaried: marketing lead", income: 2_60_000, salary: { amount: 2_60_000, from: "Harbor Retail India Ltd" } },
  { key: "imran", name: "Imran Qureshi", dob: "1988-10-11", pan: "AJRPQ4471N", occupation: "Salaried: sales manager", income: 95_000, salary: { amount: 95_000, from: "Swift Logistics Pvt Ltd", stopsOn: 70 }, risk: "medium" },
  { key: "lakshmi", name: "Lakshmi Narayanan", dob: "1953-04-08", pan: "ACVPN7765B", occupation: "Retired: bank officer", income: 85_000, salary: { amount: 85_000, from: "Pension: bank pension fund" } },
  { key: "vikas", name: "Vikas Yadav", dob: "1992-07-27", pan: "BHNPY3318R", occupation: "Salaried: field executive", income: 78_000, salary: { amount: 78_000, from: "Prism Telecom Services", stopsOn: 15 }, risk: "medium" },
  { key: "pooja", name: "Pooja Desai", dob: "1995-01-30", pan: "BKSPD9902T", occupation: "Salaried: data analyst", income: 1_20_000, salary: { amount: 1_20_000, from: "Quartz Analytics Pvt Ltd" } },
  { key: "harpreet", name: "Harpreet Kaur", dob: "1987-08-05", pan: "AZMPK1146G", occupation: "Self-employed: boutique owner", income: 1_10_000 },
  { key: "shivneri", name: "Shivneri Infra Pvt Ltd", dob: "2009-04-01", pan: "AAJCS4410P", occupation: "Construction", income: 3_20_00_000, type: "CA" },
  { key: "coastal", name: "Coastal Agro Exports LLP", dob: "2014-09-15", pan: "AAPFC8172K", occupation: "Agri exports", income: 1_40_00_000, type: "CA" },
  { key: "nilgiri", name: "Nilgiri Tea Traders", dob: "2001-02-10", pan: "AACFN3091D", occupation: "Wholesale trade", income: 45_00_000, type: "CA" },
  { key: "deccan", name: "Deccan Pharma Distributors", dob: "2011-11-22", pan: "AADFD6634M", occupation: "Pharma distribution", income: 80_00_000, type: "CA" },
];

const GILTS = [
  { name: "6.79% GS 2034", coupon: 6.79, maturity: "2034-10-07" },
  { name: "7.02% GS 2031", coupon: 7.02, maturity: "2031-06-18" },
  { name: "6.92% GS 2039", coupon: 6.92, maturity: "2039-11-18" },
  { name: "364-day T-Bill", coupon: 5.6, maturity: "2027-09-02" },
];

export const SANDBOX_DAYS = 152;

/** Builds the sample bank: staff, customers, five months of business, ending on `today`. `b` opens SANDBOX_DAYS earlier. */
export function seedSandbox(b: Bank, hash: string, today: string) {
  const start = addDays(today, -SANDBOX_DAYS);
  if (b.date > start) throw new Error("Open the sandbox bank on its start date");
  b.date = start;
  const r = rng(20261031);
  const admin: Actor = { id: "U100", name: b.staff[0].name, role: "admin" };
  b.branches.push(
    { code: "0002", name: "Koramangala", city: "Bengaluru", ifsc: `${b.code}0000002` },
    { code: "0003", name: "Connaught Place", city: "New Delhi", ifsc: `${b.code}0000003` },
  );
  b.branches[0].name = "Fort";
  for (const s of STAFF) b.staff.push({ id: `U${K.seq(b, "staff", 100)}`, ...s, passwordHash: hash, active: true });
  const actor = (username: string): Actor => {
    const s = b.staff.find((x) => x.username === username)!;
    return { id: s.id, name: s.name, role: s.role };
  };
  // customers acting for themselves, in net banking
  const self = (key: string): Actor => ({ id: cif[key], name: PEOPLE.find((p) => p.key === key)!.name, role: "customer", cif: cif[key] });
  const pay = (key: string, beneficiary: string, amount: number, mode: "NEFT" | "RTGS" = amount >= 2_00_000 ? "RTGS" : "NEFT") =>
    K.remit(b, self(key), { from: acct[key], mode, beneficiary, beneficiaryAccount: "40110022334455", ifsc: "MLBT0002210", amount: rupees(amount) });
  const officer = actor("pnair"), teller = actor("skumar"), credit = actor("fsheikh"), dealer = actor("viyer"), manager = actor("rmehta");

  // Customers, KYC and accounts
  const cif: Record<string, string> = {};
  const acct: Record<string, string> = {};
  PEOPLE.forEach((p, i) => {
    const c = K.createCustomer(b, officer, {
      name: p.name,
      dob: p.dob,
      pan: p.pan,
      aadhaar: p.type ? "" : String(2000_0000_0000 + Math.floor(r() * 7000_0000_0000)),
      mobile: `${[98, 99, 97, 90, 88, 70][i % 6]}${String(Math.floor(10_000_000 + r() * 89_999_999))}`,
      email: `${p.key}@example.in`,
      address: p.type ? "Registered office, Mumbai 400001" : ["Andheri East, Mumbai", "HSR Layout, Bengaluru", "Mylapore, Chennai", "Saket, New Delhi"][i % 4],
      occupation: p.occupation,
      monthlyIncome: rupees(p.income),
      risk: p.risk ?? "low",
      branch: ["0001", "0002", "0003"][i % 3],
    });
    K.verifyKyc(b, officer, c.cif);
    if (p.exempt) K.setTaxExempt(b, officer, c.cif, true);
    cif[p.key] = c.cif;
    acct[p.key] = K.openAccount(b, officer, { cif: c.cif, type: p.type ?? "SB", nominee: p.type ? "" : "Spouse" }).id;
  });
  b.customers.find((c) => c.cif === cif.ananya)!.netbanking = { passwordHash: hash };
  b.customers.find((c) => c.cif === cif.divya)!.netbanking = { passwordHash: hash };
  K.setOdLimit(b, manager, acct.shivneri, rupees(5_00_00_000));

  // Opening funds
  const opening: Record<string, number> = { ananya: 3_40_000, rahul: 9_80_000, meera: 32_00_000, kabir: 1_18_00_000, fatima: 18_50_000, arjun: 46_00_000, neha: 4_20_000, suresh: 2_60_000, divya: 7_50_000, imran: 1_10_000, lakshmi: 62_00_000, vikas: 85_000, pooja: 2_30_000, harpreet: 5_60_000, shivneri: 64_00_00_000, coastal: 23_00_00_000, nilgiri: 6_50_00_000, deccan: 9_00_00_000 };
  for (const [k, v] of Object.entries(opening)) K.inward(b, teller, { account: acct[k], amount: rupees(v), mode: v > 2_00_000 ? "RTGS" : "NEFT", remitter: k === "shivneri" || k === "coastal" ? "Own account at another bank" : "Transfer from previous bank" });

  // Deposits
  K.openFd(b, officer, { cif: cif.meera, amount: rupees(25_00_000), months: 24, payout: "cumulative", from: acct.meera });
  K.openFd(b, officer, { cif: cif.lakshmi, amount: rupees(50_00_000), months: 12, payout: "quarterly", from: acct.lakshmi });
  K.openFd(b, officer, { cif: cif.fatima, amount: rupees(15_00_000), months: 36, payout: "cumulative", from: acct.fatima });
  K.openFd(b, officer, { cif: cif.kabir, amount: rupees(1_00_00_000), months: 36, payout: "cumulative", from: acct.kabir });
  K.openFd(b, officer, { cif: cif.shivneri, amount: rupees(20_00_00_000), months: 12, payout: "cumulative", from: acct.shivneri });
  K.openFd(b, officer, { cif: cif.coastal, amount: rupees(8_00_00_000), days: 180, payout: "cumulative", from: acct.coastal });
  K.openFd(b, officer, { cif: cif.arjun, amount: rupees(20_00_000), days: 91, payout: "cumulative", from: acct.arjun, autoRenew: true });
  K.openRd(b, officer, { cif: cif.ananya, installment: rupees(10_000), months: 24, from: acct.ananya });
  K.openRd(b, officer, { cif: cif.neha, installment: rupees(15_000), months: 36, from: acct.neha });
  K.openRd(b, officer, { cif: cif.pooja, installment: rupees(5_000), months: 12, from: acct.pooja });

  // Treasury puts the surplus to work: gilts for SLR
  K.buyGsec(b, dealer, { security: "7.26% GS 2032", amount: rupees(30_00_00_000), coupon: 7.26, maturity: "2032-08-22" });

  const loanFor = (key: string, productCode: string, amount: number, months: number, collateral = 0, existingEmi = 0) => {
    const app = K.applyLoan(b, credit, { cif: cif[key], product: productCode, amount: rupees(amount), months, collateralValue: rupees(collateral), existingEmi: rupees(existingEmi) });
    K.appraiseLoan(b, credit, app.id);
    K.sanctionLoan(b, manager, { id: app.id, note: "Within policy" });
    return K.disburseLoan(b, credit, { id: app.id, account: acct[key] });
  };

  // Five months of business
  const days = daysBetween(start, today);
  for (let day = 0; day < days; day++) {
    const D = b.date;
    if (day === 2) loanFor("rahul", "HL", 65_00_000, 240, 95_00_000);
    if (day === 3) loanFor("kabir", "AL", 12_00_000, 60, 14_50_000);
    if (day === 4) loanFor("vikas", "PL", 6_00_000, 48);
    if (day === 6) loanFor("suresh", "GL", 3_00_000, 12, 4_20_000);
    if (day === 8) loanFor("deccan", "BL", 2_50_00_000, 84, 4_00_00_000);
    if (day === 12) loanFor("arjun", "HL", 1_20_00_000, 300, 1_80_00_000);
    if (day === 30) loanFor("imran", "PL", 4_50_000, 36);
    if (day === 20) loanFor("shivneri", "BL", 40_00_00_000, 84, 70_00_00_000);
    if (day === 25) loanFor("coastal", "BL", 15_00_00_000, 60, 24_00_00_000);
    if (day === 20) pay("shivneri", "Steel and cement suppliers", 34_00_00_000);
    if (day === 25) pay("coastal", "Cold-chain warehouse contractor", 12_50_00_000);
    // borrowers spend what they borrowed
    if (day === 2) pay("rahul", "Skyline Habitat Developers", 60_00_000);
    if (day === 3) pay("kabir", "Metro Motors", 11_50_000);
    if (day === 4) pay("vikas", "Family wedding expenses", 5_90_000, "NEFT");
    if (day === 12) pay("arjun", "Skyline Habitat Developers", 1_15_00_000);
    if (day === 31) pay("imran", "Home renovation", 4_40_000, "NEFT");
    // two borrowers run their accounts dry: one stops paying early, one recently
    if (day === 16 || day === 100) {
      const who = day === 16 ? "vikas" : "imran";
      const a = b.accounts.find((x) => x.id === acct[who])!;
      if (K.available(a) > 0) K.cashWithdrawal(b, teller, { account: a.id, amount: K.available(a) });
    }

    // salaries on the 1st
    if (D.endsWith("-01")) {
      for (const p of PEOPLE) if (p.salary && !(p.salary.stopsOn !== undefined && day > p.salary.stopsOn)) K.inward(b, teller, { account: acct[p.key], amount: rupees(p.salary.amount), mode: "NEFT", remitter: p.salary.from });
    }
    // professional and business receipts on the 5th
    if (D.endsWith("-05")) {
      for (const p of PEOPLE) if (!p.salary && !p.type && !p.exempt) K.inward(b, teller, { account: acct[p.key], amount: rupees(p.income), mode: "NEFT", remitter: "Professional receipts" });
    }
    // everyday banking: cash, transfers, payments
    for (const p of PEOPLE) {
      if (p.key === "vikas" && day > 15) continue;
      if (p.key === "imran" && day > 70) continue;
      const a = b.accounts.find((x) => x.id === acct[p.key])!;
      const roll = r();
      try {
        if (p.type === "CA") {
          if (roll < 0.35) K.inward(b, teller, { account: a.id, amount: rupees(Math.round(2_00_000 + r() * 40_00_000)), mode: "RTGS", remitter: "Customer receipts" });
          else if (roll < 0.6) K.remit(b, teller, { from: a.id, mode: "RTGS", beneficiary: "Supplier payment", beneficiaryAccount: "50200012345678", ifsc: "VNDB0004411", amount: rupees(Math.round(2_00_000 + r() * 30_00_000)) });
        } else if (roll < 0.05) K.cashWithdrawal(b, teller, { account: a.id, amount: rupees(Math.round(2 + r() * 18) * 1000) });
        else if (roll < 0.08) K.cashDeposit(b, teller, { account: a.id, amount: rupees(Math.round(5 + r() * 40) * 1000) });
        else if (roll < 0.16) K.remit(b, self(p.key), { from: a.id, mode: "IMPS", beneficiary: ["Rent", "Electricity board", "Mutual fund SIP", "Credit card bill", "School fees"][Math.floor(r() * 5)], beneficiaryAccount: "33010098765432", ifsc: "GNGB0001190", amount: rupees(Math.round(1 + r() * 25) * 1000) });
      } catch {
        // a customer short of funds just doesn't make the payment
      }
    }
    if (day === 50) K.transfer(b, teller, { from: acct.kabir, to: acct.harpreet, amount: rupees(2_50_000), narration: "Interior works" });
    if (day === 95) K.cashDeposit(b, teller, { account: acct.nilgiri, amount: rupees(12_40_000), narration: "Cash sales deposited" });

    morningTreasury(b, dealer, r, true);
    runEod(b, admin, 1);
  }

  // the dealer's first look at the new day: cover any shortfall, but leave the surplus for them to place
  morningTreasury(b, dealer, r, false);

  // Waiting for the credit desk
  K.applyLoan(b, officer, { cif: cif.divya, product: "HL", amount: rupees(85_00_000), months: 240, purpose: "Flat in Whitefield, Bengaluru", collateralValue: rupees(1_15_00_000), existingEmi: 0 });
  K.applyLoan(b, officer, { cif: cif.pooja, product: "AL", amount: rupees(8_50_000), months: 60, purpose: "Hatchback", collateralValue: rupees(10_00_000), existingEmi: 0 });
  b.audit.push({ at: Date.now(), date: b.date, user: "system", name: "Sandbox", role: "system", action: "Sandbox ready", detail: `${days} days of sample business replayed` });
  return b;
}

/**
 * What the sample bank's dealer does each morning: keep the RBI balance a little above the CRR
 * requirement. Lasting surplus goes into gilts and the daily float is lent overnight; a shortfall
 * is met by selling gilts the SLR doesn't need, and then by borrowing overnight.
 */
function morningTreasury(b: Bank, dealer: Actor, r: () => number, lend: boolean) {
  const res = treasuryPosition(b);
  const surplus = res.crrSurplus - Math.round(res.crrRequired * 0.06);
  const open = (side: string) => b.callDeals.filter((d) => d.status === "open" && d.side === side).reduce((s, d) => s + d.amount, 0);
  const lendLimit = Math.round((K.capitalFunds(b) * 50) / 100) - open("lend");
  const rate = Math.round((b.rates.policy.repo - 0.08 + r() * 0.16) * 100) / 100;
  const counterparty = () => COUNTERPARTIES[Math.floor(r() * 6)];
  const lot = rupees(1_00_00_000);
  if (surplus > rupees(50_00_000) && lend) {
    const lasting = Math.floor((surplus - lendLimit) / rupees(5_00_00_000)) * rupees(5_00_00_000);
    if (lasting > 0) {
      const g = GILTS[b.investments.length % GILTS.length];
      K.buyGsec(b, dealer, { security: g.name, amount: lasting, coupon: g.coupon, maturity: g.maturity });
    }
    const amount = Math.min(Math.floor((surplus - Math.max(0, lasting)) / lot) * lot, lendLimit);
    if (amount > 0) K.callDeal(b, dealer, { side: "lend", counterparty: counterparty(), amount, rate, days: 1 });
  } else if (surplus < 0) {
    let short = -surplus;
    // sell gilts the SLR can spare, smallest first, while keeping a quarter over the requirement
    for (const inv of [...b.investments].sort((x, y) => x.faceValue - y.faceValue)) {
      if (short <= 0) break;
      const after = treasuryPosition(b);
      if (after.slrHeld - inv.faceValue < after.slrRequired * 1.25) continue;
      if (inv.faceValue > short * 4 && short < rupees(2_00_00_000)) continue; // a small gap is cheaper to borrow
      K.sellGsec(b, dealer, inv.id);
      short -= inv.faceValue;
    }
    if (short > 0) K.callDeal(b, dealer, { side: "borrow", counterparty: counterparty(), amount: Math.ceil(short / lot) * lot, rate: rate + 0.05, days: 1 });
  }
}

export function treasuryPosition(b: Bank) {
  const gl = (code: string) => b.gl[code] ?? 0;
  return reserves(
    {
      sb: -gl(G.sb),
      ca: -gl(G.ca),
      fd: -gl(G.fd),
      rd: -gl(G.rd),
      interestPayable: -gl(G.interestPayable),
      interbankLiabilities: -gl(G.callBorrowed),
      interbankAssets: gl(G.callLent),
      balanceWithRbi: gl(G.rbi),
      cash: gl(G.cash),
      gsec: gl(G.gsec),
    },
    b.rates.policy,
  );
}
