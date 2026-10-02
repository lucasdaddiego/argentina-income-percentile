import "./styles.css";
import * as charts from "./charts";
import { fmtARS, fmtUSD, fmtNum, fmtPct, fmtShort, parseMoney } from "./format";
import { percentileOfIncome, decileOf } from "./stats";
import { fetchBlue, type BlueRate } from "./usd";
import type { Artifact, CostLine, IncomeClass, Measure } from "./types";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
// Read a CSS custom property off :root (resolves to the active light/dark theme).
const cssVar = (name: string, fallback: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
const fmtM = (x: number) => x.toLocaleString("es-AR", { maximumFractionDigits: 1 });
const fmtX = (x: number) => x.toLocaleString("es-AR", { maximumFractionDigits: 2 }) + "×";
// People counts with adaptive units, so small-but-nonzero numbers never read as "0 M".
// Exported for direct unit testing (the "menos de mil" branch isn't reachable via real population).
export const fmtPeople = (n: number) =>
  n >= 1e6 ? `${fmtM(n / 1e6)} M` : n >= 1e3 ? `~${Math.round(n / 1e3).toLocaleString("es-AR")} mil` : "menos de mil";
const signedARS = (n: number) => (n >= 0 ? "+" : "−") + fmtARS(Math.abs(n));
const signedPct = (n: number) => (n >= 0 ? "+" : "−") + fmtPct(Math.abs(n * 100));

// "La cima" worked example: a very-high per-person income, used to show the percentile saturates.
const EXAMPLE_TOP_ARS = 100_000_000;

const state = {
  currency: "ARS" as "ARS" | "USD",
  hhIncomeARS: 1500000,
  people: 3,
  costRegion: "GBA" as string,
  costValues: {} as Record<string, number>,
  blue: null as BlueRate | null,
  geoView: "region" as "region" | "aglo",
};

let data: Artifact;

async function init() {
  data = await fetch("/percentiles.v1.json").then((r) => r.json());
  state.blue = await fetchBlue();
  // If the live blue rate is unavailable, keep the USD toggle disabled (ARS-only) so it can't
  // silently no-op on click.
  if (!state.blue) {
    const usdBtn = $("currency-toggle").querySelector<HTMLButtonElement>('[data-cur="USD"]');
    if (usdBtn) {
      usdBtn.disabled = true;
      usdBtn.title = "Cotización del dólar no disponible ahora";
    }
  }
  // Stateless: no params, no storage, no cookies. Strip any stray query string on load.
  if (location.search) history.replaceState(null, "", location.pathname);

  $("source-badge").innerHTML =
    `Datos: <strong>${data.source.period_label}</strong> · Encuesta Permanente de Hogares (INDEC) · ` +
    `microdatos verificados (sha ${data.source.sha256.slice(0, 8)})`;

  // Seed state from the rendered controls so the two can't drift (matches the HTML defaults).
  state.hhIncomeARS = parseMoney($<HTMLInputElement>("income-number").value) || state.hhIncomeARS;
  state.people = Math.max(1, parseInt($<HTMLInputElement>("hh-size").value || "1", 10));

  wireControls();
  setupSticky();
  renderMethodology();
  renderFooter();
  renderSplits();
  renderBlindspots();
  renderTimeSetup();
  syncInputs();
  renderAll();

  let t: number;
  window.addEventListener("resize", () => {
    clearTimeout(t);
    t = window.setTimeout(renderVisuals, 150);
  });

  // Re-render on light/dark theme switches so the charts pick up the new palette.
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => renderAll());
}

const measure = (): Measure => data.measures.ipcf;
const ipcf = (): number => state.hhIncomeARS / Math.max(1, state.people);

// ---------- controls ----------
function wireControls() {
  $("currency-toggle").querySelectorAll<HTMLButtonElement>(".seg-btn").forEach((btn) => {
    btn.onclick = () => {
      const cur = btn.dataset.cur as "ARS" | "USD";
      if (cur === "USD" && !state.blue) return;
      state.currency = cur;
      $("currency-toggle").querySelectorAll(".seg-btn").forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      $("cur-prefix").textContent = cur === "USD" ? "US$" : "$";
      syncInputs();
      renderAll();
    };
  });

  const num = $<HTMLInputElement>("income-number");
  num.addEventListener("input", () => {
    reformatWithCaret(num);
    const v = parseMoney(num.value);
    state.hhIncomeARS = state.currency === "USD" && state.blue ? v * state.blue.venta : v;
    renderAll();
  });
  num.addEventListener("blur", syncInputs);

  const hs = $<HTMLInputElement>("hh-size");
  hs.addEventListener("input", () => {
    state.people = Math.max(1, parseInt(hs.value || "1", 10));
    renderAll();
  });

  $<HTMLSelectElement>("cost-region").addEventListener("change", (e) => {
    state.costRegion = (e.target as HTMLSelectElement).value;
    state.costValues.alquiler = rentDefault(state.costRegion);
    renderCost();
    renderBuyingPower();
  });
  $<HTMLButtonElement>("cost-reset").onclick = () => {
    state.costRegion = "GBA";
    initCostValues();
    $<HTMLSelectElement>("cost-region").value = "GBA";
    renderCost();
    renderBuyingPower();
  };

  $("geo-toggle").querySelectorAll<HTMLButtonElement>(".seg-btn").forEach((btn) => {
    btn.onclick = () => {
      state.geoView = btn.dataset.geo as "region" | "aglo";
      $("geo-toggle").querySelectorAll(".seg-btn").forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      renderGeo();
    };
  });
}

