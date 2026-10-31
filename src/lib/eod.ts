import { account, available, audit, book, customer, deductTds, LIMITS, overdue, payRdInstallment, post, product, refreshDpd, repayLoan, settleCall, settleDeposit, type Actor } from "./bank";
import { addDays, addMonths, daysBetween, isMonthEnd, isQuarterEnd } from "./dates";
import { type Bank, G, GST_RATE, LOAN_GL, type Loan } from "./model";
import { formatINR } from "./money";
import { classify, dayInterest, isNpa, provisionPct, sbRate, CLASS_LABEL } from "./rules";

// End of day: the batch a core banking system runs after the branches close. It works through the
// day in a fixed order (dues and debits first, then interest, then period-end postings, then
// maturities and classification) and finally moves the business date on by one day.

type Step = { step: string; detail: string };

export function runEod(b: Bank, actor: Actor, days = 1) {
  const runs: { date: string; steps: Step[] }[] = [];
  for (let i = 0; i < days; i++) runs.push({ date: b.date, steps: closeDay(b, actor) });
  return runs;
}

function closeDay(b: Bank, actor: Actor): Step[] {
  const D = b.date;
  const steps: Step[] = [];
  const log = (step: string, detail: string) => steps.push({ step, detail });

  // 1. Loan instalments falling due today, and NACH debits for them
  let raised = 0, collected = 0, bounced = 0;
  for (const l of b.loans) {
    if (l.status !== "active") continue;
    while (l.nextDueOn <= D && l.raised < l.months && l.outstanding > 0) {
      const demand = raiseDemand(b, actor, l);
      raised++;
      const a = account(b, l.linkedAccount);
      const due = demand.principal + demand.interest;
      if (a.status === "active" && available(a) >= overdue(l)) {
        repayLoan(b, actor, { id: l.id, amount: overdue(l), from: a.id }, "NACH");
        collected++;
      } else if (a.status === "active" && available(a) >= due) {
        repayLoan(b, actor, { id: l.id, amount: due, from: a.id }, "NACH");
        collected++;
      } else {
        // NACH returned for want of funds: a flat charge plus GST, not penal interest
        const fee = LIMITS.bounceCharge;
        const tax = Math.round((fee * GST_RATE) / 100);
        l.charges += fee + tax;
        post(b, actor, `NACH return charge ${l.id}`, [[G.interestReceivable, fee + tax], [G.fees, -fee], [G.gst, -tax]]);
        bounced++;
      }
    }
  }
  log("Loan instalments", raised ? `${raised} demanded, ${collected} collected by NACH, ${bounced} returned unpaid` : "None due");

  // 2. Recurring deposit instalments
  let rdPaid = 0, rdMissed = 0;
  for (const d of b.deposits) {
    if (d.kind !== "RD" || d.status !== "active" || d.installmentsPaid >= d.months || d.nextDueOn > D) continue;
    const a = account(b, d.linkedAccount);
    if (a.status === "active" && available(a) >= d.installment) {
      payRdInstallment(b, actor, d.id);
      rdPaid++;
    } else rdMissed++;
  }
  log("RD instalments", rdPaid || rdMissed ? `${rdPaid} paid by standing instruction, ${rdMissed} short of funds` : "None due");

  // 3. Interest accrual (actual/365). The ledger's "interest payable" always equals the rounded accruals.
  let sbAcc = 0, tdAcc = 0, odAcc = 0;
  for (const a of b.accounts) {
    if (a.status === "closed") continue;
    if (a.type === "SB" && a.balance > 0) {
      const before = Math.round(a.accrued);
      a.accrued += dayInterest(a.balance, sbRate(b.rates.sb, a.balance));
      sbAcc += Math.round(a.accrued) - before;
    } else if (a.type === "CA" && a.balance < 0) {
      a.accrued += dayInterest(-a.balance, b.rates.odRate);
      odAcc += dayInterest(-a.balance, b.rates.odRate);
    }
  }
  for (const d of b.deposits) {
    if (d.status !== "active") continue;
    const before = Math.round(d.accrued);
    d.accrued += dayInterest(d.balance, d.rate);
    tdAcc += Math.round(d.accrued) - before;
  }
  post(b, actor, `Interest accrued ${D}`, [[G.sbInterest, sbAcc], [G.tdInterest, tdAcc], [G.interestPayable, -(sbAcc + tdAcc)]]);
  log("Interest accrual", `Savings ${formatINR(sbAcc)}, term deposits ${formatINR(tdAcc)}${odAcc ? `, overdrafts ${formatINR(Math.round(odAcc))}` : ""}`);

  // 4. Quarter end: savings interest credited; term deposit interest compounded or paid out, less TDS
  if (isQuarterEnd(D)) {
    let sb = 0, cap = 0, paid = 0, tdsTotal = 0;
    for (const a of b.accounts) {
      if (a.type !== "SB" || a.status === "closed") continue;
      const amt = Math.round(a.accrued);
      a.accrued = 0;
      if (!amt) continue;
      book(b, actor, { narration: "Savings interest credited", channel: "SYSTEM", moves: [{ account: a.id, amount: amt }], gl: [[G.interestPayable, amt]], customerInitiated: false });
      sb += amt;
    }
    for (const d of b.deposits) {
      if (d.kind !== "FD" || d.status !== "active") continue;
      // short cumulative deposits earn simple interest, settled at maturity
      if (d.payout === "cumulative" && daysBetween(d.openedOn, d.maturityOn) < 181) continue;
      const amt = Math.round(d.accrued);
      if (!amt) continue;
      d.accrued -= amt;
      const tds = deductTds(b, d, amt);
      tdsTotal += tds;
      if (d.payout === "cumulative") {
        d.balance += amt - tds;
        // TDS taken from a cumulative deposit reduces it, so the principal it compounds on is reduced too
        d.principal -= tds;
        post(b, actor, `Interest compounded FD ${d.id}`, [[G.interestPayable, amt], [G.fd, -(amt - tds)], [G.tds, -tds]]);
        cap += amt;
      } else {
        d.interestPaid += amt;
        book(b, actor, { narration: `FD ${d.id} quarterly interest${tds ? `, TDS ${formatINR(tds)}` : ""}`, channel: "SYSTEM", moves: [{ account: d.linkedAccount, amount: amt - tds }], gl: [[G.interestPayable, amt], [G.tds, -tds]], customerInitiated: false });
        paid += amt;
      }
    }
    log("Quarter-end interest", `Savings credited ${formatINR(sb)}, FD compounded ${formatINR(cap)}, FD paid out ${formatINR(paid)}, TDS ${formatINR(tdsTotal)}`);
  }

  // 5. Month end: overdraft interest debited; coupon on government securities received
  if (isMonthEnd(D)) {
    let od = 0;
    for (const a of b.accounts) {
      if (a.type !== "CA" || !a.accrued) continue;
      const amt = Math.round(a.accrued);
      a.accrued = 0;
      if (!amt) continue;
      book(b, actor, { narration: "Overdraft interest", channel: "SYSTEM", moves: [{ account: a.id, amount: -amt }], gl: [[G.loanInterest, -amt]], customerInitiated: false, force: true });
      od += amt;
    }
    const coupon = Math.round(b.investments.reduce((s, i) => s + (i.faceValue * i.coupon) / 1200, 0));
    post(b, actor, `G-Sec coupon ${D.slice(0, 7)}`, [[G.rbi, coupon], [G.investmentIncome, -coupon]]);
    log("Month-end postings", `Overdraft interest ${formatINR(od)}, G-Sec coupon ${formatINR(coupon)}`);
  }

  // 6. Deposits maturing today
  let matured = 0, renewed = 0;
  for (const d of [...b.deposits]) {
    if (d.status !== "active" || d.maturityOn > D) continue;
    const r = settleDeposit(b, actor, d, d.rate, "maturity");
    matured++;
    if (r.renewed) renewed++;
  }
  log("Deposit maturities", matured ? `${matured} matured, ${renewed} renewed automatically` : "None");

  // 7. Money market deals maturing today
  const deals = b.callDeals.filter((d) => d.status === "open" && d.maturesOn <= D);
  for (const d of deals) settleCall(b, actor, d.id);
  log("Call and notice money", deals.length ? `${deals.length} deal${deals.length === 1 ? "" : "s"} settled through the RBI account` : "None maturing");

  // 8. Asset classification and provisioning
  const moved: string[] = [];
  let delta = 0;
  for (const l of b.loans) {
    if (l.status !== "active") continue;
    const before = l.assetClass;
    classifyLoan(b, actor, l, D);
    if (l.assetClass !== before) moved.push(`${l.id} ${CLASS_LABEL[before]} → ${CLASS_LABEL[l.assetClass]}`);
    const p = product(b, l.product);
    const required = Math.round((l.outstanding * provisionPct(l.assetClass, p.secured)) / 100);
    delta += required - l.provision;
    l.provision = required;
  }
  post(b, actor, `Provisioning ${D}`, [[G.provisionExpense, delta], [G.provisions, -delta]]);
  log("Asset classification", `${moved.length ? moved.join("; ") : "No changes"}; provisions ${delta >= 0 ? "up" : "down"} ${formatINR(Math.abs(delta))}`);

  // 9. Accounts with no customer activity for two years become inoperative
  let dormant = 0;
  for (const a of b.accounts) {
    if (a.status === "active" && daysBetween(a.lastActivity, D) > 730) {
      a.status = "dormant";
      dormant++;
    }
  }
  if (dormant) log("Dormancy", `${dormant} account${dormant === 1 ? "" : "s"} marked inoperative`);

  b.date = addDays(D, 1);
  log("Business date", `Moved to ${b.date}`);
  b.eod.push({ date: D, at: Date.now(), by: actor.name, steps });
  if (b.eod.length > 400) b.eod = b.eod.slice(-400);
  audit(b, actor, "End of day", `${D} closed`);
  return steps;
}

