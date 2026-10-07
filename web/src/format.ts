const arsFmt = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });
const usdFmt = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });

export function fmtARS(n: number): string {
  return "$" + arsFmt.format(Math.round(n));
}

export function fmtUSD(n: number): string {
  return "US$" + usdFmt.format(Math.round(n));
}

export function fmtNum(n: number): string {
  return arsFmt.format(Math.round(n));
}

/** Compact money for axis ticks: $120k, $1,2M. */
export function fmtShort(n: number): string {
  if (n >= 1_000_000) return "$" + (n / 1_000_000).toLocaleString("es-AR", { maximumFractionDigits: 1 }) + "M";
  if (n >= 1_000) return "$" + Math.round(n / 1_000) + "k";
  return "$" + Math.round(n);
}

export function fmtPct(n: number, decimals = 1): string {
  return n.toLocaleString("es-AR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + "%";
}

/** Parse "790.000" / "1.200.000" / "790000" → 790000. */
export function parseMoney(s: string): number {
  const digits = s.replace(/[^\d]/g, "");
  return digits ? parseInt(digits, 10) : 0;
}

export const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/** "2026-05" → "mayo 2026". */
export function fmtMonth(m: string): string {
  const [y, mm] = m.split("-");
  return `${MESES[parseInt(mm, 10) - 1]} ${y}`;
}
