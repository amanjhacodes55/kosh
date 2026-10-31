"use client";

import { useState } from "react";
import { useView } from "@/client/api";
import { compactINR } from "@/lib/money";
import { Amount, Badge, Card, D, Empty, Loading, PageHead, StatusBadge, Tabs } from "../ui";

type ReportData = {
  irac: { id: string; name: string; product: string; outstanding: number; overdue: number; dpd: number; cls: string; label: string; npaSince: string; provision: number }[];
  alm: { label: string; outflows: number; inflows: number }[];
  tds: { cif: string; name: string; pan: string; interest: number; tds: number; exempt: boolean }[];
  fy: string;
  ctr: { date: string; account: string; cif: string; name: string; amount: number; kind: string }[];
};

export function Reports() {
  const [tab, setTab] = useState<"irac" | "alm" | "tds" | "ctr">("irac");
  const { data } = useView<ReportData>("reports");
  return (
    <>
      <PageHead
        title="Regulatory reports"
        sub="Asset classification and provisioning, structural liquidity, tax deducted at source, and cash transactions for FIU-IND"
        actions={<Tabs value={tab} onChange={setTab} items={[{ value: "irac", label: "IRAC / NPA" }, { value: "alm", label: "Liquidity (ALM)" }, { value: "tds", label: "TDS" }, { value: "ctr", label: "CTR" }]} />}
      />
      {!data ? <Loading /> : tab === "irac" ? (
        <Card pad={false}>
          <table className="tbl">
            <thead><tr><th>Loan</th><th>Borrower</th><th>Product</th><th className="r">DPD</th><th>Class</th><th>NPA since</th><th className="r">Overdue</th><th className="r">Outstanding</th><th className="r">Provision</th></tr></thead>
            <tbody>
              {data.irac.sort((a, b) => b.dpd - a.dpd).map((r) => (
                <tr key={r.id}>
                  <td className="font-mono text-xs">{r.id}</td>
                  <td className="font-medium">{r.name}</td>
                  <td>{r.product}</td>
                  <td className="r num">{r.dpd}</td>
                  <td><StatusBadge s={r.cls} /></td>
                  <td>{r.npaSince ? <D d={r.npaSince} /> : "–"}</td>
                  <td className="r">{r.overdue ? <Amount value={r.overdue} /> : "–"}</td>
                  <td className="r"><Amount value={r.outstanding} /></td>
                  <td className="r"><Amount value={r.provision} /></td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td colSpan={7}>Total</td>
                <td className="r"><Amount value={data.irac.reduce((s, r) => s + r.outstanding, 0)} /></td>
                <td className="r"><Amount value={data.irac.reduce((s, r) => s + r.provision, 0)} /></td>
              </tr>
            </tbody>
          </table>
        </Card>
      ) : tab === "alm" ? (
        <Card title="Structural liquidity: residual maturity of inflows and outflows" pad={false}>
          <table className="tbl">
            <thead><tr><th>Time bucket</th><th className="r">Outflows</th><th className="r">Inflows</th><th className="r">Gap</th><th className="r">Cumulative gap</th></tr></thead>
            <tbody>
              {data.alm.map((b, i) => {
                const cum = data.alm.slice(0, i + 1).reduce((s, x) => s + x.inflows - x.outflows, 0);
                return (
                  <tr key={b.label}>
                    <td>{b.label}</td>
                    <td className="r">{compactINR(b.outflows)}</td>
                    <td className="r">{compactINR(b.inflows)}</td>
                    <td className={`r num ${b.inflows - b.outflows < 0 ? "text-danger" : "text-good"}`}>{compactINR(b.inflows - b.outflows)}</td>
                    <td className={`r num ${cum < 0 ? "text-danger" : ""}`}>{compactINR(cum)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="px-5 py-3 text-xs text-muted">Savings and current balances are split 15% volatile (1–14 days) and 85% core (1–3 years). Loans run off by their EMI schedules; deposits, call deals and gilts by maturity.</p>
        </Card>
      ) : tab === "tds" ? (
        <Card title={`Section 194A, FY ${data.fy}`} pad={false}>
          {!data.tds.length ? <Empty>No deposit interest paid this year yet.</Empty> : (
            <table className="tbl">
              <thead><tr><th>CIF</th><th>Customer</th><th>PAN</th><th className="r">Interest</th><th className="r">TDS</th><th /></tr></thead>
              <tbody>
                {data.tds.map((r) => (
                  <tr key={r.cif}>
                    <td className="font-mono text-xs">{r.cif}</td>
                    <td>{r.name}</td>
                    <td className="font-mono text-xs">{r.pan}</td>
                    <td className="r"><Amount value={r.interest} /></td>
                    <td className="r"><Amount value={r.tds} /></td>
                    <td>{r.exempt && <Badge tone="blue">15G/15H</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      ) : (
        <Card title="Cash transactions of ₹10 lakh or more" pad={false}>
          {!data.ctr.length ? <Empty>None.</Empty> : (
            <table className="tbl">
              <thead><tr><th>Date</th><th>Account</th><th>Customer</th><th>Type</th><th className="r">Amount</th></tr></thead>
              <tbody>
                {data.ctr.map((r, i) => (
                  <tr key={i}><td><D d={r.date} /></td><td className="font-mono text-xs">{r.account}</td><td>{r.name}</td><td className="capitalize">{r.kind}</td><td className="r"><Amount value={r.amount} /></td></tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
    </>
  );
}
