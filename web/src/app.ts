// Shared page state: the loaded artifact, the user's inputs, and the income the distribution
// ranks (per person, brought back to the survey's reference month).
import type { Artifact, Measure } from "./types";
import type { BlueRate } from "./usd";

export const state = {
  currency: "ARS" as "ARS" | "USD",
  hhIncomeARS: 1500000,
  people: 3,
  costRegion: "GBA" as string,
  costValues: {} as Record<string, number>,
  blue: null as BlueRate | null,
  geoView: "region" as "region" | "aglo",
  incomeMonth: "", // the month the typed income is from; seeded from the artifact's newest CPI month
};

export let data: Artifact;

export function setData(d: Artifact): void {
  data = d;
}

export const measure = (): Measure => data.measures.ipcf;

export const nominalPerPerson = (): number => state.hhIncomeARS / Math.max(1, state.people);

/** The per-person income in pesos of the survey's reference month: what the distribution ranks. */
export const ipcf = (): number => nominalPerPerson() * deflator();

// The distribution holds nominal pesos of the survey's reference month (~October 2025 for a 4º
// trimestre). An income typed months later buys less per peso, so it is brought back to that month
// with the IPC before any lookup; otherwise a household at the then-median in May-2026 pesos read
// "percentil 58". Ratio of two index points, so the series' base is irrelevant.
export function deflator(): number {
  const c = data.cpi_monthly;
  const by = Object.fromEntries(c.months.map((m) => [m.period, m.index]));
  return by[c.reference_month] / by[state.incomeMonth];
}

export const sameMonthAsSurvey = (): boolean => state.incomeMonth === data.cpi_monthly.reference_month;
