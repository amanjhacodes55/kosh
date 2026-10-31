import { ArrowRight, BookOpenCheck, CalendarClock, CircleCheckBig, FileBarChart2, Globe, HandCoins, Landmark, Layers, PiggyBank, ShieldCheck, Users, Wallet } from "lucide-react";
import Link from "next/link";
import { SandboxButton } from "@/components/site";
import { ThemeToggle } from "@/components/theme";
import { Logo } from "@/components/ui";

const MODULES = [
  { icon: Users, title: "Customers and KYC", text: "One CIF per customer with PAN and Aadhaar checks, AML risk category, Form 15G/15H, nominees and senior-citizen status." },
  { icon: Wallet, title: "Savings and current", text: "Daily-product interest credited quarterly, slabbed rates, overdrafts on current accounts, liens, freezes and dormancy." },
  { icon: PiggyBank, title: "Fixed and recurring deposits", text: "Quarterly compounding or payout, senior rates, auto-renewal, premature closure with penalty, and TDS under section 194A." },
  { icon: HandCoins, title: "Lending", text: "Home, auto, personal, gold and MSME loans: bureau score, FOIR and LTV appraisal, sanction, disbursal, EMI schedules, NACH, foreclosure." },
  { icon: FileBarChart2, title: "IRAC and provisioning", text: "Days past due drive SMA-0/1/2 and NPA classes; unrealised interest moves to suspense; provisions follow each class." },
  { icon: Landmark, title: "Treasury", text: "NDTL, CRR and SLR positions, call and notice money within prudential limits, the policy-rate corridor, gilts and the currency chest." },
  { icon: Globe, title: "Payments", text: "Cash at the counter, internal transfers, and NEFT, RTGS and IMPS with IFSC checks, UTRs and settlement through the RBI account." },
  { icon: BookOpenCheck, title: "General ledger", text: "Every posting is a balanced double-entry voucher: trial balance, balance sheet, profit and loss, and a day book." },
  { icon: CircleCheckBig, title: "Maker-checker", text: "Entries over a user's limit wait for a manager. Nobody can authorise their own work." },
  { icon: CalendarClock, title: "End of day", text: "The batch: EMIs, standing instructions, accruals, quarter-end interest, maturities, classification, then the date moves on." },
  { icon: ShieldCheck, title: "Audit and compliance", text: "An append-only audit trail, cash transaction reports, structural liquidity buckets and TDS registers." },
  { icon: Layers, title: "Many banks, one install", text: "Each bank is a tenant with its own code, IFSCs, staff, customers, products, rates and books." },
];

const ROLES = [
  ["Teller", "Cash, transfers and remittances at the counter"],
  ["Customer service officer", "Onboarding, KYC, accounts and deposits"],
  ["Credit officer", "Appraisal, sanction and disbursal"],
  ["Branch manager", "Authorises over-limit work; closes the day"],
  ["Treasury dealer", "Reserves, call money and gilts"],
  ["Auditor", "Read-only ledgers, reports and audit trail"],
  ["Administrator", "Users, branches, products and rates"],
  ["Customer", "Net banking: transfers, FDs, RDs, loans"],
];

