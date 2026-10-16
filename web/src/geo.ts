// Geography: regions and aglomerados.
import * as charts from "./charts";
import { data, ipcf, state } from "./app";
import { fmtARS } from "./format";
import { $ } from "./ui";

export function renderRegionsText(v: number) {
  const regs = data.regions;
  const richest = regs[0];
  const poorest = regs[regs.length - 1];
  const aboveCount = regs.filter((r) => v >= r.median).length;
  $("regions-explain").innerHTML =
    `El país no es parejo: la mediana del ingreso por persona va de <strong>${fmtARS(poorest.median)}</strong> ` +
    `en ${poorest.name} a <strong>${fmtARS(richest.median)}</strong> en ${richest.name} ` +
    `(${(richest.median / poorest.median).toLocaleString("es-AR", { maximumFractionDigits: 1 })}× más). ` +
    `Con tu ingreso por persona (<strong>${fmtARS(v)}</strong>) quedarías en o por encima de la mediana de ` +
    `<strong>${aboveCount} de ${regs.length}</strong> regiones. El mismo ingreso “rinde” distinto según dónde vivas.`;
  $("foot-regions").textContent = `Mediana del ingreso por persona del hogar por región (ponderada). La línea punteada marca tu ingreso. Fuente: ${data.source.period_label} (INDEC).`;
}

// Region (6) ↔ aglomerado (32) toggle for the geography chart.
export function renderGeo() {
  const v = ipcf();
  if (state.geoView === "aglo") {
    charts.renderAglomerados($("chart-regions"), data.aglomerados, v);
    const above = data.aglomerados.filter((a) => v >= a.median).length;
    $("geo-caption").textContent = "Ingreso por persona — mediana de cada aglomerado urbano (EPH)";
    $("foot-regions").textContent =
      `Mediana del ingreso por persona por aglomerado urbano de la EPH (el Gran Buenos Aires se abre en CABA y Partidos del GBA, por eso son 32 filas para 31 aglomerados). Tu ingreso quedaría en o sobre la mediana ` +
      `de ${above} de ${data.aglomerados.length} ciudades. Es la mediana local, no tu percentil dentro de la ciudad. Fuente: ${data.source.period_label} (INDEC).`;
  } else {
    charts.renderRegions($("chart-regions"), data.regions, v);
    $("geo-caption").textContent = "Ingreso por persona — mediana de cada región";
    $("foot-regions").textContent = `Mediana del ingreso por persona del hogar por región (ponderada). La línea punteada marca tu ingreso. Fuente: ${data.source.period_label} (INDEC).`;
  }
}
