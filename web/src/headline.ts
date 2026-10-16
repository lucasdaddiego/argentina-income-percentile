// The top of the page: headline percentile, class banner, context strip, synthesis, sticky bar.
import * as charts from "./charts";
import { data, deflator, measure, nominalPerPerson, sameMonthAsSurvey, state } from "./app";
import { classIndexOf, incomeClasses } from "./classes";
import { fmtARS, fmtMonth, fmtNum, fmtPct, fmtShort, fmtUSD } from "./format";
import { decileOf, percentileOfIncome } from "./stats";
import { $, escAttr, fmtM, fmtPeople, fmtX, signedARS, signedPct } from "./ui";

// ---------- sticky bar ----------
export function setupSticky() {
  const bar = $("sticky-bar");
  const headline = $("headline");
  const update = () => {
    bar.hidden = headline.getBoundingClientRect().bottom > 8;
  };
  window.addEventListener("scroll", update, { passive: true });
  update();
  bar.onclick = () => $("controls").scrollIntoView({ behavior: "smooth", block: "start" });
}
export function renderSticky(v: number, pct: number) {
  const pctTxt = pct < 1 ? "debajo del percentil 1" : `percentil ${Math.round(Math.min(99, pct))}`;
  const when = sameMonthAsSurvey() ? "" : ` (pesos de ${data.cpi_monthly.reference_label})`;
  $("sticky-bar").innerHTML =
    `<div class="sticky-inner"><span><strong>${fmtARS(v)}</strong> por persona${when} · ` +
    `<strong>${pctTxt}</strong></span><button type="button" class="sticky-edit">Editar ↑</button></div>`;
}

