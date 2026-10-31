"use client";

import { Check, X } from "lucide-react";
import { useState } from "react";
import { call, type Me, refreshAll, toast, useAsync, useView } from "@/client/api";
import type { Approval } from "@/lib/model";
import { Amount, Card, D, Empty, Loading, PageHead, StatusBadge } from "../ui";

export function Approvals({ me }: { me: Me }) {
  const { data } = useView<{ pending: Approval[]; recent: Approval[] }>("approvals");
  const checker = ["manager", "admin"].includes(me.user.role);
  return (
    <>
      <PageHead title="Authorisation" sub="Maker-checker: entries over a user's limit wait here until a second person, a branch manager or administrator, authorises them. Nobody can authorise their own entry." />
      {!data ? <Loading /> : (
        <div className="space-y-5">
          <Card title={`Waiting (${data.pending.length})`} pad={false}>
            {!data.pending.length ? <Empty>Nothing waiting for authorisation.</Empty> : (
              <ul className="divide-y divide-line">
                {data.pending.map((p) => <PendingRow key={p.id} p={p} canAct={checker && p.maker !== me.user.id} self={p.maker === me.user.id} />)}
              </ul>
            )}
          </Card>
          <Card title="Recent decisions" pad={false}>
            {!data.recent.length ? <Empty>No decisions yet.</Empty> : (
              <table className="tbl">
                <thead><tr><th>Ref</th><th>Entry</th><th>Maker</th><th>Checker</th><th>Date</th><th>Outcome</th></tr></thead>
                <tbody>
                  {data.recent.map((p) => (
                    <tr key={p.id}>
                      <td className="font-mono text-xs">{p.id}</td>
                      <td>{p.summary}{p.reason && <div className="text-xs text-muted">{p.reason}</div>}</td>
                      <td>{p.makerName}</td>
                      <td>{p.checkerName}</td>
                      <td><D d={p.date} /></td>
                      <td><StatusBadge s={p.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>
      )}
    </>
  );
}

function PendingRow({ p, canAct, self }: { p: Approval; canAct: boolean; self: boolean }) {
  const { busy, run } = useAsync();
  const [note, setNote] = useState("");
  const decide = (approve: boolean) =>
    run(async () => {
      try {
        await call("/api/authorise", "POST", { id: p.id, approve, note });
        refreshAll();
        toast(approve ? `${p.id} authorised and posted` : `${p.id} refused`);
      } catch (e) {
        toast((e as Error).message, "error");
        throw e;
      }
    });
  return (
    <li className="flex flex-wrap items-center gap-4 px-5 py-4" data-approval={p.id}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-xs text-muted">
          <span className="font-mono">{p.id}</span> · by {p.makerName} · {new Date(p.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
        </div>
        <div className="mt-0.5 font-medium">{p.summary}</div>
      </div>
      <Amount value={p.amount} className="text-lg font-semibold text-gold" />
      {canAct ? (
        <div className="flex items-center gap-2">
          <input className="input h-9 w-44" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="btn btn-ghost" disabled={busy} onClick={() => decide(false)}><X size={15} /> Refuse</button>
          <button className="btn btn-primary" data-authorise={p.id} disabled={busy} onClick={() => decide(true)}><Check size={15} /> Authorise</button>
        </div>
      ) : (
        <span className="text-xs text-muted">{self ? "Your entry: another manager must authorise it" : "Waiting for a manager"}</span>
      )}
    </li>
  );
}
