"use client";

import { ArrowLeftRight, CalendarClock, CircleCheckBig, HandCoins, Landmark, UserPlus } from "lucide-react";
import Link from "next/link";
import { type Me, useView } from "@/client/api";
import { compactINR } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { Amount, Card, Loading, Meter, PageHead, Stat } from "../ui";

type Overview = {
  date: string;
  deposits: number;
  casa: number;
  casaRatio: number;
  mix: { label: string; amount: number }[];
  advances: number;
  cdRatio: number;
  grossNpa: number;
  grossNpaPct: number;
  netNpaPct: number;
  pcr: number;
  byClass: { cls: string; label: string; amount: number }[];
  byProduct: { code: string; name: string; amount: number }[];
  profit: number;
  reserves: { crrRequired: number; crrHeld: number; slrRequired: number; slrHeld: number; ndtl: number };
  policy: { repo: number; sdf: number; msf: number; bankRate: number; crr: number; slr: number };
  cash: number;
  customers: number;
  accounts: number;
  pending: number;
  applications: number;
  today: { count: number; credits: number; debits: number };
  lastEod: { date: string; steps: { step: string; detail: string }[] } | null;
  activity: { at: number; name: string; action: string; detail: string }[];
  trend: { month: string; deposits: number; advances: number }[];
};

const MIX_COLORS = ["var(--accent)", "var(--accent-2)", "var(--gold)", "#a78bfa"];
const CLASS_COLORS: Record<string, string> = { STD: "var(--good)", "SMA-0": "#facc15", "SMA-1": "var(--warn)", "SMA-2": "#fb923c", SUB: "var(--danger)", D1: "#e11d48", D2: "#be123c", D3: "#9f1239", LOSS: "#7f1d1d" };

