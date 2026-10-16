// "¿Llegás a fin de mes?" (the editable cost basket) and the buying-power tiles.
import * as charts from "./charts";
import { data, deflator, state } from "./app";
import { fmtARS, fmtNum, fmtShort, parseMoney } from "./format";
import type { CostLine } from "./types";
import { $, escAttr, fmtX, reformatWithCaret } from "./ui";

export function rentDefault(region: string): number {
  const c = data.cost_of_living;
  if (!c) return 0;
  return c.rent_by_region?.[region] ?? c.lines.find((l) => l.key === "alquiler")?.amount ?? 0;
}

export function initCostValues() {
  const c = data.cost_of_living;
  if (!c) return;
  state.costValues = {};
  for (const l of c.lines) state.costValues[l.key] = l.key === "alquiler" ? rentDefault(state.costRegion) : l.amount;
}

// Cost lines with the user's (possibly edited) values. Every line is a flat monthly household amount.
// Exported for testing; lazily seeds the per-line values on first use (every line key is then present).
export function effectiveCostLines(): CostLine[] {
  const c = data.cost_of_living;
  if (!c) return [];
  if (!Object.keys(state.costValues).length) initCostValues();
  return c.lines.map((l) => ({ ...l, amount: state.costValues[l.key] }));
}

export function renderCost() {
  const c = data.cost_of_living;
  const sec = $("cost-section");
  if (!c) {
    sec.hidden = true;
    return;
  }
  sec.hidden = false;
  const lines = effectiveCostLines(); // seeds state.costValues on first use

  const rowsHtml = lines
    .map(
      (l) => `<tr title="${escAttr(`${l.detail}  ·  Fuente: ${l.source}`)}">
        <td>${l.label}</td>
        <td class="num"><span class="cost-money"><span class="cost-cur">$</span><input class="cost-input" data-key="${l.key}" inputmode="numeric" autocomplete="off" value="${fmtNum(l.amount)}"></span></td></tr>`
    )
    .join("");
  $("cost-table").innerHTML = `
    <table class="ladder cost-table">
      <thead><tr><th>Rubro</th><th class="num">Monto por mes <span class="muted">(editá · $0 si no aplica)</span></th></tr></thead>
      <tbody>${rowsHtml}</tbody>
      <tfoot><tr><td>Canasta de gastos típicos</td><td class="num" id="cost-grand-total">—</td></tr></tfoot>
    </table>`;

  $("cost-table").querySelectorAll<HTMLInputElement>(".cost-input").forEach((inp) => {
    inp.addEventListener("input", () => {
      reformatWithCaret(inp);
      state.costValues[inp.dataset.key as string] = parseMoney(inp.value);
      recomputeBudget();
      renderBuyingPower(); // the rent tile follows the edited rent
    });
  });

  $("cost-caveats").innerHTML =
    c.caveats.map((x) => `• ${x}`).join("<br>") + `<br><span class="muted">Período de los costos: ${c.period_label}.</span>`;

  recomputeBudget();
}

export function recomputeBudget() {
  const c = data.cost_of_living;
  if (!c) return;
  const N = state.people;
  const H = state.hhIncomeARS;
  const lines = effectiveCostLines();
  const total = lines.reduce((s, l) => s + (l.scope === "hogar" ? l.amount : l.amount * N), 0);
  const gt = document.getElementById("cost-grand-total");
  if (gt) gt.textContent = fmtARS(total);

  const ratio = total > 0 ? H / total : 0;
  const leftover = H - total;
  const cbtHogar = data.poverty_lines.cbt_adulto_equiv * N;
  // Only claim the minimum wage / pension fall short of the basket the user actually has.
  const ri = c.reference_incomes;
  const short: string[] = [];
  if (ri.smvm < total) short.push(`el <strong>salario mínimo</strong> (${fmtARS(ri.smvm)})`);
  if (ri.jubilacion_minima < total) short.push(`la <strong>jubilación mínima</strong> (${fmtARS(ri.jubilacion_minima)})`);
  const who = short.join(" y ");
  const shortTxt = short.length
    ? ` ${who[0].toUpperCase()}${who.slice(1)} no ${short.length === 1 ? "alcanza" : "alcanzan"} ni para estos gastos fijos.`
    : "";
  const verdict =
    leftover >= 0
      ? `Tu ingreso del hogar (<strong>${fmtARS(H)}</strong>) cubre esa canasta <strong>${fmtX(ratio)}</strong>: te quedarían <strong>${fmtARS(leftover)}</strong> por mes para todo lo demás (ahorro, deudas, gustos).`
      : `Tu ingreso del hogar (<strong>${fmtARS(H)}</strong>) alcanza para el <strong>${Math.round(ratio * 100)}%</strong> de esa canasta: faltarían <strong>${fmtARS(-leftover)}</strong> por mes. Por eso muchos hogares recortan (alquiler más barato, salud pública, menos consumo).`;
  $("cost-analysis").innerHTML =
    `Esta canasta de gastos del hogar suma <strong>${fmtARS(total)}</strong> por mes. ${verdict}<br><br>` +
    `${short.length ? "Para ubicarlo entre dos extremos" : "Como referencia"}: la <strong>línea de pobreza</strong> de tu hogar de ${N} ${N === 1 ? "persona" : "personas"} (lo mínimo para no ser pobre) es ~${fmtARS(cbtHogar)}.` +
    shortTxt;

  charts.renderBudget($("chart-budget"), H, lines, N);
}

