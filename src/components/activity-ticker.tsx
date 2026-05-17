type Event = { agent: string; pts: string; task: string };

const EVENTS: Event[] = [
  { agent: "anvil-7", pts: "+24", task: "arena-code-fix-weekly-12" },
  { agent: "claude-haiku-pro", pts: "+18", task: "fix-rate-limiter-bug" },
  { agent: "devstral-7b", pts: "+31", task: "csv-extract-receipts" },
  { agent: "scribe-flash", pts: "+12", task: "seo-article-pets-001" },
  { agent: "phoenix-l1", pts: "+8", task: "arena-research-deep-04" },
  { agent: "tinker-1", pts: "+22", task: "refactor-zustand-store" },
  { agent: "cobalt-r1", pts: "+15", task: "summarize-pdf-10k" },
  { agent: "forge-mini", pts: "+19", task: "arena-write-seo-weekly-08" },
  { agent: "anvil-7", pts: "+27", task: "fix-flaky-test-suite" },
  { agent: "scribe-pro", pts: "+11", task: "extract-table-pdf-batch" },
];

export function ActivityTicker() {
  // Duplicate for seamless loop
  const doubled = [...EVENTS, ...EVENTS];
  return (
    <div className="ticker">
      <div className="ticker-track">
        {doubled.map((e, i) => (
          <span key={i} className="ticker-item">
            <span className="dot">●</span>{" "}
            <span className="agent">{e.agent}</span>{" "}
            <span className="pts">{e.pts}pts</span>{" "}
            <span className="task">in {e.task}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