/** Demands one month's instalment: interest on the outstanding, the rest of the EMI as principal */
function raiseDemand(b: Bank, actor: Actor, l: Loan) {
  const notDue = l.outstanding - l.demands.reduce((s, d) => s + d.principal - d.paidPrincipal, 0);
  const interest = Math.round((l.outstanding * l.rate) / 1200);
  const last = l.raised + 1 >= l.months;
  const principal = last ? notDue : Math.min(notDue, Math.max(0, l.emi - interest));
  const demand = { dueOn: l.nextDueOn, principal, interest, paidPrincipal: 0, paidInterest: 0 };
  l.demands.push(demand);
  l.raised++;
  l.nextDueOn = addMonths(l.firstDueOn, l.raised);
  // interest on a non-performing loan is not income until it is paid: it goes to suspense
  post(b, actor, `EMI ${l.raised} of ${l.months} due ${l.id}`, [[G.interestReceivable, interest], [l.npaSince ? G.suspense : G.loanInterest, -interest]]);
  return demand;
}

/**
 * Days past due set the class; past 90 the loan becomes an NPA, and interest booked but not received
 * is reversed out of income into suspense. An NPA is upgraded only when every arrear is cleared.
 */
export function classifyLoan(b: Bank, actor: Actor, l: Loan, on: string) {
  refreshDpd(b, l);
  if (!l.npaSince && l.dpd > 90) {
    l.npaSince = on;
    const unrealised = l.demands.reduce((s, d) => s + d.interest - d.paidInterest, 0);
    post(b, actor, `NPA: unrealised interest reversed ${l.id}`, [[G.loanInterest, unrealised], [G.suspense, -unrealised]]);
    audit(b, actor, "Loan became NPA", `${l.id} of ${customer(b, l.cif).name}: ${l.dpd} days past due`);
  } else if (l.npaSince && overdue(l) === 0) {
    l.npaSince = "";
    audit(b, actor, "NPA upgraded", `${l.id}: arrears cleared in full`);
  }
  l.assetClass = l.npaSince ? classify(l.dpd, daysBetween(l.npaSince, on)) : classify(l.dpd, null);
  return isNpa(l.assetClass);
}

export const loanGl = (code: string) => LOAN_GL[code];
