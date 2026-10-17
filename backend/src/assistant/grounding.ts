/**
 * Grounding check: every number in the assistant's answer must come from the
 * data the tools returned in this conversation (or from the question itself,
 * or today's date). Formatting differences are tolerated: thousands
 * separators, a trailing %, rounding to fewer decimals, and a 0-1 share
 * written as a percentage (0.875 → 87.5).
 *
 * Limitation: small whole numbers (1-31) usually appear somewhere in the data
 * (dates, counts), so the check is strongest for quantities and totals.
 */

const NUMBER = /\d+(?:[.,]\d+)*/g;

/** Numbers written in `text`; "1,250.5" → 1250.5, "MAT-007" → 7, "2026-10-17" → 2026, 10, 17. */
export function numbersIn(text: string): number[] {
  const out: number[] = [];
  for (const token of text.match(NUMBER) ?? []) {
    // "1,250" / "1,25,000" are thousands separators; anything else with a
    // comma is a list ("3,4") and is split.
    const normalised = /^\d{1,3}(,\d{2,3})+(\.\d+)?$/.test(token) ? token.replace(/,/g, '') : token;
    for (const part of normalised.split(',')) {
      const n = Number.parseFloat(part);
      if (Number.isFinite(n)) out.push(n);
    }
  }
  return out;
}

function decimals(token: number): number {
  const s = String(token);
  const dot = s.indexOf('.');
  return dot === -1 ? 0 : s.length - dot - 1;
}

/** True when `n` is `t` written at n's precision (or a 0-1 share t written as a percentage). */
function matchesEvidence(n: number, evidence: number[]): boolean {
  const tolerance = 0.5 * 10 ** -decimals(n) + 1e-9;
  return evidence.some((t) => {
    if (Math.abs(t - n) <= tolerance) return true;
    return t > 0 && t <= 1 && Math.abs(t * 100 - n) <= tolerance;
  });
}

export interface GroundingResult {
  grounded: boolean;
  /** Numbers in the answer that no evidence supports. */
  unsupported: number[];
}

export function checkGrounding(answer: string, evidenceTexts: string[]): GroundingResult {
  const evidence = evidenceTexts.flatMap(numbersIn);
  const unsupported = numbersIn(answer).filter((n) => !matchesEvidence(n, evidence));
  return { grounded: unsupported.length === 0, unsupported };
}
