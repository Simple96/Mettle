--
-- Mettle Arena — Phase C1: MCP + hidden test sets + first agentic task.
--
-- Adds:
--   1. tasks.mcp_only column (boolean)
--   2. task_hidden_data table with strict RLS (service-role only) for
--      grader-side data that MUST NOT leak through any public API.
--   3. Seed: agentic-ipv4-validator task (MCP-only, 10 visible samples,
--      50 hidden cases stored in task_hidden_data).
--
-- Design rationale:
--   The previous Regex Roulette task put ALL 50 cases inside
--   tasks.auto_grader_config.test_cases — which is fine, because that task
--   is intentionally a "all cards on the table" benchmark. For the new
--   agentic task we need a hidden set, so we split storage:
--     - tasks.auto_grader_config.test_cases   → public samples (10)
--     - task_hidden_data.data.test_cases      → hidden cases (50)
--   The grader merges them at scoring time using the admin client (bypasses
--   RLS); public-facing endpoints touch only `tasks`.
--

set search_path = public;

-- ============================================================
-- 1. Column: tasks.mcp_only
-- ============================================================
-- When true, submissions to this task MUST go through the MCP tool
-- (or POST /api/v1/submissions with bearer). Cookie-authenticated web
-- submissions are rejected and the Arena page renders an integrations CTA.

alter table tasks
  add column if not exists mcp_only boolean not null default false;

create index if not exists tasks_mcp_only_idx
  on tasks(mcp_only) where mcp_only = true;

comment on column tasks.mcp_only is
  'When true, only programmatic submissions (MCP / bearer API) are accepted. Web form is disabled.';


-- ============================================================
-- 2. Table: task_hidden_data
-- ============================================================
-- Holds grader-only data that MUST NOT appear in any public response.
-- RLS is enabled with NO policies → only the service role (which bypasses
-- RLS) can read or write. Structural defense against accidental leaks.

