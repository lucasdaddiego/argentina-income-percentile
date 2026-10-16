// Every chart, re-rendered on input, resize and theme changes, plus the chart captions.
import * as charts from "./charts";
import { data, ipcf, measure, state } from "./app";
import { incomeClasses } from "./classes";
import { effectiveCostLines } from "./cost";
import { renderGeo } from "./geo";
import { decileOf, percentileOfIncome } from "./stats";
import { $, fmtX, signedPct } from "./ui";

export function renderVisuals() {
  charts.refreshPalette();
  const m = measure();
  const v = ipcf();
  const pct = percentileOfIncome(m, v);
  const decile = decileOf(pct);
  charts.renderRuler($("ruler"), m, pct);
  charts.renderClassScale($("chart-class"), m, incomeClasses(m), v);
  charts.renderDecileBars($("chart-deciles"), m, decile);
  charts.renderSteepness($("chart-steepness"), m, pct);
  charts.renderDualRulers($("chart-dual"), data.measures.ipcf, data.measures.individual, v, state.people);
  charts.renderSplitsPanels($("splits-grid"), data.splits, data.measures.individual.median);
  charts.renderShareBar($("chart-share"), m, decile);
  charts.renderLorenz($("chart-lorenz"), m);
  charts.renderCDF($("chart-cdf"), m, v, pct);
  charts.renderHistogram($("chart-hist"), m, v);
  renderGeo();
  if (pct >= 90) charts.renderTailZoom($("chart-tail"), m, v, pct);
  charts.renderCanastas($("chart-canastas"), m.deciles, data.poverty_lines.cbt_adulto_equiv, decile);
  if (data.cost_of_living) charts.renderBudget($("chart-budget"), state.hhIncomeARS, effectiveCostLines(), state.people);
  charts.renderTrendGini($("chart-trend-gini"), data.history.gini_quarterly);
  charts.renderTrendPoverty($("chart-trend-poverty"), data.history.poverty_semestral);
  charts.renderTrendMedian($("chart-trend-median"), data.history.median_ipcf_quarterly, data.history.cpi_quarterly);
  charts.renderTrendRealVsSmvm($("chart-trend-smvm"), data.history.median_ipcf_quarterly, data.history.smvm_quarterly, data.history.cpi_quarterly);

  const src = `Fuente: ${data.source.period_label} (INDEC). Elaboración propia con microdatos EPH.`;
  $("foot-lorenz").textContent = `Curva de Lorenz del ingreso por persona. Gini calculado sobre los mismos datos. ${src}`;
  $("foot-cdf").textContent = `Eje hasta el percentil 99,9; se extiende si tu ingreso es mayor. ${src}`;
  $("foot-hist").textContent = `${m.histogram.note} Líneas: mediana y media. ${src}`;
  $("foot-canastas").textContent = `Canastas básicas totales (CBT) que compra el ingreso medio de cada decil, ${data.poverty_lines.period_label}. Por debajo de 1× no alcanza. ${src}`;
  const med = data.history.median_ipcf_quarterly;
  const cpiIdx = new Map(data.history.cpi_quarterly.map((c) => [c.period, c.index]));
  // Deflate to the CPI base ("pesos de hoy"); a period missing from the series is left nominal.
  const real = (val: number, period: string) => val * (100 / (cpiIdx.get(period) ?? 100));
  const f = med[0];
  const l = med[med.length - 1];
  const nomChg = l.median / f.median - 1;
  // Deflate BOTH endpoints: the last quarter only sits at index 100 while the series is rebased to it.
  const realChg = real(l.median, l.period) / real(f.median, f.period) - 1;
  $("foot-trend-median").innerHTML =
    `Entre ${f.period} y ${l.period} la mediana subió <strong>${signedPct(nomChg)}</strong> en pesos corrientes, ` +
    `pero <strong>${signedPct(realChg)}</strong> en pesos de hoy: la diferencia es inflación. ` +
    `Deflactado con el IPC nivel general (INDEC, base ${data.history.cpi_base_label} = 100). Fuente: INDEC.`;

  const smvm = data.history.smvm_quarterly;
  if (smvm.length) {
    const sm = new Map(smvm.map((s) => [s.period, s.smvm]));
    const smvmReal0 = real(sm.get(f.period) ?? 0, f.period);
    const smvmRealChg = real(sm.get(l.period) ?? 0, l.period) / smvmReal0 - 1;
    const ratio0 = f.median / (sm.get(f.period) ?? 1);
    const ratioL = l.median / (sm.get(l.period) ?? 1);
    $("foot-trend-smvm").innerHTML =
      `En términos reales la <strong>mediana ${signedPct(realChg)}</strong> mientras el <strong>salario mínimo ${signedPct(smvmRealChg)}</strong>: ` +
      `el piso legal perdió contra la inflación. La mediana pasó de valer <strong>${fmtX(ratio0)}</strong> el salario mínimo en ${f.period} a <strong>${fmtX(ratioL)}</strong> en ${l.period}. ` +
      `SMVM: promedio trimestral del Consejo del Salario. Fuente: INDEC / Min. Trabajo.`;
  }
  $("foot-tail").textContent = `Ingreso por persona en cada percentil del tramo más alto (p90 → p99,99). Fuente: ${data.source.period_label} (INDEC).`;
}
