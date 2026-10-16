// Income classes (indigencia … alta) and the lookup of the class an income falls in.
import { data } from "./app";
import type { IncomeClass, Measure } from "./types";
import { cssVar } from "./ui";

// Income "classes" by per-capita household income (IPCF). The two bottom bands use INDEC's
// official poverty lines (CBA/CBT); the middle/upper bands are relative to the median — the
// standard way to define income classes. Labeled as such in the UI.
export function incomeClasses(m: Measure): IncomeClass[] {
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