export default function Home() {
  return (
    <div className="min-h-dvh">
      <header className="glass sticky top-0 z-30 border-b border-line">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-5">
          <Logo />
          <span className="text-lg font-semibold tracking-tight">Kosh</span>
          <nav className="ml-6 hidden gap-6 text-sm text-ink-2 md:flex">
            <a href="#modules" className="hover:text-ink">Modules</a>
            <a href="#roles" className="hover:text-ink">Roles</a>
            <a href="https://github.com/amanjhacodes55/kosh" className="hover:text-ink">GitHub</a>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <Link href="/signin" className="btn btn-ghost">Sign in</Link>
            <SandboxButton small id="sandbox-header" />
          </div>
        </div>
      </header>

      <section className="bg-grid relative overflow-hidden border-b border-line">
        <div className="pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[900px] -translate-x-1/2 rounded-full opacity-40 blur-3xl" style={{ background: "radial-gradient(closest-side, var(--accent), transparent)" }} />
        <div className="relative mx-auto max-w-6xl px-5 pb-20 pt-20 text-center">
          <span className="chip bg-gold/15 text-gold">Open source · MIT · built for Indian banking</span>
          <h1 className="mx-auto mt-6 max-w-4xl text-4xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
            Core banking, <span className="text-gradient">from deposits to the treasury desk</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-ink-2">
            Kosh runs a bank&apos;s books: customers and KYC, savings and current accounts, fixed and recurring deposits, loans with
            IRAC classification, CRR, SLR and call money, a double-entry ledger, maker-checker and the end-of-day batch.
          </p>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <SandboxButton id="sandbox" />
            <Link href="/signin" className="btn h-11 px-5">Sign in to your bank <ArrowRight size={16} /></Link>
          </div>
          <p className="mt-4 text-sm text-muted">A sandbox is a sample bank five months into business, with every role ready to try. No sign-up.</p>
        </div>
      </section>

      <section id="modules" className="mx-auto max-w-6xl px-5 py-20">
        <h2 className="text-2xl font-semibold tracking-tight">Everything a branch and a head office need</h2>
        <p className="mt-2 max-w-2xl text-ink-2">Each module posts to the same ledger, so accounts, deposits, loans and the general ledger can never disagree.</p>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {MODULES.map((m) => (
            <div key={m.title} className="card p-5 transition hover:-translate-y-0.5 hover:border-accent/40">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent/12 text-accent"><m.icon size={20} /></span>
              <h3 className="mt-4 font-semibold">{m.title}</h3>
              <p className="mt-1.5 text-sm text-ink-2">{m.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="roles" className="border-y border-line bg-panel">
        <div className="mx-auto grid max-w-6xl gap-10 px-5 py-20 lg:grid-cols-2">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">A screen for every desk</h2>
            <p className="mt-2 text-ink-2">Staff see what their role needs and can do only what it allows. In a sandbox, switch between them from the user menu.</p>
            <div className="mt-8 grid gap-3 sm:grid-cols-2">
              {ROLES.map(([r, t]) => (
                <div key={r} className="rounded-xl border border-line p-4">
                  <div className="font-medium">{r}</div>
                  <div className="mt-1 text-sm text-muted">{t}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="card self-start p-6 font-mono text-[13px] leading-relaxed text-ink-2">
            <div className="mb-3 font-sans text-sm font-semibold text-ink">One cash withdrawal, posted</div>
            <div>V100481 · Cash withdrawal · 31 Oct 2026</div>
            <div className="mt-2 grid grid-cols-[1fr_auto_auto] gap-x-6">
              <span>20101 Savings deposits</span><span className="text-right">3,50,000.00</span><span />
              <span className="pl-6">To 10101 Cash in hand</span><span /><span className="text-right">3,50,000.00</span>
            </div>
            <div className="mt-4 border-t border-line pt-3">Maker: Sanjay Kumar (teller) · over ₹2 lakh</div>
            <div>Checker: Rohan Mehta (branch manager) · authorised</div>
            <div className="mt-3 text-accent-ink">Statement, ledger and audit trail updated together.</div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-20 text-center">
        <h2 className="text-2xl font-semibold tracking-tight">Try it with every role</h2>
        <p className="mx-auto mt-2 max-w-xl text-ink-2">The sandbox replays five months of business through the same engine a live bank runs: salaries, EMIs, quarter-end interest, an NPA, and a treasury desk working its reserves.</p>
        <div className="mt-8 flex justify-center"><SandboxButton id="sandbox-footer" /></div>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-5 py-6 text-sm text-muted">
          <Logo size={22} /> Kosh · open-source core banking · MIT License
          <a className="ml-auto hover:text-ink" href="https://github.com/amanjhacodes55/kosh">github.com/amanjhacodes55/kosh</a>
        </div>
      </footer>
    </div>
  );
}
