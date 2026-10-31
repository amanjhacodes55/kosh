"use client";

import { useState } from "react";
import { op, useAsync, useView } from "@/client/api";
import { addDays, addMonths, ageOn, daysBetween, formatDate } from "@/lib/dates";
import { formatINR, parseRupees } from "@/lib/money";
import { emi, fdMaturity, fdRate, type RateBook, rdMaturity } from "@/lib/rules";
import { Field, Modal } from "../ui";

/** A rupee amount typed as text; `paise` is NaN until it parses */
export function AmountInput({ value, onChange, id, autoFocus }: { value: string; onChange: (v: string) => void; id?: string; autoFocus?: boolean }) {
  const p = parseRupees(value);
  return (
    <div>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted">₹</span>
        <input id={id} autoFocus={autoFocus} className="input num pl-7" inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} placeholder="0.00" />
      </div>
      {value && (Number.isNaN(p) ? <span className="mt-1 block text-xs text-danger">Enter an amount like 25000 or 1,50,000.50</span> : <span className="mt-1 block text-xs text-muted">{inWords(p)}</span>)}
    </div>
  );
}

/** ₹ in Indian words, for the line under an amount ("Twelve lakh fifty thousand rupees") */
function inWords(paise: number) {
  const n = Math.floor(paise / 100);
  if (n === 0) return "Zero rupees";
  const ones = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
  const tens = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
  const two = (x: number) => (x < 20 ? ones[x] : `${tens[Math.floor(x / 10)]}${x % 10 ? `-${ones[x % 10]}` : ""}`);
  const three = (x: number) => (x >= 100 ? `${ones[Math.floor(x / 100)]} hundred${x % 100 ? ` ${two(x % 100)}` : ""}` : two(x));
  const parts: string[] = [];
  const cr = Math.floor(n / 1e7), l = Math.floor((n % 1e7) / 1e5), th = Math.floor((n % 1e5) / 1e3), rest = n % 1000;
  if (cr) parts.push(`${cr >= 100 ? three(cr) : two(cr)} crore`);
  if (l) parts.push(`${two(l)} lakh`);
  if (th) parts.push(`${two(th)} thousand`);
  if (rest) parts.push(three(rest));
  const s = parts.join(" ") + " rupees";
  return s[0].toUpperCase() + s.slice(1);
}

function Actions({ busy, onCancel, label, danger }: { busy: boolean; onCancel: () => void; label: string; danger?: boolean }) {
  return (
    <div className="mt-5 flex justify-end gap-2">
      <button type="button" className="btn btn-ghost" onClick={onCancel}>
        Cancel
      </button>
      <button type="submit" className={`btn ${danger ? "btn-danger" : "btn-primary"}`} disabled={busy} id="submit">
        {busy ? "Posting…" : label}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

export function NewCustomer({ onClose, onDone, branches }: { onClose: () => void; onDone: (cif: string) => void; branches: { code: string; name: string }[] }) {
  const [f, setF] = useState({ name: "", dob: "", pan: "", aadhaar: "", mobile: "", email: "", address: "", occupation: "Salaried", income: "", risk: "low", branch: branches[0]?.code ?? "0001" });
  const { busy, run } = useAsync();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title="New customer (CIF)" onClose={onClose} wide>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            const r = await op<{ cif: string }>("createCustomer", { ...f, monthlyIncome: parseRupees(f.income || "0") }, "Customer created; verify KYC to open accounts");
            if (r.result) onDone(r.result.cif);
          });
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name (as on PAN)"><input id="c-name" className="input" value={f.name} onChange={set("name")} required /></Field>
          <Field label="Date of birth / incorporation"><input id="c-dob" className="input" type="date" value={f.dob} onChange={set("dob")} required /></Field>
          <Field label="PAN" hint="Mandatory for cash of ₹50,000 or more and for credit reports"><input id="c-pan" className="input font-mono uppercase" value={f.pan} onChange={set("pan")} placeholder="ABCDE1234F" maxLength={10} /></Field>
          <Field label="Aadhaar" hint="Only the last 4 digits are stored"><input id="c-aadhaar" className="input font-mono" value={f.aadhaar} onChange={set("aadhaar")} placeholder="12 digits" maxLength={14} /></Field>
          <Field label="Mobile"><input id="c-mobile" className="input" value={f.mobile} onChange={set("mobile")} placeholder="98xxxxxxxx" required /></Field>
          <Field label="Email"><input id="c-email" className="input" type="email" value={f.email} onChange={set("email")} /></Field>
          <Field label="Address" className="sm:col-span-2"><input id="c-address" className="input" value={f.address} onChange={set("address")} /></Field>
          <Field label="Occupation"><input id="c-occupation" className="input" value={f.occupation} onChange={set("occupation")} /></Field>
          <Field label="Monthly income"><AmountInput id="c-income" value={f.income} onChange={(v) => setF({ ...f, income: v })} /></Field>
          <Field label="Risk category (AML)">
            <select className="input" value={f.risk} onChange={set("risk")}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </Field>
          <Field label="Home branch">
            <select className="input" value={f.branch} onChange={set("branch")}>
              {branches.map((b) => (
                <option key={b.code} value={b.code}>{b.name}</option>
              ))}
            </select>
          </Field>
        </div>
        <Actions busy={busy} onCancel={onClose} label="Create customer" />
      </form>
    </Modal>
  );
}

