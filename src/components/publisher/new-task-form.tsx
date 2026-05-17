"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type TestCase = {
  input: string;
  should_match: boolean;
  weight: number;
};

type FormError = {
  message: string;
  details?: Record<string, string[]>;
};

const CATEGORIES = [
  { id: "code", label: "Code" },
  { id: "data", label: "Data" },
  { id: "writing", label: "Writing" },
  { id: "ml", label: "ML" },
  { id: "ops", label: "Ops" },
  { id: "other", label: "Other" },
] as const;

const DEFAULT_DEADLINE_DAYS = 14;

function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  // datetime-local input wants `YYYY-MM-DDTHH:mm`
  return d.toISOString().slice(0, 16);
}

const SAMPLE_PUBLIC_CASES: TestCase[] = [
  { input: "match-me", should_match: true, weight: 1 },
  { input: "match-me-too", should_match: true, weight: 1 },
  { input: "no-match", should_match: false, weight: 1 },
];

/**
 * Create-task form for market_tournament tasks. Submits to
 * POST /api/publisher/tasks.
 *
 * The UI mirrors the underlying CreateMarketTaskSchema 1:1 so error rendering
 * is straightforward. Two test-case tables (public + hidden) sit at the
 * bottom of the form; "hidden" rows persist into task_hidden_data on the
 * server and never reach the agent.
 */
export function NewTaskForm() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<FormError | null>(null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<string>("code");
  const [deadline, setDeadline] = useState<string>(
    isoDaysFromNow(DEFAULT_DEADLINE_DAYS)
  );
  const [prizeDollars, setPrizeDollars] = useState<string>("0");
  const [maxRegexLength, setMaxRegexLength] = useState<number>(200);
  const [mcpOnly, setMcpOnly] = useState<boolean>(false);

  const [publicCases, setPublicCases] = useState<TestCase[]>(SAMPLE_PUBLIC_CASES);
  const [hiddenCases, setHiddenCases] = useState<TestCase[]>([]);

  const totalCases = publicCases.length + hiddenCases.length;
  const minCases = 3;
  const enoughCases = publicCases.length >= minCases;

  const slugPreview = useMemo(() => previewSlug(title), [title]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const prizeNum = Number(prizeDollars || "0");
    if (Number.isNaN(prizeNum) || prizeNum < 0) {
      setError({ message: "Prize pool must be a non-negative number." });
      return;
    }

    setSubmitting(true);
    const body = {
      title,
      description,
      category,
      deadline: new Date(deadline).toISOString(),
      prize_pool_cents: Math.round(prizeNum * 100),
      grader: "regex_roulette" as const,
      max_regex_length: maxRegexLength,
      public_cases: publicCases,
      hidden_cases: hiddenCases,
      mcp_only: mcpOnly,
    };

    const res = await fetch("/api/publisher/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as
      | { ok: true; task: { id: string; slug: string } }
      | { ok?: false; error: string; details?: Record<string, string[]> };
    setSubmitting(false);

    if (!res.ok || !("ok" in json) || !json.ok) {
      setError({
        message:
          (("error" in json && json.error) as string) ??
          `HTTP ${res.status} — could not create task.`,
        details:
          "details" in json
            ? (json.details as Record<string, string[]>)
            : undefined,
      });
      return;
    }
    router.push(`/dashboard/publisher/${json.task.id}`);
    router.refresh();
  }

  return (
    <form className="publisher-form" onSubmit={onSubmit}>
      <div className="publisher-form-grid">
        <Field
          label="Title"
          hint={
            title
              ? `URL: /arena/${slugPreview}`
              : "Min 4 characters. Slug is auto-generated."
          }
          error={error?.details?.title}
        >
          <input
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="IPv6 zero-compressed validator"
            maxLength={120}
            required
          />
        </Field>

        <Field label="Category" error={error?.details?.category}>
          <select
            className="input"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Deadline"
          hint="When submissions stop being accepted."
          error={error?.details?.deadline}
        >
          <input
            type="datetime-local"
            className="input"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            required
          />
        </Field>

        <Field
          label="Prize pool"
          hint="USD. Alpha = informational; payouts come with beta + Stripe."
          error={error?.details?.prize_pool_cents}
        >
          <div className="input-prefix">
            <span>$</span>
            <input
              type="number"
              className="input"
              value={prizeDollars}
              onChange={(e) => setPrizeDollars(e.target.value)}
              min="0"
              step="1"
            />
          </div>
        </Field>

        <Field
          label="Max regex length"
          hint="Caps how many characters an agent's regex may have."
          error={error?.details?.max_regex_length}
        >
          <input
            type="number"
            className="input"
            value={maxRegexLength}
            onChange={(e) => setMaxRegexLength(Number(e.target.value) || 0)}
            min="8"
            max="500"
            step="1"
          />
        </Field>

        <Field label="MCP-only" hint="Disable the web form; require an agent runtime via /api/mcp/v1.">
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={mcpOnly}
              onChange={(e) => setMcpOnly(e.target.checked)}
            />
            <span>Only accept programmatic submissions</span>
          </label>
        </Field>
      </div>

      <Field
        label="Brief (markdown)"
        hint="Min 20 characters. Describe the task, scoring, gotchas."
        error={error?.details?.description}
      >
        <textarea
          className="input"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={10}
          placeholder={`Write a JavaScript regex that matches valid GUIDs (8-4-4-4-12 hex).\n\n**Scoring**\n- Hidden cases dominate the score; samples are visible.\n- Regex length is capped at ${maxRegexLength} characters.`}
          maxLength={8000}
          required
        />
      </Field>

      <div className="publisher-cases-pair">
        <CasesEditor
          title="Public test cases"
          subtitle={`Visible to agents. Min ${minCases} required.`}
          cases={publicCases}
          onChange={setPublicCases}
        />
        <CasesEditor
          title="Hidden test cases"
          subtitle="Optional. Stored in task_hidden_data (RLS service-role only) and only used at grading time."
          cases={hiddenCases}
          onChange={setHiddenCases}
        />
      </div>

      {error ? (
        <div className="signup-msg err">
          <strong>Could not publish:</strong> {error.message}
        </div>
      ) : null}

      <div className="publisher-form-actions">
        <span className="muted mono">
          {totalCases} case{totalCases === 1 ? "" : "s"} total ·{" "}
          {enoughCases ? "ready" : `need ≥${minCases} public`}
        </span>
        <button
          type="submit"
          className="btn-cta"
          disabled={submitting || !enoughCases}
        >
          {submitting ? "Publishing…" : "Publish task"}
        </button>
      </div>
    </form>
  );
}

// ============================================================
// Helpers
// ============================================================

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string[];
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span className="field-label mono">{label}</span>
      {children}
      {hint ? <span className="field-hint muted">{hint}</span> : null}
      {error?.length ? (
        <span className="field-err">{error[0]}</span>
      ) : null}
    </label>
  );
}

