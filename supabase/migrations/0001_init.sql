--
-- Mettle — initial schema
-- Tables: profiles, agents, tasks, submissions, verdicts, agent_elo,
--         escrow_transactions, payouts, jobs
-- Includes: indexes, RLS policies, queue helper functions, auth trigger.
--

set search_path = public;

-- ============================================================
-- Helper: updated_at trigger
-- ============================================================
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================
-- profiles  (1:1 with auth.users)
-- ============================================================
create table profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text not null unique,
  role          text not null default 'operator'
                  check (role in ('publisher', 'operator', 'both', 'admin')),
  display_name  text,
  stripe_customer_id          text,
  stripe_connect_account_id   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger profiles_updated_at
  before update on profiles
  for each row execute function set_updated_at();

-- Auto-create profile on signup
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ============================================================
-- agents
-- ============================================================
create table agents (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique,
  operator_id     uuid not null references profiles(id) on delete cascade,
  name            text not null,
  description     text,
  categories      text[] not null default '{}',
  webhook_url     text,
  webhook_secret  text,
  api_key_hash    text not null,
  api_key_prefix  text not null,
  hire_rate_cents int,
  status          text not null default 'active'
                    check (status in ('active', 'paused', 'banned')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index agents_operator_idx   on agents(operator_id);
create index agents_categories_idx on agents using gin(categories);
create index agents_status_idx     on agents(status) where status = 'active';

create trigger agents_updated_at
  before update on agents
  for each row execute function set_updated_at();

-- ============================================================
-- tasks  (arena + market_tournament + market_direct)
-- ============================================================
create table tasks (
  id                  uuid primary key default gen_random_uuid(),
  type                text not null
                        check (type in ('arena', 'market_tournament', 'market_direct')),
  category            text not null,
  publisher_id        uuid references profiles(id),
  hired_agent_id      uuid references agents(id),
  title               text not null,
  description         text not null,
  inputs_path         text,
  rubric              jsonb not null,
  auto_grader_config  jsonb,
  prize_pool_cents    int not null,
  prize_breakdown     jsonb not null,
  max_participants    int,
  deadline            timestamptz not null,
  status              text not null default 'draft'
                        check (status in ('draft', 'open', 'judging', 'settled', 'cancelled')),
  published_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index tasks_status_idx       on tasks(status);
create index tasks_open_deadline_idx on tasks(deadline) where status = 'open';
create index tasks_publisher_idx    on tasks(publisher_id);
create index tasks_category_idx     on tasks(category);

create trigger tasks_updated_at
  before update on tasks
  for each row execute function set_updated_at();

-- ============================================================
-- submissions
-- ============================================================
create table submissions (
  id                  uuid primary key default gen_random_uuid(),
  task_id             uuid not null references tasks(id) on delete cascade,
  agent_id            uuid not null references agents(id),
  artifact_path       text,
  status              text not null default 'received'
                        check (status in ('received', 'auto_grading', 'auto_graded',
                                          'human_grading', 'judged', 'rejected')),
  auto_score          double precision,
  human_score         double precision,
  final_score         double precision,
  rank                int,
  prize_awarded_cents int,
  judge_notes         text,
  audit_log           jsonb,
  submitted_at        timestamptz not null default now(),
  finalized_at        timestamptz,
  unique (task_id, agent_id)
);

create index submissions_task_rank_idx on submissions(task_id, final_score desc nulls last);
create index submissions_agent_idx     on submissions(agent_id, submitted_at desc);
create index submissions_status_idx    on submissions(status);

-- ============================================================
-- verdicts  (append-only score history per agent)
-- ============================================================
create table verdicts (
  id              uuid primary key default gen_random_uuid(),
  agent_id        uuid not null references agents(id) on delete cascade,
  submission_id   uuid not null references submissions(id) on delete cascade,
  task_category   text not null,
  task_type       text not null,
  score           double precision not null,
  rank            int,
  elo_delta       double precision,
  earned_at       timestamptz not null default now()
);

create index verdicts_agent_idx   on verdicts(agent_id, earned_at desc);
create index verdicts_category_idx on verdicts(task_category);

-- ============================================================
-- agent_elo  (current ELO snapshot per category)
-- ============================================================
create table agent_elo (
  agent_id      uuid not null references agents(id) on delete cascade,
  category      text not null,
  arena_elo     double precision not null default 1200,
  market_elo    double precision not null default 1200,
  combined_elo  double precision not null default 1200,
  tasks_played  int not null default 0,
  last_updated  timestamptz not null default now(),
  primary key (agent_id, category)
);

create index agent_elo_leaderboard_idx on agent_elo(category, combined_elo desc);

-- ============================================================
-- escrow + payouts
-- ============================================================
create table escrow_transactions (
  id                        uuid primary key default gen_random_uuid(),
  task_id                   uuid not null references tasks(id),
  stripe_payment_intent_id  text,
  amount_cents              int not null,
  status                    text not null
                              check (status in ('pending', 'held', 'released', 'refunded', 'failed')),
  created_at                timestamptz not null default now()
);

create table payouts (
  id                 uuid primary key default gen_random_uuid(),
  agent_id           uuid not null references agents(id),
  task_id            uuid not null references tasks(id),
  amount_cents       int not null,
  stripe_transfer_id text,
  status             text not null
                       check (status in ('pending', 'paid', 'failed')),
  created_at         timestamptz not null default now()
);

-- ============================================================
-- jobs  (Postgres-backed queue)
-- ============================================================
create table jobs (
  id            uuid primary key default gen_random_uuid(),
  type          text not null,
  payload       jsonb not null default '{}'::jsonb,
  run_at        timestamptz not null default now(),
  status        text not null default 'pending'
                  check (status in ('pending', 'running', 'done', 'failed')),
  attempts      int not null default 0,
  max_attempts  int not null default 5,
  locked_at     timestamptz,
  locked_by     text,
  last_error    text,
  created_at    timestamptz not null default now()
);

create index jobs_pending_idx on jobs(run_at) where status = 'pending';
create index jobs_running_idx on jobs(locked_at) where status = 'running';

-- ============================================================
-- Queue helper functions
-- ============================================================

-- Atomically claim the next runnable job for a worker.
create or replace function claim_next_job(worker_id text)
returns setof jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed_id uuid;
begin
  with cte as (
    select id
    from jobs
    where status = 'pending' and run_at <= now()
    order by run_at
    limit 1
    for update skip locked
  )
  update jobs j
     set status     = 'running',
         locked_at  = now(),
         locked_by  = worker_id,
         attempts   = attempts + 1
    from cte
   where j.id = cte.id
  returning j.id into claimed_id;

  if claimed_id is null then
    return;
  end if;

  return query select * from jobs where id = claimed_id;
end;
$$;

-- Re-queue jobs that have been `running` for too long.
create or replace function requeue_stuck_jobs(older_than timestamptz)
returns int
language sql
security definer
set search_path = public
as $$
  with stuck as (
    update jobs
       set status     = 'pending',
           locked_at  = null,
           locked_by  = null,
           last_error = coalesce(last_error, '') || E'\n[sweeper] requeued'
     where status = 'running' and locked_at < older_than
    returning 1
  )
  select count(*)::int from stuck;
$$;

-- ============================================================
-- RLS policies
-- ============================================================
alter table profiles    enable row level security;
alter table agents      enable row level security;
alter table tasks       enable row level security;
alter table submissions enable row level security;
alter table verdicts    enable row level security;
alter table agent_elo   enable row level security;
alter table escrow_transactions enable row level security;
alter table payouts     enable row level security;
alter table jobs        enable row level security;

-- profiles: user can read/update their own row
create policy profiles_self_select on profiles
  for select using (id = auth.uid());
create policy profiles_self_update on profiles
  for update using (id = auth.uid());

-- agents: operator manages their own; public read
create policy agents_owner_all on agents
  for all using (operator_id = auth.uid())
  with check (operator_id = auth.uid());
create policy agents_public_read on agents
  for select using (status in ('active', 'paused'));

-- tasks: publisher manages own; public read of non-draft tasks
create policy tasks_publisher_all on tasks
  for all using (publisher_id = auth.uid())
  with check (publisher_id = auth.uid());
create policy tasks_public_read on tasks
  for select using (status in ('open', 'judging', 'settled'));

-- submissions: operator sees own; publisher sees during judging
create policy submissions_operator_select on submissions
  for select using (
    agent_id in (select id from agents where operator_id = auth.uid())
  );
create policy submissions_publisher_select on submissions
  for select using (
    task_id in (select id from tasks where publisher_id = auth.uid())
  );

-- verdicts: public read (it's the public scorecard); no writes from clients
create policy verdicts_public_read on verdicts
  for select using (true);

-- agent_elo: public read (leaderboard)
create policy agent_elo_public_read on agent_elo
  for select using (true);

-- escrow_transactions / payouts / jobs: no client access (service-role only)
-- (RLS enabled, no policies = denied to anon and authenticated users)
