# Banking rules

How Kosh works out each number. The formulas live in [src/lib/rules.ts](../src/lib/rules.ts) and are
unit-tested in [tests/rules.test.ts](../tests/rules.test.ts). Amounts are held in whole paise; interest
is computed in fractions and rounded only when posted. Rates are % a year. Every default below can be
changed under **Rates** or **Treasury → RBI policy rates**.

## Savings accounts

- Interest accrues each end of day on the day's balance: `balance × rate / 36500`.
- The rate is slabbed by balance: 2.70% up to ₹10 lakh, 3.00% above (whole balance).
- Accrued interest is credited at the end of each quarter (30 June, 30 September, 31 December, 31 March).
- Savings interest is outside section 194A, so no TDS.

## Fixed deposits

- The rate comes from the card by tenure in days, plus 0.50% for senior citizens (60 and over).
- **Cumulative, six months or more:** compounded quarterly; the broken period after the last full
  quarter earns simple interest.
  `A = P × (1 + r/400)^q`, then `A += A × r × d / 36500`
- **Cumulative, under six months:** simple interest, `P × r × days / 36500`.
- **Quarterly payout:** simple interest paid to the linked account each quarter; the principal is
  returned at maturity.
- **At maturity** the interest is worked out again from scratch, and anything accruals rounded
  differently is trued up. The deposit is then paid to the linked account or, with auto-renew, renewed
  at the current card rate.
- **Premature closure:** the card rate for the period actually run (never above the contracted rate),
  less a 0.50% penalty. Nothing is paid within 7 days. Interest already paid out is recovered from the
  payout.

## Recurring deposits

- Maturity value: `M = Σ I × (1 + r/400)^(k/3)` for k = 1…n months, which is the same as
  `R[(1+i)^n − 1] / (1 − (1+i)^(−1/3))` with i = r/400 and n quarters.
- Instalments are collected by standing instruction at end of day.
- A late instalment is charged ₹1.50 per ₹100 for each month it is late.
- On closure the value is worked out from the instalments actually paid, each growing from its own
  payment date.

## TDS (section 194A)

- Once a customer's deposit interest for the financial year passes ₹50,000 (₹1,00,000 for senior
  citizens), 10% is due on all of it, including what was paid before the threshold was crossed; what
  was already deducted is netted off.
- 20% without PAN. Nothing with Form 15G/15H.

## Loans

- EMI on a reducing balance: `EMI = P × r × (1+r)^n / ((1+r)^n − 1)`, r = rate/1200.
- Each due date, end of day demands one instalment: interest on the outstanding principal at rate/12,
  the rest of the EMI as principal. The last instalment clears what is left.
- NACH collects the dues if the linked account has the funds. Otherwise the debit is returned, with a
  ₹500 charge plus GST (a charge, not penal interest).
- Repayments go to charges, then interest, then principal, oldest first. Anything over the dues prepays
  principal: the EMI stays, and the loan finishes sooner.
- **Floating rate:** repo + spread (home 2.65%, MSME 4.25%). When the repo rate changes, the EMI is
  recomputed over the remaining tenure.
- **Fixed rate:** auto 9.15%, personal 11.45%, gold 9.00%.
- **Foreclosure:** arrears + principal + interest for the broken period + a foreclosure charge (none on
  floating-rate loans) + GST.
- **Appraisal:** the credit score must be 700 or more, FOIR 55% or less of monthly income (existing EMIs
  at this bank are added automatically), tenure within the product's maximum, and LTV within its cap
  (home 80%, auto 85%, gold 75%, MSME 70%). All pass: approve. One fails with a score of 680 or more:
  refer. Otherwise: decline. The demo's credit score is derived from the PAN; connect a bureau in
  `bureauScore`.
- **Processing fee:** a percentage of the loan (0.25% to 1.5%), plus 18% GST, debited on disbursal.

## Asset classification and provisioning (IRAC)

| Days past due | Class | Provision (secured / unsecured) |
| --- | --- | --- |
| 0 | Standard | 0.4% |
| 1–30 | SMA-0 | 0.4% |
| 31–60 | SMA-1 | 0.4% |
| 61–90 | SMA-2 | 0.4% |
| over 90: NPA, first 12 months | Sub-standard | 15% / 25% |
| NPA 1–2 years | Doubtful 1 | 25% / 100% |
| NPA 2–4 years | Doubtful 2 | 40% / 100% |
| NPA over 4 years | Doubtful 3 | 100% |

- Days past due count from the oldest instalment not paid in full.
- When a loan becomes an NPA, the interest booked but not received is reversed out of income into
  interest suspense. Later interest on it goes straight to suspense, and moves to income only when
  paid.
- An NPA is upgraded to standard only when every arrear is paid.
- Provisions are adjusted at each end of day.

## Treasury

- **NDTL** = demand liabilities (savings, current, interest payable) + time liabilities (fixed and
  recurring) + liabilities to other banks − assets with other banks.
- **CRR** = CRR% × NDTL, held as the balance with the RBI. It may dip to 90% on a day if the
  fortnight's average holds. Default 3.00%.
- **SLR** = SLR% × NDTL, held in cash and government securities. Default 18.00%.
- **Call money** (overnight) and **notice money** (2–14 days): interest `amount × rate × days / 36500`,
  settled through the RBI account at end of day.
- **Call money limits**, as % of capital funds (capital + reserves): borrowing up to 125% on any day and
  100% on a fortnightly average; lending up to 50% on any day and 25% on average. Deals over the
  day limit are refused. A rate outside the SDF–MSF corridor is allowed but noted in the audit trail.
- **Policy rate defaults:** repo 5.50%, SDF 5.25%, MSF 5.75%, bank rate 5.75%.

## Other limits

| Rule | Default |
| --- | --- |
| PAN (or Form 60) for cash deposits | ₹50,000 or more |
| Cash transaction report (FIU-IND) | ₹10 lakh or more |
| Teller cash withdrawal without authorisation | up to ₹2 lakh |
| Transfers and remittances without authorisation | up to ₹25 lakh |
| Credit officer's sanction limit | ₹25 lakh |
| RTGS minimum / IMPS maximum | ₹2 lakh / ₹5 lakh |
| RTGS at a branch | ₹20 (₹2–5 lakh) or ₹45 (over ₹5 lakh), plus GST; free online |
| Dormancy | no customer activity for two years |

The authorisation limits are in `LIMITS` in [src/lib/bank.ts](../src/lib/bank.ts).
