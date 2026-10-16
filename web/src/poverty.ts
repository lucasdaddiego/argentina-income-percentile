// The poverty card: status against the CBA/CBT lines and the cushion.
import * as charts from "./charts";
import { data } from "./app";
import { fmtARS, fmtPct } from "./format";
import { $, fmtX } from "./ui";

export function renderPoverty(v: number) {
  const pl = data.poverty_lines;
  let status: string, cls: string;
  if (v < pl.cba_adulto_equiv) {
    status = "Bajo la línea de indigencia";
    cls = "indigente";
  } else if (v < pl.cbt_adulto_equiv) {
    status = "Bajo la línea de pobreza";
    cls = "pobre";
  } else {
    status = "Sobre la línea de pobreza";
    cls = "no-pobre";
  }
  const vsCbt = v / pl.cbt_adulto_equiv;
  const cba = pl.cba_adulto_equiv;
  const cbt = pl.cbt_adulto_equiv;

  let cushion: string;
  if (v >= cbt) {
    const c = v - cbt;
    cushion = `Tu <strong>colchón</strong> antes de la pobreza: tu ingreso por persona podría caer <strong>${fmtARS(c)}</strong> (−${fmtPct((c / v) * 100)}) antes de que tu hogar quede bajo la línea.`;
  } else if (v >= cba) {
    const need = cbt - v;
    cushion = `Para <strong>salir de la pobreza</strong> te faltan <strong>${fmtARS(need)}</strong> por persona (+${fmtPct((need / v) * 100)}).`;
  } else {
    const need = cba - v;
    cushion = `Para <strong>salir de la indigencia</strong> te faltan <strong>${fmtARS(need)}</strong> por persona.`;
  }

  $("poverty-line").innerHTML = `
    <div class="poverty-card">
      <div class="poverty-status ${cls}">${status}</div>
      <p>Tu ingreso por persona (<strong>${fmtARS(v)}</strong>) equivale a <strong>${fmtX(vsCbt)}</strong>
      la canasta de pobreza por persona.</p>
      <p class="poverty-cushion">${cushion}</p>
      <div id="poverty-numberline" class="numberline"></div>
      <ul class="poverty-stats">
        <li><span>Línea de pobreza (CBT) por persona</span><strong>${fmtARS(pl.cbt_adulto_equiv)}</strong></li>
        <li><span>Línea de indigencia (CBA) por persona</span><strong>${fmtARS(pl.cba_adulto_equiv)}</strong></li>
        <li><span>Tu ingreso vs la línea de pobreza</span><strong>${fmtX(vsCbt)}</strong></li>
      </ul>
      <p class="foot">Canasta Básica por adulto, ${pl.period_label} (INDEC). En hogares con menores el umbral
      oficial es algo menor: la escala de INDEC pondera a cada integrante por edad.</p>
    </div>`;
  charts.renderNumberLine($("poverty-numberline"), v, pl.cba_adulto_equiv, pl.cbt_adulto_equiv);
}
