import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import indexHtml from "../index.html?raw";
import { ARTIFACT } from "./fixture";

const BLUE = { venta: 1450, fechaActualizacion: "2026-06-26" };
const bodyHtml = new DOMParser().parseFromString(indexHtml, "text/html").body.innerHTML;

interface BootOpts {
  artifact?: unknown;
  blue?: unknown | null;
  search?: string;
  presetIncome?: string; // set on the income field BEFORE init seeds state from the DOM
  presetPeople?: string; // set on the hh-size field BEFORE init
}

/** Mount the real index.html body, mock the two fetches, import main.ts (which auto-runs init), wait. */
async function boot(opts: BootOpts = {}) {
  const artifact = opts.artifact ?? ARTIFACT;
  const blue = opts.blue === undefined ? BLUE : opts.blue;
  document.body.innerHTML = bodyHtml;
  if (opts.presetIncome !== undefined) $i("income-number").value = opts.presetIncome;
  if (opts.presetPeople !== undefined) $i("hh-size").value = opts.presetPeople;
  window.history.replaceState(null, "", opts.search ?? "/");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (String(url).includes("dolarapi")) {
        if (blue === null) return { ok: false, json: async () => ({}) };
        return { ok: true, json: async () => blue };
      }
      return { ok: true, json: async () => artifact };
    }),
  );
  vi.resetModules();
  const M = await import("../src/main");
  await vi.waitFor(() => {
    if (!document.getElementById("result")?.innerHTML) throw new Error("init not done");
  });
  return M;
}

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const $i = (id: string) => document.getElementById(id) as HTMLInputElement;
function setVal(id: string, v: string) {
  const el = $i(id);
  el.value = v;
  el.dispatchEvent(new Event("input"));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("init smoke", () => {
  it("boots against the artifact and renders the headline + source badge", async () => {
    await boot();
    expect($("result").innerHTML).toContain("percentil");
    expect($("source-badge").innerHTML).toContain("Encuesta Permanente de Hogares");
    expect($("site-footer").innerHTML).toContain("EPH");
  });

  it("strips a stray query string on load", async () => {
    await boot({ search: "/?foo=bar" });
    expect(window.location.search).toBe("");
  });

  it("disables the USD toggle when the blue rate is unavailable", async () => {
    await boot({ blue: null });
    const usd = document.querySelector('[data-cur="USD"]') as HTMLButtonElement;
    expect(usd.disabled).toBe(true);
    // headline shows no USD equivalence line
    expect($("result").innerHTML).not.toContain("dólar blue");
  });

  it("tolerates a missing USD button when blue is unavailable", async () => {
    document.body.innerHTML = bodyHtml;
    document.querySelector('[data-cur="USD"]')?.remove();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        String(url).includes("dolarapi")
          ? { ok: false, json: async () => ({}) }
          : { ok: true, json: async () => ARTIFACT },
      ),
    );
    vi.resetModules();
    await import("../src/main");
    await vi.waitFor(() => {
      if (!$("result").innerHTML) throw new Error("nope");
    });
    expect($("result").innerHTML).toContain("percentil");
  });
});

describe("currency toggle", () => {
  it("switches to USD and back, reformatting the income field", async () => {
    await boot();
    (document.querySelector('[data-cur="USD"]') as HTMLButtonElement).click();
    expect($("cur-prefix").textContent).toBe("US$");
    expect($i("income-number").value).not.toBe("");
    setVal("income-number", "1000"); // interpreted as USD -> *venta
    expect($("result").innerHTML).toContain("percentil");
    (document.querySelector('[data-cur="ARS"]') as HTMLButtonElement).click();
    expect($("cur-prefix").textContent).toBe("$");
  });

  it("ignores a USD click when the blue rate is unavailable", async () => {
    await boot({ blue: null });
    const usd = document.querySelector('[data-cur="USD"]') as HTMLButtonElement;
    usd.disabled = false; // a disabled button wouldn't fire onclick — re-enable to reach the guard
    usd.click();
    expect($("cur-prefix").textContent).toBe("$"); // guard returns early, still ARS
  });
});

