// Live dólar blue from dolarapi.com — display only, never baked into percentiles.

export interface BlueRate {
  venta: number;
  fecha: string;
}

// init() waits on this before it paints anything, so the request must be bounded: a dolarapi that
// accepts the connection and then never answers would leave the page blank until the browser's own
// (minutes-long) timeout. An abort rejects, which the catch below already maps to "no rate".
const TIMEOUT_MS = 3000;

export async function fetchBlue(): Promise<BlueRate | null> {
  try {
    const r = await fetch("https://dolarapi.com/v1/dolares/blue", { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!r.ok) return null;
    const d = await r.json();
    // Guard the external shape: a missing/non-numeric rate must fall back to ARS-only,
    // not silently turn every USD conversion into NaN.
    if (typeof d?.venta !== "number" || !(d.venta > 0)) return null;
    return { venta: d.venta, fecha: String(d.fechaActualizacion ?? "") };
  } catch {
    return null;
  }
}
