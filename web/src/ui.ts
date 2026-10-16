// DOM and formatting helpers shared by the page sections.
import { fmtARS, fmtNum, fmtPct } from "./format";

export const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// Read a CSS custom property off :root (resolves to the active light/dark theme).
export const cssVar = (name: string, fallback: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

export const fmtM = (x: number) => x.toLocaleString("es-AR", { maximumFractionDigits: 1 });

export const fmtX = (x: number) => x.toLocaleString("es-AR", { maximumFractionDigits: 2 }) + "×";

// People counts with adaptive units, so small-but-nonzero numbers never read as "0 M".
// Exported for direct unit testing (the "menos de mil" branch isn't reachable via real population).
export const fmtPeople = (n: number) =>
  n >= 1e6 ? `${fmtM(n / 1e6)} M` : n >= 1e3 ? `~${Math.round(n / 1e3).toLocaleString("es-AR")} mil` : "menos de mil";

export const signedARS = (n: number) => (n >= 0 ? "+" : "−") + fmtARS(Math.abs(n));

export const signedPct = (n: number) => (n >= 0 ? "+" : "−") + fmtPct(Math.abs(n * 100));

// For attribute contexts (title="…"): artifact strings land there verbatim, and one `"` would end
// the attribute early.
export const escAttr = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** Mark `btn` as the pressed option of a segmented toggle (the class and aria-pressed together). */
export function pressOnly(group: HTMLElement, btn: HTMLButtonElement) {
  group.querySelectorAll(".seg-btn").forEach((b) => {
    b.classList.remove("is-active");
    b.setAttribute("aria-pressed", "false");
  });
  btn.classList.add("is-active");
  btn.setAttribute("aria-pressed", "true");
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
