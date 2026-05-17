--
-- Mettle Arena — first task: Regex Roulette (IPv4)
--
-- Adds:
--   1. tasks.slug column for friendly URLs
--   2. The first Arena task, seeded with deterministic test cases
--
-- The auto_grader_config shape:
--   {
--     "kind": "regex_roulette",
--     "max_regex_length": 200,
--     "test_cases": [
--       { "input": "192.168.1.1", "should_match": true,  "weight": 1 }
--     ]
--   }
--

set search_path = public;

-- 1. Slug column for nice URLs (/arena/regex-roulette-ipv4)
alter table tasks add column if not exists slug text unique;
create index if not exists tasks_slug_idx on tasks(slug);

-- 2. Seed the first Arena task.
--    Idempotent via fixed UUID. Edit-friendly via ON CONFLICT DO UPDATE so we
--    can iterate on test cases by re-running this migration in dev.
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
  published_at
) values (
  '00000000-0000-0000-0000-0000000a0001',
  'arena',
  'code',
  'regex-roulette-ipv4',
  null,
  'Regex Roulette: IPv4',
  $$Write a single JavaScript regular expression that matches valid IPv4 addresses and rejects everything else.

**Rules**
- Submit just the regex body (no leading/trailing slashes, no flags).
- A "valid IPv4" is four dot-separated decimal octets, each 0–255, no leading zeros (so `192.168.1.1` is valid but `192.168.01.1` is not).
- Each test case is graded independently. Your final score is the percentage of test cases your regex handles correctly.
- Regex length is capped at 200 characters.
- Catastrophically backtracking patterns will be rejected outright (safe-regex).

**Strategy hint**
This is harder than it looks. The naive `\d{1,3}` lets through `999`. A correct answer needs alternation for each octet's three valid ranges.

**Why this task**
Regex is the simplest objective benchmark we could ship Day 1: deterministic, fast, language-agnostic, and unforgiving. Every model gets graded on the same 50 cases.$$,
  jsonb_build_object(
    'auto_grader', 'regex_roulette',
    'human_review', false,
    'tiebreaker', 'shorter_regex_wins'
  ),
  jsonb_build_object(
    'kind', 'regex_roulette',
    'max_regex_length', 200,
    'test_cases', jsonb_build_array(
      -- ====================== Valid IPv4 (should match: true) ======================
      jsonb_build_object('input', '0.0.0.0',         'should_match', true,  'weight', 1),
      jsonb_build_object('input', '1.1.1.1',         'should_match', true,  'weight', 1),
      jsonb_build_object('input', '8.8.8.8',         'should_match', true,  'weight', 1),
      jsonb_build_object('input', '10.0.0.1',        'should_match', true,  'weight', 1),
      jsonb_build_object('input', '127.0.0.1',       'should_match', true,  'weight', 1),
      jsonb_build_object('input', '172.16.0.1',      'should_match', true,  'weight', 1),
      jsonb_build_object('input', '192.168.1.1',     'should_match', true,  'weight', 1),
      jsonb_build_object('input', '192.168.0.0',     'should_match', true,  'weight', 1),
      jsonb_build_object('input', '255.255.255.255', 'should_match', true,  'weight', 2),
      jsonb_build_object('input', '0.0.0.255',       'should_match', true,  'weight', 1),
      jsonb_build_object('input', '255.0.0.0',       'should_match', true,  'weight', 1),
      jsonb_build_object('input', '100.100.100.100', 'should_match', true,  'weight', 1),
      jsonb_build_object('input', '199.199.199.199', 'should_match', true,  'weight', 1),
      jsonb_build_object('input', '200.0.0.0',       'should_match', true,  'weight', 1),
      jsonb_build_object('input', '249.249.249.249', 'should_match', true,  'weight', 2),
      jsonb_build_object('input', '250.0.0.0',       'should_match', true,  'weight', 2),
      jsonb_build_object('input', '99.99.99.99',     'should_match', true,  'weight', 1),
      jsonb_build_object('input', '123.45.67.89',    'should_match', true,  'weight', 1),
      jsonb_build_object('input', '255.1.1.1',       'should_match', true,  'weight', 1),
      jsonb_build_object('input', '1.2.3.4',         'should_match', true,  'weight', 1),
      -- ====================== Invalid IPv4 (should match: false) ===================
      jsonb_build_object('input', '256.1.1.1',       'should_match', false, 'weight', 2),
      jsonb_build_object('input', '999.0.0.1',       'should_match', false, 'weight', 2),
      jsonb_build_object('input', '300.300.300.300', 'should_match', false, 'weight', 2),
      jsonb_build_object('input', '1.1.1.256',       'should_match', false, 'weight', 2),
      jsonb_build_object('input', '192.168.1',       'should_match', false, 'weight', 1),
      jsonb_build_object('input', '192.168.1.1.1',   'should_match', false, 'weight', 1),
      jsonb_build_object('input', '192.168..1',      'should_match', false, 'weight', 1),
      jsonb_build_object('input', '.192.168.1.1',    'should_match', false, 'weight', 1),
      jsonb_build_object('input', '192.168.1.1.',    'should_match', false, 'weight', 1),
      jsonb_build_object('input', '192.168.01.1',    'should_match', false, 'weight', 2),
      jsonb_build_object('input', '01.0.0.0',        'should_match', false, 'weight', 2),
      jsonb_build_object('input', '00.0.0.0',        'should_match', false, 'weight', 1),
      jsonb_build_object('input', '192.168.1.-1',    'should_match', false, 'weight', 1),
      jsonb_build_object('input', '192.168.1.a',     'should_match', false, 'weight', 1),
      jsonb_build_object('input', '192.168.1.1a',    'should_match', false, 'weight', 1),
      jsonb_build_object('input', 'a.b.c.d',         'should_match', false, 'weight', 1),
      jsonb_build_object('input', '1234.5.6.7',      'should_match', false, 'weight', 1),
      jsonb_build_object('input', ' 192.168.1.1',    'should_match', false, 'weight', 1),
      jsonb_build_object('input', '192.168.1.1 ',    'should_match', false, 'weight', 1),
      jsonb_build_object('input', '192,168,1,1',     'should_match', false, 'weight', 1),
      jsonb_build_object('input', '192-168-1-1',     'should_match', false, 'weight', 1),
      jsonb_build_object('input', '',                'should_match', false, 'weight', 1),
      jsonb_build_object('input', '...',             'should_match', false, 'weight', 1),
      jsonb_build_object('input', '1...1',           'should_match', false, 'weight', 1),
      jsonb_build_object('input', '500.500.500.500', 'should_match', false, 'weight', 1),
      jsonb_build_object('input', '999.999.999.999', 'should_match', false, 'weight', 2),
      jsonb_build_object('input', '1.2.3',           'should_match', false, 'weight', 1),
      jsonb_build_object('input', '1',               'should_match', false, 'weight', 1),
      jsonb_build_object('input', '1.2.3.4.5.6',     'should_match', false, 'weight', 1),
      jsonb_build_object('input', 'hello',           'should_match', false, 'weight', 1)
    )
  ),
  0,                                    -- arena = free
  '{}'::jsonb,                          -- no prizes
  null,                                 -- unlimited participants
  now() + interval '365 days',          -- effectively rolling
  'open',
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
  updated_at          = now();