export function OpenAccount({ cif, onClose }: { cif: string; onClose: () => void }) {
  const [type, setType] = useState<"SB" | "CA">("SB");
  const [nominee, setNominee] = useState("");
  const { busy, run } = useAsync();
  return (
    <Modal title="Open account" onClose={onClose}>
      <form onSubmit={(e) => (e.preventDefault(), run(async () => (await op("openAccount", { cif, type, nominee }, "Account opened"), onClose())))}>
        <div className="grid grid-cols-2 gap-3">
          {(["SB", "CA"] as const).map((t) => (
            <button type="button" key={t} id={`type-${t}`} onClick={() => setType(t)} className={`rounded-xl border p-4 text-left transition ${type === t ? "border-accent bg-accent/10" : "border-line hover:bg-raise"}`}>
              <div className="font-medium">{t === "SB" ? "Savings account" : "Current account"}</div>
              <div className="mt-1 text-xs text-muted">{t === "SB" ? "Interest daily, credited quarterly" : "No interest; overdraft facility"}</div>
            </button>
          ))}
        </div>
        <Field label="Nominee" className="mt-4"><input className="input" value={nominee} onChange={(e) => setNominee(e.target.value)} placeholder="Name and relationship" /></Field>
        <Actions busy={busy} onCancel={onClose} label="Open account" />
      </form>
    </Modal>
  );
}

export function CashForm({ kind, account, onClose }: { kind: "deposit" | "withdrawal"; account: string; onClose: () => void }) {
  const [amount, setAmount] = useState("");
  const [narration, setNarration] = useState("");
  const { busy, run } = useAsync();
  return (
    <Modal title={kind === "deposit" ? "Cash deposit" : "Cash withdrawal"} onClose={onClose}>
      <form onSubmit={(e) => (e.preventDefault(), run(async () => (await op(kind === "deposit" ? "cashDeposit" : "cashWithdrawal", { account, amount: parseRupees(amount), narration }, kind === "deposit" ? "Cash deposited" : "Cash paid out"), onClose())))}>
        <div className="mb-4 rounded-xl bg-raise px-3 py-2 text-sm">Account <span className="font-mono">{account}</span></div>
        <Field label="Amount"><AmountInput id="amount" autoFocus value={amount} onChange={setAmount} /></Field>
        <Field label="Narration" className="mt-4"><input className="input" value={narration} onChange={(e) => setNarration(e.target.value)} placeholder={kind === "deposit" ? "Cash deposit" : "Cash withdrawal"} /></Field>
        <p className="mt-3 text-xs text-muted">{kind === "withdrawal" ? "Withdrawals over ₹2,00,000 go to the branch manager for authorisation." : "Deposits of ₹50,000 or more need PAN; ₹10 lakh or more is reported in the CTR."}</p>
        <Actions busy={busy} onCancel={onClose} label={kind === "deposit" ? "Deposit" : "Pay out"} />
      </form>
    </Modal>
  );
}

