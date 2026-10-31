// Money is held as whole paise (integers) everywhere. Interest is worked out in fractions and rounded
// to the paisa only when it is posted, so accruals don't drift.

export type Paise = number;

export const rupees = (r: number): Paise => Math.round(r * 100);
export const toRupees = (p: Paise) => p / 100;

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inr0 = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

/** ₹12,34,567.89 (Indian grouping) */
export function formatINR(p: Paise, opts: { whole?: boolean } = {}) {
  return (opts.whole ? inr0 : inr).format(p / 100);
}

/** ₹4.25 Cr, ₹12.4 L, ₹8,500: for dashboards */
export function compactINR(p: Paise) {
  const r = p / 100;
  const sign = r < 0 ? "−" : "";
  const a = Math.abs(r);
  if (a >= 1e7) return `${sign}₹${(a / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `${sign}₹${(a / 1e5).toFixed(2)} L`;
  return `${sign}${inr0.format(a)}`;
}

/** Parses "1,50,000.50" or "150000" typed in a form; NaN when it isn't an amount */
export function parseRupees(text: string): Paise {
  const t = String(text).replace(/[,₹\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return NaN;
  return rupees(Number(t));
}
