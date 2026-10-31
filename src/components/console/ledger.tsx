"use client";

import { Fragment, useState } from "react";
import { useView } from "@/client/api";
import type { Voucher } from "@/lib/model";
import { Amount, Card, D, Empty, Loading, PageHead, Tabs } from "../ui";

type Group = { group: string; amount: number; items: { code: string; name: string; amount: number }[] };
type LedgerData = { trial: { code: string; name: string; type: string; group: string; balance: number }[]; totals: { dr: number; cr: number }; assets: Group[]; liabilities: Group[]; income: Group[]; expenses: Group[]; profit: number };

export function Ledger() {
  const [tab, setTab] = useState<"bs" | "pl" | "tb" | "jv">("bs");
  const { data } = useView<LedgerData>("ledger");
  return (
    <>
      <PageHead
        title="General ledger"
        sub="Every transaction posts a balanced double-entry voucher; the books below are read straight from the ledger."
        actions={<Tabs value={tab} onChange={setTab} items={[{ value: "bs", label: "Balance sheet" }, { value: "pl", label: "Profit and loss" }, { value: "tb", label: "Trial balance" }, { value: "jv", label: "Journal" }]} />}
      />
      {!data ? <Loading /> : tab === "bs" ? (
        <div className="grid gap-5 lg:grid-cols-2">
          <Statement title="Capital and liabilities" groups={data.liabilities} />
          <Statement title="Assets" groups={data.assets} />
        </div>
      ) : tab === "pl" ? (
        <div className="grid gap-5 lg:grid-cols-2">
          <Statement title="Income" groups={data.income} />
          <Statement title="Expenditure" groups={[...data.expenses, { group: "Net profit", amount: data.profit, items: [] }]} />
        </div>
      ) : tab === "tb" ? (
        <Card pad={false}>
          <table className="tbl">
            <thead><tr><th>GL head</th><th>Name</th><th>Type</th><th className="r">Debit</th><th className="r">Credit</th></tr></thead>
            <tbody>
              {data.trial.map((r) => (
                <tr key={r.code}>
                  <td className="font-mono text-xs">{r.code}</td>
                  <td>{r.name}</td>
                  <td className="capitalize text-ink-2">{r.type}</td>
                  <td className="r">{r.balance > 0 ? <Amount value={r.balance} /> : ""}</td>
                  <td className="r">{r.balance < 0 ? <Amount value={-r.balance} /> : ""}</td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td colSpan={3}>Totals {data.totals.dr === data.totals.cr ? <span className="chip ml-2 bg-good/15 text-good">Balanced</span> : <span className="chip ml-2 bg-danger/15 text-danger">Out of balance</span>}</td>
                <td className="r"><Amount value={data.totals.dr} /></td>
                <td className="r"><Amount value={data.totals.cr} /></td>
              </tr>
            </tbody>
          </table>
        </Card>
      ) : (
        <Journal />
      )}
    </>
  );
}

function Statement({ title, groups }: { title: string; groups: Group[] }) {
  const total = groups.reduce((s, g) => s + g.amount, 0);
  return (
    <Card title={title} pad={false}>
      <table className="tbl">
        <tbody>
          {groups.map((g) => (
            <Fragment key={g.group}>
              <tr className="bg-raise/50">
                <td className="font-semibold">{g.group}</td>
                <td className="r font-semibold"><Amount value={g.amount} /></td>
              </tr>
              {g.items.filter((i) => i.amount !== 0).map((i) => (
                <tr key={i.code}>
                  <td className="pl-8 text-ink-2">{i.name}</td>
                  <td className="r text-ink-2"><Amount value={i.amount} /></td>
                </tr>
              ))}
            </Fragment>
          ))}
          <tr className="text-base">
            <td className="font-semibold">Total</td>
            <td className="r font-semibold text-gold"><Amount value={total} /></td>
          </tr>
        </tbody>
      </table>
    </Card>
  );
}

function Journal() {
  const [date, setDate] = useState("");
  const { data } = useView<{ date: string; days: string[]; vouchers: Voucher[]; chart: { code: string; name: string }[] }>("journal", { date });
  if (!data) return <Loading />;
  const name = (code: string) => data.chart.find((c) => c.code === code)?.name ?? code;
  return (
    <Card title={<span>Day book for <D d={data.date} /></span>} actions={
      <select className="input h-8 w-44" value={data.date} onChange={(e) => setDate(e.target.value)}>
        {data.days.map((d) => <option key={d}>{d}</option>)}
      </select>
    } pad={false}>
      {!data.vouchers.length ? <Empty>No vouchers on this day.</Empty> : (
        <div className="divide-y divide-line">
          {data.vouchers.map((v) => (
            <div key={v.id} className="px-5 py-3">
              <div className="flex items-center gap-3 text-sm">
                <span className="font-mono text-xs text-muted">{v.id}</span>
                <span className="font-medium">{v.narration}</span>
                <span className="ml-auto text-xs text-muted">{v.by}</span>
              </div>
              <table className="mt-2 w-full text-xs">
                <tbody>
                  {v.lines.map((l, i) => (
                    <tr key={i} className="text-ink-2">
                      <td className="w-16 font-mono">{l.gl}</td>
                      <td className={l.cr ? "pl-6" : ""}>{l.cr ? "To " : ""}{name(l.gl)}</td>
                      <td className="w-36 text-right">{l.dr ? <Amount value={l.dr} /> : ""}</td>
                      <td className="w-36 text-right">{l.cr ? <Amount value={l.cr} /> : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