export function TransferForm({ from, onClose, own }: { from: string; onClose: () => void; own?: { id: string; type: string }[] }) {
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [narration, setNarration] = useState("");
  const { busy, run } = useAsync();
  return (
    <Modal title="Transfer within the bank" onClose={onClose}>
      <form onSubmit={(e) => (e.preventDefault(), run(async () => (await op("transfer", { from, to: to.trim(), amount: parseRupees(amount), narration }, "Transferred"), onClose())))}>
        <div className="mb-4 rounded-xl bg-raise px-3 py-2 text-sm">From <span className="font-mono">{from}</span></div>
        <Field label="To account number">
          <input id="to" className="input font-mono" value={to} onChange={(e) => setTo(e.target.value)} list="own-accounts" required />
          {own && (
            <datalist id="own-accounts">
              {own.filter((a) => a.id !== from).map((a) => (
                <option key={a.id} value={a.id}>{a.type}</option>
              ))}
            </datalist>
          )}
        </Field>
        <Field label="Amount" className="mt-4"><AmountInput id="amount" value={amount} onChange={setAmount} /></Field>
        <Field label="Remarks" className="mt-4"><input className="input" value={narration} onChange={(e) => setNarration(e.target.value)} placeholder="Transfer" /></Field>
        <Actions busy={busy} onCancel={onClose} label="Transfer" />
      </form>
    </Modal>
  );
}

export function RemitForm({ from, onClose, online }: { from: string; onClose: () => void; online?: boolean }) {
  const [f, setF] = useState({ mode: "NEFT", beneficiary: "", beneficiaryAccount: "", ifsc: "", amount: "", narration: "" });
  const { busy, run } = useAsync();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title="Pay another bank" onClose={onClose}>
      <form onSubmit={(e) => (e.preventDefault(), run(async () => (await op<{ utr: string }>("remit", { ...f, from, amount: parseRupees(f.amount) }, `${f.mode} sent`), onClose())))}>
        <div className="grid grid-cols-3 gap-2">
          {[
            ["NEFT", "Any amount, settles in half-hourly batches"],
            ["RTGS", "₹2 lakh and above, real time"],
            ["IMPS", "Instant, up to ₹5 lakh"],
          ].map(([m, d]) => (
            <button type="button" key={m} id={`mode-${m}`} onClick={() => setF({ ...f, mode: m })} className={`rounded-xl border p-3 text-left transition ${f.mode === m ? "border-accent bg-accent/10" : "border-line hover:bg-raise"}`}>
              <div className="text-sm font-semibold">{m}</div>
              <div className="mt-0.5 text-[11px] leading-tight text-muted">{d}</div>
            </button>
          ))}
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Beneficiary name" className="sm:col-span-2"><input id="ben-name" className="input" value={f.beneficiary} onChange={set("beneficiary")} required /></Field>
          <Field label="Account number"><input id="ben-account" className="input font-mono" value={f.beneficiaryAccount} onChange={set("beneficiaryAccount")} required /></Field>
          <Field label="IFSC"><input id="ben-ifsc" className="input font-mono uppercase" value={f.ifsc} onChange={set("ifsc")} maxLength={11} placeholder="ABCD0123456" required /></Field>
          <Field label="Amount" className="sm:col-span-2"><AmountInput id="amount" value={f.amount} onChange={(v) => setF({ ...f, amount: v })} /></Field>
        </div>
        <p className="mt-3 text-xs text-muted">{online ? "Online NEFT, RTGS and IMPS are free." : "Settles through the bank's current account with the RBI. RTGS at the branch: ₹20 to ₹45 plus GST."}</p>
        <Actions busy={busy} onCancel={onClose} label={`Send ${f.mode}`} />
      </form>
    </Modal>
  );
}

export function useRates() {
  return useView<RateBook>("rates").data;
}