describe("household controls", () => {
  it("reacts to a household-size change and clamps blanks to 1", async () => {
    await boot();
    setVal("hh-size", "5");
    expect($("result").innerHTML).toContain("percentil");
    setVal("hh-size", ""); // -> "1"
    expect($("result").innerHTML).toContain("percentil");
  });
});

// Income bands (people=1 so ipcf === income), covering every status/class/headline branch.
async function bootSolo(income: number, opts: BootOpts = {}) {
  const M = await boot(opts);
  setVal("hh-size", "1");
  setVal("income-number", String(income));
  return M;
}

describe("income bands", () => {
  it("below p1 + indigence (pct<1)", async () => {
    await bootSolo(20000);
    expect($("result").innerHTML).toContain("percentil 1");
    expect($("poverty-line").innerHTML).toContain("indigencia");
    expect($("class-banner").innerHTML).toContain("Indigencia");
  });

  it("poverty band (between CBA and CBT)", async () => {
    await bootSolo(300000);
    expect($("poverty-line").innerHTML).toContain("Bajo la línea de pobreza");
    expect($("poverty-line").innerHTML).toContain("salir de la pobreza");
  });

  it("vulnerable band lands in decile 5 (milestone target dedup)", async () => {
    await bootSolo(420000);
    expect($("milestones").innerHTML).toContain("para");
    expect($("class-banner").innerHTML).toContain("vulnerable");
  });

  it("middle class above the median", async () => {
    await bootSolo(600000);
    expect($("poverty-line").innerHTML).toContain("Sobre la línea de pobreza");
    expect($("poverty-line").innerHTML).toContain("colchón");
  });

  it("top of decile 10 but below the 1% (cima shown)", async () => {
    await bootSolo(1300000);
    expect($("cima-section").hidden).toBe(false);
    expect($("cima-explain").innerHTML).toContain("decil 10");
    expect($("chart-tail").innerHTML).toContain("svg");
  });

  it("inside the 1% — all milestones passed, top class", async () => {
    await bootSolo(4000000);
    expect($("result").innerHTML).toContain("1%");
    expect($("milestones").innerHTML).toContain("superó todos");
    expect($("context-strip").innerHTML).toContain("En la cima");
    expect($("cima-explain").innerHTML).toContain("1% más alto");
  });

  it("captions the steepness chart when every milestone is passed on the first render", async () => {
    // straight into the top 1% (no earlier render to leave a caption behind): renderMilestones
    // returns early, but renderVisuals still draws #chart-steepness, so it needs its caption
    await boot({ presetIncome: "4000000", presetPeople: "1" });
    expect($("milestones").innerHTML).toContain("superó todos");
    expect($("chart-steepness").innerHTML).toContain("svg");
    expect($("foot-steepness").textContent).toContain("percentil");
  });

  it("places the income against the median AND the mean, not the median alone", async () => {
    // Default household: $1.500.000 / 3 = $500.000 per person, above the median ($450.000) but
    // below the mean ($635.996). The copy used to say "por encima de los dos" here.
    await boot();
    expect($("headline-explain").innerHTML).toContain("entre la mediana y el promedio");
    expect($("headline-explain").innerHTML).not.toContain("los dos");
    setVal("hh-size", "1");
    setVal("income-number", "1300000");
    expect($("headline-explain").innerHTML).toContain("por encima de los dos");
    setVal("income-number", "300000");
    expect($("headline-explain").innerHTML).toContain("por debajo de los dos");
  });

  it("counts the survey sample in persons, the unit n_unweighted is in", async () => {
    // measures.ipcf.n_unweighted counts rows of the individual base (31.690 persons in 11.628
    // households for 4T-2025); the copy used to call them "hogares".
    await boot();
    const n = ARTIFACT.measures.ipcf.n_unweighted.toLocaleString("es-AR");
    expect($("headline-explain").innerHTML).toContain(`${n} personas, no un padrón`);
    expect($("headline-explain").innerHTML).not.toContain("hogares, no un padrón");
  });

  it("cima copy when below the top 10%", async () => {
    await bootSolo(200000);
    expect($("cima-section").hidden).toBe(true);
  });
});

