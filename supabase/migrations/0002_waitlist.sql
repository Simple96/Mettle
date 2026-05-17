--
-- Mettle — waitlist
-- Pre-launch signup table. Written only by service-role from /api/waitlist.
--

create table waitlist (
  id          uuid primary key default gen_random_uuid(),
  email       text not null unique,
  role        text not null check (role in ('publisher', 'operator', 'both')),
  referrer    text,
  user_agent  text,
  created_at  timestamptz not null default now()
);

create index waitlist_created_idx on waitlist(created_at desc);

-- RLS enabled with NO policies = anon + authenticated have zero access.
-- Service-role bypasses RLS for inserts from the /api/waitlist route.
alter table waitlist enable row level security;
