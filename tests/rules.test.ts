import { describe, expect, test } from "vitest";
import { addMonths, financialYear, isQuarterEnd, monthsBetween } from "@/lib/dates";
import { compactINR, formatINR, parseRupees, rupees } from "@/lib/money";
import { amortise, appraise, classify, defaultRates, emi, fdMaturity, fdRate, prematureRate, provisionPct, rdMaturity, reserves, tdsDue } from "@/lib/rules";

const R = defaultRates();

describe("dates", () => {
  test("month arithmetic clamps to the month's end", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(monthsBetween("2026-01-31", "2026-02-28")).toBe(1);
    expect(monthsBetween("2026-01-15", "2026-04-14")).toBe(2);
  });
  test("financial years and quarter ends", () => {
    expect(financialYear("2026-03-31")).toBe("2025-26");
    expect(financialYear("2026-04-01")).toBe("2026-27");
    expect(isQuarterEnd("2026-09-30")).toBe(true);
    expect(isQuarterEnd("2026-10-31")).toBe(false);
  });
});

describe("money", () => {
  test("Indian grouping", () => {
    expect(formatINR(rupees(1234567.5))).toBe("₹12,34,567.50");
    expect(compactINR(rupees(4_25_00_000))).toBe("₹4.25 Cr");
    expect(parseRupees("1,50,000.5")).toBe(15000050);
    expect(Number.isNaN(parseRupees("12abc"))).toBe(true);
  });
});

describe("deposits", () => {
  test("card rate by tenure, with the senior-citizen extra", () => {
    expect(fdRate(R.fd, 365, false, R.seniorExtra)).toBe(6.8);
    expect(fdRate(R.fd, 400, true, R.seniorExtra)).toBe(7.3);
    expect(fdRate(R.fd, 5, false, R.seniorExtra)).toBeNull();
  });
  test("a cumulative FD compounds quarterly", () => {
    // ₹1,00,000 at 7% for exactly one year: (1 + 0.07/4)^4
    const m = fdMaturity(rupees(100000), 7, "2026-04-01", "2027-04-01", "cumulative");
    expect(m.maturity).toBe(Math.round(rupees(100000) * Math.pow(1.0175, 4)));
    expect(m.interest).toBe(718590);
  });
  test("short and payout deposits earn simple interest", () => {
    expect(fdMaturity(rupees(100000), 5.25, "2026-04-01", "2026-07-01", "cumulative").interest).toBe(Math.round((rupees(100000) * 5.25 * 91) / 36500));
    expect(fdMaturity(rupees(100000), 7, "2026-04-01", "2027-04-01", "quarterly").maturity).toBe(rupees(100000));
  });
  test("RD maturity matches the published formula", () => {
    // ₹1,000 a month for 12 months at 7%: R[(1+i)^n − 1] / (1 − (1+i)^(−1/3)) with i = 7/400, n = 4 quarters
    const m = rdMaturity(rupees(1000), 7, 12);
    const i = 7 / 400;
    expect(Math.abs(m.maturity - (rupees(1000) * (Math.pow(1 + i, 4) - 1)) / (1 - Math.pow(1 + i, -1 / 3)))).toBeLessThan(100);
  });
  test("premature closure: the lower of period and contracted rates, less the penalty", () => {
    expect(prematureRate(R.fd, 200, 7, false, 0.5, 0.5)).toBe(5.5);
    expect(prematureRate(R.fd, 800, 6.8, false, 0.5, 0.5)).toBe(6.3);
    expect(prematureRate(R.fd, 5, 7, false, 0.5, 0.5)).toBe(0);
  });
  test("TDS starts once the year's interest passes the threshold, and catches up", () => {
    const who = { senior: false, pan: true, exempt: false };
    expect(tdsDue(rupees(49000), 0, who, R.tds)).toBe(0);
    expect(tdsDue(rupees(60000), 0, who, R.tds)).toBe(rupees(6000));
    expect(tdsDue(rupees(70000), rupees(6000), who, R.tds)).toBe(rupees(1000));
    expect(tdsDue(rupees(90000), 0, { ...who, senior: true }, R.tds)).toBe(0);
    expect(tdsDue(rupees(60000), 0, { ...who, pan: false }, R.tds)).toBe(rupees(12000));
    expect(tdsDue(rupees(600000), 0, { ...who, exempt: true }, R.tds)).toBe(0);
  });
});

describe("loans", () => {
  test("EMI on a reducing balance", () => {
    // ₹10 lakh at 9% for 5 years: ₹20,758
    expect(Math.round(emi(rupees(1000000), 9, 60) / 100)).toBe(20758);
  });
  test("the schedule ends at zero", () => {
    const s = amortise(rupees(500000), 11, 24, "2026-12-05");
    expect(s).toHaveLength(24);
    expect(s.at(-1)!.closing).toBe(0);
    expect(s.reduce((t, r) => t + r.principal, 0)).toBe(rupees(500000));
    expect(s[1].dueOn).toBe("2027-01-05");
  });
  test("appraisal checks score, FOIR, tenure and LTV", () => {
    const hl = R.products[0];
    const a = appraise({ amount: rupees(8000000), months: 240, rate: 8.15, monthlyIncome: rupees(250000), existingEmi: 0, collateral: rupees(11000000), pan: "BDXPM2290L" }, hl);
    expect(a.checks.map((c) => c.label)).toEqual(["Credit score", "FOIR", "Tenure", "Loan to value"]);
    expect(a.ltv).toBe(72.73);
    const big = appraise({ amount: rupees(10000000), months: 240, rate: 8.15, monthlyIncome: rupees(100000), existingEmi: 0, collateral: rupees(11000000), pan: "BDXPM2290L" }, hl);
    expect(big.checks.find((c) => c.label === "FOIR")!.ok).toBe(false);
    expect(big.checks.find((c) => c.label === "Loan to value")!.ok).toBe(false);
  });
});

describe("IRAC", () => {
  test("days past due set the class; NPAs age into doubtful", () => {
    expect(classify(0, null)).toBe("STD");
    expect(classify(30, null)).toBe("SMA-0");
    expect(classify(31, null)).toBe("SMA-1");
    expect(classify(90, null)).toBe("SMA-2");
    expect(classify(91, null)).toBe("SUB");
    expect(classify(400, 300)).toBe("SUB");
    expect(classify(500, 400)).toBe("D1");
    expect(classify(1000, 900)).toBe("D2");
    expect(classify(2000, 1500)).toBe("D3");
  });
  test("provisioning", () => {
    expect(provisionPct("STD", true)).toBe(0.4);
    expect(provisionPct("SUB", true)).toBe(15);
    expect(provisionPct("SUB", false)).toBe(25);
    expect(provisionPct("D1", false)).toBe(100);
    expect(provisionPct("D2", true)).toBe(40);
  });
});

describe("reserves", () => {
  test("NDTL, CRR and SLR", () => {
    const r = reserves({ sb: 400, ca: 200, fd: 300, rd: 100, interestPayable: 0, interbankLiabilities: 50, interbankAssets: 150, balanceWithRbi: 40, cash: 20, gsec: 160 }, R.policy);
    expect(r.ndtl).toBe(900);
    expect(r.crrRequired).toBe(27);
    expect(r.slrRequired).toBe(162);
    expect(r.crrSurplus).toBe(13);
    expect(r.slrSurplus).toBe(18);
  });
});