describe("one-person household", () => {
  it("marks the individual ruler and prefills the cohort income", async () => {
    // preset BEFORE init so renderSplits sees a 1-person household and prefills the cohort field
    await boot({ presetPeople: "1", presetIncome: "800000" });
    expect($("dual-explain").innerHTML).toContain("1 persona");
    expect($i("cohort-income").value).not.toBe("");
  });
});

describe("cohort comparator", () => {
  it("prompts, then ranks against all earners and within a group", async () => {
    const M = await boot();
    const sel = $i("cohort-group");
    setVal("cohort-income", ""); // empty -> prompt
    expect($("cohort-result").innerHTML).toContain("Ingresá");
    sel.value = "all";
    setVal("cohort-income", "900000");
    expect($("cohort-result").innerHTML).toContain("entre todos los que cobran");
    // pick a real group (first optgroup option)
    const opt = sel.querySelector("optgroup option") as HTMLOptionElement;
    sel.value = opt.value;
    sel.dispatchEvent(new Event("change"));
    expect($("cohort-result").innerHTML).toContain("percentil");
    void M;
  });

  it("returns early for an unknown group key, leaving the prior result", async () => {
    await boot();
    const sel = $i("cohort-group");
    // first produce a real result…
    sel.value = "all";
    setVal("cohort-income", "500000");
    expect($("cohort-result").innerHTML).toContain("percentil");
    // …then switch to an invalid group: updateCohort returns early, result is left untouched
    const o = document.createElement("option");
    o.value = "sexo:zzz";
    sel.appendChild(o);
    sel.value = "sexo:zzz";
    sel.dispatchEvent(new Event("change"));
    expect($("cohort-result").innerHTML).toContain("percentil");
  });
});

describe("geography toggle", () => {
  it("switches between aglomerados and regions", async () => {
    await boot();
    (document.querySelector('[data-geo="aglo"]') as HTMLButtonElement).click();
    expect($("geo-caption").textContent).toContain("aglomerado");
    (document.querySelector('[data-geo="region"]') as HTMLButtonElement).click();
    expect($("geo-caption").textContent).toContain("región");
  });

  it("spaces the aglomerado footnote around the city count", async () => {
    await boot();
    (document.querySelector('[data-geo="aglo"]') as HTMLButtonElement).click();
    expect($("foot-regions").textContent).toMatch(/sobre la mediana de \d+ de \d+ ciudades/);
  });
});

describe("cost & budget", () => {
  it("edits a cost line, changes region and resets", async () => {
    await boot();
    const inp = document.querySelector(".cost-input") as HTMLInputElement;
    inp.value = "999999";
    inp.dispatchEvent(new Event("input"));
    expect($("cost-grand-total").textContent).not.toBe("—");
    const region = $i("cost-region");
    region.value = "CABA";
    region.dispatchEvent(new Event("change"));
    (document.getElementById("cost-reset") as HTMLButtonElement).click();
    expect($("cost-region").innerHTML).toContain("Buenos Aires");
  });

  it("shows a deficit when costs exceed a low income", async () => {
    await bootSolo(150000);
    expect($("cost-analysis").innerHTML).toContain("faltarían");
  });

  it("shows a surplus when income covers the basket", async () => {
    await bootSolo(8000000);
    expect($("cost-analysis").innerHTML).toContain("quedarían");
  });
});

describe("time machine", () => {
  it("changes quarter and inflation", async () => {
    await boot();
    const q = $i("time-quarter");
    q.value = q.options[0].value;
    q.dispatchEvent(new Event("change"));
    setVal("time-infl", "12");
    expect($("time-infl-out").textContent).toBe("12%");
    expect($("time-result").innerHTML).toContain("mediana");
  });

  it("handles an empty inflation value", async () => {
    await boot();
    const infl = $i("time-infl");
    Object.defineProperty(infl, "value", { value: "", configurable: true });
    infl.dispatchEvent(new Event("input"));
    expect($("time-result").innerHTML).toContain("mediana");
  });
});

