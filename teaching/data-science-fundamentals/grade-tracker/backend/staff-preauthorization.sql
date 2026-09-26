-- Pre-authorize a trusted teaching-team email before its first verified sign-in.
-- This table is private and has no client grants.
create table if not exists grade_private.staff_preauthorizations (
  email text primary key check (email = lower(btrim(email))),
  role text not null check (role in ('instructor', 'ta')),
  created_at timestamptz not null default now(),
  consumed_at timestamptz,
  consumed_by uuid references auth.users(id) on delete set null
);

alter table grade_private.staff_preauthorizations enable row level security;
revoke all on grade_private.staff_preauthorizations from public, anon, authenticated;

create or replace function grade_private.activate_preauthorized_staff()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  authorized_role text;
begin
  if new.email is null or new.email_confirmed_at is null then
    return new;
  end if;

  select p.role
    into authorized_role
    from grade_private.staff_preauthorizations p
   where p.email = lower(new.email)
     and p.consumed_at is null
   for update;

  if authorized_role is null then
    return new;
  end if;

  insert into grade_private.staff_users(user_id, role, active)
  values (new.id, authorized_role, true)
  on conflict (user_id) do update
    set role = excluded.role,
        active = true;

  update grade_private.staff_preauthorizations
     set consumed_at = now(),
         consumed_by = new.id
   where email = lower(new.email)
     and consumed_at is null;

  return new;
end;
$$;

revoke all on function grade_private.activate_preauthorized_staff()
  from public, anon, authenticated;

drop trigger if exists activate_preauthorized_grade_staff on auth.users;
create trigger activate_preauthorized_grade_staff
after insert or update of email, email_confirmed_at on auth.users
for each row execute function grade_private.activate_preauthorized_staff();

-- Full instructor-level access explicitly approved by the course instructor.
insert into grade_private.staff_preauthorizations(email, role)
values ('a.hossein@newuu.uz', 'instructor')
on conflict (email) do update
  set role = excluded.role;

-- Activate immediately if this exact email is already verified.
insert into grade_private.staff_users(user_id, role, active)
select u.id, 'instructor', true
  from auth.users u
 where lower(u.email) = 'a.hossein@newuu.uz'
   and u.email_confirmed_at is not null
on conflict (user_id) do update
  set role = excluded.role,
      active = true;

update grade_private.staff_preauthorizations p
   set consumed_at = now(),
       consumed_by = u.id
  from auth.users u
 where p.email = 'a.hossein@newuu.uz'
   and lower(u.email) = p.email
   and u.email_confirmed_at is not null
   and p.consumed_at is null;
