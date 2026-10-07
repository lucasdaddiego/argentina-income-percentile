// Mirrors the pipeline artifact (schema_version 1).

export interface Decile {
  decile: number;
  hasta: number | null;
  mean: number;
  share: number;
  population: number;
}

export interface Histogram {
  edges: number[];
  counts: number[];
  cap_quantile: number;
  note: string;
}

export interface Measure {
  key: "individual" | "ipcf";
  label: string;
  short: string;
  universe: string;
  value_col: string;
  weight: string;
  n_unweighted: number;
  population: number;
  mean: number;
  median: number;
  gini: number;
  cap: number;
  percentiles: Record<string, number>;
  deciles: Decile[];
  histogram: Histogram;
  lorenz: [number, number][];
}

export interface PovertyLines {
  period: string;
  period_label: string;
  source: string;
  cba_adulto_equiv: number;
  cbt_adulto_equiv: number;
}

export interface IncomeClass {
  key: string;
  name: string;
  short: string;
  desc: string;
  phrase: string; // reads after "tu hogar …", e.g. "es de clase media"
  lo: number;
  hi: number; // Infinity for the open-ended top class
  color: string;
}

export interface SplitGroup {
  key: string;
  label: string;
  median: number;
  mean: number;
  p25: number;
  p75: number;
  n: number;
  population: number;
  percentiles: Record<string, number>;
}

export interface SplitDim {
  label: string;
  groups: SplitGroup[];
}

export type Splits = Record<string, SplitDim>;

export interface IndecReference {
  gini: number;
  mean: number;
  median: number;
  population: number;
  d10_d1_median_gap: number;
  deciles: { decile: number; hasta: number | null; mean: number; share: number }[];
}

export interface Artifact {
  schema_version: number;
  generated_at: string;
  currency: string;
  hero_measure: "individual" | "ipcf";
  source: {
    survey: string;
    period: string;
    period_label: string;
    file: string;
    sha256: string;
    url: string;
  };
  measures: { individual: Measure; ipcf: Measure };
  regions: Region[];
  aglomerados: Aglomerado[];
  splits: Splits;
  poverty_lines: PovertyLines;
  indec_reference_ipcf: IndecReference;
  history: History;
  cpi_monthly: CpiMonthly;
  cost_of_living: CostOfLiving;
  citation: string;
}

/** Monthly CPI (ratio use only) to bring a typed income back to the survey's reference month. */
export interface CpiMonthly {
  reference_month: string; // the month the survey's incomes refer to (= poverty_lines.period)
  reference_label: string;
  source: string;
  months: { period: string; index: number }[]; // contiguous, from reference_month onward
}

export interface CostLine {
  key: string;
  label: string;
  amount: number;
  amount_caba?: number;
  optional?: boolean;
  scope: "hogar" | "persona";
  detail: string;
  source: string;
  confidence: string;
}

export interface Good {
  key: string;
  label: string;
  unit: string;
  price: number;
  source: string;
  confidence: string;
}

export interface CostOfLiving {
  period_label: string;
  lines: CostLine[];
  rent_by_region: Record<string, number>;
  floor: { label: string; amount: number; detail: string; source: string; confidence: string };
  reference_incomes: { smvm: number; jubilacion_minima: number; notes: string };
  goods: Good[];
  caveats: string[];
}

export interface Region {
  code: number;
  name: string;
  median: number;
  mean: number;
  population: number;
  n_unweighted: number;
}

export interface Aglomerado {
  code: number;
  name: string;
  median: number;
  mean: number;
  p25: number;
  p75: number;
  population: number;
  n_unweighted: number;
}

export interface History {
  gini_quarterly: { period: string; gini: number }[];
  poverty_semestral: { period: string; poverty_pct: number; indigence_pct: number }[];
  median_ipcf_quarterly: { period: string; median: number }[];
  cpi_quarterly: { period: string; index: number }[];
  cpi_base_label: string;
  smvm_quarterly: { period: string; smvm: number }[];
}