describe("window events", () => {
  it("hides/shows the sticky bar on scroll and scrolls up on click", async () => {
    await boot();
    const headline = $("headline");
    headline.getBoundingClientRect = () => ({ bottom: 100 }) as DOMRect;
    window.dispatchEvent(new Event("scroll"));
    expect($("sticky-bar").hidden).toBe(true);
    headline.getBoundingClientRect = () => ({ bottom: 0 }) as DOMRect;
    window.dispatchEvent(new Event("scroll"));
    expect($("sticky-bar").hidden).toBe(false);
    $("sticky-bar").click(); // scrollIntoView (polyfilled) — must not throw
  });

  it("re-renders visuals on resize (debounced)", async () => {
    await boot();
    window.dispatchEvent(new Event("resize"));
    await new Promise((r) => setTimeout(r, 200));
    expect($("chart-cdf").innerHTML).toContain("svg");
  });

  it("re-renders on a dark-mode change", async () => {
    let handler: (() => void) | undefined;
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener: (_: string, cb: () => void) => {
        handler = cb;
      },
    }));
    await boot();
    expect(handler).toBeTypeOf("function");
    handler?.();
    expect($("result").innerHTML).toContain("percentil");
  });
});

describe("artifact variants", () => {
  function craft(mut: (a: ReturnType<typeof structuredClone<typeof ARTIFACT>>) => void) {
    const a = structuredClone(ARTIFACT);
    mut(a);
    return a;
  }

  it("hides cost & buying sections when cost_of_living is absent", async () => {
    const a = craft((a) => {
      delete (a as { cost_of_living?: unknown }).cost_of_living;
    });
    const M = await boot({ artifact: a });
    expect($("cost-section").hidden).toBe(true);
    expect($("buying-section").hidden).toBe(true);
    // the cost controls stay wired — exercise the helpers' no-cost guards
    $i("cost-region").dispatchEvent(new Event("change")); // rentDefault(!c) -> 0
    (document.getElementById("cost-reset") as HTMLButtonElement).click(); // initCostValues(!c) -> return
    expect(M.effectiveCostLines()).toEqual([]); // effectiveCostLines(!c) -> []
    expect(M.recomputeBudget()).toBeUndefined(); // recomputeBudget(!c) -> early return
  });

  it("totals a persona-scoped, zero-amount basket (else-scope + zero-total branches)", async () => {
    const a = craft((a) => {
      a.cost_of_living.lines = a.cost_of_living.lines.map((l, i) => ({
        ...l,
        amount: 0,
        scope: i === 0 ? "persona" : l.scope, // one per-person line so the *N branch runs
      }));
      a.cost_of_living.rent_by_region = {} as never;
    });
    await boot({ artifact: a });
    expect($("cost-grand-total").textContent).toBe("$0"); // total === 0 -> ratio branch
  });

  it("omits the buying goods when none are present", async () => {
    const a = craft((a) => {
      delete (a.cost_of_living as { goods?: unknown }).goods;
    });
    await boot({ artifact: a });
    expect($("buying-grid").innerHTML).toContain("canastas");
  });

  it("renders the plural margin copy when sampling error exceeds a point", async () => {
    const a = craft((a) => {
      a.measures.ipcf.n_unweighted = 4; // tiny n -> wide margin -> "puntos"
    });
    await boot({ artifact: a });
    expect($("headline-explain").innerHTML).toContain("puntos");
  });

  it("tolerates trend periods missing from the CPI/SMVM series", async () => {
    const a = craft((a) => {
      const first = a.history.median_ipcf_quarterly[0].period;
      a.history.cpi_quarterly = a.history.cpi_quarterly.filter((c) => c.period !== first);
      a.history.smvm_quarterly = [{ period: "9999-T9", smvm: 1 }];
    });
    await boot({ artifact: a });
    expect($("foot-trend-smvm").innerHTML).toContain("salario mínimo");
  });

  it("keeps the real-terms median change invariant to the CPI base", async () => {
    await boot();
    const base = $("foot-trend-median").innerHTML;
    // Re-express the CPI series on another base (last quarter = 200 instead of 100). A change in
    // real terms must not move, so BOTH endpoints have to be deflated, not only the first one.
    const a = craft((a) => {
      a.history.cpi_quarterly = a.history.cpi_quarterly.map((c) => ({ ...c, index: c.index * 2 }));
    });
    await boot({ artifact: a });
    expect($("foot-trend-median").innerHTML).toBe(base);
  });

  it("skips the SMVM footnote when the series is empty", async () => {
    const a = craft((a) => {
      a.history.smvm_quarterly = [];
    });
    await boot({ artifact: a });
    expect($("foot-trend-median").innerHTML).toContain("mediana");
  });
  it("omits the SMVM cells when no reference income is present", async () => {
    const a = craft((a) => {
      a.cost_of_living.reference_incomes = {} as never;
    });
    await boot({ artifact: a });
    expect($("context-strip").innerHTML).not.toContain("salario mínimo");
  });

  it("renders a methodology mismatch mark when our figures diverge from INDEC", async () => {
    const a = craft((a) => {
      a.indec_reference_ipcf.gini = 0.9;
      a.indec_reference_ipcf.median = 1;
    });
    await boot({ artifact: a });
    expect($("methodology-body").innerHTML).toContain("✗");
  });

  it("falls back when a middle decile has no upper bound", async () => {
    const a = craft((a) => {
      a.measures.ipcf.deciles[5].hasta = null; // decile 6's upper bound
    });
    // income in decile 6 exercises the "gap chip" (ds[decile-1].hasta ?? v) + "sin tope" upper bound
    await bootSolo(500000, { artifact: a });
    expect($("ladder-explain").innerHTML).toContain("decil");
    // income in decile 7 exercises the lower-bound fallback (ds[decile-2].hasta ?? 0)
    await bootSolo(600000, { artifact: a });
    expect($("ladder-explain").innerHTML).toContain("decil");
  });

  it("handles a buying region with no rent and no live blue", async () => {
    const a = craft((a) => {
      a.cost_of_living.rent_by_region = {} as never;
      a.cost_of_living.lines = a.cost_of_living.lines.filter((l) => l.key !== "alquiler");
    });
    await boot({ artifact: a, blue: null });
    expect($("buying-grid").innerHTML).toContain("canastas");
  });
});