function displayIncome(): string {
  const v = state.currency === "USD" && state.blue ? state.hhIncomeARS / state.blue.venta : state.hhIncomeARS;
  return fmtNum(v);
}
function syncInputs() {
  $<HTMLInputElement>("income-number").value = displayIncome();
}

// Re-format the income field with thousands separators while typing, keeping the caret in place.
// Exported for direct unit testing (the null-selectionStart fallback isn't reachable via jsdom events).
export function reformatWithCaret(input: HTMLInputElement) {
  const sel = input.selectionStart ?? input.value.length;
  const digitsBeforeCaret = input.value.slice(0, sel).replace(/\D/g, "").length;
  const digits = input.value.replace(/\D/g, "");
  const formatted = digits ? fmtNum(parseInt(digits, 10)) : "";
  input.value = formatted;
  let pos = 0;
  let seen = 0;
  while (pos < formatted.length && seen < digitsBeforeCaret) {
    const c = formatted.charCodeAt(pos);
    if (c >= 48 && c <= 57) seen++;
    pos++;
  }
  input.setSelectionRange(pos, pos);
}

// ---------- sticky bar ----------
function setupSticky() {
  const bar = $("sticky-bar");
  const headline = $("headline");
  const update = () => {
    bar.hidden = headline.getBoundingClientRect().bottom > 8;
  };
  window.addEventListener("scroll", update, { passive: true });
  update();
  bar.onclick = () => $("controls").scrollIntoView({ behavior: "smooth", block: "start" });
}
function renderSticky(v: number, pct: number) {
  $("sticky-bar").innerHTML =
    `<div class="sticky-inner"><span><strong>${fmtARS(v)}</strong> por persona · ` +
    `<strong>percentil ${Math.round(Math.min(99, pct))}</strong></span><span class="sticky-edit">Editar ↑</span></div>`;
}

// ---------- render ----------
function renderAll() {
  charts.refreshPalette();
  const v = ipcf();
  const pct = percentileOfIncome(measure(), v);
  renderHeadline(v, pct);
  renderClass(v);
  renderContext(v, pct);
  renderVistazoSynthesis(v);
  renderLadder(v, pct);
  renderMilestones(v, pct);
  renderDual(v);
  renderConcentration();
  renderCimaText(v, pct);
  $("cima-section").hidden = pct < 90; // "La cima" only matters once you're in the top 10%
  renderRegionsText(v);
  renderTrendsText();
  renderPoverty(v);
  renderCost();
  renderBuyingPower();
  updateTime();
  renderSticky(v, pct);
  renderVisuals();
}

function renderHeadline(v: number, pct: number) {
  const m = measure();
  const millones = fmtM(m.population / 1e6);

  $("per-person-val").textContent = fmtARS(v);
  $("per-person").innerHTML =
    `Lo comparamos con el ingreso por persona de ~${millones} millones de habitantes. ` +
    `<a class="subtle-link" href="#methodology">cómo se calcula</a>`;

  let headline: string;
  if (pct >= 99) headline = "Tu hogar está en el <strong>1% de mayores ingresos</strong> del país.";
  else if (pct < 1) headline = "Tu hogar está <strong>por debajo del percentil 1</strong>.";
  else headline = `Tu hogar está en el <strong>percentil ${Math.round(pct)}</strong>.`;

  const usd = state.blue && v > 0 ? `<span class="usd-eq">≈ ${fmtUSD(v / state.blue.venta)} al dólar blue</span>` : "";
  const deCada = Math.round(Math.min(99, Math.max(1, pct)));

  $("result").innerHTML = `
    <div class="pct-big">${deCada}<span>º percentil</span></div>
    <div class="pct-text">
      <p class="lead">${headline}</p>
      <p><strong>${deCada} de cada 100</strong> personas tienen un ingreso por persona menor al de tu hogar. ${usd}</p>
    </div>`;

  const decile = decileOf(pct);
  const masN = 100 - deCada;
  const vMenos = deCada === 1 ? "tiene" : "tienen";
  const vMas = masN === 1 ? "tiene" : "tienen";
  const multStr = (v / m.median).toLocaleString("es-AR", { maximumFractionDigits: 1 });
  // The mean sits well above the median, so an income can be above one and below the other.
  const vsBoth =
    v >= m.median && v >= m.mean ? "por encima de los dos" : v < m.median && v < m.mean ? "por debajo de los dos" : "entre la mediana y el promedio";
  $("headline-explain").innerHTML =
    `El <strong>percentil ${deCada}</strong> significa que, de cada 100 personas ordenadas por ingreso por persona, ` +
    `<strong>${deCada}</strong> ${vMenos} menos que tu hogar y <strong>${masN}</strong> ${vMas} más. ` +
    `Tu hogar cae en el <strong>decil ${decile} de 10</strong>.<br><br>` +
    `La <strong>mediana</strong> es el ingreso que deja a la mitad de la gente por debajo y a la otra mitad por encima: ` +
    `hoy son <strong>${fmtARS(m.median)}</strong> por persona. El <strong>promedio</strong> —lo que le tocaría a cada uno ` +
    `si se repartiera todo en partes iguales— da ${fmtARS(m.mean)}. ` +
    `Tu ingreso por persona (<strong>${fmtARS(v)}</strong>) está ${vsBoth}: equivale a ` +
    `<strong>${multStr} veces la mediana</strong> (${multStr} × ${fmtARS(m.median)} ≈ ${fmtARS(v)}). ` +
    `<span class="muted">El promedio es mayor que la mediana porque los ingresos más altos lo estiran hacia arriba.</span><br><br>` +
    `<span class="muted">Y es una <strong>estimación</strong> de una encuesta de ${fmtNum(m.n_unweighted)} hogares, no un padrón: tu percentil tiene un margen de ±${Math.max(1, Math.round(charts.percentileMargin(m, pct)))} punto${Math.max(1, Math.round(charts.percentileMargin(m, pct))) === 1 ? "" : "s"} (la franja sombreada en la regla de arriba).</span>`;
}

