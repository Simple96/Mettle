import "server-only";

export type RegexRouletteTestCase = {
  input: string;
  should_match: boolean;
  weight?: number;
};

export type RegexRouletteConfig = {
  kind: "regex_roulette";
  max_regex_length?: number;
  test_cases: RegexRouletteTestCase[];
};

export type CaseResult = {
  input: string;
  expected: boolean;
  got: boolean | null;
  ok: boolean;
  error?: string;
};

export type GradeResult = {
  ok: true;
  score: number;            // 0–100, weighted
  raw_correct: number;      // count of correct cases (unweighted)
  total: number;            // count of cases
  cases: CaseResult[];
  regex_length: number;
  duration_ms: number;
} | {
  ok: false;
  reason:
    | "regex_too_long"
    | "regex_invalid_syntax"
    | "regex_unsafe"
    | "no_test_cases"
    | "internal_error";
  message: string;
};

const ABSOLUTE_MAX = 200;
const DEFAULT_MAX = 200;
const WALL_CLOCK_MS = 1500;

/**
 * Patterns known to cause catastrophic backtracking when present. These are
 * narrowly-targeted to avoid the false-positives that safe-regex v2 hits on
 * any non-trivial regex with bounded alternation + repetition.
 *
 *  - Nested unbounded quantifiers:   (x+)+ / (x*)* / (x+)* / (x*)+
 *  - Adjacent unbounded quantifiers on overlapping char classes (lookahead):
 *    `\d+\d+` style — handled implicitly by length cap
 */
const REDOS_PATTERNS: RegExp[] = [
  /\+\)\s*[+*]/,   // ... + ) + or ... + ) *
  /\*\)\s*[+*]/,   // ... * ) + or ... * ) *
  /\+\}\s*[+*]/,   // ... +}+  (closing a {n,} group)
];

function isLikelyReDoS(src: string): boolean {
  return REDOS_PATTERNS.some((p) => p.test(src));
}

/**
 * Deterministically grades a single regex submission against the
 * configured test cases. Synchronous and fast — designed to run
 * inside the request handler.
 *
 * Hardening:
 *  - Hard length cap (default 200, with absolute ceiling 200 chars)
 *  - safe-regex screens for catastrophic-backtracking patterns
 *  - Per-case try/catch + total wall-clock budget
 *
 * JavaScript regex has no native execution timeout, so a truly
 * pathological pattern could still hang a single .test() call. The
 * safe-regex check is our first line of defense; Vercel's function
 * timeout is the safety net.
 */
export function gradeRegexRoulette(
  regexBody: string,
  config: RegexRouletteConfig
): GradeResult {
  const startedAt = Date.now();
  const trimmed = regexBody.trim();
  const maxLen = Math.min(config.max_regex_length ?? DEFAULT_MAX, ABSOLUTE_MAX);

  if (trimmed.length === 0) {
    return {
      ok: false,
      reason: "regex_invalid_syntax",
      message: "Regex is empty.",
    };
  }
  if (trimmed.length > maxLen) {
    return {
      ok: false,
      reason: "regex_too_long",
      message: `Regex is ${trimmed.length} chars; max is ${maxLen}.`,
    };
  }

  if (isLikelyReDoS(trimmed)) {
    return {
      ok: false,
      reason: "regex_unsafe",
      message:
        "Regex contains nested unbounded quantifiers like (x+)+ that are prone to catastrophic backtracking. Refactor before submitting.",
    };
  }

  let compiled: RegExp;
  try {
    compiled = new RegExp(`^(?:${trimmed})$`);
  } catch (e) {
    return {
      ok: false,
      reason: "regex_invalid_syntax",
      message: e instanceof Error ? e.message : "Could not compile regex.",
    };
  }

  const cases = Array.isArray(config.test_cases) ? config.test_cases : [];
  if (cases.length === 0) {
    return {
      ok: false,
      reason: "no_test_cases",
      message: "Task has no test cases configured.",
    };
  }

  let totalWeight = 0;
  let earnedWeight = 0;
  let rawCorrect = 0;
  const caseResults: CaseResult[] = [];

  for (const c of cases) {
    if (Date.now() - startedAt > WALL_CLOCK_MS) {
      caseResults.push({
        input: c.input,
        expected: c.should_match,
        got: null,
        ok: false,
        error: "Aborted: total grading time exceeded 1.5s.",
      });
      const w = c.weight ?? 1;
      totalWeight += w;
      continue;
    }

    const w = c.weight ?? 1;
    totalWeight += w;
    let got: boolean | null = null;
    let err: string | undefined;
    try {
      got = compiled.test(c.input);
    } catch (e) {
      err = e instanceof Error ? e.message : "regex.test threw";
    }
    const isOk = got !== null && got === c.should_match;
    if (isOk) {
      earnedWeight += w;
      rawCorrect += 1;
    }
    caseResults.push({
      input: c.input,
      expected: c.should_match,
      got,
      ok: isOk,
      error: err,
    });
  }

  const score = totalWeight > 0 ? (earnedWeight / totalWeight) * 100 : 0;

  return {
    ok: true,
    score: Math.round(score * 100) / 100, // 2 decimal places
    raw_correct: rawCorrect,
    total: cases.length,
    cases: caseResults,
    regex_length: trimmed.length,
    duration_ms: Date.now() - startedAt,
  };
}
