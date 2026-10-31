"use client";

import { UserPlus } from "lucide-react";
import { useState } from "react";
import { op, useAsync, useView } from "@/client/api";
import type { Branch, Role, Staff } from "@/lib/model";
import { Card, Field, Loading, Modal, PageHead, StatusBadge } from "../ui";

type AdminData = { staff: (Omit<Staff, "passwordHash"> & { roleLabel: string })[]; branches: Branch[]; roles: Record<Role, { label: string; blurb: string }> };

export function Admin() {
  const { data } = useView<AdminData>("admin");
  const [modal, setModal] = useState<string | null>(null);
  if (!data) return <Loading />;
  return (
    <>
      <PageHead title="Administration" sub="Users and their roles, and branches" actions={<><button className="btn" onClick={() => setModal("branch")}>Add branch</button><button className="btn btn-primary" onClick={() => setModal("user")}><UserPlus size={15} /> New user</button></>} />
      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Users" className="lg:col-span-2" pad={false}>
          <table className="tbl">
            <thead><tr><th>User ID</th><th>Name</th><th>Role</th><th>Branch</th><th>Status</th><th /></tr></thead>
            <tbody>
              {data.staff.map((s) => (
                <tr key={s.id}>
                  <td className="font-mono text-xs">{s.username}</td>
                  <td className="font-medium">{s.name}</td>
                  <td>{s.roleLabel}</td>
                  <td>{data.branches.find((b) => b.code === s.branch)?.name}</td>
                  <td><StatusBadge s={s.active ? "active" : "closed"} /></td>
                  <td className="r">{s.username !== "admin" && <button className="btn btn-ghost btn-sm" onClick={() => op("setStaffActive", { id: s.id, active: !s.active }, s.active ? "User disabled" : "User enabled")}>{s.active ? "Disable" : "Enable"}</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <div className="space-y-5">
          <Card title="Roles">
            <ul className="space-y-3 text-sm">
              {Object.entries(data.roles).map(([k, r]) => (
                <li key={k}><div className="font-medium">{r.label}</div><div className="text-xs text-muted">{r.blurb}</div></li>
              ))}
            </ul>
          </Card>
          <Card title="Branches" pad={false}>
            <table className="tbl">
              <tbody>
                {data.branches.map((b) => (
                  <tr key={b.code}><td className="font-medium">{b.name}</td><td className="text-ink-2">{b.city}</td><td className="font-mono text-xs">{b.ifsc}</td></tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      </div>
      {modal === "user" && <NewUser roles={data.roles} branches={data.branches} onClose={() => setModal(null)} />}
      {modal === "branch" && <NewBranch onClose={() => setModal(null)} />}
    </>
  );
}

function NewUser({ roles, branches, onClose }: { roles: AdminData["roles"]; branches: Branch[]; onClose: () => void }) {
  const [f, setF] = useState({ username: "", name: "", role: "teller", branch: branches[0].code, password: "" });
  const { busy, run } = useAsync();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title="New user" onClose={onClose}>
      <form onSubmit={(e) => (e.preventDefault(), run(async () => (await op("createStaff", f, "User created"), onClose())))}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="User ID"><input className="input" value={f.username} onChange={set("username")} required /></Field>
          <Field label="Name"><input className="input" value={f.name} onChange={set("name")} required /></Field>
          <Field label="Role">
            <select className="input" value={f.role} onChange={set("role")}>
              {Object.entries(roles).map(([k, r]) => <option key={k} value={k}>{r.label}</option>)}
            </select>
          </Field>
          <Field label="Branch">
            <select className="input" value={f.branch} onChange={set("branch")}>
              {branches.map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}
            </select>
          </Field>
          <Field label="Temporary password" className="sm:col-span-2"><input className="input" type="password" value={f.password} onChange={set("password")} minLength={8} required /></Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy}>Create</button>
        </div>
      </form>
    </Modal>
  );
}

function NewBranch({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const { busy, run } = useAsync();
  return (
    <Modal title="Add branch" onClose={onClose}>
      <form onSubmit={(e) => (e.preventDefault(), run(async () => (await op("addBranch", { name, city }, "Branch added"), onClose())))}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Branch name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} required /></Field>
          <Field label="City"><input className="input" value={city} onChange={(e) => setCity(e.target.value)} /></Field>
        </div>
        <p className="mt-3 text-xs text-muted">The IFSC is the bank code, a zero, and the branch number.</p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy}>Add</button>
        </div>
      </form>
    </Modal>
  );
}
