/**
 * Tiny zero-dependency markdown renderer for the task description.
 *
 * Supports just what we need for Arena briefs: paragraphs, **bold**, `code`,
 * unordered lists, and h3 (#). We deliberately don't pull in a full library
 * to keep the bundle small and avoid sanitizing-other-people's-HTML issues.
 *
 * If/when we let publishers submit arbitrary markdown (Market tasks), swap
 * in `react-markdown` + `rehype-sanitize`.
 */
export function TaskMarkdown({ source }: { source: string }) {
  const blocks = parseBlocks(source);
  return (
    <div className="task-md">
      {blocks.map((b, i) => {
        if (b.kind === "h3") return <h3 key={i}>{inline(b.text)}</h3>;
        if (b.kind === "ul")
          return (
            <ul key={i}>
              {b.items.map((it, j) => (
                <li key={j}>{inline(it)}</li>
              ))}
            </ul>
          );
        return <p key={i}>{inline(b.text)}</p>;
      })}
    </div>
  );
}

type Block =
  | { kind: "p"; text: string }
  | { kind: "h3"; text: string }
  | { kind: "ul"; items: string[] };

function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const out: Block[] = [];
  let buf: string[] = [];
  let ul: string[] | null = null;

  const flushPara = () => {
    if (buf.length) {
      out.push({ kind: "p", text: buf.join(" ").trim() });
      buf = [];
    }
  };
  const flushUl = () => {
    if (ul) {
      out.push({ kind: "ul", items: ul });
      ul = null;
    }
  };

  for (const line of lines) {
    if (/^\s*$/.test(line)) {
      flushPara();
      flushUl();
      continue;
    }
    const h = line.match(/^#{1,3}\s+(.*)$/);
    if (h) {
      flushPara();
      flushUl();
      out.push({ kind: "h3", text: h[1] });
      continue;
    }
    const li = line.match(/^\s*[-*]\s+(.*)$/);
    if (li) {
      flushPara();
      if (!ul) ul = [];
      ul.push(li[1]);
      continue;
    }
    if (ul) flushUl();
    buf.push(line.trim());
  }
  flushPara();
  flushUl();
  return out;
}

function inline(s: string): React.ReactNode {
  // Order matters: code first (so its content isn't bold-processed), then bold.
  const parts: React.ReactNode[] = [];
  let rest = s;
  let key = 0;

  while (rest.length > 0) {
    const codeMatch = rest.match(/`([^`]+)`/);
    const boldMatch = rest.match(/\*\*([^*]+)\*\*/);

    let next: { idx: number; len: number; node: React.ReactNode } | null = null;
    if (codeMatch && codeMatch.index !== undefined) {
      next = {
        idx: codeMatch.index,
        len: codeMatch[0].length,
        node: (
          <code key={key++} className="task-md-code">
            {codeMatch[1]}
          </code>
        ),
      };
    }
    if (boldMatch && boldMatch.index !== undefined) {
      if (!next || boldMatch.index < next.idx) {
        next = {
          idx: boldMatch.index,
          len: boldMatch[0].length,
          node: <strong key={key++}>{boldMatch[1]}</strong>,
        };
      }
    }

    if (!next) {
      parts.push(rest);
      break;
    }
    if (next.idx > 0) parts.push(rest.slice(0, next.idx));
    parts.push(next.node);
    rest = rest.slice(next.idx + next.len);
  }

  return parts;
}
