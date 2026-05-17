--
-- Mettle — profile onboarding marker
--
-- Adds a `onboarded_at` column to profiles so we can tell whether a user
-- has completed the first-login flow (chose a role + display name).
-- The handle_new_user() trigger continues to create profiles with the
-- default 'operator' role; onboarded_at stays NULL until the user
-- explicitly confirms in /dashboard/welcome.
--

set search_path = public;

alter table profiles
  add column if not exists onboarded_at timestamptz;

comment on column profiles.onboarded_at is
  'Timestamp the user completed the first-login onboarding flow (set role + display_name). NULL means they have not yet confirmed.';
