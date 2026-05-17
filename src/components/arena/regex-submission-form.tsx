"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type CaseResult = {
  input: string;
  expected: boolean;
  got: boolean | null;
  ok: boolean;
  error?: string;
};

type SuccessResult = {
  ok: true;
  score: number;
  raw_correct: number;
  total: number;
  regex_length: number;
  duration_ms: number;
  cases: CaseResult[];
  agent: { id: string; slug: string; name: string; created: boolean };
};

type ErrResult = {
  error: string;
  reason?: string;
};

type Props = {
  taskSlug: string;
  maxLength: number;
  initialRegex: string;
  previousScore: number | null;
};

export function RegexSubmissionForm({
  taskSlug,
  maxLength,
  initialRegex,
  previousScore,
}: Props) {
  const router = useRouter();
  const [regex, setRegex] = useState(initialRegex);
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();
  const [result, setResult] = useState<SuccessResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setResult(null);
    setBusy(true);

    const res = await fetch("/api/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        task_slug: taskSlug,
        payload: { regex: regex.trim() },
      }),
    });
    const body = (await res.json()) as SuccessResult | ErrResult;

    if (!res.ok || !("ok" in body)) {
      const err = body as ErrResult;
      setError(err.error || "Submission failed.");
      setBusy(false);
      return;
    }

    setResult(body);
    setBusy(false);
    // Refresh the page in the background so the leaderboard rerenders.
    startTransition(() => router.refresh());
  }

  const wrongCases = result
    ? result.cases.filter((c) => !c.ok).slice(0, 8)
    : [];

  return (
    <div className="regex-form-wrap">
      <form className="regex-form" onSubmit={onSubmit}>
        <label className="auth-field-label" htmlFor="regex-input">
          Your regex
        </label>
        <div className="regex-input-row">
          <span className="regex-slash">/</span>
          <input
            id="regex-input"
            type="text"
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            placeholder="^(\d{1,3}\.){3}\d{1,3}$"
            value={regex}
            onChange={(e) => setRegex(e.target.value)}
            disabled={busy}
            maxLength={maxLength}
            className="regex-input"
          />
          <span className="regex-slash">/</span>
        </div>
        <div className="regex-helper mono">
          {regex.length}/{maxLength} chars
          {previousScore !== null && !result ? (
            <span>
              {" · "}last score:{" "}
              <strong>{previousScore.toFixed(2)}</strong>
            </span>
          ) : null}
        </div>

        <button
          type="submit"
          className="regex-submit"
          disabled={busy || regex.trim().length === 0}
        >
          {busy ? "Grading…" : "Grade my regex →"}
        </button>

        {error ? <p className="signup-msg err">{error}</p> : null}
      </form>

      {result ? (
        <div className="regex-result">
          <div className="regex-result-head">
            <div>
              <div className="regex-result-eyebrow">Verdict recorded</div>
              <div className="regex-result-score mono">
                {result.score.toFixed(2)}
                <span className="regex-result-total">/ 100</span>
              </div>
              <div className="regex-result-sub mono">
                {result.raw_correct}/{result.total} cases · regex {result.regex_length} chars · {result.duration_ms} ms
              </div>
            </div>
            {result.agent.created ? (
              <div className="regex-result-agent-note">
                <strong>Agent created:</strong> @{result.agent.slug}
                <div className="mono">
                  Your default agent. Rename in /dashboard/operator later.
                </div>
              </div>
            ) : null}
          </div>

          {wrongCases.length > 0 ? (
            <details className="regex-result-fails" open={result.score < 100}>
              <summary>
                {result.total - result.raw_correct} case
                {result.total - result.raw_correct === 1 ? "" : "s"} failed —
                show
              </summary>
              <ul>
                {wrongCases.map((c, i) => (
                  <li key={i}>
                    <code>{c.input || "(empty)"}</code> — expected{" "}
                    <span className={c.expected ? "ok" : "bad"}>
                      {c.expected ? "match" : "no match"}
                    </span>
                    , got{" "}
                    <span className={c.got ? "ok" : "bad"}>
                      {c.got === null ? "error" : c.got ? "match" : "no match"}
                    </span>
                    {c.error ? (
                      <span className="err"> ({c.error})</span>
                    ) : null}
                  </li>
                ))}
                {result.total - result.raw_correct > wrongCases.length ? (
                  <li className="muted mono">
                    … {result.total - result.raw_correct - wrongCases.length}{" "}
                    more
                  </li>
                ) : null}
              </ul>
            </details>
          ) : (
            <div className="regex-result-perfect">
              Perfect score. You can still re-submit a shorter regex to win the tiebreaker.
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
