"use client";

import { ArrowLeftRight, BookOpenCheck, Building2, CalendarClock, ChevronDown, CircleCheckBig, FileBarChart2, Gauge, HandCoins, Landmark, LogOut, Percent, PiggyBank, Search, ShieldCheck, Users } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { call, type Me, refreshAll, toast, useView } from "@/client/api";
import { formatDate } from "@/lib/dates";
import { ThemeToggle } from "./theme";
import { Logo, Toasts } from "./ui";

export const NAV: { path: string; label: string; icon: typeof Gauge; roles: string[]; group: string }[] = [
  { path: "", label: "Dashboard", icon: Gauge, roles: ["*"], group: "Overview" },
  { path: "customers", label: "Customers", icon: Users, roles: ["officer", "manager", "teller", "credit", "admin", "auditor"], group: "Branch" },
  { path: "teller", label: "Teller counter", icon: ArrowLeftRight, roles: ["teller", "manager"], group: "Branch" },
  { path: "deposits", label: "Deposits", icon: PiggyBank, roles: ["officer", "manager", "teller", "admin", "auditor"], group: "Branch" },
  { path: "loans", label: "Loans", icon: HandCoins, roles: ["credit", "manager", "officer", "admin", "auditor"], group: "Branch" },
  { path: "approvals", label: "Authorisation", icon: CircleCheckBig, roles: ["manager", "admin", "teller", "credit", "officer", "treasury"], group: "Branch" },
  { path: "treasury", label: "Treasury", icon: Landmark, roles: ["treasury", "manager", "admin", "auditor"], group: "Treasury" },
  { path: "rates", label: "Rates", icon: Percent, roles: ["*"], group: "Treasury" },
  { path: "ledger", label: "General ledger", icon: BookOpenCheck, roles: ["manager", "admin", "auditor", "treasury"], group: "Finance" },
  { path: "reports", label: "Regulatory reports", icon: FileBarChart2, roles: ["manager", "admin", "auditor", "credit", "treasury"], group: "Finance" },
  { path: "eod", label: "End of day", icon: CalendarClock, roles: ["manager", "admin", "auditor"], group: "Operations" },
  { path: "audit", label: "Audit trail", icon: ShieldCheck, roles: ["auditor", "admin", "manager"], group: "Operations" },
  { path: "admin", label: "Administration", icon: Building2, roles: ["admin"], group: "Operations" },
];

export const allowed = (role: string, roles: string[]) => roles.includes("*") || roles.includes(role);

export function Shell({ me, children }: { me: Me; children: ReactNode }) {
  const path = usePathname().replace(/^\/app\/?/, "").split("/")[0] ?? "";
  const items = NAV.filter((n) => allowed(me.user.role, n.roles));
  const groups = [...new Set(items.map((i) => i.group))];
  const pending = useView<{ pending: unknown[] }>(["manager", "admin"].includes(me.user.role) ? "approvals" : null).data?.pending.length ?? 0;
  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-line bg-panel lg:flex">
        <Link href="/app" className="flex items-center gap-2.5 px-5 py-4">
          <Logo />
          <div className="leading-tight">
            <div className="font-semibold tracking-tight">Kosh</div>
            <div className="text-[11px] text-muted">Core banking</div>
          </div>
        </Link>
        <nav className="flex-1 overflow-y-auto px-3 pb-4 scroll-thin" aria-label="Main">
          {groups.map((g) => (
            <div key={g} className="mt-3">
              <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">{g}</div>
              {items
                .filter((i) => i.group === g)
                .map((i) => {
                  const on = path === i.path;
                  return (
                    <Link
                      key={i.path}
                      href={`/app${i.path ? `/${i.path}` : ""}`}
                      className={`group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition ${on ? "bg-accent/12 font-medium text-ink" : "text-ink-2 hover:bg-raise hover:text-ink"}`}
                    >
                      {on && <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-accent" />}
                      <i.icon size={16} className={on ? "text-accent" : "text-muted group-hover:text-ink-2"} />
                      {i.label}
                      {i.path === "approvals" && pending > 0 && <span className="ml-auto rounded-full bg-gold px-1.5 text-[11px] font-semibold text-black">{pending}</span>}
                    </Link>
                  );
                })}
            </div>
          ))}
        </nav>
        <div className="border-t border-line px-5 py-3 text-[11px] text-muted">
          {me.bank.name} · IFSC prefix {me.bank.code}
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar me={me} />
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6">{children}</main>
      </div>
      <Toasts />
    </div>
  );
}

