// Structural splits and the cohort comparator (individual income).
import { data, deflator, sameMonthAsSurvey, state } from "./app";
import { fmtARS, fmtNum, fmtShort, parseMoney } from "./format";
import { percentileOfIncome } from "./stats";
import type { Measure } from "./types";
import { $, reformatWithCaret } from "./ui";

// Structural splits + cohort comparator. Set up once (cohort control); panels render in renderVisuals.
export function renderSplits() {
  const nat = data.measures.individual.median;
  $("splits-foot").innerHTML =
    `Mediana del <strong>ingreso individual</strong> (perceptores, ponderado por PONDII), ${data.source.period_label}. ` +
    `La punteada es la mediana nacional (${fmtShort(nat)}); se omiten grupos con muy pocos casos. Fuente: INDEC.`;

  const sel = $<HTMLSelectElement>("cohort-group");
  let opts = `<option value="all">todos los que cobran</option>`;
  for (const [k, d] of Object.entries(data.splits)) {
    opts += `<optgroup label="${d.label}">`;
    for (const g of d.groups) opts += `<option value="${k}:${g.key}">${g.label}</option>`;
    opts += `</optgroup>`;
  }
  sel.innerHTML = opts;

  const inc = $<HTMLInputElement>("cohort-income");
  if (state.people === 1) inc.value = fmtNum(state.hhIncomeARS);
  inc.addEventListener("input", () => {
    reformatWithCaret(inc);
    updateCohort();
  });
  sel.addEventListener("change", updateCohort);
  updateCohort();
}

export function updateCohort() {
  const typed = parseMoney($<HTMLInputElement>("cohort-income").value);
  const out = $("cohort-result");
  if (!typed) {
    out.innerHTML = `Ingresá tu <strong>sueldo individual</strong> para ubicarte entre los que cobran.`;
    return;
  }
  // Same month as the household income, same deflation: the perceptores are ranked in survey pesos.
  const inc = typed * deflator();
  const amount = sameMonthAsSurvey()
    ? `<strong>${fmtARS(typed)}</strong>`
    : `<strong>${fmtARS(typed)}</strong> (≈ ${fmtARS(inc)} de ${data.cpi_monthly.reference_label})`;
  const natPct = Math.round(percentileOfIncome(data.measures.individual, inc));
  const sel = $<HTMLSelectElement>("cohort-group").value;
  if (sel === "all") {
    out.innerHTML = `Tu sueldo (${amount}) está en el <strong>percentil ${natPct}</strong> entre todos los que cobran un ingreso.`;
    return;
  }
  const [dimKey, gKey] = sel.split(":");
  const dim = data.splits[dimKey];
  const g = dim?.groups.find((x) => x.key === gKey);
  if (!g) return;
  const gPct = Math.round(percentileOfIncome({ percentiles: g.percentiles } as unknown as Measure, inc));
  out.innerHTML =
    `Tu sueldo (${amount}) está en el <strong>percentil ${gPct}</strong> entre <strong>${g.label.toLowerCase()}</strong> ` +
    `(${dim.label.toLowerCase()}), y en el <strong>percentil ${natPct}</strong> entre todos los que cobran.`;
}