describe("misc branch coverage", () => {
  it("falls back to default state when the control fields are blank", async () => {
    await boot({ presetIncome: "", presetPeople: "" });
    expect($("result").innerHTML).toContain("percentil");
  });

  it("handles a cleared (zero) income", async () => {
    await boot();
    setVal("hh-size", "1");
    setVal("income-number", "0");
    expect($("vistazo-synthesis").innerHTML).toContain("resumen");
  });

  it("recomputeBudget tolerates a missing grand-total cell", async () => {
    const M = await boot();
    document.getElementById("cost-grand-total")?.remove();
    expect(M.recomputeBudget()).toBeUndefined(); // if(gt) false branch — no throw
  });

  it("returns early from updateTime for a quarter outside the CPI series", async () => {
    await boot();
    const q = $i("time-quarter");
    const before = $("time-result").innerHTML;
    const o = document.createElement("option");
    o.value = "9999-T9";
    q.appendChild(o);
    q.value = "9999-T9";
    q.dispatchEvent(new Event("change"));
    expect($("time-result").innerHTML).toBe(before); // unchanged: updateTime bailed
  });
});

describe("exported pure helpers", () => {
  it("classIndexOf falls back for gapped class lists", async () => {
    const M = await boot();
    const gapped = [
      { lo: 0, hi: 10 },
      { lo: 20, hi: 30 },
    ] as Parameters<typeof M.classIndexOf>[0];
    expect(M.classIndexOf(gapped, 15)).toBe(1); // not found, v>0 -> last
    expect(M.classIndexOf(gapped, -5)).toBe(0); // not found, v<=0 -> first
    expect(M.classIndexOf(gapped, 5)).toBe(0); // found
  });

  it("fmtPeople adapts units across magnitudes", async () => {
    const M = await boot();
    expect(M.fmtPeople(2_500_000)).toContain("M");
    expect(M.fmtPeople(4500)).toContain("mil");
    expect(M.fmtPeople(500)).toBe("menos de mil");
  });

  it("reformatWithCaret tolerates a null caret position", async () => {
    const M = await boot();
    const inp = document.createElement("input");
    inp.value = "1234567";
    Object.defineProperty(inp, "selectionStart", { value: null, configurable: true });
    M.reformatWithCaret(inp);
    expect(inp.value).toBe("1.234.567");
  });
});