export function renderHeadline(v: number, pct: number) {
  const m = measure();
  const millones = fmtM(m.population / 1e6);

  const c = data.cpi_monthly;
  $("per-person-val").textContent = fmtARS(nominalPerPerson());
  // The month the income is from, and what the lookup actually uses, in the open: the survey holds
  // pesos of its reference month, the user types pesos of now.
  const adjusted = sameMonthAsSurvey()
    ? `Tu ingreso es de <strong>${c.reference_label}</strong>, el mes que releva la encuesta, así que se compara tal cual. `
    : `Tu ingreso es de <strong>${fmtMonth(state.incomeMonth)}</strong> y la encuesta releva ingresos de <strong>${c.reference_label}</strong>: ` +
      `descontada la inflación entre ambos (${fmtPct((1 / deflator() - 1) * 100)}), son <strong>${fmtARS(v)}</strong> por persona ` +
      `en pesos de ${c.reference_label}, y ese es el número que ubicamos. `;
  $("per-person").innerHTML =
    adjusted +
    `Lo comparamos con el ingreso por persona de ~${millones} millones de habitantes. ` +
    `<a class="subtle-link" href="#methodology">cómo se calcula</a>`;

  let headline: string;
  if (pct >= 99) headline = "Tu hogar está en el <strong>1% de mayores ingresos</strong> del país.";
  else if (pct < 1) headline = "Tu hogar está <strong>por debajo del percentil 1</strong>.";
  else headline = `Tu hogar está en el <strong>percentil ${Math.round(pct)}</strong>.`;

  const usd = state.blue && v > 0 ? `<span class="usd-eq">≈ ${fmtUSD(v / state.blue.venta)} al dólar blue</span>` : "";
  const deCada = Math.round(Math.min(99, Math.max(1, pct)));
  // Below p1 the rounded "1" would contradict the headline: fewer than 1 in 100 have less.
  const belowP1 = pct < 1;

  $("result").innerHTML = belowP1
    ? `
    <div class="pct-big">&lt;1<span> percentil</span></div>
    <div class="pct-text">
      <p class="lead">${headline}</p>
      <p><strong>Menos de 1 de cada 100</strong> personas tiene un ingreso por persona menor al de tu hogar. ${usd}</p>
    </div>`
    : `
    <div class="pct-big">${deCada}<span>º percentil</span></div>
    <div class="pct-text">
      <p class="lead">${headline}</p>
      <p><strong>${deCada} de cada 100</strong> personas tienen un ingreso por persona menor al de tu hogar. ${usd}</p>
    </div>`;

  const decile = decileOf(pct);
  const masN = 100 - deCada;
  const vMenos = deCada === 1 ? "tiene" : "tienen";
  const vMas = masN === 1 ? "tiene" : "tienen";
  const pctMeaning = belowP1
    ? `Estar <strong>por debajo del percentil 1</strong> significa que, de cada 100 personas ordenadas por ingreso por persona, ` +
      `<strong>menos de 1</strong> tiene menos que tu hogar y <strong>más de 99</strong> tienen más. `
    : `El <strong>percentil ${deCada}</strong> significa que, de cada 100 personas ordenadas por ingreso por persona, ` +
      `<strong>${deCada}</strong> ${vMenos} menos que tu hogar y <strong>${masN}</strong> ${vMas} más. `;
  const multStr = (v / m.median).toLocaleString("es-AR", { maximumFractionDigits: 1 });
  // The mean sits well above the median, so an income can be above one and below the other.
  const vsBoth =
    v >= m.median && v >= m.mean ? "por encima de los dos" : v < m.median && v < m.mean ? "por debajo de los dos" : "entre la mediana y el promedio";
  $("headline-explain").innerHTML =
    pctMeaning +
    `Tu hogar cae en el <strong>decil ${decile} de 10</strong>.<br><br>` +
    `La <strong>mediana</strong> es el ingreso que deja a la mitad de la gente por debajo y a la otra mitad por encima: ` +
    `hoy son <strong>${fmtARS(m.median)}</strong> por persona. El <strong>promedio</strong> —lo que le tocaría a cada uno ` +
    `si se repartiera todo en partes iguales— da ${fmtARS(m.mean)}. ` +
    `Tu ingreso por persona (<strong>${fmtARS(v)}</strong>) está ${vsBoth}: equivale a ` +
    `<strong>${multStr} veces la mediana</strong> (${multStr} × ${fmtARS(m.median)} ≈ ${fmtARS(v)}). ` +
    `<span class="muted">El promedio es mayor que la mediana porque los ingresos más altos lo estiran hacia arriba.</span><br><br>` +
    `<span class="muted">Y es una <strong>estimación</strong> de una encuesta a ${fmtNum(m.n_unweighted)} personas, no un padrón: tu percentil tiene un margen de ±${Math.max(1, Math.round(charts.percentileMargin(m, pct)))} punto${Math.max(1, Math.round(charts.percentileMargin(m, pct))) === 1 ? "" : "s"} (la franja sombreada en la regla de arriba).</span>`;
}

export function renderClass(v: number) {
  const m = measure();
  const pl = data.poverty_lines;
  const classes = incomeClasses(m);
  const idx = classIndexOf(classes, v);
  const cur = classes[idx];
  const hiTxt = cur.hi === Infinity ? "sin tope" : fmtARS(cur.hi);

  $("class-banner").innerHTML = `
    <div class="class-banner" style="border-left-color:${cur.color}">
      <span class="class-name" style="color:${cur.color}">${cur.name}</span>
      <span class="class-desc">${cur.desc}. <span class="muted">Tramo: ${fmtARS(cur.lo)} – ${hiTxt} por persona.</span></span>
    </div>`;

  const rows = classes
    .map((c, i) => {
      const loPct = percentileOfIncome(m, c.lo);
      const hiPct = c.hi === Infinity ? 100 : percentileOfIncome(m, c.hi);
      const share = Math.max(0, hiPct - loPct).toLocaleString("es-AR", { maximumFractionDigits: 0 });
      const range = `${fmtShort(c.lo)} – ${c.hi === Infinity ? "+" : fmtShort(c.hi)}`;
      return `<li class="${i === idx ? "is-you" : ""}">
        <span class="sw" style="background:${c.color}"></span>
        <span class="cl-name">${c.name}${i === idx ? ' <strong>· vos</strong>' : ""}</span>
        <span class="cl-range">${range}</span>
        <span class="cl-share">${share}%</span></li>`;
    })
    .join("");
  $("class-legend").innerHTML = `<ul class="class-legend">${rows}</ul>`;

  $("class-foot").innerHTML =
    `<strong>Indigencia</strong> y <strong>pobreza</strong> se miden con las líneas oficiales de INDEC (CBA/CBT por persona, ${pl.period_label}); ` +
    `los tramos medio y alto se definen en relación con la <strong>mediana</strong>, el criterio habitual para clasificar ingresos. ` +
    `El % es la parte de la población que cae en cada tramo.`;
}

