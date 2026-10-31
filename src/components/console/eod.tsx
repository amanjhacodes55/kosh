"use client";

import { CalendarClock, Play } from "lucide-react";
import { useState } from "react";
import { type Me, op, useAsync, useView } from "@/client/api";
import { formatDate } from "@/lib/dates";
import { Card, D, Empty, Loading, PageHead } from "../ui";

type EodData = { date: string; runs: { date: string; at: number; by: string; steps: { step: string; detail: string }[] }[]; pending: number };

export function EndOfDay({ me }: { me: Me }) {
  const { data } = useView<EodData>("eod");
  const { busy, run } = useAsync();
  const [days, setDays] = useState("1");
  const can = ["manager", "admin"].includes(me.user.role);
  if (!data) return <Loading />;
  return (
    <>
      <PageHead title="End of day" sub="The batch that closes the books for the day and moves the business date on" />
      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Business date">
          <div className="flex items-center gap-3">
            <CalendarClock className="text-gold" size={30} />
            <div className="text-3xl font-semibold tracking-tight">{formatDate(data.date)}</div>
          </div>
          <ol className="mt-5 space-y-1.5 text-sm text-ink-2">
            {["Loan instalments raised; EMIs collected by NACH, bounces charged", "RD instalments collected by standing instruction", "Interest accrued on savings and term deposits", "Quarter end: savings interest credited; FD interest compounded or paid, less TDS", "Month end: overdraft interest; gilt coupons", "Deposits maturing paid out or renewed", "Call and notice money settled", "Loans aged and classified (IRAC); provisions adjusted", "Inactive accounts marked dormant", "Business date moves on"].map((s, i) => (
              <li key={i} className="flex gap-2"><span className="num w-5 text-muted">{i + 1}.</span>{s}</li>
            ))}
          </ol>
          {can && (
            <div className="mt-6 flex items-center gap-2">
              <select id="eod-days" className="input w-40" value={days} onChange={(e) => setDays(e.target.value)}>
                <option value="1">Close today</option>
                <option value="7">Run 7 days</option>
                <option value="30">Run 30 days</option>
                <option value="62">Run 62 days</option>
                <option value="92">Run a quarter</option>
              </select>
              <button id="run-eod" className="btn btn-primary" disabled={busy || data.pending > 0} onClick={() => run(() => op("runEod", { days: Number(days) }, Number(days) === 1 ? "Day closed" : `${days} days closed`))}>
                <Play size={15} /> {busy ? "Running…" : "Run end of day"}
              </button>
            </div>
          )}
          {data.pending > 0 && <p className="mt-3 rounded-xl border border-gold/40 bg-gold/10 p-3 text-sm">{data.pending} entr{data.pending === 1 ? "y is" : "ies are"} waiting for authorisation. Clear the queue before closing the day.</p>}
        </Card>
        <Card title="Recent runs" className="lg:col-span-2" pad={false}>
          {!data.runs.length ? <Empty>No runs yet.</Empty> : (
            <div className="max-h-[70vh] divide-y divide-line overflow-auto scroll-thin">
              {data.runs.map((r, i) => (
                <details key={r.date + r.at} open={i === 0} className="px-5 py-3">
                  <summary className="flex cursor-pointer items-center gap-3 text-sm">
                    <span className="font-medium"><D d={r.date} /></span>
                    <span className="text-xs text-muted">by {r.by}</span>
                  </summary>
                  <table className="mt-2 w-full text-sm">
                    <tbody>
                      {r.steps.map((s) => (
                        <tr key={s.step} className="border-b border-line/40 last:border-0">
                          <td className="w-48 py-1.5 align-top text-ink-2">{s.step}</td>
                          <td className="py-1.5">{s.detail}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
