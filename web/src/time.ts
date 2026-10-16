// "Tu ingreso, en el tiempo" and the trend captions.
import { data, ipcf, state } from "./app";
import { fmtARS } from "./format";
import { $, fmtX } from "./ui";

const quarterLabel = (p: string) => {
  const [y, q] = p.split("-T");
  return `${q}º trim. ${y}`;
};

// "Tu ingreso, en el tiempo" — compare to past real medians + a future-inflation scenario.
export function renderTimeSetup() {
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

export function updateTime() {
  const v = ipcf();
  const H = state.hhIncomeARS;
  const idx = new Map(data.history.cpi_quarterly.map((c) => [c.period, c.index]));
  const medMap = new Map(data.history.median_ipcf_quarterly.map((m) => [m.period, m.median]));
  const qsel = $<HTMLSelectElement>("time-quarter").value;
  const ci = idx.get(qsel);
  const med = medMap.get(qsel);
  if (!ci || med == null) return;
  // That quarter's median in pesos of the CPI base quarter: the series ends there, so later inflation
  // (between the base and the day the user's income is from) is not in this comparison.
  const realMed = (med * 100) / ci;
  const base = data.history.cpi_base_label;
  const ratio = v / realMed;
  const infl = parseInt($<HTMLInputElement>("time-infl").value || "0", 10) / 100;
  const need = H * (1 + infl);
  $("time-result").innerHTML =
    `Tu ingreso por persona (<strong>${fmtARS(v)}</strong>) equivale a <strong>${fmtX(ratio)}</strong> la mediana de ` +
    `${quarterLabel(qsel)} —que medida en pesos del ${base} era <strong>${fmtARS(realMed)}</strong>—. ` +
    `Y si el próximo trimestre la inflación fuera <strong>${Math.round(infl * 100)}%</strong>, para no perder poder de compra lo que entra a tu hogar ` +
    `debería pasar de ${fmtARS(H)} a <strong>${fmtARS(need)}</strong>.<br>` +
    `<span class="muted">Tu ingreso ya está llevado a pesos de ${data.cpi_monthly.reference_label} (el mes de la encuesta, dentro del ${base}), así que la comparación es en pesos equivalentes.</span>`;
}

export function renderTrendsText() {
  $("foot-trend").innerHTML =
    `Izq.: Gini del ingreso por persona, por trimestre. Der.: ` +
    `<span style="color:var(--pobre);font-weight:600">pobreza</span> e ` +
    `<span style="color:rgba(17,17,17,0.5);font-weight:600">indigencia</span> (% de personas), por semestre. ` +
    `Series oficiales de INDEC.`;
}
