"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { type Me, op, useView } from "@/client/api";
import { daysBetween, formatDate, tenureLabel } from "@/lib/dates";
import type { Deposit, Txn } from "@/lib/model";
import { compactINR, formatINR } from "@/lib/money";
import { Amount, Badge, Card, D, Empty, Facts, Loading, PageHead, Stat, StatusBadge, Tabs } from "../ui";
import { Confirm, useRates } from "./forms";

type Row = { id: string; kind: string; name: string; cif: string; balance: number; principal: number; installment: number; rate: number; openedOn: string; maturityOn: string; status: string; payout: string; installmentsPaid: number; months: number };

export function Deposits({ me }: { me: Me }) {
  const router = useRouter();
  const { data } = useView<Row[]>("deposits");
  const rates = useRates();
  const [tab, setTab] = useState<"active" | "closed">("active");
  const active = (data ?? []).filter((d) => d.status === "active");
  const rows = (data ?? []).filter((d) => (tab === "active" ? d.status === "active" : d.status !== "active"));
  const soon = active.filter((d) => daysBetween(me.bank.date, d.maturityOn) <= 30);
  return (
    <>
      <PageHead title="Term deposits" sub="Fixed deposits (cumulative or quarterly payout) and recurring deposits. Open new ones from the customer's page." />
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Fixed deposits" value={compactINR(active.filter((d) => d.kind === "FD").reduce((s, d) => s + d.balance, 0))} sub={`${active.filter((d) => d.kind === "FD").length} active`} />
        <Stat label="Recurring deposits" value={compactINR(active.filter((d) => d.kind === "RD").reduce((s, d) => s + d.balance, 0))} sub={`${active.filter((d) => d.kind === "RD").length} active`} />
        <Stat label="Maturing in 30 days" value={soon.length} sub={compactINR(soon.reduce((s, d) => s + d.balance, 0))} tone={soon.length ? "gold" : undefined} />
        <Stat label="Weighted average rate" value={`${active.length ? (active.reduce((s, d) => s + d.rate * d.balance, 0) / Math.max(1, active.reduce((s, d) => s + d.balance, 0))).toFixed(2) : "–"}%`} />
      </div>
      <div className="grid gap-5 xl:grid-cols-4">
        <Card className="xl:col-span-3" pad={false} title={<Tabs value={tab} onChange={setTab} items={[{ value: "active", label: "Active" }, { value: "closed", label: "Matured and closed" }]} />}>
          {!data ? <div className="p-5"><Loading /></div> : !rows.length ? <Empty>Nothing here.</Empty> : (
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead><tr><th>Deposit</th><th>Customer</th><th>Type</th><th>Rate</th><th>Opened</th><th>Matures</th><th>Status</th><th className="r">Balance</th></tr></thead>
                <tbody>
                  {rows.map((d) => (
                    <tr key={d.id} className="link" onClick={() => router.push(`/app/deposits/${d.id}`)}>
                      <td className="font-mono text-xs">{d.id}</td>
                      <td className="font-medium">{d.name}</td>
                      <td>{d.kind === "FD" ? <Badge tone="accent">FD · {d.payout === "cumulative" ? "reinvest" : "payout"}</Badge> : <Badge tone="gold">RD · {d.installmentsPaid}/{d.months}</Badge>}</td>
                      <td className="num">{d.rate}%</td>
                      <td><D d={d.openedOn} /></td>
                      <td><D d={d.maturityOn} /></td>
                      <td><StatusBadge s={d.status} /></td>
                      <td className="r"><Amount value={d.balance} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card title="FD card rates" actions={<Link href="/app/rates" className="text-xs text-accent-ink hover:underline">Edit</Link>}>
          {rates && (
            <table className="w-full text-sm">
              <tbody>
                {rates.fd.map((r) => (
                  <tr key={r.from} className="border-b border-line/50 last:border-0">
                    <td className="py-1.5 text-ink-2">{tenureLabel(r.from)} – {tenureLabel(r.to)}</td>
                    <td className="num py-1.5 text-right font-medium">{r.rate}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-3 text-xs text-muted">Senior citizens +{rates?.seniorExtra}%. Premature closure: rate for the period run, less {rates?.prematurePenalty}%.</p>
        </Card>
      </div>
    </>
  );
}

type DepositData = { deposit: Deposit; name: string; projected: { interest: number; maturity: number }; quote: { days: number; rate: number; contracted: number; penalty: number; payable: number; atMaturity: number } | null; txns: Txn[] };

export function DepositPage({ id, me }: { id: string; me: Me }) {
  const { data, error } = useView<DepositData>("deposit", { id });
  const [closing, setClosing] = useState(false);
  if (error) return <Empty>{error}</Empty>;
  if (!data) return <Loading />;
  const d = data.deposit;
  const canClose = ["officer", "manager"].includes(me.user.role) && d.status === "active";
  return (
    <>
      <PageHead
        title={<span className="flex items-center gap-2">{d.kind === "FD" ? "Fixed deposit" : "Recurring deposit"} <span className="font-mono text-lg text-ink-2">{d.id}</span> <StatusBadge s={d.status} /></span>}
        sub={<><Link href={`/app/customers/${d.cif}`} className="text-accent-ink hover:underline">{data.name}</Link> · linked account {d.linkedAccount}</>}
        actions={canClose && <button id="close-early" className="btn btn-danger" onClick={() => setClosing(true)}>Close before maturity</button>}
      />
      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Terms" className="lg:col-span-2">
          <Facts
            cols={3}
            items={[
              [d.kind === "FD" ? "Principal" : "Monthly instalment", <Amount key="p" value={d.kind === "FD" ? d.principal : d.installment} />],
              ["Rate", `${d.rate}% a year`],
              ["Interest", d.kind === "RD" ? "Compounded quarterly" : d.payout === "cumulative" ? "Compounded quarterly" : "Paid out quarterly"],
              ["Opened", <D key="o" d={d.openedOn} />],
              ["Matures", <D key="m" d={d.maturityOn} />],
              ["Tenure", tenureLabel(daysBetween(d.openedOn, d.maturityOn))],
              [d.kind === "FD" ? "Current balance" : "Paid in", <Amount key="b" value={d.balance} />],
              ["Accrued, not yet posted", <Amount key="a" value={Math.round(d.accrued)} />],
              [d.kind === "RD" ? "Instalments" : "Auto-renew", d.kind === "RD" ? `${d.installmentsPaid} of ${d.months} · next ${formatDate(d.nextDueOn)}` : d.autoRenew ? "Yes" : "No"],
              ["Maturity value (contracted)", <Amount key="mv" value={d.kind === "FD" && d.payout === "quarterly" ? d.principal : data.projected.maturity} className="text-gold" />],
              ["Total interest", <Amount key="ti" value={data.projected.interest} />],
              ...(d.status !== "active" ? ([["Paid on closure", <Amount key="pc" value={d.closedAmount} />]] as [string, React.ReactNode][]) : []),
            ]}
          />
        </Card>
        {data.quote && (
          <Card title="If closed today">
            <Facts
              cols={2}
              items={[
                ["Days run", data.quote.days],
                ["Rate applied", `${data.quote.rate}%`],
                ["Contracted rate", `${data.quote.contracted}%`],
                ["Penalty", `${data.quote.penalty}%`],
              ]}
            />
            <div className="mt-4 rounded-xl bg-raise p-3">
              <div className="text-xs text-muted">Payable now (before TDS)</div>
              <div className="text-xl font-semibold"><Amount value={data.quote.payable} /></div>
              <div className="mt-1 text-xs text-muted">At maturity: {formatINR(data.quote.atMaturity)}</div>
            </div>
          </Card>
        )}
      </div>
      <Card title="Postings" className="mt-5" pad={false}>
        {!data.txns.length ? <Empty>No postings to the linked account yet.</Empty> : (
          <table className="tbl">
            <thead><tr><th>Date</th><th>Narration</th><th className="r">Amount</th></tr></thead>
            <tbody>
              {data.txns.map((t) => (
                <tr key={t.id}><td><D d={t.date} /></td><td>{t.narration}</td><td className="r"><Amount value={t.amount} signed /></td></tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {closing && data.quote && (
        <Confirm title="Close before maturity" text={`Pays ${formatINR(data.quote.payable)} (less any TDS) to ${d.linkedAccount}: ${data.quote.rate}% for ${data.quote.days} days instead of the contracted ${data.quote.contracted}%.`} label="Close deposit" danger onClose={() => setClosing(false)} onConfirm={() => op("closeDeposit", { id: d.id }, "Deposit closed and paid out")} />
      )}
    </>
  );
}
