import { describe, expect, it } from "vitest";
import { fmtARS, fmtMonth, fmtNum, fmtPct, fmtShort, fmtUSD, MESES, parseMoney } from "../src/format";

describe("fmtARS", () => {
  it("prefixes $ and groups thousands with es-AR dots", () => {
    expect(fmtARS(1234567)).toBe("$1.234.567");
  });
  it("rounds to whole pesos", () => {
    expect(fmtARS(1234.6)).toBe("$1.235");
    expect(fmtARS(1234.4)).toBe("$1.234");
  });
  it("handles zero", () => {
    expect(fmtARS(0)).toBe("$0");
  });
});

describe("fmtUSD", () => {
  it("prefixes US$ and rounds", () => {
    expect(fmtUSD(1000)).toBe("US$1.000");
    expect(fmtUSD(1234.5)).toBe("US$1.235");
  });
});

describe("fmtNum", () => {
  it("groups thousands without a currency prefix", () => {
    expect(fmtNum(1000000)).toBe("1.000.000");
    expect(fmtNum(42)).toBe("42");
  });
});

describe("fmtShort", () => {
  it("renders millions with one decimal (M branch)", () => {
    expect(fmtShort(1_500_000)).toBe("$1,5M");
    expect(fmtShort(2_000_000)).toBe("$2M");
  });
  it("renders thousands rounded (k branch)", () => {
    expect(fmtShort(120_000)).toBe("$120k");
    expect(fmtShort(1_000)).toBe("$1k");
  });
  it("renders sub-thousand values whole (else branch)", () => {
    expect(fmtShort(999)).toBe("$999");
    expect(fmtShort(0)).toBe("$0");
  });
});

describe("fmtPct", () => {
  it("defaults to one decimal", () => {
    expect(fmtPct(12.34)).toBe("12,3%");
  });
  it("honors an explicit decimal count", () => {
    expect(fmtPct(50, 0)).toBe("50%");
    expect(fmtPct(7.5, 2)).toBe("7,50%");
  });
});

describe("parseMoney", () => {
  it("strips dots and currency, keeping digits", () => {
    expect(parseMoney("790.000")).toBe(790000);
    expect(parseMoney("1.200.000")).toBe(1200000);
    expect(parseMoney("US$ 1.000")).toBe(1000);
    expect(parseMoney("790000")).toBe(790000);
  });
  it("returns 0 when there are no digits", () => {
    expect(parseMoney("")).toBe(0);
    expect(parseMoney("abc")).toBe(0);
  });
});

describe("fmtMonth", () => {
  it("spells the month in Spanish, lowercase, with the year", () => {
    expect(fmtMonth("2026-05")).toBe("mayo 2026");
    expect(fmtMonth("2025-10")).toBe("octubre 2025");
    expect(MESES).toHaveLength(12);
  });
});