function TopBar({ me }: { me: Me }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  return (
    <header className="glass sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line px-4 sm:px-6">
      <Link href="/app" className="lg:hidden">
        <Logo size={26} />
      </Link>
      <div className="hidden min-w-0 items-center gap-2 md:flex">
        <span className="truncate font-semibold">{me.bank.name}</span>
        <span className="chip bg-raise font-mono text-ink-2">{me.bank.code}</span>
        {me.bank.sandbox && <span className="chip bg-gold/15 text-gold">Sandbox</span>}
      </div>
      <form
        className="relative ml-auto hidden w-72 sm:block"
        onSubmit={(e) => {
          e.preventDefault();
          const t = q.trim();
          if (!t) return;
          router.push(/^1[12]\d{10}$/.test(t) ? `/app/accounts/${t}` : `/app/customers?q=${encodeURIComponent(t)}`);
          setQ("");
        }}
      >
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <input className="input h-9 pl-9" placeholder="Customer, CIF, PAN or account no." value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
      </form>
      <div className="flex items-center gap-1.5 rounded-lg border border-line bg-raise px-2.5 py-1.5 text-xs" title="The bank's business date moves only when end of day runs">
        <CalendarClock size={14} className="text-gold" />
        <span className="text-muted">Business date</span>
        <span id="business-date" className="font-semibold">{formatDate(me.bank.date)}</span>
      </div>
      <ThemeToggle />
      <UserMenu me={me} />
    </header>
  );
}

function UserMenu({ me }: { me: Me }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  const switchTo = async (kind: "staff" | "customer", id: string) => {
    try {
      await call("/api/auth/switch", "POST", { kind, id });
      setOpen(false);
      refreshAll();
      router.push(kind === "customer" ? "/netbanking" : "/app");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };
  const signOut = async () => {
    await call("/api/auth/signout", "POST").catch(() => {});
    router.push("/signin");
  };
  return (
    <div className="relative" ref={ref}>
      <button id="user-menu" className="flex items-center gap-2 rounded-xl px-2 py-1 hover:bg-raise" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-accent to-[var(--accent-2)] text-xs font-semibold text-white">
          {me.user.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}
        </span>
        <span className="hidden text-left leading-tight sm:block">
          <span className="block text-sm font-medium">{me.user.name}</span>
          <span className="block text-[11px] text-muted">{me.user.roleLabel}</span>
        </span>
        <ChevronDown size={14} className="text-muted" />
      </button>
      {open && (
        <div className="card pop absolute right-0 top-12 z-40 w-72 overflow-hidden p-1.5" style={{ boxShadow: "var(--shadow)" }}>
          {me.people && (
            <>
              <div className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">Sandbox: sign in as</div>
              {me.people.staff.map((s) => (
                <button key={s.id} data-switch={s.username} className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm hover:bg-raise ${s.id === me.user.id ? "text-accent-ink" : ""}`} onClick={() => switchTo("staff", s.id)}>
                  <span>{s.name}</span>
                  <span className="text-xs text-muted">{s.roleLabel}</span>
                </button>
              ))}
              {me.people.customers.map((c) => (
                <button key={c.cif} data-switch={`cif-${c.cif}`} className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm hover:bg-raise" onClick={() => switchTo("customer", c.cif)}>
                  <span>{c.name}</span>
                  <span className="text-xs text-muted">Net banking</span>
                </button>
              ))}
              <div className="my-1 border-t border-line" />
            </>
          )}
          <button className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-danger hover:bg-raise" onClick={signOut}>
            <LogOut size={15} /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}