// Income "classes" by per-capita household income (IPCF). The two bottom bands use INDEC's
// official poverty lines (CBA/CBT); the middle/upper bands are relative to the median — the
// standard way to define income classes. Labeled as such in the UI.
function incomeClasses(m: Measure): IncomeClass[] {
  const med = m.median;
  const { cba_adulto_equiv: cba, cbt_adulto_equiv: cbt } = data.poverty_lines;
  return [
    { key: "indigencia", name: "Indigencia", short: "Indig.", phrase: "está en la indigencia", lo: 0, hi: cba, color: cssVar("--class-indigencia", "#7a1f1f"), desc: "el ingreso por persona no llega a la canasta alimentaria (no alcanza ni para comer)" },
    { key: "pobreza", name: "Pobreza", short: "Pobreza", phrase: "está en situación de pobreza", lo: cba, hi: cbt, color: cssVar("--class-pobreza", "#9a3b2e"), desc: "cubre la comida pero no la canasta básica total" },
    { key: "vulnerable", name: "Sectores vulnerables", short: "Vulnerable", phrase: "está en los sectores vulnerables", lo: cbt, hi: med, color: cssVar("--class-vulnerable", "#c0823a"), desc: "apenas sobre la línea de pobreza, todavía por debajo del ingreso típico" },
    { key: "media", name: "Clase media", short: "Media", phrase: "es de clase media", lo: med, hi: med * 2, color: cssVar("--class-media", "#5b86a8"), desc: "entre el ingreso típico (la mediana) y el doble" },
    { key: "media_alta", name: "Clase media-alta", short: "Media-alta", phrase: "es de clase media-alta", lo: med * 2, hi: med * 4, color: cssVar("--class-media-alta", "#2a5c8a"), desc: "entre 2 y 4 veces el ingreso típico" },
    { key: "alta", name: "Clase alta", short: "Alta", phrase: "es de clase alta", lo: med * 4, hi: Infinity, color: cssVar("--class-alta", "#16344f"), desc: "más de 4 veces el ingreso típico" },
  ];
}

// Exported for direct unit testing: with the real (tiling) income classes a match always exists,
// so the not-found fallback is only reachable with synthetic, gapped class lists.
export function classIndexOf(classes: IncomeClass[], v: number): number {
  const i = classes.findIndex((c) => v >= c.lo && v < c.hi);
  return i < 0 ? (v <= 0 ? 0 : classes.length - 1) : i;
}

