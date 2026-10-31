"use client";

import { useState } from "react";
import { type Me, op, useAsync, useView } from "@/client/api";
import { tenureLabel } from "@/lib/dates";
import { formatINR } from "@/lib/money";
import { loanRate, type RateBook } from "@/lib/rules";
import { Card, Loading, PageHead } from "../ui";

export function Rates({ me }: { me: Me }) {
  const { data } = useView<RateBook>("rates");
  if (!data) return <Loading />;
  return <RateCard data={data} edit={["treasury", "admin"].includes(me.user.role)} />;
}

function RateCard({ data, edit }: { data: RateBook; edit: boolean }) {
  const [fd, setFd] = useState(data.fd);
  const [misc, setMisc] = useState({ seniorExtra: String(data.seniorExtra), prematurePenalty: String(data.prematurePenalty), odRate: String(data.odRate) });
  const { busy, run } = useAsync();
  return (
    <>
      <PageHead
        title="Rates"
        sub="The card applies to new deposits from today; running deposits keep their contracted rate. Floating loans follow the repo rate."
        actions={edit && <button id="save-rates" className="btn btn-primary" disabled={busy} onClick={() => run(() => op("setRates", { fd, seniorExtra: Number(misc.seniorExtra), prematurePenalty: Number(misc.prematurePenalty), odRate: Number(misc.odRate) }, "Rate card updated"))}>Save card</button>}
      />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Fixed and recurring deposits" pad={false}>
          <table className="tbl">
            <thead><tr><th>Tenure</th><th className="r">General</th><th className="r">Senior citizen</th></tr></thead>
            <tbody>
              {fd.map((r, i) => (
                <tr key={r.from}>
                  <td>{tenureLabel(r.from)} to {tenureLabel(r.to)}</td>
                  <td className="r">
                    {edit ? (
                      <input aria-label={`Rate ${tenureLabel(r.from)}`} className="input num ml-auto h-8 w-20 text-right" value={r.rate} onChange={(e) => setFd(fd.map((x, j) => (j === i ? { ...x, rate: Number(e.target.value) || 0 } : x)))} />
                    ) : (
                      <span className="num">{r.rate}%</span>
                    )}
                  </td>
                  <td className="r num text-gold">{Math.round((r.rate + Number(misc.seniorExtra || 0)) * 100) / 100}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <div className="space-y-5">
          <Card title="Other rates">
            <div className="grid grid-cols-3 gap-4">
              {(["seniorExtra", "prematurePenalty", "odRate"] as const).map((k) => (
                <label key={k} className="block">
                  <span className="label">{{ seniorExtra: "Senior citizen extra", prematurePenalty: "Premature penalty", odRate: "Overdraft rate" }[k]} (%)</span>
                  <input className="input num" disabled={!edit} value={misc[k]} onChange={(e) => setMisc({ ...misc, [k]: e.target.value })} />
                </label>
              ))}
            </div>
            <div className="mt-5 text-sm">
              <div className="label">Savings account</div>
              {data.sb.map((s, i) => (
                <div key={i} className="flex justify-between border-b border-line/50 py-1.5 last:border-0">
                  <span className="text-ink-2">{s.upto === null ? `Above ${formatINR(data.sb[i - 1]?.upto ?? 0, { whole: true })}` : `Up to ${formatINR(s.upto, { whole: true })}`}</span>
                  <span className="num font-medium">{s.rate}%</span>
                </div>
              ))}
            </div>
          </Card>
          <Card title="Loan products" pad={false}>
            <table className="tbl">
              <thead><tr><th>Product</th><th>Pricing</th><th className="r">Rate</th><th className="r">Max LTV</th><th className="r">Fee</th></tr></thead>
              <tbody>
                {data.products.map((p) => (
                  <tr key={p.code}>
                    <td className="font-medium">{p.name}</td>
                    <td className="text-ink-2">{p.rateType === "floating" ? `Repo ${data.policy.repo}% + ${p.spread}%` : "Fixed"}</td>
                    <td className="r num font-semibold">{loanRate(p, data.policy)}%</td>
                    <td className="r num">{p.secured ? `${p.maxLtv}%` : "Unsecured"}</td>
                    <td className="r num">{p.processingFeePct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      </div>
    </>
  );
}
