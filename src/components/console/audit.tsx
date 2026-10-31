"use client";

import { useState } from "react";
import { useView } from "@/client/api";
import type { AuditEntry } from "@/lib/model";
import { Card, D, Empty, Loading, PageHead } from "../ui";

export function AuditTrail() {
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const { data } = useView<AuditEntry[]>("audit", { q: search });
  return (
    <>
      <PageHead title="Audit trail" sub="Who did what, and when: every sign-in, posting, authorisation, rate change and batch run. Entries can't be edited or removed." />
      <form className="mb-4" onSubmit={(e) => (e.preventDefault(), setSearch(q))}>
        <input className="input max-w-md" placeholder="Search actions, people, references" value={q} onChange={(e) => setQ(e.target.value)} />
      </form>
      <Card pad={false}>
        {!data ? <div className="p-5"><Loading /></div> : !data.length ? <Empty>No entries.</Empty> : (
          <div className="max-h-[70vh] overflow-auto scroll-thin">
            <table className="tbl">
              <thead><tr><th>Time</th><th>Business date</th><th>User</th><th>Role</th><th>Action</th><th>Detail</th></tr></thead>
              <tbody>
                {data.map((e, i) => (
                  <tr key={i}>
                    <td className="num whitespace-nowrap text-xs text-muted">{new Date(e.at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                    <td><D d={e.date} /></td>
                    <td>{e.name}</td>
                    <td className="capitalize text-ink-2">{e.role}</td>
                    <td className="font-medium">{e.action}</td>
                    <td className="text-ink-2">{e.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
