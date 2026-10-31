# Architecture

Kosh is a Next.js app. The browser runs the staff console (`/app`) and net banking (`/netbanking`); the
server runs the banking engine behind a small API.

## Layers

| File | What it does |
| --- | --- |
| [src/lib/rules.ts](../src/lib/rules.ts) | Pure formulas: interest, EMIs, FD and RD maturity, premature rates, TDS, appraisal, IRAC classes and provisions, NDTL, CRR, SLR, call money limits |
| [src/lib/model.ts](../src/lib/model.ts) | The shape of one bank's books, the roles, and the chart of accounts |
| [src/lib/bank.ts](../src/lib/bank.ts) | The engine: every operation (customers, accounts, cash, payments, deposits, loans, treasury), all posting through `book()` and `post()` |
| [src/lib/eod.ts](../src/lib/eod.ts) | The end-of-day batch |
| [src/lib/ops.ts](../src/lib/ops.ts) | The operations the API accepts: which roles may run them, which amounts need authorisation, and maker-checker |
| [src/lib/views.ts](../src/lib/views.ts) | Read models for each screen, filtered by role |
| [src/lib/store.ts](../src/lib/store.ts) | Storage with compare-and-swap writes: Netlify Blobs, or memory |
| [src/lib/tenancy.ts](../src/lib/tenancy.ts) | Banks, sign-in, sessions, sandboxes |
| [src/lib/seed.ts](../src/lib/seed.ts) | A new bank's opening books, and the sandbox's five months of sample business |

## Postings

`post()` takes ledger entries (debits positive, credits negative), refuses anything that doesn't
balance, and updates the ledger balances. `book()` adds customer accounts: it works out each account's
ledger heads (an overdrawn current account moves from current deposits to overdrafts), checks the funds
(available = balance − lien + overdraft limit), posts one voucher, and writes the statement lines. Nothing
else changes a balance, which is why [tests/engine.test.ts](../tests/engine.test.ts) can check after
every scenario that:

- the ledger sums to zero;
- savings, current, overdraft, FD and RD heads equal the accounts and deposits;
- interest payable equals the rounded accruals;
- each loan head equals its loans' outstanding principal;
- interest receivable equals unpaid interest plus charges;
- interest suspense equals NPAs' unpaid interest;
- provisions, call money and gilts equal their registers;
- every statement's last balance is the account's balance.

## Maker-checker

`execute()` in `ops.ts` checks the role, then asks the operation whether this request needs a second
person. If it does, the operation is run on a copy of the books to make sure it would post, then queued.
A manager or administrator who isn't the maker authorises it; it then runs as the maker, and the audit
trail records both. End of day refuses to run while anything is waiting.

## End of day

1. Loan instalments demanded; NACH collects them, or charges a returned debit.
2. RD instalments by standing instruction.
3. Interest accrued on savings and term deposits; overdraft interest accrued.
4. Quarter end: savings interest credited; FD interest compounded or paid out, with TDS.
5. Month end: overdraft interest debited; gilt coupons received.
6. Deposits maturing are settled or renewed.
7. Call and notice money settled through the RBI account.
8. Loans aged, classified and provisioned; NPAs' interest moved to suspense.
9. Inactive accounts marked dormant.
10. The business date moves on.

## Storage and concurrency

Each bank is one JSON document (`banks/<id>`). An operation is
`read with version → apply → write if the version is unchanged`, retried on conflict
(`transact()` in `store.ts`). On Netlify, Blobs gives strong consistency and conditional writes
(`onlyIfMatch`). This keeps every operation atomic. It suits banks of the sandbox's size; a large bank
would implement the `KV` interface over a relational database and split the journal from the master
data.

## Security

- Passwords are scrypt hashes, and sessions are random tokens stored as SHA-256 hashes, in an HttpOnly,
  SameSite=Lax cookie that lasts 12 hours.
- State-changing endpoints refuse cross-site requests.
- Roles are enforced on the server, for every operation and every view.
- Customers in net banking can act only on their own accounts.
- Aadhaar is stored as its last four digits.
- The "switch user" menu exists only in sandboxes.
