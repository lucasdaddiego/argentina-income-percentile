import "./styles.css";
import * as charts from "./charts";
import { renderBlindspots, renderFooter, renderMethodology } from "./about";
import { data, ipcf, measure, setData, state } from "./app";
import { initCostValues, renderBuyingPower, renderCost, rentDefault } from "./cost";
import { fmtMonth, fmtNum, parseMoney } from "./format";
import { renderGeo, renderRegionsText } from "./geo";
import { renderClass, renderContext, renderHeadline, renderSticky, renderVistazoSynthesis, setupSticky } from "./headline";
import { renderCimaText, renderConcentration, renderDual, renderLadder, renderMilestones } from "./ladder";
import { renderPoverty } from "./poverty";
import { renderSplits, updateCohort } from "./splits";
import { percentileOfIncome } from "./stats";
import { renderTimeSetup, renderTrendsText, updateTime } from "./time";
import { $, pressOnly, reformatWithCaret } from "./ui";
import { fetchBlue } from "./usd";
import { renderVisuals } from "./visuals";
// ?url makes Vite emit a content-hashed copy (/assets/percentiles.v1-<hash>.json) and return its
// URL, so a data refresh gets a new name and a long browser cache can never serve the old values.
import artifactUrl from "../public/percentiles.v1.json?url";

// Re-exported for the tests, which import the page through its entry point.
export { effectiveCostLines, recomputeBudget } from "./cost";
export { classIndexOf } from "./classes";
export { fmtPeople, reformatWithCaret } from "./ui";

async function init() {
  try {
    const res = await fetch(artifactUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    setData(await res.json());
  } catch {
    $("source-badge").textContent = "No se pudieron cargar los datos. Recargá la página.";
    return;
  }
  // The USD toggle needs the live blue, which lands after the first paint (below): disabled till then.
  const usdBtn = $("currency-toggle").querySelector<HTMLButtonElement>('[data-cur="USD"]');
  if (usdBtn) {
    usdBtn.disabled = true;
    usdBtn.title = "Buscando la cotización del dólar…";
  }
  // Stateless: no params, no storage, no cookies. Strip any stray query string on load.
  if (location.search) history.replaceState(null, "", location.pathname);

  $("source-badge").innerHTML =
    `Datos: <strong>${data.source.period_label}</strong> · Encuesta Permanente de Hogares (INDEC) · ` +
    `microdatos verificados (sha ${data.source.sha256.slice(0, 8)})`;

  // Seed state from the rendered controls so the two can't drift (matches the HTML defaults).
  state.hhIncomeARS = parseMoney($<HTMLInputElement>("income-number").value) || state.hhIncomeARS;
  state.people = Math.max(1, parseInt($<HTMLInputElement>("hh-size").value || "1", 10));
  state.incomeMonth = data.cpi_monthly.months[data.cpi_monthly.months.length - 1].period;

  renderMonthSetup();
  wireControls();
  setupSticky();
  renderMethodology();
  renderFooter();
  renderSplits();
  renderBlindspots();
  renderTimeSetup();
  syncInputs();
  renderAll();

  // The live blue decorates an already-complete page (the USD line in the headline, the dollar
  // tile, the USD toggle). Awaiting it before rendering would let a stalled dolarapi.com
  // (connected but never answering, so the catch in usd.ts never fires) hold the whole page blank
  // until the browser's own network timeout. Decorate afterwards instead.
  void fetchBlue().then((blue) => {
    state.blue = blue;
    if (!usdBtn) return;
    if (blue) {
      usdBtn.disabled = false;
      usdBtn.title = "";
      renderAll();
    } else {
      // Keep the toggle disabled (ARS-only) so it can't silently no-op on click.
      usdBtn.title = "Cotización del dólar no disponible ahora";
    }
  });

  let t: number;
  window.addEventListener("resize", () => {
    clearTimeout(t);
    t = window.setTimeout(renderVisuals, 150);
  });

  // Re-render on light/dark theme switches so the charts pick up the new palette.
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => renderAll());
}

function renderMonthSetup() {
  const sel = $<HTMLSelectElement>("income-month");
  sel.innerHTML = data.cpi_monthly.months.map((m) => `<option value="${m.period}">${fmtMonth(m.period)}</option>`).join("");
  sel.value = state.incomeMonth;
  sel.addEventListener("change", () => {
    state.incomeMonth = sel.value;
    renderAll();
    updateCohort();
  });
}

// ---------- controls ----------
function wireControls() {
  $("currency-toggle").querySelectorAll<HTMLButtonElement>(".seg-btn").forEach((btn) => {
    btn.onclick = () => {
      const cur = btn.dataset.cur as "ARS" | "USD";
      if (cur === "USD" && !state.blue) return;
      state.currency = cur;
      pressOnly($("currency-toggle"), btn);
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
      pressOnly($("geo-toggle"), btn);
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

init();