export function renderContext(v: number, pct: number) {
  const m = measure();
  const classes = incomeClasses(m);
  const idx = classIndexOf(classes, v);
  const below = (pct / 100) * m.population;
  const above = m.population - below;
  const gMed = v - m.median;
  const gMean = v - m.mean;
  const cbt = data.poverty_lines.cbt_adulto_equiv;
  const smvm = data.cost_of_living?.reference_incomes?.smvm;

  const cell = (label: string, value: string, sub: string, title = "") =>
    `<div class="ctx-cell" title="${escAttr(title)}"><span class="ctx-label">${label}</span><strong class="ctx-value">${value}</strong><span class="ctx-sub">${sub}</span></div>`;

  let next: string;
  if (idx >= classes.length - 1) {
    next = cell("Próximo escalón", "En la cima", "ya estás en el tramo más alto");
  } else {
    const nc = classes[idx + 1];
    next = cell("Próximo escalón", fmtARS(Math.max(0, nc.lo - v)), `para entrar a ${nc.name.toLowerCase()}`);
  }

  let cells =
    cell("Gente por debajo", fmtPeople(below), `${fmtPeople(above)} ganan más`, `${Math.round(below).toLocaleString("es-AR")} por debajo · ${Math.round(above).toLocaleString("es-AR")} por encima`) +
    cell("Vs. el hogar típico", signedARS(gMed), `${signedPct(gMed / m.median)} · mediana ${fmtShort(m.median)}`, `mediana del país ${fmtARS(m.median)}`) +
    cell("Vs. el promedio", signedARS(gMean), `${signedPct(gMean / m.mean)} · promedio ${fmtShort(m.mean)}`, `promedio del país ${fmtARS(m.mean)}`) +
    cell("Canastas de pobreza", fmtX(v / cbt), "la línea de pobreza es 1×", `canasta básica total ${fmtARS(cbt)} por persona`);
  if (smvm) cells += cell("Vs. salario mínimo", fmtX(v / smvm), `por persona, vs SMVM ${fmtShort(smvm)}`, `salario mínimo ${fmtARS(smvm)}`);
  cells += next;

  $("context-strip").innerHTML = cells;
}

export function renderVistazoSynthesis(v: number) {
  const m = measure();
  const classes = incomeClasses(m);
  const cur = classes[classIndexOf(classes, v)];
  const cbt = data.poverty_lines.cbt_adulto_equiv;
  const p90 = m.percentiles["90"];
  const relMed = v / m.median;
  const medWord = v >= m.median ? `un <strong>${signedPct(relMed - 1).replace("+", "")}</strong> por encima de` : `un <strong>${signedPct(1 - relMed).replace("+", "")}</strong> por debajo de`;

  let topPart: string;
  if (v >= p90) {
    topPart = `Ya estás dentro del <strong>10% más rico</strong> (que arranca en ${fmtARS(p90)} por persona).`;
  } else {
    const mult = v > 0 ? ` (${fmtX(p90 / v)} tu ingreso de hoy)` : "";
    topPart = `Para entrar al <strong>10% más rico</strong> —que arranca en ${fmtARS(p90)} por persona— te faltan <strong>${fmtARS(p90 - v)}</strong>${mult}.`;
  }

  $("vistazo-synthesis").innerHTML =
    `En resumen: tu hogar <strong>${cur.phrase}</strong>. Tu ingreso por persona (<strong>${fmtARS(v)}</strong>) está ${medWord} la mediana ` +
    `y compra <strong>${fmtX(v / cbt)}</strong> la canasta básica de pobreza (la línea es 1×). ${topPart}`;
}