export function Dashboard({ me }: { me: Me }) {
  const { data: o } = useView<Overview>("overview");
  const role = me.user.role;
  const quick = [
    { show: ["officer", "manager"].includes(role), href: "/app/customers?new=1", label: "New customer", icon: UserPlus },
    { show: ["teller", "manager"].includes(role), href: "/app/teller", label: "Teller counter", icon: ArrowLeftRight },
    { show: ["credit", "manager"].includes(role), href: "/app/loans", label: "Credit desk", icon: HandCoins },
    { show: ["treasury", "manager", "admin"].includes(role), href: "/app/treasury", label: "Treasury desk", icon: Landmark },
    { show: ["manager", "admin"].includes(role), href: "/app/approvals", label: `Authorise${o?.pending ? ` (${o.pending})` : ""}`, icon: CircleCheckBig },
    { show: ["manager", "admin"].includes(role), href: "/app/eod", label: "End of day", icon: CalendarClock },
  ].filter((q) => q.show);
  return (
    <>
      <PageHead
        title={`Good ${greeting()}, ${me.user.name.split(" ")[0]}`}
        sub={`${me.user.roleLabel} · business date ${formatDate(me.bank.date)}`}
        actions={quick.map((q) => (
          <Link key={q.href} href={q.href} className="btn">
            <q.icon size={15} /> {q.label}
          </Link>
        ))}
      />
      {!o ? (
        <Loading />
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="Total deposits" value={compactINR(o.deposits)} sub={`CASA ${o.casaRatio}% · ${o.accounts} accounts`} />
            <Stat label="Advances" value={compactINR(o.advances)} sub={`Credit–deposit ratio ${o.cdRatio}%`} />
            <Stat label="Gross NPA" value={`${o.grossNpaPct}%`} tone={o.grossNpaPct > 3 ? "danger" : o.grossNpaPct > 0 ? "warn" : "good"} sub={`Net NPA ${o.netNpaPct}% · PCR ${o.pcr}%`} />
            <Stat label="Profit this period" value={compactINR(o.profit)} tone={o.profit >= 0 ? "good" : "danger"} sub="Income less expenses and provisions" />
          </div>

          <div className="grid gap-5 xl:grid-cols-3">
            <Card title="Deposits and advances, month end" className="xl:col-span-2">
              <TrendChart data={o.trend} />
            </Card>
            <Card title="Reserve requirements" actions={<Link href="/app/treasury" className="text-xs text-accent-ink hover:underline">Treasury</Link>}>
              <Reserve label={`CRR ${o.policy.crr}%`} held={o.reserves.crrHeld} required={o.reserves.crrRequired} note="Balance with RBI" />
              <div className="h-4" />
              <Reserve label={`SLR ${o.policy.slr}%`} held={o.reserves.slrHeld} required={o.reserves.slrRequired} note="Cash and government securities" />
              <div className="mt-4 rounded-xl bg-raise px-3 py-2.5 text-xs text-muted">
                NDTL <span className="num font-semibold text-ink">{compactINR(o.reserves.ndtl)}</span> · repo <span className="font-semibold text-ink">{o.policy.repo}%</span> · corridor {o.policy.sdf}–{o.policy.msf}%
              </div>
            </Card>
          </div>

          <div className="grid gap-5 lg:grid-cols-3">
            <Card title="Deposit mix">
              <StackBar items={o.mix.map((m, i) => ({ label: m.label, value: m.amount, color: MIX_COLORS[i] }))} />
            </Card>
            <Card title="Asset quality (IRAC)">
              <StackBar items={o.byClass.map((c) => ({ label: c.label, value: c.amount, color: CLASS_COLORS[c.cls] ?? "var(--muted)" }))} />
            </Card>
            <Card title="Advances by product">
              <div className="space-y-3">
                {o.byProduct.map((p) => (
                  <div key={p.code}>
                    <div className="mb-1 flex justify-between text-sm">
                      <span>{p.name}</span>
                      <span className="num text-ink-2">{compactINR(p.amount)}</span>
                    </div>
                    <Meter value={p.amount} max={Math.max(...o.byProduct.map((x) => x.amount))} />
                  </div>
                ))}
              </div>
            </Card>
          </div>

          <div className="grid gap-5 lg:grid-cols-3">
            <Card title="Today at the branches">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <div className="text-xs text-muted">Transactions</div>
                  <div className="num text-xl font-semibold">{o.today.count}</div>
                </div>
                <div>
                  <div className="text-xs text-muted">Cash in vault</div>
                  <div className="num text-xl font-semibold">{compactINR(o.cash)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted">Credits</div>
                  <Amount value={o.today.credits} className="text-good" />
                </div>
                <div>
                  <div className="text-xs text-muted">Debits</div>
                  <Amount value={o.today.debits} className="text-danger" />
                </div>
              </div>
              <div className="mt-4 flex gap-2 text-xs">
                <Link href="/app/approvals" className="chip bg-gold/15 text-gold">{o.pending} awaiting authorisation</Link>
                <Link href="/app/loans" className="chip bg-info/15 text-info">{o.applications} loan applications open</Link>
              </div>
            </Card>
            <Card title="Recent activity" className="lg:col-span-2" pad={false}>
              <ul className="divide-y divide-line/60">
                {o.activity.map((a, i) => (
                  <li key={i} className="flex items-baseline gap-3 px-5 py-2.5 text-sm">
                    <span className="w-14 shrink-0 text-xs text-muted">{new Date(a.at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span>
                    <span className="font-medium">{a.action}</span>
                    <span className="min-w-0 truncate text-ink-2">{a.detail}</span>
                    <span className="ml-auto shrink-0 text-xs text-muted">{a.name}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
};

function Reserve({ label, held, required, note }: { label: string; held: number; required: number; note: string }) {
  const ok = held >= required;
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-sm font-medium">{label}</span>
        <span className={`chip ${ok ? "bg-good/15 text-good" : "bg-danger/15 text-danger"}`}>{ok ? "Compliant" : "Shortfall"}</span>
      </div>
      <Meter value={held} max={Math.max(held, required) * 1.05} tone={ok ? "accent" : "danger"} />
      <div className="mt-1.5 flex justify-between text-xs text-muted">
        <span>
          Held <span className="num text-ink">{compactINR(held)}</span>
        </span>
        <span>
          Required <span className="num text-ink">{compactINR(required)}</span>
        </span>
      </div>
      <div className="mt-0.5 text-[11px] text-muted">{note}</div>
    </div>
  );
}

export function StackBar({ items }: { items: { label: string; value: number; color: string }[] }) {
  const total = items.reduce((s, i) => s + Math.max(0, i.value), 0) || 1;
  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full bg-raise">
        {items.map((i) => (
          <div key={i.label} className="h-full transition-[width] duration-700" style={{ width: `${(Math.max(0, i.value) / total) * 100}%`, background: i.color }} title={i.label} />
        ))}
      </div>
      <ul className="mt-4 space-y-2 text-sm">
        {items.map((i) => (
          <li key={i.label} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: i.color }} />
            <span>{i.label}</span>
            <span className="ml-auto num text-ink-2">{compactINR(i.value)}</span>
            <span className="num w-12 text-right text-xs text-muted">{Math.round((Math.max(0, i.value) / total) * 1000) / 10}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TrendChart({ data }: { data: Overview["trend"] }) {
  const W = 640, H = 220, pad = 34;
  const max = Math.max(1, ...data.map((d) => Math.max(d.deposits, d.advances)));
  const bw = (W - pad * 2) / data.length;
  const y = (v: number) => H - 26 - (v / max) * (H - 50);
  const label = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleString("en-IN", { month: "short", timeZone: "UTC" });
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Deposits and advances by month">
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <g key={t}>
            <line x1={pad} x2={W - 8} y1={y(max * t)} y2={y(max * t)} stroke="var(--line)" strokeDasharray={t ? "3 4" : undefined} />
            <text x={pad - 6} y={y(max * t) + 4} textAnchor="end" fontSize="10" fill="var(--muted)">{compactINR(max * t).replace("₹", "")}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = pad + i * bw + bw * 0.18;
          const w = bw * 0.3;
          return (
            <g key={d.month}>
              <rect x={x} y={y(d.deposits)} width={w} height={H - 26 - y(d.deposits)} rx="4" fill="var(--accent)">
                <title>{`Deposits ${compactINR(d.deposits)}`}</title>
              </rect>
              <rect x={x + w + 4} y={y(d.advances)} width={w} height={H - 26 - y(d.advances)} rx="4" fill="var(--gold)">
                <title>{`Advances ${compactINR(d.advances)}`}</title>
              </rect>
              <text x={x + w + 2} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--muted)">{label(d.month)}</text>
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex gap-4 text-xs text-muted">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-accent" /> Deposits</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-gold" /> Advances</span>
      </div>
    </div>
  );
}