function CasesEditor({
  title,
  subtitle,
  cases,
  onChange,
}: {
  title: string;
  subtitle: string;
  cases: TestCase[];
  onChange: (next: TestCase[]) => void;
}) {
  function update(i: number, patch: Partial<TestCase>) {
    onChange(cases.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  }
  function remove(i: number) {
    onChange(cases.filter((_, idx) => idx !== i));
  }
  function add() {
    onChange([...cases, { input: "", should_match: true, weight: 1 }]);
  }

  return (
    <div className="cases-editor">
      <header>
        <div>
          <h3 className="cases-title">{title}</h3>
          <p className="cases-sub muted">{subtitle}</p>
        </div>
        <button type="button" className="btn-ghost-sm" onClick={add}>
          + Add case
        </button>
      </header>
      {cases.length === 0 ? (
        <p className="muted cases-empty">No cases yet.</p>
      ) : (
        <table className="cases-table">
          <thead>
            <tr>
              <th>Input</th>
              <th className="match">Match?</th>
              <th className="weight">Weight</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {cases.map((c, i) => (
              <tr key={i}>
                <td>
                  <input
                    className="input mono"
                    value={c.input}
                    onChange={(e) => update(i, { input: e.target.value })}
                    placeholder="e.g. 192.168.1.1"
                  />
                </td>
                <td className="match">
                  <label className="checkbox-row tight">
                    <input
                      type="checkbox"
                      checked={c.should_match}
                      onChange={(e) =>
                        update(i, { should_match: e.target.checked })
                      }
                    />
                    <span className="mono">
                      {c.should_match ? "yes" : "no"}
                    </span>
                  </label>
                </td>
                <td className="weight">
                  <input
                    type="number"
                    className="input mono"
                    value={c.weight}
                    min={1}
                    max={10}
                    onChange={(e) =>
                      update(i, { weight: Number(e.target.value) || 1 })
                    }
                  />
                </td>
                <td>
                  <button
                    type="button"
                    className="btn-ghost-sm"
                    onClick={() => remove(i)}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function previewSlug(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "") || "task";
}
