// Methodology, footer and blind spots: rendered once from the artifact.
import { data } from "./app";
import { fmtARS, fmtMonth, fmtNum } from "./format";
import { $, fmtM } from "./ui";

export function renderBlindspots() {
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

export function renderMethodology() {
  const ref = data.indec_reference_ipcf;
  const m = data.measures.ipcf;
  const ind = data.measures.individual;
  const pl = data.poverty_lines;
  const ok = (a: number, b: number, tol: number) => (Math.abs(a - b) / b <= tol ? "✓" : "✗");
  const cpiCoverage = `IPC disponible hasta ${fmtMonth(data.cpi_monthly.months[data.cpi_monthly.months.length - 1].period)}`;

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
      <li>Los ingresos de la encuesta son <strong>nominales</strong> de ${pl.period_label}. El ingreso que escribís se lleva a
      pesos de ese mes con el IPC nivel general del INDEC, según el mes que elijas arriba
      (${cpiCoverage}; si tu ingreso es posterior, la inflación desde entonces no está descontada). Los gastos de
      “¿Llegás a fin de mes?” son precios actuales y se comparan con tu ingreso tal cual. La “mediana en pesos de hoy”
      usa la misma fuente (base ${data.history.cpi_base_label}).</li>
      <li>Se usa el último <strong>2º o 4º trimestre</strong> publicado (ahora, ${data.source.period_label}) porque esos no están inflados por el aguinaldo, a diferencia del 1º y el 3º.</li>
      <li>Son ingresos <strong>declarados</strong> en una encuesta: los más altos suelen subdeclararse.</li>
      <li>Tu percentil es una <strong>estimación</strong> sobre la grilla de percentiles, no un padrón exacto.</li>
      <li>Cobertura: 31 aglomerados urbanos (la EPH no releva zonas rurales).</li>
    </ul>`;
}

export function renderFooter() {
  const d = new Date(data.generated_at);
  $("site-footer").innerHTML = `
    <p>${data.citation}</p>
    <p class="muted">
      Base: ${data.source.file} · período ${data.source.period} · sha256 ${data.source.sha256.slice(0, 16)}… ·
      artefacto generado ${d.toLocaleDateString("es-AR")} ·
      <a href="${data.source.url}" rel="noopener">microdatos EPH (INDEC)</a>
    </p>`;
}
