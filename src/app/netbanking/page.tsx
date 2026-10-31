"use client";

import { ArrowLeftRight, HandCoins, LogOut, PiggyBank, Repeat, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { call, op, refreshAll, useMe, useView } from "@/client/api";
import { FdForm, LoanApply, RdForm, RemitForm, TransferForm } from "@/components/console/forms";
import { ThemeToggle } from "@/components/theme";
import { Amount, Badge, Card, D, Empty, Loading, Logo, StatusBadge, Toasts } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import type { Account, Customer, Deposit, Loan, LoanApplication, Txn } from "@/lib/model";
import { formatINR } from "@/lib/money";
import type { RateBook } from "@/lib/rules";

type NB = {
  customer: Omit<Customer, "netbanking"> & { senior: boolean };
  accounts: (Account & { available: number })[];
  deposits: Deposit[];
  loans: (Loan & { overdue: number })[];
  applications: LoanApplication[];
  rates: { fd: RateBook["fd"]; seniorExtra: number };
  products: { code: string; name: string; rate: number; secured: boolean }[];
  recent: Txn[];
  date: string;
  ifsc: string;
};

export default function NetBanking() {
  const me = useMe();
  const router = useRouter();
  const { data } = useView<NB>(me?.kind === "customer" ? "netbanking" : null);
  const [modal, setModal] = useState<string | null>(null);
  useEffect(() => {
    if (me === null) router.replace("/signin");
    else if (me?.kind === "staff") router.replace("/app");
  }, [me, router]);
  if (!me || !data) return <div className="mx-auto max-w-5xl p-8"><Loading /></div>;
  const sb = data.accounts.find((a) => a.type === "SB" && a.status === "active") ?? data.accounts[0];
  const live = data.accounts.filter((a) => a.status === "active");
  const total = live.reduce((s, a) => s + a.balance, 0) + data.deposits.filter((d) => d.status === "active").reduce((s, d) => s + d.balance, 0);
  return (
    <div className="min-h-dvh">
      <header className="glass sticky top-0 z-30 border-b border-line">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-5">
          <Logo />
          <div className="leading-tight">
            <div className="font-semibold">{me.bank.name}</div>
            <div className="text-[11px] text-muted">Net banking</div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            {me.people && (
              <button className="btn btn-ghost btn-sm" id="back-to-staff" onClick={async () => { await call("/api/auth/switch", "POST", { kind: "staff", id: "U100" }); refreshAll(); router.push("/app"); }}>Back to staff view</button>
            )}
            <button className="btn btn-ghost btn-sm" onClick={async () => { await call("/api/auth/signout", "POST"); router.push("/signin"); }}><LogOut size={15} /> Sign out</button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-5 py-8">
        <div className="relative overflow-hidden rounded-3xl border border-line p-7" style={{ background: "linear-gradient(135deg, color-mix(in srgb, var(--accent) 22%, var(--panel)), var(--panel) 60%)" }}>
          <div className="text-sm text-ink-2">Welcome back,</div>
          <h1 className="text-3xl font-semibold tracking-tight">{data.customer.name}</h1>
          <div className="mt-1 text-sm text-muted">Customer ID {data.customer.cif} · {formatDate(data.date)}</div>
          <div className="mt-6 text-xs uppercase tracking-wider text-muted">Total relationship value</div>
          <div className="num text-4xl font-semibold text-gradient">{formatINR(total)}</div>
          <div className="mt-6 flex flex-wrap gap-2">
            {sb && <button id="nb-transfer" className="btn" onClick={() => setModal("tr")}><ArrowLeftRight size={15} /> Transfer</button>}
            {sb && <button id="nb-remit" className="btn" onClick={() => setModal("remit")}><Send size={15} /> NEFT / IMPS / RTGS</button>}
            {sb && <button id="nb-fd" className="btn btn-primary" onClick={() => setModal("fd")}><PiggyBank size={15} /> Open FD</button>}
            {sb && <button id="nb-rd" className="btn" onClick={() => setModal("rd")}><Repeat size={15} /> Open RD</button>}
            <button id="nb-loan" className="btn" onClick={() => setModal("loan")}><HandCoins size={15} /> Apply for a loan</button>
          </div>
        </div>

        <div className="mt-6 grid gap-5 lg:grid-cols-3">
          <div className="space-y-5 lg:col-span-2">
            <Card title="Accounts" pad={false}>
              <ul className="divide-y divide-line">
                {data.accounts.map((a) => (
                  <li key={a.id} className="flex items-center gap-4 px-5 py-4">
                    <div>
                      <div className="font-medium">{a.type === "SB" ? "Savings account" : "Current account"}</div>
                      <div className="font-mono text-xs text-muted">{a.id} · IFSC {data.ifsc}</div>
                    </div>
                    <div className="ml-auto text-right">
                      <div className="text-lg font-semibold"><Amount value={a.balance} /></div>
                      <div className="text-xs text-muted">Available {formatINR(a.available)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
            <Card title="Recent transactions" pad={false}>
              {!data.recent.length ? <Empty>No transactions yet.</Empty> : (
                <table className="tbl">
                  <tbody>
                    {data.recent.map((t) => (
                      <tr key={t.id}>
                        <td className="w-28"><D d={t.date} /></td>
                        <td className="max-w-sm truncate">{t.narration}</td>
                        <td><Badge>{t.channel}</Badge></td>
                        <td className="r"><Amount value={t.amount} signed /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </div>
          <div className="space-y-5">
            <Card title="Deposits" pad={false}>
              {!data.deposits.filter((d) => d.status === "active").length ? <Empty>No deposits. Open an FD in a minute.</Empty> : (
                <ul className="divide-y divide-line">
                  {data.deposits.filter((d) => d.status === "active").map((d) => (
                    <li key={d.id} className="px-5 py-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">{d.kind === "FD" ? "Fixed deposit" : "Recurring deposit"}</span>
                        <span className="num text-sm text-accent-ink">{d.rate}%</span>
                      </div>
                      <div className="mt-1 flex items-center justify-between text-xs text-muted">
                        <span>Matures {formatDate(d.maturityOn)}</span>
                        <Amount value={d.balance} className="text-sm text-ink" />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card title="Loans" pad={false}>
              {!data.loans.length && !data.applications.length ? <Empty>No loans.</Empty> : (
                <ul className="divide-y divide-line">
                  {data.loans.filter((l) => l.status === "active").map((l) => (
                    <li key={l.id} className="px-5 py-3 text-sm">
                      <div className="flex justify-between"><span className="font-medium">{data.products.find((p) => p.code === l.product)?.name}</span><span className="num">{l.rate}%</span></div>
                      <div className="mt-1 flex justify-between text-xs text-muted"><span>EMI {formatINR(l.emi)} · next {formatDate(l.nextDueOn)}</span><Amount value={l.outstanding} className="text-ink" /></div>
                      {l.overdue > 0 && (
                        <div className="mt-2 flex items-center justify-between rounded-lg bg-danger/10 px-2.5 py-1.5 text-xs text-danger">
                          Overdue {formatINR(l.overdue)}
                          <button className="btn btn-sm" onClick={() => op("repayLoan", { id: l.id, amount: l.overdue }, "Paid")}>Pay now</button>
                        </div>
                      )}
                    </li>
                  ))}
                  {data.applications.filter((a) => a.status !== "disbursed").map((a) => (
                    <li key={a.id} className="flex items-center justify-between px-5 py-3 text-sm">
                      <span>{data.products.find((p) => p.code === a.product)?.name} · <Amount value={a.amount} compact /></span>
                      <StatusBadge s={a.status} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      </main>
      {modal === "tr" && sb && <TransferForm from={sb.id} own={data.accounts} onClose={() => setModal(null)} />}
      {modal === "remit" && sb && <RemitForm from={sb.id} online onClose={() => setModal(null)} />}
      {modal === "fd" && <FdForm cif={data.customer.cif} dob={data.customer.dob} accounts={live} rates={data.rates} today={data.date} online onClose={() => setModal(null)} />}
      {modal === "rd" && <RdForm cif={data.customer.cif} dob={data.customer.dob} accounts={live} rates={data.rates} today={data.date} onClose={() => setModal(null)} />}
      {modal === "loan" && <LoanApply cif={data.customer.cif} products={data.products} onClose={() => setModal(null)} />}
      <Toasts />
    </div>
  );
}