function renderClass(v: number) {
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

function renderContext(v: number, pct: number) {
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
    `<div class="ctx-cell" title="${title}"><span class="ctx-label">${label}</span><strong class="ctx-value">${value}</strong><span class="ctx-sub">${sub}</span></div>`;

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

function renderVistazoSynthesis(v: number) {
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

function renderLadder(v: number, pct: number) {
  const m = measure();
  const decile = decileOf(pct);
  const ds = m.deciles;
  const maxShare = Math.max(...ds.map((d) => d.share));

  // gap chips
  const top10Entry = m.percentiles["90"];
  const chip = (txt: string) => `<span class="chip">${txt}</span>`;
  const chips: string[] = [];
  chips.push(v >= m.median ? chip(`${signedARS(v - m.median)} sobre la mediana`) : chip(`Te faltan ${fmtARS(m.median - v)} para la mediana`));
  if (decile < 10) chips.push(chip(`Te faltan ${fmtARS(Math.max(0, (ds[decile - 1].hasta ?? v) - v))} para el decil ${decile + 1}`));
  chips.push(v >= top10Entry ? chip("Estás en el 10% más rico") : chip(`Te faltan ${fmtARS(top10Entry - v)} para el 10% más rico`));
  $("gap-chips").innerHTML = chips.join("");

  const rows = ds
    .map((d) => {
      const isUser = d.decile === decile;
      const hasta = d.hasta === null ? "sin tope" : fmtARS(d.hasta);
      const barW = (d.share / maxShare) * 100;
      return `<tr class="${isUser ? "is-user" : ""}">
        <td>D${d.decile}${isUser ? ' <span class="you">vos</span>' : ""}</td>
        <td class="num">${hasta}</td>
        <td class="num">${fmtARS(d.mean)}</td>
        <td><div class="cell-share"><span>${d.share.toLocaleString("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</span><span class="cell-share-bar" style="width:${barW}%"></span></div></td>
        <td class="num">${fmtM(d.population / 1e6)}</td>
        <td class="num">${fmtX(d.mean / m.median)}</td>
      </tr>`;
    })
    .join("");

  $("ladder").innerHTML = `
    <table class="ladder">
      <thead><tr><th>Decil</th><th class="num">Hasta</th><th class="num">Ingreso medio</th><th>% del ingreso</th><th class="num">Pobl. (M)</th><th class="num">×mediana</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td>Total</td><td class="num">—</td><td class="num">${fmtARS(m.mean)}</td><td>100%</td><td class="num">${fmtM(m.population / 1e6)}</td><td class="num">—</td></tr></tfoot>
    </table>`;
  const ur = ds[decile - 1];
  const lower = decile > 1 ? ds[decile - 2].hasta ?? 0 : 0;
  const upper = ur.hasta === null ? "sin tope" : fmtARS(ur.hasta);
  $("ladder-explain").innerHTML =
    `Tu hogar cae en el <strong>decil ${decile}</strong>: ese grupo gana entre ${fmtARS(lower)} y ${upper} ` +
    `por persona, con un ingreso medio de <strong>${fmtARS(ur.mean)}</strong>, y concentra el ` +
    `<strong>${ur.share.toLocaleString("es-AR", { maximumFractionDigits: 1 })}%</strong> de todo el ingreso del país.`;
  $("foot-deciles").textContent = `Ingreso medio por decil (ingreso por persona del hogar). Tu decil en color. Fuente: ${data.source.period_label} (INDEC).`;
}

function renderMilestones(v: number, pct: number) {
  const m = measure();
  const N = state.people;
  const decile = decileOf(pct);
  const raw: { label: string; target: number | null }[] = [];
  if (decile < 10) raw.push({ label: `entrar al decil ${decile + 1}`, target: m.deciles[decile - 1].hasta });
  raw.push({ label: "igualar la mediana", target: m.median });
  raw.push({ label: "entrar al 10% más rico", target: m.percentiles["90"] });
  raw.push({ label: "entrar al 1% más alto", target: m.percentiles["99"] });

  const seen = new Set<number>();
  const items = raw
    .filter((x): x is { label: string; target: number } => x.target != null && x.target > v)
    .sort((a, b) => a.target - b.target)
    .filter((x) => {
      const k = Math.round(x.target);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

  // The steepness chart is drawn either way (renderVisuals), so caption it before the early
  // return — otherwise a household past every milestone gets an unlabelled chart.
  $("foot-steepness").innerHTML =
    `Cada barra es cuánto más de <strong>ingreso por persona</strong> separa un percentil del siguiente, cerca de tu posición (en azul). ` +
    `Hacia la derecha los escalones se agrandan: subir cerca de la cima cuesta mucho más que abajo. Fuente: ${data.source.period_label} (INDEC).`;

  if (!items.length) {
    $("milestones").innerHTML = `<p class="explain">Tu hogar ya superó todos los hitos que mide esta herramienta, hasta el <strong>1% más alto</strong>.</p>`;
    return;
  }
  $("milestones").innerHTML = items
    .map((x) => {
      const gap = x.target - v;
      return `<div class="ms-card">
        <span class="ms-to">para ${x.label}</span>
        <strong class="ms-gap">+${fmtARS(gap)}</strong>
        <span class="ms-sub">por persona · +${fmtARS(gap * N)} al hogar · llegar a ${fmtShort(x.target)}/p.</span>
      </div>`;
    })
    .join("");
}

function renderDual(v: number) {
  const ip = data.measures.ipcf;
  const ind = data.measures.individual;
  const ipcfPct = Math.round(percentileOfIncome(ip, v));
  const giniInd = ind.gini.toFixed(3);
  const giniIpcf = ip.gini.toFixed(3);

  $("dual-intro").innerHTML =
    `Hay dos formas de mirar tu ingreso. Una es el <strong>ingreso por persona del hogar</strong> (lo que venís ` +
    `viendo): suma todo lo que entra y lo divide por la gente que vive ahí. La otra es el <strong>sueldo individual</strong> ` +
    `de cada persona que cobra. No son lo mismo, y te ubican en lugares distintos.`;

  let personal: string;
  if (state.people === 1) {
    const indPct = Math.round(percentileOfIncome(ind, v));
    personal =
      `Como tu hogar es de <strong>1 persona</strong>, tu ingreso es también tu sueldo individual: ahí caés en el ` +
      `<strong>percentil ${indPct}</strong> de los perceptores (y en el <strong>percentil ${ipcfPct}</strong> por persona).`;
  } else {
    personal =
      `Tu hogar es de <strong>${state.people} personas</strong>, así que tu ingreso por persona no es el sueldo de nadie ` +
      `en particular: por eso te marcamos sólo en la distribución por persona (percentil <strong>${ipcfPct}</strong>).`;
  }

  $("dual-explain").innerHTML =
    `La distribución de <strong>sueldos individuales</strong> es más desigual que la de ingresos por persona ` +
    `(Gini <strong>${giniInd}</strong> vs <strong>${giniIpcf}</strong>): el hogar “reparte” lo que entra entre quienes no ` +
    `tienen ingreso propio (chicos, estudiantes, amas de casa, jubilados sin aporte). Por eso la <strong>mediana del sueldo ` +
    `individual</strong> (${fmtARS(ind.median)}) es bastante más alta que la del <strong>ingreso por persona</strong> ` +
    `(${fmtARS(ip.median)}): un sueldo lo cobra una sola persona; el ingreso por persona se diluye en todo el hogar. ${personal}`;

  $("dual-foot").innerHTML =
    `Sueldo individual = ingreso total individual (P47T) de perceptores, ponderado por PONDII (${fmtNum(ind.n_unweighted)} casos); ` +
    `ingreso por persona = IPCF, ponderado por PONDIH. Fuente: ${data.source.period_label} (INDEC).`;
}

// Structural splits + cohort comparator. Set up once (cohort control); panels render in renderVisuals.
function renderSplits() {
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

function updateCohort() {
  const inc = parseMoney($<HTMLInputElement>("cohort-income").value);
  const out = $("cohort-result");
  if (!inc) {
    out.innerHTML = `Ingresá tu <strong>sueldo individual</strong> para ubicarte entre los que cobran.`;
    return;
  }
  const natPct = Math.round(percentileOfIncome(data.measures.individual, inc));
  const sel = $<HTMLSelectElement>("cohort-group").value;
  if (sel === "all") {
    out.innerHTML = `Tu sueldo (<strong>${fmtARS(inc)}</strong>) está en el <strong>percentil ${natPct}</strong> entre todos los que cobran un ingreso.`;
    return;
  }
  const [dimKey, gKey] = sel.split(":");
  const dim = data.splits[dimKey];
  const g = dim?.groups.find((x) => x.key === gKey);
  if (!g) return;
  const gPct = Math.round(percentileOfIncome({ percentiles: g.percentiles } as unknown as Measure, inc));
  out.innerHTML =
    `Tu sueldo (<strong>${fmtARS(inc)}</strong>) está en el <strong>percentil ${gPct}</strong> entre <strong>${g.label.toLowerCase()}</strong> ` +
    `(${dim.label.toLowerCase()}), y en el <strong>percentil ${natPct}</strong> entre todos los que cobran.`;
}

function renderBlindspots() {
  const gap = data.measures.ipcf.population - data.measures.individual.population;
  const items = [
    `El “sueldo individual” deja afuera a <strong>~${fmtM(gap / 1e6)} millones</strong> de personas sin ingreso propio (chicos, estudiantes, jubilados sin aporte): cuentan en el ingreso por persona del hogar, no entre los perceptores.`,
    `La encuesta <strong>capta mal los ingresos más altos</strong> (subdeclaración) y la cola se corta cerca del percentil 99,9: la concentración real en la cima es <strong>mayor</strong> que la que se ve acá.`,
    `Es ingreso <strong>declarado</strong>: lo informal o “en negro” puede quedar por debajo de lo real.`,
    `Mide <strong>ingreso</strong> (lo que entra cada mes), no <strong>patrimonio</strong>: casas, autos y ahorros no cuentan.`,
    `El percentil tiene <strong>escalones</strong>: cerca de la mediana, $2.000 pueden cambiarte de puesto; arriba, los ingresos se declaran redondeados y millones casi no te mueven.`,
    `Cubre <strong>31 aglomerados urbanos</strong>: la EPH no releva zonas rurales.`,
  ];
  $("blindspots-list").innerHTML = items.map((x) => `<li>${x}</li>`).join("");
}

function renderConcentration() {
  const m = measure();
  const ds = m.deciles;
  const d1 = ds[0], d10 = ds[9];
  const bottom50 = ds.slice(0, 5).reduce((s, d) => s + d.share, 0);
  const ratioMeans = d10.mean / d1.mean;
  const skew = m.mean / m.median;

  // Inequality measures that complement the Gini, all exact functions of the same data.
  const sh = ds.map((d) => d.share);
  const palma = sh[9] / (sh[0] + sh[1] + sh[2] + sh[3]); // top 10% ÷ bottom 40%
  const s80s20 = (sh[8] + sh[9]) / (sh[0] + sh[1]); // top quintile ÷ bottom quintile
  const hoover = Math.max(...m.lorenz.map(([p, i]) => p - i)) * 100; // largest Lorenz gap
  const dec = (x: number) => x.toLocaleString("es-AR", { maximumFractionDigits: 1 });

  const row = (a: string, b: string) => `<li><span>${a}</span><strong>${b}</strong></li>`;
  const d10share = d10.share.toLocaleString("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const b50 = bottom50.toLocaleString("es-AR", { maximumFractionDigits: 1 });
  const skewPct = Math.round((skew - 1) * 100);
  $("concentration").innerHTML = `
    <ul class="concentration-list">
      ${row("El 10% más rico (decil 10) concentra", `${d10share}% del ingreso`)}
      ${row("La mitad más pobre (deciles 1 a 5), en cambio", `${b50}%`)}
      ${row("Brecha de ingresos medios entre el decil 10 y el decil 1", `${fmtX(ratioMeans)}`)}
      ${row("La media supera a la mediana en", `${fmtX(skew)} (cola de ingresos altos)`)}
    </ul>
    <p class="explain">
      En palabras: el <strong>decil 10</strong> —el 10% de mayores ingresos— se queda con el <strong>${d10share}%</strong> de
      toda la plata del país, mientras que la <strong>mitad más pobre</strong> (la mitad de la población) junta apenas el
      <strong>${b50}%</strong>. En promedio, ese decil más alto gana <strong>${fmtX(ratioMeans)}</strong> lo que el más bajo. Y como
      unos pocos ingresos muy altos “tiran” del promedio hacia arriba, la <strong>media</strong> (${fmtARS(m.mean)}) termina un
      <strong>${skewPct}%</strong> por encima de la <strong>mediana</strong> (${fmtARS(m.median)}); por eso, para describir “lo típico”,
      la mediana es más fiel que el promedio.
    </p>
    <p class="gini-line">El <strong>coeficiente de Gini</strong> resume toda esa desigualdad en un solo número de 0 a 1:
      <strong>0</strong> sería que todos ganan exactamente igual y <strong>1</strong>, que una sola persona se queda con todo.
      Argentina está hoy en <strong>${m.gini.toFixed(3)}</strong>
      <span class="muted">— una desigualdad alta (los países más parejos rondan 0,25–0,30).</span></p>
    <div class="context-strip">
      <div class="ctx-cell" title="Decil 10 dividido por los deciles 1 a 4">
        <span class="ctx-label">Índice de Palma</span><strong class="ctx-value">${dec(palma)}×</strong>
        <span class="ctx-sub">el 10% más rico gana ${dec(palma)} veces lo que el 40% más pobre</span></div>
      <div class="ctx-cell" title="Quintil más rico dividido por el más pobre">
        <span class="ctx-label">Brecha 20/20 (S80/S20)</span><strong class="ctx-value">${dec(s80s20)}×</strong>
        <span class="ctx-sub">el 20% de arriba gana ${dec(s80s20)} veces el 20% de abajo</span></div>
      <div class="ctx-cell" title="Mayor distancia entre la curva de Lorenz y la línea de igualdad">
        <span class="ctx-label">Índice de Hoover</span><strong class="ctx-value">${dec(hoover)}%</strong>
        <span class="ctx-sub">la parte del ingreso que habría que mover para que todos ganen igual</span></div>
    </div>
    <p class="foot">Tres miradas que complementan al Gini, sobre los mismos datos: <strong>Palma</strong> = decil 10 ÷ (deciles 1–4); <strong>20/20</strong> = quintil más rico ÷ quintil más pobre; <strong>Hoover</strong> = mayor brecha entre la curva de Lorenz y la igualdad perfecta.</p>`;

  charts.renderShareBar($("chart-share"), m, 0);
  $("share-caption").innerHTML =
    `Cada bloque es un decil (10% de la población); su ancho es su parte del ingreso total. ` +
    `El decil 10 se queda con el <strong>${d10.share.toLocaleString("es-AR", { maximumFractionDigits: 1 })}%</strong>.`;
}

function renderRegionsText(v: number) {
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
function renderGeo() {
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

const quarterLabel = (p: string) => {
  const [y, q] = p.split("-T");
  return `${q}º trim. ${y}`;
};

// "Tu ingreso, en el tiempo" — compare to past real medians + a future-inflation scenario.
function renderTimeSetup() {
  const sel = $<HTMLSelectElement>("time-quarter");
  sel.innerHTML = data.history.median_ipcf_quarterly.map((m) => `<option value="${m.period}">${quarterLabel(m.period)}</option>`).join("");
  $("time-intro").innerHTML =
    `El IPC permite comparar tu ingreso de hoy con la foto de cada trimestre, en pesos equivalentes —y estimar cuánto necesitarías para no perder contra la inflación.`;
  $("time-foot").innerHTML =
    `Deflactado con el IPC del INDEC (base ${data.history.cpi_base_label}). La inflación del próximo trimestre es un escenario que elegís vos, no un pronóstico. No comparamos tu percentil con el pasado: solo hay medianas históricas.`;
  const infl = $<HTMLInputElement>("time-infl");
  sel.addEventListener("change", updateTime);
  infl.addEventListener("input", () => {
    $("time-infl-out").textContent = `${infl.value}%`;
    updateTime();
  });
  updateTime();
}

function updateTime() {
  const v = ipcf();
  const H = state.hhIncomeARS;
  const idx = new Map(data.history.cpi_quarterly.map((c) => [c.period, c.index]));
  const medMap = new Map(data.history.median_ipcf_quarterly.map((m) => [m.period, m.median]));
  const qsel = $<HTMLSelectElement>("time-quarter").value;
  const ci = idx.get(qsel);
  const med = medMap.get(qsel);
  if (!ci || med == null) return;
  const realMed = (med * 100) / ci; // that quarter's median, in today's pesos
  const ratio = v / realMed;
  const infl = parseInt($<HTMLInputElement>("time-infl").value || "0", 10) / 100;
  const need = H * (1 + infl);
  $("time-result").innerHTML =
    `Tu ingreso por persona (<strong>${fmtARS(v)}</strong>, en pesos de hoy) equivale a <strong>${fmtX(ratio)}</strong> la mediana de ` +
    `${quarterLabel(qsel)} —que medida en pesos de hoy era <strong>${fmtARS(realMed)}</strong>—. ` +
    `Y si el próximo trimestre la inflación fuera <strong>${Math.round(infl * 100)}%</strong>, para no perder poder de compra lo que entra a tu hogar ` +
    `debería pasar de ${fmtARS(H)} a <strong>${fmtARS(need)}</strong>.`;
}

function renderTrendsText() {
  $("foot-trend").innerHTML =
    `Izq.: Gini del ingreso por persona, por trimestre. Der.: ` +
    `<span style="color:var(--pobre);font-weight:600">pobreza</span> e ` +
    `<span style="color:rgba(17,17,17,0.5);font-weight:600">indigencia</span> (% de personas), por semestre. ` +
    `Series oficiales de INDEC.`;
}

function renderCimaText(v: number, pct: number) {
  const m = measure();
  const p90 = m.percentiles["90"];
  const p99 = m.percentiles["99"];
  const p9999 = m.percentiles["99.99"];
  const mult = v / m.median;
  let where: string;
  if (pct < 90) where = `Tu hogar todavía no está en esa cima: estás en el percentil ${Math.round(pct)}.`;
  else if (v >= p99) where = `Tu hogar está dentro del <strong>1% más alto</strong>.`;
  else where = `Tu hogar está en el tramo alto del decil 10, aún por debajo del 1% más rico.`;
  $("cima-explain").innerHTML =
    `Dentro del 10% más rico hay tanta distancia como en buena parte del resto del país: el piso es ` +
    `${fmtARS(p90)} por persona, el 1% más alto arranca en ${fmtARS(p99)} y los ingresos más altos que ` +
    `mide la encuesta superan los ${fmtARS(p9999)}. ${where}<br><br>` +
    `Por eso el percentil “satura”: <strong>alguien con $15M y alguien con ${fmtShort(EXAMPLE_TOP_ARS)} figuran los dos como “top 1%”</strong>, ` +
    `aunque uno gane varias veces más que el otro. Lo que de verdad los separa no es el puesto —es la ` +
    `<strong>magnitud</strong>: cuántas veces el ingreso típico. Tu ingreso por persona es ` +
    `<strong>${mult.toLocaleString("es-AR", { maximumFractionDigits: 1 })}×</strong> la mediana ($${fmtNum(m.median)}); ` +
    `${fmtShort(EXAMPLE_TOP_ARS)} por persona serían unas <strong>${Math.round(EXAMPLE_TOP_ARS / m.median).toLocaleString("es-AR")}×</strong>.`;
}

function renderPoverty(v: number) {
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

function rentDefault(region: string): number {
  const c = data.cost_of_living;
  if (!c) return 0;
  return c.rent_by_region?.[region] ?? c.lines.find((l) => l.key === "alquiler")?.amount ?? 0;
}

function initCostValues() {
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

function renderCost() {
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
      (l) => `<tr title="${l.detail}  ·  Fuente: ${l.source}">
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
  const verdict =
    leftover >= 0
      ? `Tu ingreso del hogar (<strong>${fmtARS(H)}</strong>) cubre esa canasta <strong>${fmtX(ratio)}</strong>: te quedarían <strong>${fmtARS(leftover)}</strong> por mes para todo lo demás (ahorro, deudas, gustos).`
      : `Tu ingreso del hogar (<strong>${fmtARS(H)}</strong>) alcanza para el <strong>${Math.round(ratio * 100)}%</strong> de esa canasta: faltarían <strong>${fmtARS(-leftover)}</strong> por mes. Por eso muchos hogares recortan (alquiler más barato, salud pública, menos consumo).`;
  $("cost-analysis").innerHTML =
    `Esta canasta de gastos del hogar suma <strong>${fmtARS(total)}</strong> por mes. ${verdict}<br><br>` +
    `Para ubicarlo entre dos extremos: la <strong>línea de pobreza</strong> de tu hogar de ${N} ${N === 1 ? "persona" : "personas"} (lo mínimo para no ser pobre) es ~${fmtARS(cbtHogar)}. ` +
    `El <strong>salario mínimo</strong> (${fmtARS(c.reference_incomes.smvm)}) y la <strong>jubilación mínima</strong> (${fmtARS(c.reference_incomes.jubilacion_minima)}) no alcanzan ni para los gastos fijos de un hogar.`;

  charts.renderBudget($("chart-budget"), H, lines, N);
}

// Buying power: translate the household's monthly income into concrete, recognizable things.
function renderBuyingPower() {
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
  const cbtHogar = pl.cbt_adulto_equiv * state.people;
  tiles.push(tile(cnt(H / cbtHogar), `canastas básicas (hogar de ${state.people})`, `1 canasta ${fmtShort(cbtHogar)}`));
  if (c.reference_incomes?.smvm) tiles.push(tile(cnt(H / c.reference_incomes.smvm), "salarios mínimos", `SMVM ${fmtShort(c.reference_incomes.smvm)}`));
  const rent = rentDefault(state.costRegion);
  if (rent) tiles.push(tile(cnt(H / rent), `alquileres (${state.costRegion})`, `alquiler ${fmtShort(rent)}`));
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

function renderVisuals() {
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

function renderMethodology() {
  const ref = data.indec_reference_ipcf;
  const m = data.measures.ipcf;
  const ind = data.measures.individual;
  const pl = data.poverty_lines;
  const ok = (a: number, b: number, tol: number) => (Math.abs(a - b) / b <= tol ? "✓" : "✗");

  $("methodology-body").innerHTML = `
    <p>Casi todos los “calculadores de sueldo” inventan los números o los estiman a ojo. Acá se descargan
    los <strong>microdatos públicos de la Encuesta Permanente de Hogares</strong> (INDEC,
    ${data.source.period_label}) y se calcula la distribución del ingreso desde cero, con los ponderadores
    muestrales oficiales. Cada cifra se contrasta contra lo que el propio INDEC publicó.</p>

    <h3>Qué medimos</h3>
    <p>El <strong>ingreso por persona del hogar</strong> (IPCF): el ingreso total del hogar dividido por
    cuántas personas viven en él. Es la medida que usa INDEC para la distribución del ingreso y la pobreza,
    y permite comparar hogares de distinto tamaño. <span class="muted">Repartir el ingreso en partes iguales
    es la convención oficial; no implica que todos cobren lo mismo.</span></p>

    <h3>Cómo se calcula</h3>
    <ul>
      <li>Percentiles y deciles por CDF empírica ponderada, igual que INDEC.</li>
      <li>Gini a partir de la curva de Lorenz de los propios datos, no ajustado a una fórmula.</li>
      <li>Pobreza: tu ingreso por persona comparado con la Canasta Básica por adulto (CBA/CBT, ${pl.period_label}).
      <span class="muted">Simplificación: contamos a cada integrante como un adulto; en hogares con menores el
      umbral oficial es algo más bajo, porque la escala de INDEC pondera por edad.</span></li>
    </ul>

    <h3>Lo verificamos contra INDEC</h3>
    <p>Reproducimos las cifras publicadas por INDEC para el ingreso per cápita familiar (${data.source.period_label}):</p>
    <table class="val-table">
      <thead><tr><th>Indicador</th><th>INDEC</th><th>Nuestro cálculo</th><th></th></tr></thead>
      <tbody>
        <tr><td>Gini</td><td>${ref.gini}</td><td>${m.gini.toFixed(3)}</td><td>${ok(m.gini, ref.gini, 0.02)}</td></tr>
        <tr><td>Mediana</td><td>${fmtARS(ref.median)}</td><td>${fmtARS(m.median)}</td><td>${ok(m.median, ref.median, 0.02)}</td></tr>
        <tr><td>Media</td><td>${fmtARS(ref.mean)}</td><td>${fmtARS(m.mean)}</td><td>${ok(m.mean, ref.mean, 0.02)}</td></tr>
        <tr><td>Población</td><td>${fmtNum(ref.population)}</td><td>${fmtNum(m.population)}</td><td>${ok(m.population, ref.population, 0.01)}</td></tr>
      </tbody>
    </table>
    <p class="muted">Todos los límites de decil del informe oficial se reproducen al peso.</p>

    <details class="measure-details">
      <summary>Otra medida: ingreso individual (por perceptor)</summary>
      <p>Si en vez del hogar mirás a cada persona con ingresos (no por integrante), la base es de
      ${fmtNum(ind.n_unweighted)} casos (~${fmtM(ind.population / 1e6)} millones de perceptores):
      mediana <strong>${fmtARS(ind.median)}</strong>, media ${fmtARS(ind.mean)}, Gini ${ind.gini.toFixed(3)}.
      Es una pregunta distinta —“cuánto cobra una persona”— y por eso no la usamos como medida principal.</p>
    </details>

    <h3>Qué tener en cuenta</h3>
    <ul>
      <li>Los ingresos son <strong>nominales</strong> del mes relevado. La única serie ajustada por inflación es
      la “mediana en pesos de hoy”, deflactada con el IPC nivel general del INDEC (base ${data.history.cpi_base_label}).</li>
      <li>Se usa el <strong>4º trimestre</strong> porque no está inflado por el aguinaldo (a diferencia del 1º y 3º).</li>
      <li>Son ingresos <strong>declarados</strong> en una encuesta: los más altos suelen subdeclararse.</li>
      <li>Tu percentil es una <strong>estimación</strong> sobre la grilla de percentiles, no un padrón exacto.</li>
      <li>Cobertura: 31 aglomerados urbanos (la EPH no releva zonas rurales).</li>
    </ul>`;
}

function renderFooter() {
  const d = new Date(data.generated_at);
  $("site-footer").innerHTML = `
    <p>${data.citation}</p>
    <p class="muted">
      Base: ${data.source.file} · período ${data.source.period} · sha256 ${data.source.sha256.slice(0, 16)}… ·
      artefacto generado ${d.toLocaleDateString("es-AR")} ·
      <a href="${data.source.url}" rel="noopener">microdatos EPH (INDEC)</a>
    </p>`;
}

init();