export function FdForm({ cif, dob, accounts, onClose, rates, today, online }: { cif: string; dob: string; accounts: { id: string; type: string; available: number }[]; onClose: () => void; rates: { fd: RateBook["fd"]; seniorExtra: number }; today: string; online?: boolean }) {
  const [amount, setAmount] = useState("");
  const [tenure, setTenure] = useState("12m");
  const [payout, setPayout] = useState<"cumulative" | "quarterly">("cumulative");
  const [from, setFrom] = useState(accounts.find((a) => a.type === "SB")?.id ?? accounts[0]?.id ?? "");
  const [autoRenew, setAutoRenew] = useState(false);
  const { busy, run } = useAsync();
  const senior = ageOn(dob, today) >= 60;
  const months = tenure.endsWith("m") ? Number(tenure.slice(0, -1)) : 0;
  const days = tenure.endsWith("d") ? Number(tenure.slice(0, -1)) : 0;
  const maturityOn = months ? addMonths(today, months) : addDays(today, days);
  const rate = fdRate(rates.fd, daysBetween(today, maturityOn), senior, rates.seniorExtra);
  const p = parseRupees(amount);
  const quote = rate && p > 0 ? fdMaturity(p, rate, today, maturityOn, payout) : null;
  return (
    <Modal title="Open a fixed deposit" onClose={onClose}>
      <form onSubmit={(e) => (e.preventDefault(), run(async () => (await op("openFd", { cif, amount: p, months: months || undefined, days: days || undefined, payout, from, autoRenew }, "Fixed deposit opened"), onClose())))}>
        <Field label="Amount"><AmountInput id="fd-amount" autoFocus value={amount} onChange={setAmount} /></Field>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Tenure">
            <select id="fd-tenure" className="input" value={tenure} onChange={(e) => setTenure(e.target.value)}>
              {["30d", "91d", "180d", "270d", "12m", "18m", "24m", "36m", "60m", "120m"].map((t) => (
                <option key={t} value={t}>{t.endsWith("d") ? `${t.slice(0, -1)} days` : `${Number(t.slice(0, -1)) / 12 >= 1 && Number(t.slice(0, -1)) % 12 === 0 ? `${Number(t.slice(0, -1)) / 12} year${t === "12m" ? "" : "s"}` : `${t.slice(0, -1)} months`}`}</option>
              ))}
            </select>
          </Field>
          <Field label="Interest">
            <select id="fd-payout" className="input" value={payout} onChange={(e) => setPayout(e.target.value as "cumulative")}>
              <option value="cumulative">Reinvest (compounded quarterly)</option>
              <option value="quarterly">Pay out every quarter</option>
            </select>
          </Field>
          <Field label="Debit account" className="sm:col-span-2">
            <select className="input" value={from} onChange={(e) => setFrom(e.target.value)}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.type} {a.id} · {formatINR(a.available)} available</option>
              ))}
            </select>
          </Field>
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={autoRenew} onChange={(e) => setAutoRenew(e.target.checked)} /> Renew automatically at maturity</label>
        <div className="mt-4 grid grid-cols-3 gap-3 rounded-xl border border-line bg-raise p-3 text-sm">
          <div>
            <div className="text-xs text-muted">Rate{senior ? " (senior)" : ""}</div>
            <div className="num text-lg font-semibold text-accent-ink">{rate ?? "–"}%</div>
          </div>
          <div>
            <div className="text-xs text-muted">Matures</div>
            <div className="font-medium">{formatDate(maturityOn)}</div>
          </div>
          <div>
            <div className="text-xs text-muted">{payout === "quarterly" ? "Interest over the term" : "Maturity value"}</div>
            <div className="num font-semibold text-gold">{quote ? formatINR(payout === "quarterly" ? quote.interest : quote.maturity) : "–"}</div>
          </div>
        </div>
        {online && <p className="mt-2 text-xs text-muted">TDS applies once your deposit interest for the year passes ₹50,000 (₹1,00,000 for senior citizens), unless you have filed Form 15G/15H.</p>}
        <Actions busy={busy} onCancel={onClose} label="Open deposit" />
      </form>
    </Modal>
  );
}

export function RdForm({ cif, dob, accounts, onClose, rates, today }: { cif: string; dob: string; accounts: { id: string; type: string; available: number }[]; onClose: () => void; rates: { fd: RateBook["fd"]; seniorExtra: number }; today: string }) {
  const [amount, setAmount] = useState("5000");
  const [months, setMonths] = useState("24");
  const [from, setFrom] = useState(accounts.find((a) => a.type === "SB")?.id ?? accounts[0]?.id ?? "");
  const { busy, run } = useAsync();
  const rate = fdRate(rates.fd, daysBetween(today, addMonths(today, Number(months))), ageOn(dob, today) >= 60, rates.seniorExtra);
  const p = parseRupees(amount);
  const quote = rate && p > 0 ? rdMaturity(p, rate, Number(months)) : null;
  return (
    <Modal title="Open a recurring deposit" onClose={onClose}>
      <form onSubmit={(e) => (e.preventDefault(), run(async () => (await op("openRd", { cif, installment: p, months: Number(months), from }, "Recurring deposit opened; first instalment paid"), onClose())))}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Monthly instalment"><AmountInput id="rd-amount" value={amount} onChange={setAmount} /></Field>
          <Field label="Months">
            <select className="input" value={months} onChange={(e) => setMonths(e.target.value)}>
              {[6, 12, 18, 24, 36, 48, 60, 84, 120].map((m) => (
                <option key={m} value={m}>{m} months</option>
              ))}
            </select>
          </Field>
          <Field label="Instalments debited from" className="sm:col-span-2">
            <select className="input" value={from} onChange={(e) => setFrom(e.target.value)}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.type} {a.id}</option>
              ))}
            </select>
          </Field>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-3 rounded-xl border border-line bg-raise p-3 text-sm">
          <div><div className="text-xs text-muted">Rate</div><div className="num text-lg font-semibold text-accent-ink">{rate ?? "–"}%</div></div>
          <div><div className="text-xs text-muted">You pay in</div><div className="num font-medium">{quote ? formatINR(p * Number(months)) : "–"}</div></div>
          <div><div className="text-xs text-muted">Maturity value</div><div className="num font-semibold text-gold">{quote ? formatINR(quote.maturity) : "–"}</div></div>
        </div>
        <p className="mt-2 text-xs text-muted">Instalments are collected by standing instruction at end of day; late instalments attract ₹1.50 per ₹100 per month.</p>
        <Actions busy={busy} onCancel={onClose} label="Open RD" />
      </form>
    </Modal>
  );
}

