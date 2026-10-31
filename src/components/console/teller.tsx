"use client";

import { ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine, Download, Send } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { type Me, op, useAsync, useView } from "@/client/api";
import { compactINR, parseRupees } from "@/lib/money";
import { Amount, Card, Empty, Field, Modal, PageHead, Stat, StatusBadge } from "../ui";
import { AmountInput, CashForm, RemitForm, TransferForm } from "./forms";

type Acc = { id: string; type: string; name: string; cif: string; balance: number; available: number; status: string };

export function Teller({ me }: { me: Me }) {
  const accounts = useView<Acc[]>("accounts").data;
  const o = useView<{ cash: number; today: { count: number; credits: number; debits: number }; pending: number }>("overview").data;
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const [modal, setModal] = useState<string | null>(null);
  const list = (accounts ?? []).filter((a) => a.status !== "closed" && (!q || a.name.toLowerCase().includes(q.toLowerCase()) || a.id.includes(q)));
  const acc = accounts?.find((a) => a.id === sel);
  return (
    <>
      <PageHead title="Teller counter" sub={`${me.user.name} · cash, transfers and payments. Withdrawals over ₹2 lakh and cash of ₹10 lakh or more need the manager's authorisation.`} />
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Cash in vault" value={o ? compactINR(o.cash) : "–"} />
        <Stat label="Transactions today" value={o?.today.count ?? "–"} />
        <Stat label="Credits today" value={o ? compactINR(o.today.credits) : "–"} tone="good" />
        <Stat label="Awaiting authorisation" value={o?.pending ?? "–"} tone={o?.pending ? "gold" : undefined} />
      </div>
      <div className="grid gap-5 lg:grid-cols-5">
        <Card title="Find the account" className="lg:col-span-2" pad={false}>
          <div className="p-3">
            <input id="teller-search" className="input" placeholder="Name or account number" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          </div>
          <ul className="max-h-[55vh] overflow-auto border-t border-line scroll-thin">
            {list.slice(0, 60).map((a) => (
              <li key={a.id}>
                <button data-account={a.id} onClick={() => setSel(a.id)} className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition hover:bg-raise ${sel === a.id ? "bg-accent/10" : ""}`}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{a.name}</span>
                    <span className="font-mono text-xs text-muted">{a.type} {a.id}</span>
                  </span>
                  <Amount value={a.balance} className="text-sm" />
                </button>
              </li>
            ))}
          </ul>
        </Card>
        <div className="lg:col-span-3">
          {!acc ? (
            <Card><Empty>Choose an account to transact on it.</Empty></Card>
          ) : (
            <Card title={<span>{acc.name} <span className="ml-1 font-mono text-xs text-muted">{acc.id}</span></span>} actions={<StatusBadge s={acc.status} />}>
              <div className="grid grid-cols-2 gap-4">
                <div><div className="text-xs text-muted">Balance</div><div className="text-2xl font-semibold"><Amount value={acc.balance} /></div></div>
                <div><div className="text-xs text-muted">Available</div><div className="text-2xl font-semibold"><Amount value={acc.available} /></div></div>
              </div>
              <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Action id="t-deposit" icon={ArrowDownToLine} label="Cash deposit" onClick={() => setModal("dep")} />
                <Action id="t-withdraw" icon={ArrowUpFromLine} label="Cash withdrawal" onClick={() => setModal("wd")} />
                <Action id="t-transfer" icon={ArrowLeftRight} label="Transfer" onClick={() => setModal("tr")} />
                <Action id="t-remit" icon={Send} label="NEFT / RTGS / IMPS" onClick={() => setModal("remit")} />
                <Action id="t-inward" icon={Download} label="Inward credit" onClick={() => setModal("in")} />
                <Link href={`/app/accounts/${acc.id}`} className="flex flex-col items-start gap-2 rounded-xl border border-line p-4 text-sm transition hover:border-accent/50 hover:bg-raise">
                  <span className="text-muted">Open</span> Statement
                </Link>
              </div>
            </Card>
          )}
        </div>
      </div>
      {acc && modal === "dep" && <CashForm kind="deposit" account={acc.id} onClose={() => setModal(null)} />}
      {acc && modal === "wd" && <CashForm kind="withdrawal" account={acc.id} onClose={() => setModal(null)} />}
      {acc && modal === "tr" && <TransferForm from={acc.id} onClose={() => setModal(null)} />}
      {acc && modal === "remit" && <RemitForm from={acc.id} onClose={() => setModal(null)} />}
      {acc && modal === "in" && <InwardForm account={acc.id} onClose={() => setModal(null)} />}
    </>
  );
}

function Action({ id, icon: Icon, label, onClick }: { id: string; icon: typeof Send; label: string; onClick: () => void }) {
  return (
    <button id={id} onClick={onClick} className="flex flex-col items-start gap-2 rounded-xl border border-line p-4 text-left text-sm transition hover:border-accent/50 hover:bg-raise">
      <Icon size={18} className="text-accent" /> {label}
    </button>
  );
}

function InwardForm({ account, onClose }: { account: string; onClose: () => void }) {
  const [amount, setAmount] = useState("");
  const [remitter, setRemitter] = useState("");
  const [mode, setMode] = useState("NEFT");
  const { busy, run } = useAsync();
  return (
    <Modal title="Inward remittance" onClose={onClose}>
      <form onSubmit={(e) => (e.preventDefault(), run(async () => (await op("inward", { account, amount: parseRupees(amount), remitter, mode }, "Credited"), onClose())))}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Mode">
            <select className="input" value={mode} onChange={(e) => setMode(e.target.value)}>
              <option>NEFT</option><option>RTGS</option><option>IMPS</option>
            </select>
          </Field>
          <Field label="Remitter"><input className="input" value={remitter} onChange={(e) => setRemitter(e.target.value)} required /></Field>
          <Field label="Amount" className="sm:col-span-2"><AmountInput value={amount} onChange={setAmount} /></Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy}>Credit</button>
        </div>
      </form>
    </Modal>
  );
}
