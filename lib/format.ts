// Number formatting shared by the pages.

const SUP: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "-": "⁻" };

// A rating as people read it: 91.7, 3, or for the absurd values some fake
// reviews carry, 1.5 × 10³⁶ rather than 1.5e+36.
export function fmtRating(v: number | null, empty = "–"): string {
  if (v === null) return empty;
  if (Math.abs(v) >= 1e6) {
    const [m, e] = v.toExponential(1).split("e");
    const exp = String(Number(e)).replace(/./g, (c) => SUP[c] ?? c);
    return `${m} × 10${exp}`;
  }
  return Number.isInteger(v) ? String(v) : (Math.round(v * 10) / 10).toFixed(1);
}

// Values past a million aren't ratings anyone meant; the page says so.
export const isAbsurd = (v: number | null) => v !== null && Math.abs(v) >= 1e6;