export function LoanApply({ cif, onClose, products }: { cif: string; onClose: () => void; products: { code: string; name: string; rate: number; secured: boolean; maxTenureMonths?: number }[] }) {
  const [f, setF] = useState({ product: products[0]?.code ?? "HL", amount: "", months: "240", purpose: "", collateralValue: "", existingEmi: "" });
  const { busy, run } = useAsync();
  const p = products.find((x) => x.code === f.product)!;
  const amt = parseRupees(f.amount);
  const monthly = amt > 0 ? emi(amt, p.rate, Number(f.months)) : 0;
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title="Loan application" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            await op("applyLoan", { cif, product: f.product, amount: amt, months: Number(f.months), purpose: f.purpose, collateralValue: parseRupees(f.collateralValue || "0"), existingEmi: parseRupees(f.existingEmi || "0") }, "Application submitted to the credit desk");
            onClose();
          });
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Product" className="sm:col-span-2">
            <select id="loan-product" className="input" value={f.product} onChange={set("product")}>
              {products.map((x) => (
                <option key={x.code} value={x.code}>{x.name} · {x.rate}%</option>
              ))}
            </select>
          </Field>
          <Field label="Amount"><AmountInput id="loan-amount" value={f.amount} onChange={(v) => setF({ ...f, amount: v })} /></Field>
          <Field label="Tenure (months)"><input id="loan-months" className="input" type="number" min={6} value={f.months} onChange={set("months")} /></Field>
          {p.secured && <Field label="Value of security"><AmountInput id="loan-collateral" value={f.collateralValue} onChange={(v) => setF({ ...f, collateralValue: v })} /></Field>}
          <Field label="EMIs on other loans"><AmountInput value={f.existingEmi} onChange={(v) => setF({ ...f, existingEmi: v })} /></Field>
          <Field label="Purpose" className="sm:col-span-2"><input className="input" value={f.purpose} onChange={set("purpose")} /></Field>
        </div>
        <div className="mt-4 rounded-xl border border-line bg-raise p-3 text-sm">
          EMI about <span className="num font-semibold text-gold">{monthly ? formatINR(monthly) : "–"}</span> a month at {p.rate}%
        </div>
        <Actions busy={busy} onCancel={onClose} label="Submit application" />
      </form>
    </Modal>
  );
}

export function NetbankingForm({ cif, onClose }: { cif: string; onClose: () => void }) {
  const [password, setPassword] = useState("");
  const { busy, run } = useAsync();
  return (
    <Modal title="Enable net banking" onClose={onClose}>
      <form onSubmit={(e) => (e.preventDefault(), run(async () => (await op("enableNetbanking", { cif, password }, "Net banking enabled"), onClose())))}>
        <p className="mb-4 text-sm text-ink-2">The customer signs in with the bank code, their CIF ({cif}) as user ID, and this password.</p>
        <Field label="Temporary password"><input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required /></Field>
        <Actions busy={busy} onCancel={onClose} label="Enable" />
      </form>
    </Modal>
  );
}

export function Confirm({ title, text, label, danger, onClose, onConfirm, children }: { title: string; text: string; label: string; danger?: boolean; onClose: () => void; onConfirm: () => Promise<unknown>; children?: React.ReactNode }) {
  const { busy, run } = useAsync();
  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={(e) => (e.preventDefault(), run(async () => (await onConfirm(), onClose())))}>
        <p className="text-sm text-ink-2">{text}</p>
        {children}
        <Actions busy={busy} onCancel={onClose} label={label} danger={danger} />
      </form>
    </Modal>
  );
}
