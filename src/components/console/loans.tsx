"use client";

import { Check, ClipboardCheck, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { type Me, op, useAsync, useView } from "@/client/api";
import { formatDate } from "@/lib/dates";
import type { Loan, LoanApplication, Txn } from "@/lib/model";
import { compactINR, formatINR, parseRupees } from "@/lib/money";
import type { LoanProduct, ScheduleRow } from "@/lib/rules";
import { Amount, Badge, Card, D, Empty, Facts, Field, Loading, Modal, PageHead, Stat, StatusBadge, Tabs } from "../ui";
import { AmountInput, Confirm } from "./forms";

type LoanRow = { id: string; product: string; name: string; cif: string; sanctioned: number; outstanding: number; overdue: number; emi: number; rate: number; dpd: number; assetClass: string; status: string; nextDueOn: string };
type LoansData = { loans: LoanRow[]; applications: (LoanApplication & { name: string })[]; products: (LoanProduct & { rate: number })[] };

const STAGES = [
  { key: "applied", label: "Applied" },
  { key: "appraised", label: "Appraised" },
  { key: "sanctioned", label: "Sanctioned" },
  { key: "disbursed", label: "Disbursed" },
] as const;

export function Loans({ me }: { me: Me }) {
  const router = useRouter();
  const { data } = useView<LoansData>("loans");
  const [tab, setTab] = useState<"pipeline" | "book">(["credit"].includes(me.user.role) ? "pipeline" : "book");
  if (!data) return <Loading />;
  const active = data.loans.filter((l) => l.status === "active");
  const npa = active.filter((l) => ["SUB", "D1", "D2", "D3", "LOSS"].includes(l.assetClass));
  const sma = active.filter((l) => l.assetClass.startsWith("SMA"));
  return (
    <>
      <PageHead title="Loans and advances" sub="From application to closure: appraisal against bureau score, FOIR and LTV; sanction under delegated limits; disbursal; NACH collection; IRAC classification." actions={<Tabs value={tab} onChange={setTab} items={[{ value: "pipeline", label: "Credit pipeline" }, { value: "book", label: "Loan book" }]} />} />
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Loan book" value={compactINR(active.reduce((s, l) => s + l.outstanding, 0))} sub={`${active.length} live loans`} />
        <Stat label="Overdue" value={compactINR(active.reduce((s, l) => s + l.overdue, 0))} tone="warn" sub={`${active.filter((l) => l.overdue > 0).length} accounts in arrears`} />
        <Stat label="Special mention (SMA)" value={sma.length} sub={compactINR(sma.reduce((s, l) => s + l.outstanding, 0))} tone={sma.length ? "warn" : undefined} />
        <Stat label="Non-performing" value={npa.length} sub={compactINR(npa.reduce((s, l) => s + l.outstanding, 0))} tone={npa.length ? "danger" : "good"} />
      </div>
      {tab === "pipeline" ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {STAGES.map((s) => {
            const apps = data.applications.filter((a) => a.status === s.key).slice(0, s.key === "disbursed" ? 6 : 50);
            return (
              <div key={s.key} className="card rise flex flex-col">
                <div className="flex items-center justify-between border-b border-line px-4 py-3 text-sm font-semibold">
                  {s.label}
                  <span className="chip bg-raise text-ink-2">{data.applications.filter((a) => a.status === s.key).length}</span>
                </div>
                <div className="space-y-2 p-3">
                  {apps.length === 0 && <div className="py-6 text-center text-xs text-muted">None</div>}
                  {apps.map((a) => (
                    <Link key={a.id} href={`/app/applications/${a.id}`} data-app={a.id} className="block rounded-xl border border-line bg-bg p-3 transition hover:border-accent/50">
                      <div className="flex items-center justify-between text-xs text-muted">
                        <span className="font-mono">{a.id}</span>
                        <Badge tone="accent">{a.product}</Badge>
                      </div>
                      <div className="mt-1 font-medium">{a.name}</div>
                      <div className="mt-1 flex items-center justify-between text-sm">
                        <Amount value={a.amount} compact />
                        <span className="text-xs text-muted">{a.months} months</span>
                      </div>
                      {a.appraisal && <div className="mt-2 text-xs text-muted">Score {a.appraisal.score} · FOIR {a.appraisal.foir}% · <span className={a.appraisal.recommend === "approve" ? "text-good" : a.appraisal.recommend === "refer" ? "text-warn" : "text-danger"}>{a.appraisal.recommend}</span></div>}
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <Card pad={false}>
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>Loan</th><th>Borrower</th><th>Product</th><th>Rate</th><th>Next due</th><th className="r">DPD</th><th>Class</th><th className="r">EMI</th><th className="r">Overdue</th><th className="r">Outstanding</th></tr></thead>
              <tbody>
                {data.loans.map((l) => (
                  <tr key={l.id} className="link" onClick={() => router.push(`/app/loans/${l.id}`)} data-loan={l.id}>
                    <td className="font-mono text-xs">{l.id}</td>
                    <td className="font-medium">{l.name}</td>
                    <td>{data.products.find((p) => p.code === l.product)?.name}</td>
                    <td className="num">{l.rate}%</td>
                    <td>{l.status === "active" ? <D d={l.nextDueOn} /> : "–"}</td>
                    <td className={`r num ${l.dpd > 90 ? "text-danger" : l.dpd > 0 ? "text-warn" : ""}`}>{l.dpd}</td>
                    <td><StatusBadge s={l.status === "closed" ? "closed" : l.assetClass} /></td>
                    <td className="r"><Amount value={l.emi} /></td>
                    <td className="r">{l.overdue ? <Amount value={l.overdue} className="text-danger" /> : "–"}</td>
                    <td className="r"><Amount value={l.outstanding} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}

type AppData = { application: LoanApplication; customer: { cif: string; name: string; pan: string; monthlyIncome: number; kyc: string; occupation: string }; accounts: { id: string; type: string }[]; product: LoanProduct };

export function ApplicationPage({ id, me }: { id: string; me: Me }) {
  const router = useRouter();
  const { data, error } = useView<AppData>("application", { id });
  const [modal, setModal] = useState<string | null>(null);
  const { busy, run } = useAsync();
  if (error) return <Empty>{error}</Empty>;
  if (!data) return <Loading />;
  const a = data.application;
  const credit = ["credit", "manager"].includes(me.user.role);
  const ap = a.appraisal;
  return (
    <>
      <PageHead
        title={<span className="flex items-center gap-2">{data.product.name} application <span className="font-mono text-lg text-ink-2">{a.id}</span> <StatusBadge s={a.status} /></span>}
        sub={<><Link href={`/app/customers/${a.cif}`} className="text-accent-ink hover:underline">{data.customer.name}</Link> · {data.customer.occupation} · applied {formatDate(a.appliedOn)} by {a.by}</>}
        actions={
          credit && (
            <>
              {["applied", "appraised"].includes(a.status) && (
                <button id="appraise" className="btn" disabled={busy} onClick={() => run(() => op("appraiseLoan", { id }, "Credit report pulled and appraisal done"))}>
                  <ClipboardCheck size={15} /> {a.status === "appraised" ? "Re-appraise" : "Appraise"}
                </button>
              )}
              {a.status === "appraised" && <button id="sanction" className="btn btn-primary" onClick={() => setModal("sanction")}><Check size={15} /> Sanction</button>}
              {a.status === "sanctioned" && <button id="disburse" className="btn btn-primary" onClick={() => setModal("disburse")}>Disburse</button>}
              {!["disbursed", "rejected"].includes(a.status) && <button className="btn btn-ghost" onClick={() => setModal("reject")}><X size={15} /> Reject</button>}
              {a.loanId && <button className="btn" onClick={() => router.push(`/app/loans/${a.loanId}`)}>View loan</button>}
            </>
          )
        }
      />
      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Request">
          <Facts cols={2} items={[["Amount", <Amount key="a" value={a.amount} />], ["Tenure", `${a.months} months`], ["Rate", `${a.rate}% ${data.product.rateType === "floating" ? `(repo + ${data.product.spread}%)` : "fixed"}`], ["Purpose", a.purpose], ["Security", a.collateral ? `${a.collateral.kind}` : "Unsecured"], ["Security value", a.collateral ? <Amount key="c" value={a.collateral.value} /> : "–"], ["Monthly income", <Amount key="i" value={data.customer.monthlyIncome} />], ["Other EMIs", <Amount key="e" value={a.existingEmi} />]]} />
          {a.decisionNote && <p className="mt-4 rounded-xl bg-raise p-3 text-sm">{a.decisionNote}</p>}
        </Card>
        <Card title="Appraisal" className="lg:col-span-2">
          {!ap ? (
            <Empty>Not appraised yet. Appraisal pulls the credit report and checks FOIR, LTV and tenure against the product.</Empty>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Mini label="Credit score" value={ap.score} tone={ap.score >= 750 ? "good" : ap.score >= 700 ? undefined : "danger"} />
                <Mini label="EMI" value={formatINR(ap.emi)} />
                <Mini label="FOIR" value={`${ap.foir}%`} tone={ap.foir <= 55 ? undefined : "danger"} />
                <Mini label="LTV" value={ap.ltv === null ? "–" : `${ap.ltv}%`} />
              </div>
              <ul className="mt-5 space-y-2">
                {ap.checks.map((c) => (
                  <li key={c.label} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2.5 text-sm">
                    <span className={`grid h-6 w-6 place-items-center rounded-full ${c.ok ? "bg-good/15 text-good" : "bg-danger/15 text-danger"}`}>{c.ok ? <Check size={14} /> : <X size={14} />}</span>
                    <span className="font-medium">{c.label}</span>
                    <span className="ml-auto text-ink-2">{c.detail}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-4 flex items-center gap-3 text-sm">
                Recommendation:
                <Badge tone={ap.recommend === "approve" ? "green" : ap.recommend === "refer" ? "amber" : "red"}>{ap.recommend}</Badge>
                <span className="text-muted">· eligible by income up to {compactINR(ap.maxByIncome)}</span>
              </div>
              {a.status === "appraised" && (a.amount > 25_00_000_00 || ap.recommend !== "approve") && me.user.role === "credit" && (
                <p className="mt-3 rounded-xl border border-gold/40 bg-gold/10 p-3 text-sm">Sanctioning this goes to the branch manager: {a.amount > 25_00_000_00 ? "it is above your ₹25 lakh limit" : "it is against the appraisal"}.</p>
              )}
            </>
          )}
        </Card>
      </div>
      {modal === "sanction" && <Confirm title="Sanction loan" text={`Sanction ${formatINR(a.amount)} at ${a.rate}% for ${a.months} months.`} label="Sanction" onClose={() => setModal(null)} onConfirm={() => op("sanctionLoan", { id, note: "Sanctioned within policy" }, "Loan sanctioned")} />}
      {modal === "reject" && <Confirm title="Reject application" text="The applicant is told the application was declined." label="Reject" danger onClose={() => setModal(null)} onConfirm={() => op("rejectLoan", { id, note: "Declined after appraisal" }, "Application rejected")} />}
      {modal === "disburse" && <Disburse id={id} accounts={data.accounts} fee={data.product.processingFeePct} amount={a.amount} onClose={() => setModal(null)} />}
    </>
  );
}

function Mini({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "good" | "danger" }) {
  return (
    <div className="rounded-xl bg-raise p-3">
      <div className="text-xs text-muted">{label}</div>
      <div className={`num mt-0.5 text-lg font-semibold ${tone === "good" ? "text-good" : tone === "danger" ? "text-danger" : ""}`}>{value}</div>
    </div>
  );
}

function Disburse({ id, accounts, fee, amount, onClose }: { id: string; accounts: { id: string; type: string }[]; fee: number; amount: number; onClose: () => void }) {
  const [account, setAccount] = useState(accounts[0]?.id ?? "");
  const feeAmt = Math.round((amount * fee) / 100);
  return (
    <Confirm title="Disburse loan" text={`Credits ${formatINR(amount)} to the borrower's account and debits the processing fee of ${formatINR(feeAmt)} plus 18% GST. EMIs start next month by NACH.`} label="Disburse" onClose={onClose} onConfirm={() => op("disburseLoan", { id, account }, "Loan disbursed")}>
      <Field label="Credit to" className="mt-4">
        <select className="input" value={account} onChange={(e) => setAccount(e.target.value)}>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.type} {a.id}</option>
          ))}
        </select>
      </Field>
    </Confirm>
  );
}

type LoanData = { loan: Loan & { overdue: number }; name: string; product: LoanProduct; schedule: ScheduleRow[]; foreclosure: { arrears: number; principal: number; brokenInterest: number; charge: number; gst: number; total: number } | null; txns: Txn[] };

export function LoanPage({ id, me }: { id: string; me: Me }) {
  const { data, error } = useView<LoanData>("loan", { id });
  const [modal, setModal] = useState<string | null>(null);
  if (error) return <Empty>{error}</Empty>;
  if (!data) return <Loading />;
  const l = data.loan;
  const can = ["teller", "credit", "manager"].includes(me.user.role) && l.status === "active";
  return (
    <>
      <PageHead
        title={<span className="flex items-center gap-2">{data.product.name} <span className="font-mono text-lg text-ink-2">{l.id}</span> <StatusBadge s={l.status === "closed" ? "closed" : l.assetClass} /></span>}
        sub={<><Link href={`/app/customers/${l.cif}`} className="text-accent-ink hover:underline">{data.name}</Link> · disbursed {formatDate(l.disbursedOn)} · repays from {l.linkedAccount} by NACH</>}
        actions={can && (
          <>
            <button id="repay" className="btn btn-primary" onClick={() => setModal("repay")}>Repayment</button>
            {["credit", "manager"].includes(me.user.role) && <button id="foreclose" className="btn" onClick={() => setModal("close")}>Foreclose</button>}
          </>
        )}
      />
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat label="Outstanding principal" value={<Amount value={l.outstanding} />} />
        <Stat label="EMI" value={<Amount value={l.emi} />} sub={`${l.rate}% ${l.rateType === "floating" ? `· repo + ${l.spread}%` : "fixed"}`} />
        <Stat label="Overdue" value={<Amount value={l.overdue} />} tone={l.overdue ? "danger" : undefined} sub={l.charges ? `incl. charges ${formatINR(l.charges)}` : undefined} />
        <Stat label="Days past due" value={l.dpd} tone={l.dpd > 90 ? "danger" : l.dpd > 0 ? "warn" : "good"} sub={l.npaSince ? `NPA since ${formatDate(l.npaSince)}` : "Performing"} />
        <Stat label="Provision held" value={<Amount value={l.provision} />} sub={`${l.raised} of ${l.months} instalments raised`} />
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Repayment schedule (from here)" className="lg:col-span-2" pad={false}>
          {!data.schedule.length ? <Empty>No instalments left to raise.</Empty> : (
            <div className="max-h-[50vh] overflow-auto scroll-thin">
              <table className="tbl">
                <thead><tr><th>#</th><th>Due</th><th className="r">Opening</th><th className="r">Interest</th><th className="r">Principal</th><th className="r">EMI</th><th className="r">Closing</th></tr></thead>
                <tbody>
                  {data.schedule.map((r) => (
                    <tr key={r.n}>
                      <td className="num text-muted">{l.raised + r.n}</td>
                      <td><D d={r.dueOn} /></td>
                      <td className="r"><Amount value={r.opening} /></td>
                      <td className="r"><Amount value={r.interest} /></td>
                      <td className="r"><Amount value={r.principal} /></td>
                      <td className="r font-medium"><Amount value={r.emi} /></td>
                      <td className="r"><Amount value={r.closing} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <div className="space-y-5">
          <Card title="Unpaid instalments">
            {!l.demands.length ? <p className="text-sm text-muted">Nothing overdue.</p> : (
              <ul className="space-y-2 text-sm">
                {l.demands.map((d) => (
                  <li key={d.dueOn} className="flex justify-between rounded-lg bg-raise px-3 py-2">
                    <D d={d.dueOn} />
                    <Amount value={d.principal - d.paidPrincipal + d.interest - d.paidInterest} className="text-danger" />
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {data.foreclosure && (
            <Card title="Foreclosure today">
              <Facts cols={2} items={[["Arrears", <Amount key="a" value={data.foreclosure.arrears} />], ["Principal", <Amount key="p" value={data.foreclosure.principal} />], ["Broken-period interest", <Amount key="b" value={data.foreclosure.brokenInterest} />], ["Charge + GST", <Amount key="c" value={data.foreclosure.charge + data.foreclosure.gst} />]]} />
              <div className="mt-3 rounded-xl bg-raise p-3 text-sm">Total <span className="font-semibold"><Amount value={data.foreclosure.total} /></span></div>
            </Card>
          )}
        </div>
      </div>
      <Card title="Collections" className="mt-5" pad={false}>
        {!data.txns.length ? <Empty>No collections yet.</Empty> : (
          <table className="tbl">
            <thead><tr><th>Date</th><th>Narration</th><th>Channel</th><th className="r">Amount</th></tr></thead>
            <tbody>
              {data.txns.slice(0, 40).map((t) => (
                <tr key={t.id}><td><D d={t.date} /></td><td>{t.narration}</td><td><Badge>{t.channel}</Badge></td><td className="r"><Amount value={t.amount} signed /></td></tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {modal === "repay" && <Repay loan={l} onClose={() => setModal(null)} />}
      {modal === "close" && data.foreclosure && <Confirm title="Foreclose loan" text={`Debits ${formatINR(data.foreclosure.total)} from ${l.linkedAccount} and closes the loan.`} label="Foreclose" danger onClose={() => setModal(null)} onConfirm={() => op("forecloseLoan", { id: l.id }, "Loan closed")} />}
    </>
  );
}

function Repay({ loan, onClose }: { loan: Loan & { overdue: number }; onClose: () => void }) {
  const [amount, setAmount] = useState(String((loan.overdue || loan.emi) / 100));
  const [cash, setCash] = useState(false);
  const { busy, run } = useAsync();
  return (
    <Modal title="Loan repayment" onClose={onClose}>
      <form onSubmit={(e) => (e.preventDefault(), run(async () => (await op("repayLoan", { id: loan.id, amount: parseRupees(amount), cash }, "Repayment applied: charges, then interest, then principal"), onClose())))}>
        <Field label="Amount" hint={`Overdue ${formatINR(loan.overdue)}. Anything above the dues prepays principal.`}><AmountInput id="repay-amount" value={amount} onChange={setAmount} /></Field>
        <label className="mt-4 flex items-center gap-2 text-sm"><input type="checkbox" checked={cash} onChange={(e) => setCash(e.target.checked)} /> Paid in cash at the counter (otherwise debited from {loan.linkedAccount})</label>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button id="submit" className="btn btn-primary" disabled={busy}>Apply repayment</button>
        </div>
      </form>
    </Modal>
  );
}