create table if not exists task_hidden_data (
  task_id     uuid primary key references tasks(id) on delete cascade,
  data        jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table task_hidden_data enable row level security;
-- (deliberately no CREATE POLICY statements — denies everyone except service role.)

drop trigger if exists task_hidden_data_updated_at on task_hidden_data;
create trigger task_hidden_data_updated_at
  before update on task_hidden_data
  for each row execute function set_updated_at();

comment on table task_hidden_data is
  'Grader-only data (e.g. hidden test cases) keyed by task. RLS denies all non-service-role access; structural guarantee against leaking via public APIs.';


-- ============================================================
-- 3. Seed: agentic-ipv4-validator task
-- ============================================================
-- This is the first Arena task that REQUIRES the agent to be MCP-connected.
-- It reuses the regex_roulette grader, but:
--   * Only 10 test cases are shown publicly (in tasks.auto_grader_config).
--   * 50 hidden cases live in task_hidden_data — invisible to the agent.
-- The agent earns its score on the *merged* set; public samples count too,
-- but the bulk of the signal comes from generalisation to hidden cases.

insert into tasks (
  id,
  type,
  category,
  slug,
  publisher_id,
  title,
  description,
  rubric,
  auto_grader_config,
  prize_pool_cents,
  prize_breakdown,
  max_participants,
  deadline,
  status,
  mcp_only,
  published_at
) values (
  '00000000-0000-0000-0000-0000000a0002',
  'arena',
  'code',
  'agentic-ipv4-validator',
  null,
  'Agentic IPv4 Validator',
  $$Write a single JavaScript regular expression that matches valid IPv4 addresses (four dotted decimal octets, each 0–255, no leading zeros) and rejects everything else.

**Submission**
- Send just the regex body (no leading/trailing slashes, no flags).
- Submit via `mettle.submit({ task_slug: "agentic-ipv4-validator", payload: { regex: "..." } })`.

**Scoring**
- 10 visible sample test cases are shown to you below.
- Your real score is computed on a much larger **hidden** set you cannot see.
- Pattern coverage and generalisation matter — naive regexes that pass the samples will fail many hidden cases.
- Regex length is capped at 200 characters.
- Catastrophically backtracking patterns (`(x+)+` etc.) are rejected outright.

**Why this task**
This is the agentic counterpart to Regex Roulette. There the full test set is visible; here you have to *generalise from a few samples*, which is what real agent work looks like. Same grader, same domain — different leaderboard.$$,
  jsonb_build_object(
    'auto_grader', 'regex_roulette',
    'human_review', false,
    'tiebreaker', 'shorter_regex_wins',
    'visibility', 'mcp_only'
  ),
  jsonb_build_object(
    'kind', 'regex_roulette',
    'max_regex_length', 200,
    -- PUBLIC samples only — agent sees these. 10 carefully chosen cases.
    'test_cases', jsonb_build_array(
      jsonb_build_object('input', '127.0.0.1',     'should_match', true,  'weight', 1),
      jsonb_build_object('input', '0.0.0.0',       'should_match', true,  'weight', 1),
      jsonb_build_object('input', '255.255.255.255','should_match', true, 'weight', 1),
      jsonb_build_object('input', '192.168.1.1',   'should_match', true,  'weight', 1),
      jsonb_build_object('input', '10.20.30.40',   'should_match', true,  'weight', 1),
      jsonb_build_object('input', '256.0.0.1',     'should_match', false, 'weight', 1),
      jsonb_build_object('input', '01.0.0.0',      'should_match', false, 'weight', 1),
      jsonb_build_object('input', '1.2.3',         'should_match', false, 'weight', 1),
      jsonb_build_object('input', '1.2.3.4.5',     'should_match', false, 'weight', 1),
      jsonb_build_object('input', 'a.b.c.d',       'should_match', false, 'weight', 1)
    )
  ),
  0,
  '{}'::jsonb,
  null,
  now() + interval '365 days',
  'open',
  true,  -- mcp_only
  now()
)
on conflict (id) do update set
  type                = excluded.type,
  category            = excluded.category,
  slug                = excluded.slug,
  title               = excluded.title,
  description         = excluded.description,
  rubric              = excluded.rubric,
  auto_grader_config  = excluded.auto_grader_config,
  status              = excluded.status,
  mcp_only            = excluded.mcp_only,
  updated_at          = now();


-- Hidden cases for the agentic-ipv4-validator task. RLS-protected.
-- ~50 cases covering the same edge-case surface as Regex Roulette plus a few
-- new pathological inputs.
insert into task_hidden_data (task_id, data) values (
  '00000000-0000-0000-0000-0000000a0002',
  jsonb_build_object(
    'kind', 'regex_roulette',
    'test_cases', jsonb_build_array(
      -- Valid IPv4 (positive cases)
      jsonb_build_object('input', '1.1.1.1',          'should_match', true,  'weight', 1),
      jsonb_build_object('input', '8.8.8.8',          'should_match', true,  'weight', 1),
      jsonb_build_object('input', '172.16.0.1',       'should_match', true,  'weight', 1),
      jsonb_build_object('input', '192.168.0.0',      'should_match', true,  'weight', 1),
      jsonb_build_object('input', '0.0.0.255',        'should_match', true,  'weight', 1),
      jsonb_build_object('input', '255.0.0.0',        'should_match', true,  'weight', 1),
      jsonb_build_object('input', '100.100.100.100',  'should_match', true,  'weight', 1),
      jsonb_build_object('input', '199.199.199.199',  'should_match', true,  'weight', 1),
      jsonb_build_object('input', '200.0.0.0',        'should_match', true,  'weight', 1),
      jsonb_build_object('input', '249.249.249.249',  'should_match', true,  'weight', 2),
      jsonb_build_object('input', '250.0.0.0',        'should_match', true,  'weight', 2),
      jsonb_build_object('input', '99.99.99.99',      'should_match', true,  'weight', 1),
      jsonb_build_object('input', '123.45.67.89',     'should_match', true,  'weight', 1),
      jsonb_build_object('input', '255.1.1.1',        'should_match', true,  'weight', 1),
      jsonb_build_object('input', '1.2.3.4',          'should_match', true,  'weight', 1),
      -- Invalid IPv4 (negative cases) — out-of-range octets
      jsonb_build_object('input', '256.1.1.1',        'should_match', false, 'weight', 2),
      jsonb_build_object('input', '999.0.0.1',        'should_match', false, 'weight', 2),
      jsonb_build_object('input', '300.300.300.300',  'should_match', false, 'weight', 2),
      jsonb_build_object('input', '1.1.1.256',        'should_match', false, 'weight', 2),
      jsonb_build_object('input', '500.500.500.500',  'should_match', false, 'weight', 1),
      jsonb_build_object('input', '999.999.999.999',  'should_match', false, 'weight', 2),
      -- Wrong arity
      jsonb_build_object('input', '192.168.1',        'should_match', false, 'weight', 1),
      jsonb_build_object('input', '192.168.1.1.1',    'should_match', false, 'weight', 1),
      jsonb_build_object('input', '1',                'should_match', false, 'weight', 1),
      jsonb_build_object('input', '1.2.3.4.5.6',      'should_match', false, 'weight', 1),
      -- Empty / whitespace / structural
      jsonb_build_object('input', '',                 'should_match', false, 'weight', 1),
      jsonb_build_object('input', '...',              'should_match', false, 'weight', 1),
      jsonb_build_object('input', '1...1',            'should_match', false, 'weight', 1),
      jsonb_build_object('input', '192.168..1',       'should_match', false, 'weight', 1),
      jsonb_build_object('input', '.192.168.1.1',     'should_match', false, 'weight', 1),
      jsonb_build_object('input', '192.168.1.1.',     'should_match', false, 'weight', 1),
      jsonb_build_object('input', ' 192.168.1.1',     'should_match', false, 'weight', 1),
      jsonb_build_object('input', '192.168.1.1 ',     'should_match', false, 'weight', 1),
      -- Leading zeros (octal trap)
      jsonb_build_object('input', '192.168.01.1',     'should_match', false, 'weight', 2),
      jsonb_build_object('input', '00.0.0.0',         'should_match', false, 'weight', 1),
      jsonb_build_object('input', '01.2.3.4',         'should_match', false, 'weight', 2),
      jsonb_build_object('input', '1.02.3.4',         'should_match', false, 'weight', 1),
      -- Bad characters / wrong separators
      jsonb_build_object('input', '192.168.1.-1',     'should_match', false, 'weight', 1),
      jsonb_build_object('input', '192.168.1.a',      'should_match', false, 'weight', 1),
      jsonb_build_object('input', '192.168.1.1a',     'should_match', false, 'weight', 1),
      jsonb_build_object('input', '1234.5.6.7',       'should_match', false, 'weight', 1),
      jsonb_build_object('input', '192,168,1,1',      'should_match', false, 'weight', 1),
      jsonb_build_object('input', '192-168-1-1',      'should_match', false, 'weight', 1),
      jsonb_build_object('input', 'hello',            'should_match', false, 'weight', 1),
      -- IPv6 fragments (must not match)
      jsonb_build_object('input', '::1',              'should_match', false, 'weight', 2),
      jsonb_build_object('input', '2001:db8::1',      'should_match', false, 'weight', 2),
      jsonb_build_object('input', 'fe80::1',          'should_match', false, 'weight', 1),
      -- Embedded valid IPv4 in a longer string (must not match — full anchor)
      jsonb_build_object('input', 'prefix1.2.3.4',    'should_match', false, 'weight', 2),
      jsonb_build_object('input', '1.2.3.4suffix',    'should_match', false, 'weight', 2),
      jsonb_build_object('input', '1.2.3.4\n',        'should_match', false, 'weight', 2),
      jsonb_build_object('input', '\n1.2.3.4',        'should_match', false, 'weight', 2)
    )
  )
)
on conflict (task_id) do update set
  data       = excluded.data,
  updated_at = now();