// Buying power: translate the household's monthly income into concrete, recognizable things.
export function renderBuyingPower() {
  const c = data.cost_of_living;
  const sec = $("buying-section");
  if (!c) {
    sec.hidden = true;
    return;
  }
  sec.hidden = false;
  const H = state.hhIncomeARS;
  const pl = data.poverty_lines;
  const cnt = (n: number) => (n >= 10 ? Math.round(n).toLocaleString("es-AR") : n.toLocaleString("es-AR", { maximumFractionDigits: 1 }));
  const tile = (big: string, label: string, sub: string) =>
    `<div class="bp-tile"><strong class="bp-num">${big}</strong><span class="bp-label">${label}</span><span class="bp-sub">${sub}</span></div>`;

  const tiles: string[] = [];
  if (state.blue) tiles.push(tile(cnt(H / state.blue.venta), "dólares al blue", `blue $${fmtNum(state.blue.venta)}`));
  // The canasta is priced in the survey's reference month, so the income is compared in those pesos.
  const cbtHogar = pl.cbt_adulto_equiv * state.people;
  tiles.push(tile(cnt((H * deflator()) / cbtHogar), `canastas básicas (hogar de ${state.people})`, `1 canasta ${fmtShort(cbtHogar)}, ${pl.period_label}`));
  if (c.reference_incomes?.smvm) tiles.push(tile(cnt(H / c.reference_incomes.smvm), "salarios mínimos", `SMVM ${fmtShort(c.reference_incomes.smvm)}`));
  // The rent the user sees (and may have edited) in the cost table, not the region default.
  const rent = effectiveCostLines().find((l) => l.key === "alquiler")?.amount ?? 0;
  const rentLabel = rent === rentDefault(state.costRegion) ? `alquileres (${state.costRegion})` : "alquileres como el tuyo";
  if (rent) tiles.push(tile(cnt(H / rent), rentLabel, `alquiler ${fmtShort(rent)}`));
  for (const g of c.goods ?? []) {
    const per = g.unit === "L" ? "/L" : g.unit === "kg" ? "/kg" : " c/u";
    tiles.push(tile(cnt(H / g.price), g.label, `$${fmtNum(g.price)}${per}`));
  }
  $("buying-grid").innerHTML = tiles.join("");

  $("buying-intro").innerHTML =
    `Otra forma de ver tu ingreso: en cosas concretas. Con <strong>lo que entra a tu hogar por mes</strong> ` +
    `(${fmtARS(H)}) podrías comprar, por ejemplo:`;
  const srcs = (c.goods ?? []).map((g) => g.source).filter((s, i, a) => a.indexOf(s) === i);
  $("buying-foot").innerHTML =
    `Precios de referencia, mediados de 2026 — <strong>estimados</strong> que varían por marca, lugar y momento. ` +
    `Fuentes: dólar blue (dolarapi.com, en vivo); canasta y salario mínimo (INDEC / ANSES); ` +
    `alquileres por región, ${c.period_label}; bienes: ${srcs.join("; ")}.`;
}
