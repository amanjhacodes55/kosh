"use client";

import { ArrowDownLeft, ArrowUpRight, Landmark } from "lucide-react";
import { useState } from "react";
import { type Me, op, toast, useAsync, useView } from "@/client/api";
import type { CallDeal, Investment } from "@/lib/model";
import { compactINR, formatINR, parseRupees } from "@/lib/money";
import { moneyMarketInterest, type PolicyRates } from "@/lib/rules";
import { Amount, Card, D, Empty, Field, Loading, Meter, Modal, PageHead, StatusBadge } from "../ui";
import { AmountInput } from "./forms";

type Position = { demand: number; time: number; ndtl: number; crrRequired: number; crrHeld: number; crrSurplus: number; crrPct: number; crrDailyMinimum: number; slrRequired: number; slrHeld: number; slrSurplus: number; slrPct: number };
type TreasuryData = {
  position: Position;
  policy: PolicyRates;
  capitalFunds: number;
  limits: { borrowDay: number; borrowAvg: number; lendDay: number; lendAvg: number; borrowed: number; lent: number };
  wacr: number | null;
  deals: CallDeal[];
  investments: Investment[];
  cash: number;
  counterparties: string[];
};

export function Treasury({ me }: { me: Me }) {
  const { data } = useView<TreasuryData>("treasury");
  const [modal, setModal] = useState<string | null>(null);
  const dealer = me.user.role === "treasury";
  const policyEditor = ["treasury", "admin"].includes(me.user.role);
  if (!data) return <Loading />;
  const p = data.position;
  return (
    <>
      <PageHead
        title="Treasury"
        sub="Reserve requirements on NDTL, the call and notice money market within prudential limits, government securities, and the currency chest"
        actions={
          <>
            {dealer && <button id="deal-borrow" className="btn" onClick={() => setModal("borrow")}><ArrowDownLeft size={15} /> Borrow call money</button>}
            {dealer && <button id="deal-lend" className="btn btn-primary" onClick={() => setModal("lend")}><ArrowUpRight size={15} /> Lend call money</button>}
            {policyEditor && <button id="policy-rates" className="btn" onClick={() => setModal("policy")}><Landmark size={15} /> RBI policy rates</button>}
          </>
        }
      />
      <div className="grid gap-5 lg:grid-cols-3">
        <ReserveCard title={`Cash reserve ratio · ${data.policy.crr}%`} held={p.crrHeld} required={p.crrRequired} surplus={p.crrSurplus} pct={p.crrPct} note={`Held as balance with RBI. Daily minimum ${formatINR(p.crrDailyMinimum)} (90%); the fortnight's average must meet 100%.`} id="crr" />
        <ReserveCard title={`Statutory liquidity ratio · ${data.policy.slr}%`} held={p.slrHeld} required={p.slrRequired} surplus={p.slrSurplus} pct={p.slrPct} note="Held in cash and unencumbered government securities." id="slr" />
        <Card title="Net demand and time liabilities">
          <table className="w-full text-sm">
            <tbody>
              <Row k="Demand liabilities (savings, current, interest payable)" v={p.demand} />
              <Row k="Time liabilities (fixed and recurring)" v={p.time} />
              <Row k="Net interbank (borrowed less lent)" v={p.ndtl - p.demand - p.time} />
              <tr className="border-t border-line font-semibold"><td className="pt-2">NDTL</td><td className="num whitespace-nowrap pt-2 text-right">{compactINR(p.ndtl)}</td></tr>
            </tbody>
          </table>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
            {[["Repo", data.policy.repo], ["SDF", data.policy.sdf], ["MSF", data.policy.msf]].map(([k, v]) => (
              <div key={k} className="rounded-lg bg-raise py-2"><div className="text-muted">{k}</div><div className="num text-base font-semibold">{v}%</div></div>
            ))}
          </div>
        </Card>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <Card title="Call money limits" actions={<span className="text-xs text-muted">Capital funds {compactINR(data.capitalFunds)}</span>}>
          <Limit label="Borrowed" value={data.limits.borrowed} day={data.limits.borrowDay} avg={data.limits.borrowAvg} dayPct={125} avgPct={100} />
          <div className="h-5" />
          <Limit label="Lent" value={data.limits.lent} day={data.limits.lendDay} avg={data.limits.lendAvg} dayPct={50} avgPct={25} />
          <p className="mt-4 text-xs text-muted">Today&apos;s weighted average call rate: <span className="font-semibold text-ink">{data.wacr ? `${data.wacr}%` : "no deals yet"}</span></p>
        </Card>
        <Card title="Dealing blotter" className="lg:col-span-2" pad={false}>
          {!data.deals.length ? <Empty>No deals.</Empty> : (
            <div className="max-h-80 overflow-auto scroll-thin">
              <table className="tbl">
                <thead><tr><th>Deal</th><th>Side</th><th>Counterparty</th><th>Dealt</th><th>Matures</th><th className="r">Rate</th><th className="r">Amount</th><th className="r">Interest</th><th>Status</th></tr></thead>
                <tbody>
                  {data.deals.map((d) => (
                    <tr key={d.id}>
                      <td className="font-mono text-xs">{d.id}</td>
                      <td><StatusBadge s={d.side} /></td>
                      <td className="max-w-48 truncate">{d.counterparty}</td>
                      <td><D d={d.dealtOn} /></td>
                      <td><D d={d.maturesOn} /></td>
                      <td className="r num">{d.rate}%</td>
                      <td className="r"><Amount value={d.amount} compact /></td>
                      <td className="r"><Amount value={d.interest} /></td>
                      <td><StatusBadge s={d.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <Card title="Government securities (SLR)" className="lg:col-span-2" pad={false} actions={dealer && <button className="btn btn-sm" onClick={() => setModal("gsec")}>Buy</button>}>
          <table className="tbl">
            <thead><tr><th>Holding</th><th>Security</th><th className="r">Coupon</th><th>Maturity</th><th className="r">Face value</th><th /></tr></thead>
            <tbody>
              {data.investments.map((i) => (
                <tr key={i.id}>
                  <td className="font-mono text-xs">{i.id}</td>
                  <td>{i.security}</td>
                  <td className="r num">{i.coupon}%</td>
                  <td><D d={i.maturity} /></td>
                  <td className="r"><Amount value={i.faceValue} compact /></td>
                  <td className="r">{dealer && <button className="btn btn-ghost btn-sm" onClick={() => op("sellGsec", { id: i.id }, "Sold")}>Sell</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="Cash and currency chest">
          <div className="text-xs text-muted">Cash in vault</div>
          <div className="num text-2xl font-semibold">{compactINR(data.cash)}</div>
          <div className="mt-1 text-xs text-muted">Balance with RBI {compactINR(p.crrHeld)}</div>
          {["treasury", "manager"].includes(me.user.role) && (
            <div className="mt-4 flex gap-2">
              <button className="btn btn-sm" onClick={() => setModal("toRbi")}>Vault → RBI</button>
              <button className="btn btn-sm" onClick={() => setModal("fromRbi")}>RBI → vault</button>
            </div>
          )}
        </Card>
      </div>
      {(modal === "borrow" || modal === "lend") && <DealForm side={modal} data={data} onClose={() => setModal(null)} />}
      {modal === "policy" && <PolicyForm policy={data.policy} onClose={() => setModal(null)} />}
      {modal === "gsec" && <GsecForm onClose={() => setModal(null)} />}
      {(modal === "toRbi" || modal === "fromRbi") && <ChestForm direction={modal} onClose={() => setModal(null)} />}
    </>
  );
}

const Row = ({ k, v }: { k: string; v: number }) => (
  <tr><td className="py-1 pr-3 text-ink-2">{k}</td><td className="num whitespace-nowrap py-1 text-right">{compactINR(v)}</td></tr>
);

function ReserveCard({ title, held, required, surplus, pct, note, id }: { title: string; held: number; required: number; surplus: number; pct: number; note: string; id: string }) {
  const ok = surplus >= 0;
  return (
    <Card title={title} actions={<span id={`${id}-status`} className={`chip ${ok ? "bg-good/15 text-good" : "bg-danger/15 text-danger"}`}>{ok ? "Compliant" : "Shortfall"}</span>}>
      <div className="flex items-end justify-between">
        <div>
          <div className="text-xs text-muted">Held</div>
          <div className="num text-2xl font-semibold">{compactINR(held)}</div>
        </div>
        <div className="text-right">
          <div className="text-xs text-muted">Required</div>
          <div className="num text-lg font-medium text-ink-2">{compactINR(required)}</div>
        </div>
      </div>
      <div className="mt-3"><Meter value={held} max={Math.max(held, required) * 1.05} tone={ok ? "accent" : "danger"} /></div>
      <div className="mt-2 flex justify-between text-xs">
        <span className="text-muted">{pct}% of NDTL</span>
        <span className={ok ? "text-good" : "text-danger"}>{ok ? "Surplus" : "Short by"} {compactINR(Math.abs(surplus))}</span>
      </div>
      <p className="mt-3 text-xs text-muted">{note}</p>
    </Card>
  );
}

function Limit({ label, value, day, avg, dayPct, avgPct }: { label: string; value: number; day: number; avg: number; dayPct: number; avgPct: number }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-sm"><span>{label}</span><span className="num">{compactINR(value)} <span className="text-muted">of {compactINR(day)}</span></span></div>
      <Meter value={value} max={day} tone={value > avg ? "warn" : "accent"} />
      <div className="mt-1 text-[11px] text-muted">Any day {dayPct}% of capital funds; fortnightly average {avgPct}% ({compactINR(avg)})</div>
    </div>
  );
}

function DealForm({ side, data, onClose }: { side: "borrow" | "lend"; data: TreasuryData; onClose: () => void }) {
  const short = Math.max(0, -data.position.crrSurplus);
  const [amount, setAmount] = useState(side === "borrow" && short ? String(Math.ceil(short / 1_00_00_000_00) * 1_00_00_000) : "");
  const [rate, setRate] = useState(String(data.policy.repo));
  const [days, setDays] = useState("1");
  const [cp, setCp] = useState(data.counterparties[0]);
  const { busy, run } = useAsync();
  const p = parseRupees(amount);
  const r = Number(rate);
  const outside = r < data.policy.sdf || r > data.policy.msf;
  return (
    <Modal title={side === "borrow" ? "Borrow in the call money market" : "Lend in the call money market"} onClose={onClose}>
      <form onSubmit={(e) => (e.preventDefault(), run(async () => (await op("callDeal", { side, counterparty: cp, amount: p, rate: r, days: Number(days) }, side === "borrow" ? "Borrowed; funds credited to the RBI account" : "Lent; funds debited from the RBI account"), onClose())))}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Counterparty" className="sm:col-span-2">
            <select className="input" value={cp} onChange={(e) => setCp(e.target.value)}>
              {data.counterparties.map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Amount"><AmountInput id="deal-amount" value={amount} onChange={setAmount} /></Field>
          <Field label="Rate (% a year)" hint={outside ? "Outside the SDF–MSF corridor" : `Corridor ${data.policy.sdf}–${data.policy.msf}%`}><input id="deal-rate" className="input num" value={rate} onChange={(e) => setRate(e.target.value)} /></Field>
          <Field label="Tenor" className="sm:col-span-2">
            <select className="input" value={days} onChange={(e) => setDays(e.target.value)}>
              <option value="1">Overnight (call money)</option>
              {[2, 3, 7, 14].map((d) => <option key={d} value={d}>{d} days (notice money)</option>)}
            </select>
          </Field>
        </div>
        <div className="mt-4 rounded-xl border border-line bg-raise p-3 text-sm">
          Interest {side === "borrow" ? "payable" : "receivable"} at maturity: <span className="num font-semibold text-gold">{p > 0 && r > 0 ? formatINR(moneyMarketInterest(p, r, Number(days))) : "–"}</span> (actual/365)
          {side === "borrow" && short > 0 && <div className="mt-1 text-xs text-danger">CRR is short by {formatINR(short)} today.</div>}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button id="submit" className="btn btn-primary" disabled={busy}>Deal</button>
        </div>
      </form>
    </Modal>
  );
}

function PolicyForm({ policy, onClose }: { policy: PolicyRates; onClose: () => void }) {
  const [f, setF] = useState(Object.fromEntries(Object.entries(policy).map(([k, v]) => [k, String(v)])) as Record<keyof PolicyRates, string>);
  const { busy, run } = useAsync();
  const labels: [keyof PolicyRates, string][] = [["repo", "Repo rate"], ["sdf", "Standing deposit facility"], ["msf", "Marginal standing facility"], ["bankRate", "Bank rate"], ["crr", "Cash reserve ratio"], ["slr", "Statutory liquidity ratio"]];
  return (
    <Modal title="RBI policy rates" onClose={onClose}>
      <form onSubmit={(e) => (e.preventDefault(), run(async () => {
        const r = await op<{ repriced: number }>("setPolicyRates", f);
        const n = r.result?.repriced ?? 0;
        toast(`Policy rates updated${n ? `; ${n} floating-rate loan${n === 1 ? "" : "s"} repriced` : ""}`);
        onClose();
      }))}>
        <p className="mb-4 text-sm text-ink-2">Enter the rates as the RBI announces them. A repo change reprices every floating-rate (external benchmark) loan; CRR and SLR changes take effect on the requirement at once.</p>
        <div className="grid grid-cols-2 gap-4">
          {labels.map(([k, l]) => (
            <Field key={k} label={`${l} (%)`}><input id={`p-${k}`} className="input num" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>
          ))}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button id="submit" className="btn btn-primary" disabled={busy}>Apply</button>
        </div>
      </form>
    </Modal>
  );
}

function GsecForm({ onClose }: { onClose: () => void }) {
  const [f, setF] = useState({ security: "6.79% GS 2034", amount: "", coupon: "6.79", maturity: "2034-10-07" });
  const { busy, run } = useAsync();
  return (
    <Modal title="Buy government securities" onClose={onClose}>
      <form onSubmit={(e) => (e.preventDefault(), run(async () => (await op("buyGsec", { ...f, amount: parseRupees(f.amount), coupon: Number(f.coupon) }, "Bought; settled through the RBI account"), onClose())))}>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Security" className="col-span-2"><input className="input" value={f.security} onChange={(e) => setF({ ...f, security: e.target.value })} /></Field>
          <Field label="Face value" className="col-span-2"><AmountInput value={f.amount} onChange={(v) => setF({ ...f, amount: v })} /></Field>
          <Field label="Coupon (%)"><input className="input" value={f.coupon} onChange={(e) => setF({ ...f, coupon: e.target.value })} /></Field>
          <Field label="Maturity"><input className="input" type="date" value={f.maturity} onChange={(e) => setF({ ...f, maturity: e.target.value })} /></Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy}>Buy</button>
        </div>
      </form>
    </Modal>
  );
}

function ChestForm({ direction, onClose }: { direction: "toRbi" | "fromRbi"; onClose: () => void }) {
  const [amount, setAmount] = useState("");
  const { busy, run } = useAsync();
  return (
    <Modal title={direction === "toRbi" ? "Remit cash to the currency chest" : "Draw cash from the currency chest"} onClose={onClose}>
      <form onSubmit={(e) => (e.preventDefault(), run(async () => (await op("remitCash", { direction, amount: parseRupees(amount) }, "Done"), onClose())))}>
        <Field label="Amount"><AmountInput value={amount} onChange={setAmount} /></Field>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy}>Remit</button>
        </div>
      </form>
    </Modal>
  );
}
