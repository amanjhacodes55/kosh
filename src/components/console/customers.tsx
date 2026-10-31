"use client";

import { ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine, BadgeCheck, FileCheck2, Globe, HandCoins, Lock, Printer, Send, Unlock, UserPlus, Wallet } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { type Me, op, useView } from "@/client/api";
import type { Account, Customer, Deposit, Loan, LoanApplication, Txn } from "@/lib/model";
import { formatDate } from "@/lib/dates";
import { parseRupees } from "@/lib/money";
import { Amount, Badge, Card, D, Empty, Facts, Field, Loading, PageHead, StatusBadge } from "../ui";
import { AmountInput, CashForm, Confirm, FdForm, LoanApply, NetbankingForm, NewCustomer, OpenAccount, RdForm, RemitForm, TransferForm, useRates } from "./forms";

type Row = { cif: string; name: string; pan: string; mobile: string; kyc: string; risk: string; branch: string; senior: boolean; createdOn: string; accounts: number };

export function Customers({ me, q }: { me: Me; q: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [search, setSearch] = useState(q);
  const [adding, setAdding] = useState(params.get("new") === "1");
  const { data } = useView<Row[]>("customers", { q });
  const canAdd = ["officer", "manager", "admin"].includes(me.user.role);
  return (
    <>
      <PageHead
        title="Customers"
        sub="Customer information file (CIF): one record per customer, shared by every account, deposit and loan"
        actions={canAdd && (
          <button id="new-customer" className="btn btn-primary" onClick={() => setAdding(true)}>
            <UserPlus size={15} /> New customer
          </button>
        )}
      />
      <form className="mb-4" onSubmit={(e) => (e.preventDefault(), router.push(`/app/customers?q=${encodeURIComponent(search)}`))}>
        <input className="input max-w-md" placeholder="Search by name, CIF, PAN or mobile" value={search} onChange={(e) => setSearch(e.target.value)} />
      </form>
      <Card pad={false}>
        {!data ? (
          <div className="p-5"><Loading /></div>
        ) : !data.length ? (
          <Empty>No customers match.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr><th>CIF</th><th>Name</th><th>PAN</th><th>Mobile</th><th>KYC</th><th>Risk</th><th>Branch</th><th className="r">Accounts</th></tr>
              </thead>
              <tbody>
                {data.map((c) => (
                  <tr key={c.cif} className="link" onClick={() => router.push(`/app/customers/${c.cif}`)}>
                    <td className="font-mono text-xs">{c.cif}</td>
                    <td className="font-medium">{c.name} {c.senior && <Badge tone="gold">Senior</Badge>}</td>
                    <td className="font-mono text-xs">{c.pan || "–"}</td>
                    <td className="num">{c.mobile}</td>
                    <td><StatusBadge s={c.kyc} /></td>
                    <td><StatusBadge s={c.risk} /></td>
                    <td>{me.bank.branches.find((b) => b.code === c.branch)?.name}</td>
                    <td className="r num">{c.accounts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {adding && <NewCustomer branches={me.bank.branches} onClose={() => setAdding(false)} onDone={(cif) => router.push(`/app/customers/${cif}`)} />}
    </>
  );
}

type C360 = {
  customer: Omit<Customer, "netbanking"> & { senior: boolean; netbanking: boolean };
  accounts: (Account & { available: number })[];
  deposits: Deposit[];
  loans: (Loan & { overdue: number })[];
  applications: LoanApplication[];
  tds: { year: string; interest: number; tds: number };
};

export function CustomerPage({ cif, me }: { cif: string; me: Me }) {
  const router = useRouter();
  const { data, error } = useView<C360>("customer", { cif });
  const rates = useRates();
  const loanInfo = useView<{ products: { code: string; name: string; rate: number; secured: boolean }[] }>("loans").data;
  const [modal, setModal] = useState<string | null>(null);
  if (error) return <Empty>{error}</Empty>;
  if (!data) return <Loading />;
  const c = data.customer;
  const role = me.user.role;
  const front = ["officer", "manager"].includes(role);
  const casa = data.accounts.filter((a) => a.status !== "closed");
  return (
    <>
      <PageHead
        title={
          <span className="flex flex-wrap items-center gap-2">
            {c.name}
            <StatusBadge s={c.kyc} />
            {c.senior && <Badge tone="gold">Senior citizen</Badge>}
            {c.taxExempt && <Badge tone="blue">{c.senior ? "Form 15H" : "Form 15G"}</Badge>}
          </span>
        }
        sub={`CIF ${c.cif} · customer since ${formatDate(c.createdOn)} · ${me.bank.branches.find((b) => b.code === c.branch)?.name} branch`}
        actions={
          front && (
            <>
              {c.kyc !== "verified" && (
                <button id="verify-kyc" className="btn btn-primary" onClick={() => op("verifyKyc", { cif }, "KYC verified")}>
                  <BadgeCheck size={15} /> Verify KYC
                </button>
              )}
              {c.kyc === "verified" && (
                <>
                  <button id="open-account" className="btn" onClick={() => setModal("account")}><Wallet size={15} /> Open account</button>
                  <button id="open-fd" className="btn" onClick={() => setModal("fd")} disabled={!casa.length}>Open FD</button>
                  <button id="open-rd" className="btn" onClick={() => setModal("rd")} disabled={!casa.length}>Open RD</button>
                  <button id="apply-loan" className="btn" onClick={() => setModal("loan")}><HandCoins size={15} /> Loan</button>
                  {!c.netbanking && <button className="btn" onClick={() => setModal("nb")}><Globe size={15} /> Net banking</button>}
                  <button className="btn btn-ghost" onClick={() => op("setTaxExempt", { cif, exempt: !c.taxExempt }, c.taxExempt ? "Exemption removed" : `Form ${c.senior ? "15H" : "15G"} recorded`)}>
                    <FileCheck2 size={15} /> {c.taxExempt ? "Remove 15G/H" : c.senior ? "Record 15H" : "Record 15G"}
                  </button>
                </>
              )}
            </>
          )
        }
      />
      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Card title="Savings and current accounts" pad={false}>
            {!data.accounts.length ? <Empty>No accounts yet.</Empty> : (
              <table className="tbl">
                <thead><tr><th>Account</th><th>Type</th><th>Status</th><th className="r">Balance</th><th className="r">Available</th></tr></thead>
                <tbody>
                  {data.accounts.map((a) => (
                    <tr key={a.id} className="link" onClick={() => router.push(`/app/accounts/${a.id}`)}>
                      <td className="font-mono text-xs">{a.id}</td>
                      <td>{a.type === "SB" ? "Savings" : "Current"}{a.odLimit ? <span className="ml-1 text-xs text-muted">OD <Amount value={a.odLimit} compact /></span> : null}</td>
                      <td><StatusBadge s={a.status} /></td>
                      <td className="r"><Amount value={a.balance} /></td>
                      <td className="r"><Amount value={a.available} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
          <Card title="Term deposits" pad={false}>
            {!data.deposits.length ? <Empty>No deposits.</Empty> : (
              <table className="tbl">
                <thead><tr><th>Deposit</th><th>Type</th><th>Rate</th><th>Matures</th><th>Status</th><th className="r">Balance</th></tr></thead>
                <tbody>
                  {data.deposits.map((d) => (
                    <tr key={d.id} className="link" onClick={() => router.push(`/app/deposits/${d.id}`)}>
                      <td className="font-mono text-xs">{d.id}</td>
                      <td>{d.kind === "FD" ? `Fixed · ${d.payout === "cumulative" ? "reinvest" : "quarterly payout"}` : `Recurring · ${d.installmentsPaid}/${d.months}`}</td>
                      <td className="num">{d.rate}%</td>
                      <td><D d={d.maturityOn} /></td>
                      <td><StatusBadge s={d.status} /></td>
                      <td className="r"><Amount value={d.status === "active" ? d.balance : d.closedAmount} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
          <Card title="Loans" pad={false}>
            {!data.loans.length && !data.applications.length ? <Empty>No loans.</Empty> : (
              <table className="tbl">
                <thead><tr><th>Loan</th><th>Product</th><th>Class</th><th className="r">EMI</th><th className="r">Overdue</th><th className="r">Outstanding</th></tr></thead>
                <tbody>
                  {data.loans.map((l) => (
                    <tr key={l.id} className="link" onClick={() => router.push(`/app/loans/${l.id}`)}>
                      <td className="font-mono text-xs">{l.id}</td>
                      <td>{l.product} · {l.rate}%</td>
                      <td><StatusBadge s={l.status === "closed" ? "closed" : l.assetClass} /></td>
                      <td className="r"><Amount value={l.emi} /></td>
                      <td className="r">{l.overdue ? <Amount value={l.overdue} className="text-danger" /> : "–"}</td>
                      <td className="r"><Amount value={l.outstanding} /></td>
                    </tr>
                  ))}
                  {data.applications.filter((x) => x.status !== "disbursed").map((x) => (
                    <tr key={x.id} className="link" onClick={() => router.push(`/app/applications/${x.id}`)}>
                      <td className="font-mono text-xs">{x.id}</td>
                      <td>{x.product} application</td>
                      <td><StatusBadge s={x.status} /></td>
                      <td className="r">–</td><td className="r">–</td>
                      <td className="r"><Amount value={x.amount} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>
        <div className="space-y-5">
          <Card title="KYC and profile">
            <Facts cols={2} items={[["Date of birth", <D key="d" d={c.dob} />], ["PAN", <span key="p" className="font-mono">{c.pan || "Form 60"}</span>], ["Aadhaar", c.aadhaarLast4 ? `xxxx xxxx ${c.aadhaarLast4}` : "–"], ["Mobile", c.mobile], ["Email", c.email || "–"], ["Occupation", c.occupation], ["Monthly income", <Amount key="i" value={c.monthlyIncome} />], ["AML risk", <StatusBadge key="r" s={c.risk} />], ["Net banking", c.netbanking ? "Enabled" : "Not enabled"], ["Address", c.address || "–"]]} />
          </Card>
          <Card title={`Tax on deposit interest, FY ${data.tds.year || "–"}`}>
            <Facts items={[["Interest paid or credited", <Amount key="a" value={data.tds.interest} />], ["TDS deducted (194A)", <Amount key="b" value={data.tds.tds} />]]} />
          </Card>
        </div>
      </div>
      {modal === "account" && <OpenAccount cif={cif} onClose={() => setModal(null)} />}
      {modal === "fd" && rates && <FdForm cif={cif} dob={c.dob} accounts={casa} rates={rates} today={me.bank.date} onClose={() => setModal(null)} />}
      {modal === "rd" && rates && <RdForm cif={cif} dob={c.dob} accounts={casa} rates={rates} today={me.bank.date} onClose={() => setModal(null)} />}
      {modal === "loan" && loanInfo && <LoanApply cif={cif} products={loanInfo.products} onClose={() => setModal(null)} />}
      {modal === "nb" && <NetbankingForm cif={cif} onClose={() => setModal(null)} />}
    </>
  );
}

type AccountData = { account: Account & { available: number }; customer: { cif: string; name: string; pan: string; mobile: string; kyc: string }; branch: { name: string; ifsc: string }; txns: Txn[] };

export function AccountPage({ id, me }: { id: string; me: Me }) {
  const { data, error } = useView<AccountData>("account", { id });
  const [modal, setModal] = useState<string | null>(null);
  if (error) return <Empty>{error}</Empty>;
  if (!data) return <Loading />;
  const a = data.account;
  const role = me.user.role;
  const counter = ["teller", "manager"].includes(role);
  return (
    <>
      <PageHead
        title={<span className="flex items-center gap-2">{a.type === "SB" ? "Savings" : "Current"} account <span className="font-mono text-lg text-ink-2">{a.id}</span> <StatusBadge s={a.status} /></span>}
        sub={<><Link className="text-accent-ink hover:underline" href={`/app/customers/${data.customer.cif}`}>{data.customer.name}</Link> · CIF {data.customer.cif} · {data.branch?.name} · IFSC {data.branch?.ifsc}</>}
        actions={
          <>
            {counter && a.status === "active" && (
              <>
                <button id="cash-deposit" className="btn" onClick={() => setModal("dep")}><ArrowDownToLine size={15} /> Deposit</button>
                <button id="cash-withdrawal" className="btn" onClick={() => setModal("wd")}><ArrowUpFromLine size={15} /> Withdraw</button>
                <button id="transfer" className="btn" onClick={() => setModal("tr")}><ArrowLeftRight size={15} /> Transfer</button>
                <button id="remit" className="btn" onClick={() => setModal("remit")}><Send size={15} /> NEFT / RTGS / IMPS</button>
              </>
            )}
            {role === "manager" && a.status === "active" && <button className="btn btn-ghost" onClick={() => setModal("freeze")}><Lock size={15} /> Freeze</button>}
            {["manager", "officer"].includes(role) && (a.status === "frozen" || a.status === "dormant") && <button className="btn" onClick={() => op("activateAccount", { account: a.id, reason: "Re-KYC done" }, "Account activated")}><Unlock size={15} /> Activate</button>}
            {role === "manager" && <button className="btn btn-ghost" onClick={() => setModal("lien")}>Lien{a.type === "CA" ? " / OD" : ""}</button>}
            <button className="btn btn-ghost" onClick={() => window.print()}><Printer size={15} /> Statement</button>
          </>
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Box label="Balance" value={<Amount value={a.balance} />} />
        <Box label="Available" value={<Amount value={a.available} />} />
        <Box label="Lien" value={<Amount value={a.lien} />} />
        <Box label={a.type === "SB" ? "Interest accrued (unposted)" : "Overdraft limit"} value={a.type === "SB" ? <Amount value={Math.round(a.accrued)} /> : <Amount value={a.odLimit} />} />
        <Box label="Last customer activity" value={<D d={a.lastActivity} />} />
      </div>
      <Card title="Statement" pad={false}>
        {!data.txns.length ? <Empty>No transactions yet.</Empty> : (
          <div className="max-h-[60vh] overflow-auto scroll-thin">
            <table className="tbl">
              <thead><tr><th>Date</th><th>Narration</th><th>Channel</th><th className="r">Debit</th><th className="r">Credit</th><th className="r">Balance</th></tr></thead>
              <tbody>
                {data.txns.map((t, i) => (
                  <tr key={t.id} className={i === 0 ? "flash" : ""}>
                    <td><D d={t.date} /></td>
                    <td className="max-w-md truncate">{t.narration}</td>
                    <td><Badge>{t.channel}</Badge></td>
                    <td className="r">{t.amount < 0 ? <Amount value={-t.amount} className="text-danger" /> : ""}</td>
                    <td className="r">{t.amount > 0 ? <Amount value={t.amount} className="text-good" /> : ""}</td>
                    <td className="r"><Amount value={t.balance} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {modal === "dep" && <CashForm kind="deposit" account={a.id} onClose={() => setModal(null)} />}
      {modal === "wd" && <CashForm kind="withdrawal" account={a.id} onClose={() => setModal(null)} />}
      {modal === "tr" && <TransferForm from={a.id} onClose={() => setModal(null)} />}
      {modal === "remit" && <RemitForm from={a.id} onClose={() => setModal(null)} />}
      {modal === "freeze" && <FreezeForm account={a.id} onClose={() => setModal(null)} />}
      {modal === "lien" && <LienForm account={a} onClose={() => setModal(null)} />}
    </>
  );
}

const Box = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="card rise p-4">
    <div className="text-xs text-muted">{label}</div>
    <div className="mt-1 text-lg font-semibold">{value}</div>
  </div>
);

function FreezeForm({ account, onClose }: { account: string; onClose: () => void }) {
  const [reason, setReason] = useState("Court order / LEA request");
  return (
    <Confirm title="Freeze account" text="A frozen account accepts credits but refuses every debit until it is activated again." label="Freeze" danger onClose={onClose} onConfirm={() => op("freezeAccount", { account, reason }, "Account frozen")}>
      <Field label="Reason" className="mt-4"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
    </Confirm>
  );
}

function LienForm({ account, onClose }: { account: Account; onClose: () => void }) {
  const [lien, setLien] = useState(String(account.lien / 100));
  const [od, setOd] = useState(String(account.odLimit / 100));
  return (
    <Confirm
      title="Lien and overdraft"
      text="A lien holds part of the balance (for example as security for a loan). Current accounts can be given an overdraft limit."
      label="Save"
      onClose={onClose}
      onConfirm={async () => {
        await op("setLien", { account: account.id, amount: parseRupees(lien || "0") }, "Lien updated");
        if (account.type === "CA") await op("setOdLimit", { account: account.id, amount: parseRupees(od || "0") }, "Overdraft limit set");
      }}
    >
      <Field label="Lien amount" className="mt-4"><AmountInput value={lien} onChange={setLien} /></Field>
      {account.type === "CA" && <Field label="Overdraft limit" className="mt-4"><AmountInput value={od} onChange={setOd} /></Field>}
    </Confirm>
  );
}
