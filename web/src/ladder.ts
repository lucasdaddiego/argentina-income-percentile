// "Dónde estás": the decile ladder, the milestones, the two income measures, concentration and the top tail.
import * as charts from "./charts";
import { data, measure, state } from "./app";
import { fmtARS, fmtNum, fmtShort } from "./format";
import { decileOf, percentileOfIncome } from "./stats";
import { $, fmtM, fmtX, signedARS } from "./ui";

// "La cima" worked example: a very-high per-person income, used to show the percentile saturates.
const EXAMPLE_TOP_ARS = 100_000_000;

export function renderLadder(v: number, pct: number) {
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

export function renderMilestones(v: number, pct: number) {
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

export function renderDual(v: number) {
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

export function renderConcentration() {
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

export function renderCimaText(v: number, pct: number) {
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
