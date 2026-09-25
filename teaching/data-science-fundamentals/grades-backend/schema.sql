-- Data Science Fundamentals, 2026: private, instructor-managed gradebook.
-- Run ONCE in a dedicated Supabase project's SQL editor as a database admin.
-- This file contains no roster, marks, invitation codes, staff account, or secret.
-- Keep the Supabase service_role key and any roster/import script off GitHub.
-- Expose only the public schema through the Supabase Data API. Do not expose
-- grade_private. The browser may use only the project URL and publishable key.
--
-- Initial setup, performed privately after running this migration:
--  1. Import the 155 roster rows into public.course_students using a private
--     administrative connection, never from browser JavaScript. Use the
--     attached file's learner_id, university_id, full_name, and cohort.
--  2. Generate one independent, cryptographically random 24-byte code per
--     student; encode each as 48 lowercase hexadecimal characters. Insert
--     only its SHA-256 hash into grade_private.student_invites, e.g.
--       pg_catalog.sha256(pg_catalog.convert_to('<48-hex-code>', 'UTF8'))
--     Securely distribute each original code to that student. Where possible,
--     populate allowed_email with their verified university email. If it is
--     null, possession of the code is the enrollment identity check.
--  3. Instructor and TA each sign in once using email OTP, then an admin uses
--     the template below with the correct email and appropriate role:
--       INSERT INTO grade_private.staff_users (user_id, role)
--       SELECT id, 'instructor' FROM auth.users
--       WHERE lower(email) = lower('<INSTRUCTOR_EMAIL>');
--       INSERT INTO grade_private.staff_users (user_id, role)
--       SELECT id, 'ta' FROM auth.users
--       WHERE lower(email) = lower('<TA_EMAIL>');
--     Confirm that each INSERT affected exactly one row. Do not put real
--     names, addresses, codes, or grade data in this versioned migration.
--  4. Configure the Auth email template with {{ .Token }} for the OTP flow.
--     Set Auth email rate limits, allowed domains or enrollment restrictions,
--     and a production SMTP provider as appropriate for the university.
--  5. The university minimum passing grade is seeded at 40% per the NewUU
--     Academic Regulations approved March 2026, effective Fall
--     2026/27, sections 14.1-14.2. An approved course-specific threshold
--     may be configured later by the instructor.

-- All statements below are transactional. A failure rolls back the entire
-- migration rather than leaving a partially configured gradebook.
begin;

create schema if not exists grade_private;
revoke all on schema grade_private from public, anon;
grant usage on schema grade_private to authenticated;

create table if not exists public.course_students (
  id uuid primary key default gen_random_uuid(),
  learner_id text not null unique,
  university_id text not null unique,
  full_name text not null,
  cohort text not null,
  auth_user_id uuid unique references auth.users(id) on delete set null,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint course_students_ids_nonempty check (
    length(btrim(learner_id)) > 0 and length(btrim(university_id)) > 0
  ),
  constraint course_students_name_nonempty check (length(btrim(full_name)) > 0)
);

create table if not exists grade_private.staff_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('instructor', 'ta')),
  active boolean not null default true,
  added_at timestamptz not null default now()
);

create table if not exists grade_private.student_invites (
  student_id uuid primary key references public.course_students(id) on delete cascade,
  code_hash bytea not null unique check (octet_length(code_hash) = 32),
  allowed_email text,
  expires_at timestamptz,
  used_by uuid references auth.users(id) on delete set null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  constraint student_invites_email_format check (
    allowed_email is null or
    (allowed_email = lower(btrim(allowed_email)) and allowed_email like '%@%')
  )
);

create table if not exists public.assessment_definitions (
  key text primary key,
  label text not null,
  category text not null check (category in ('lab', 'assessment')),
  due_label text not null,
  max_score numeric(7,2) not null default 100 check (max_score > 0),
  weight numeric(5,2) not null default 0 check (weight between 0 and 100),
  sort_order integer not null unique,
  constraint labs_weight_zero check (category <> 'lab' or weight = 0)
);

create table if not exists public.grading_settings (
  id integer primary key check (id = 1),
  pass_threshold numeric(5,2) check (pass_threshold between 0 and 100),
  labs_weight numeric(5,2) not null check (labs_weight between 0 and 100),
  labs_best_count integer not null check (labs_best_count between 1 and 12),
  updated_at timestamptz not null default now()
);

create table if not exists public.grade_entries (
  student_id uuid not null references public.course_students(id) on delete cascade,
  assessment_key text not null references public.assessment_definitions(key),
  score numeric(7,2) check (score is null or score >= 0),
  outcome text check (outcome in ('pass', 'revise', 'fail')),
  published boolean not null default false,
  note text, -- Student-visible feedback whenever published = true.
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  primary key (student_id, assessment_key)
);
-- If this migration is rerun after an earlier version, permit blank drafts.
alter table public.grade_entries
  drop constraint if exists grade_entry_has_result;
create index if not exists grade_entries_assessment_key_idx
  on public.grade_entries(assessment_key);

-- Preserve staff corrections, including the state before a publication or
-- deletion. This table is never exposed to the browser or API roles.
create table if not exists grade_private.grade_changes (
  id bigint generated always as identity primary key,
  student_id uuid not null,
  assessment_key text not null,
  operation text not null check (operation in ('INSERT', 'UPDATE', 'DELETE')),
  before_row jsonb,
  after_row jsonb,
  actor_user_id uuid,
  changed_at timestamptz not null default now()
);
create index if not exists grade_changes_student_idx
  on grade_private.grade_changes(student_id, changed_at desc);

-- Grade calculation contract for the portal:
--  * All stored scores are earned points between 0 and max_score (100 for
--    the seeded assessments). A score contributes score/max_score of that
--    item's weight. A missing grade row is ungraded, not a published zero.
--  * The 12 weekly labs together contribute 15 percentage points. Rank their
--    normalized results, take the best nine, and divide their sum by nine;
--    when fewer than nine results are published, the remaining slots count
--    as zero for a clearly labeled provisional total.
--  * A published lab must have an outcome (pass/revise/fail), and may also
--    have a score. If its score is NULL, pass counts as 100% and revise/fail
--    as 0% until revised. Unpublished drafts may be entirely blank.
--    If a numeric score exists it determines weighted points; the outcome
--    remains the teacher's separate judgment, even when marked fail. The
--    portal must display both fields so such combinations are not hidden.
--  * A published non-lab assessment must have a numeric score. It may also
--    carry a teacher-assigned outcome, but a score alone is sufficient.
--  * Students see published rows only. Unpublished rows must not be counted
--    or hinted at in their progress. Do not declare an overall course pass
--    while pass_threshold is NULL or required assessments are ungraded.
--    Staff may revise outcomes, scores, feedback, and publication state;
--    each modification is retained in grade_private.grade_changes.
insert into public.assessment_definitions
  (key, label, category, due_label, max_score, weight, sort_order)
select
  'lab_' || lpad(n::text, 2, '0'), 'Lab ' || n, 'lab', 'Week ' || n,
  100, 0, n
from generate_series(1, 12) as n
on conflict (key) do nothing;

insert into public.assessment_definitions
  (key, label, category, due_label, max_score, weight, sort_order)
values
  ('midterm', 'Midterm exam', 'assessment', 'Week 6', 100, 20, 20),
  ('final', 'Final exam', 'assessment', 'Exam period', 100, 25, 21),
  ('data_quality', 'Data Quality Report', 'assessment', 'Week 4', 100, 10, 22),
  ('eda', 'EDA and Visualization Brief', 'assessment', 'Week 7', 100, 10, 23),
  ('modelling', 'Modelling Assignment', 'assessment', 'Week 11', 100, 10, 24),
  ('capstone', 'Capstone project and dashboard', 'assessment', 'Week 12', 100, 10, 25)
on conflict (key) do nothing;

insert into public.grading_settings
  (id, pass_threshold, labs_weight, labs_best_count)
values (1, 40, 15, 9)
on conflict (id) do nothing;

-- The private functions use a fixed empty search_path and fully qualified
-- references. Only these narrow functions, not the underlying private tables,
-- are callable by authenticated users.
create or replace function grade_private.staff_role()
returns text
language sql stable security definer set search_path = ''
as $$
  select s.role
  from grade_private.staff_users as s
  where s.user_id = (select auth.uid()) and s.active = true
  limit 1;
$$;

create or replace function grade_private.is_staff()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from grade_private.staff_users as s
    where s.user_id = (select auth.uid()) and s.active = true
  );
$$;

create or replace function grade_private.is_instructor()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from grade_private.staff_users as s
    where s.user_id = (select auth.uid())
      and s.active = true and s.role = 'instructor'
  );
$$;

-- SECURITY INVOKER RPC wrapper: the privileged function lives outside every
-- exposed schema. A student can call this after completing email OTP sign-in.
create or replace function public.my_grade_role()
returns text
language sql stable security invoker set search_path = ''
as $$
  select grade_private.staff_role();
$$;

create or replace function grade_private.claim_student(code text)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  normalized_code text := lower(btrim(code));
  invite grade_private.student_invites%rowtype;
  student public.course_students%rowtype;
  verified_email text;
begin
  if caller is null then
    raise exception 'Sign in before claiming a student profile';
  end if;

  -- Codes contain 192 random bits. Neither an ID nor a student's name works.
  if normalized_code is null or normalized_code !~ '^[0-9a-f]{48}$' then
    return null;
  end if;

  select * into invite from grade_private.student_invites as i
  where i.code_hash = pg_catalog.sha256(
    pg_catalog.convert_to(normalized_code, 'UTF8')
  )
  for update;
  if not found or (invite.expires_at is not null and invite.expires_at < now()) then
    return null;
  end if;

  select * into student from public.course_students as s
  where s.id = invite.student_id for update;
  if not found then
    return null;
  end if;

  -- Require a verified email account even if the Auth project also supports
  -- anonymous identities. An OTP proves control of that address; a private
  -- allowed_email, when provided, further binds the code to the roster.
  select lower(btrim(u.email)) into verified_email
  from auth.users as u
  where u.id = caller and u.email is not null
    and u.email_confirmed_at is not null;
  if verified_email is null or (
    invite.allowed_email is not null
    and verified_email is distinct from invite.allowed_email
  ) then
    return null;
  end if;

  if (invite.used_by is not null and invite.used_by <> caller)
     or (student.auth_user_id is not null and student.auth_user_id <> caller)
     or exists (
       select 1 from public.course_students as other
       where other.auth_user_id = caller and other.id <> student.id
     ) then
    return null;
  end if;

  update public.course_students as s
  set auth_user_id = caller, claimed_at = coalesce(s.claimed_at, now())
  where s.id = student.id;

  update grade_private.student_invites as i
  set used_by = caller, used_at = coalesce(i.used_at, now())
  where i.student_id = student.id;

  return pg_catalog.jsonb_build_object(
    'id', student.id,
    'learner_id', student.learner_id,
    'university_id', student.university_id,
    'full_name', student.full_name,
    'cohort', student.cohort
  );
end;
$$;

create or replace function public.claim_my_student(invite_code text)
returns jsonb
language sql volatile security invoker set search_path = ''
as $$
  select grade_private.claim_student(invite_code);
$$;

-- Validate against the configured maximum on every staff insert/update;
-- clients cannot falsify authorship or timestamps through API calls.
create or replace function grade_private.validate_grade_entry()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  maximum numeric;
  assessment_category text;
begin
  select a.max_score, a.category into maximum, assessment_category
  from public.assessment_definitions as a where a.key = new.assessment_key;
  if maximum is null then
    raise exception 'Unknown assessment';
  end if;
  if new.score is not null and new.score > maximum then
    raise exception 'Score exceeds assessment maximum';
  end if;
  if new.published and assessment_category = 'lab' and new.outcome is null then
    raise exception 'Published labs require pass, revise, or fail';
  end if;
  if new.published and assessment_category = 'assessment' and new.score is null then
    raise exception 'Published assessments require a numeric score';
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

drop trigger if exists grade_entries_validate on public.grade_entries;
create trigger grade_entries_validate
before insert or update on public.grade_entries
for each row execute function grade_private.validate_grade_entry();

-- Existing rows must retain the same scoring scale and category. This also
-- prevents an instructor-side definition edit from bypassing entry validation.
create or replace function grade_private.guard_assessment_definition()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if (new.key, new.category, new.max_score)
       is distinct from (old.key, old.category, old.max_score)
     and exists (
       select 1 from public.grade_entries as g where g.assessment_key = old.key
     ) then
    raise exception 'Cannot change key, category, or maximum after grading begins';
  end if;
  return new;
end;
$$;

drop trigger if exists assessment_definitions_guard on public.assessment_definitions;
create trigger assessment_definitions_guard
before update on public.assessment_definitions
for each row execute function grade_private.guard_assessment_definition();

create or replace function grade_private.audit_grade_entry()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into grade_private.grade_changes
      (student_id, assessment_key, operation, before_row, after_row, actor_user_id)
    values
      (new.student_id, new.assessment_key, tg_op, null, to_jsonb(new), auth.uid());
  elsif tg_op = 'UPDATE' then
    insert into grade_private.grade_changes
      (student_id, assessment_key, operation, before_row, after_row, actor_user_id)
    values
      (new.student_id, new.assessment_key, tg_op, to_jsonb(old), to_jsonb(new), auth.uid());
  else
    insert into grade_private.grade_changes
      (student_id, assessment_key, operation, before_row, after_row, actor_user_id)
    values
      (old.student_id, old.assessment_key, tg_op, to_jsonb(old), null, auth.uid());
  end if;
  return null;
end;
$$;

drop trigger if exists grade_entries_audit on public.grade_entries;
create trigger grade_entries_audit
after insert or update or delete on public.grade_entries
for each row execute function grade_private.audit_grade_entry();

-- RLS is backed by explicit grants. Students have SELECT only; all writes
-- require the authenticated staff role and the corresponding RLS policy.
alter table public.course_students enable row level security;
alter table public.assessment_definitions enable row level security;
alter table public.grading_settings enable row level security;
alter table public.grade_entries enable row level security;
alter table grade_private.staff_users enable row level security;
alter table grade_private.student_invites enable row level security;
alter table grade_private.grade_changes enable row level security;

revoke all on public.course_students, public.assessment_definitions,
  public.grading_settings, public.grade_entries
  from public, anon, authenticated;
grant select on public.course_students, public.assessment_definitions,
  public.grading_settings, public.grade_entries to authenticated;
grant insert, update, delete on public.grade_entries to authenticated;
grant insert, update, delete on public.assessment_definitions to authenticated;
grant update (pass_threshold) on public.grading_settings to authenticated;

revoke all on grade_private.staff_users, grade_private.student_invites,
  grade_private.grade_changes
  from public, anon, authenticated;
revoke all on function grade_private.staff_role(), grade_private.is_staff(),
  grade_private.is_instructor(), grade_private.claim_student(text),
  grade_private.validate_grade_entry(), grade_private.guard_assessment_definition(),
  grade_private.audit_grade_entry(),
  public.my_grade_role(),
  public.claim_my_student(text) from public, anon, authenticated;
grant execute on function grade_private.staff_role(), grade_private.is_staff(),
  grade_private.is_instructor(), grade_private.claim_student(text),
  public.my_grade_role(), public.claim_my_student(text) to authenticated;

drop policy if exists course_students_own_or_staff on public.course_students;
create policy course_students_own_or_staff on public.course_students
  for select to authenticated
  using (auth_user_id = (select auth.uid()) or (select grade_private.is_staff()));

drop policy if exists assessment_definitions_read on public.assessment_definitions;
create policy assessment_definitions_read on public.assessment_definitions
  for select to authenticated using (true);
drop policy if exists assessment_definitions_insert on public.assessment_definitions;
create policy assessment_definitions_insert on public.assessment_definitions
  for insert to authenticated with check ((select grade_private.is_instructor()));
drop policy if exists assessment_definitions_update on public.assessment_definitions;
create policy assessment_definitions_update on public.assessment_definitions
  for update to authenticated
  using ((select grade_private.is_instructor()))
  with check ((select grade_private.is_instructor()));
drop policy if exists assessment_definitions_delete on public.assessment_definitions;
create policy assessment_definitions_delete on public.assessment_definitions
  for delete to authenticated using ((select grade_private.is_instructor()));

drop policy if exists grading_settings_read on public.grading_settings;
create policy grading_settings_read on public.grading_settings
  for select to authenticated using (true);
drop policy if exists grading_settings_instructor_update on public.grading_settings;
create policy grading_settings_instructor_update on public.grading_settings
  for update to authenticated
  using ((select grade_private.is_instructor()))
  with check ((select grade_private.is_instructor()));

drop policy if exists grade_entries_own_published_or_staff on public.grade_entries;
create policy grade_entries_own_published_or_staff on public.grade_entries
  for select to authenticated
  using (
    (select grade_private.is_staff())
    or (
      published = true and exists (
        select 1 from public.course_students as s
        where s.id = grade_entries.student_id
          and s.auth_user_id = (select auth.uid())
      )
    )
  );
drop policy if exists grade_entries_staff_insert on public.grade_entries;
create policy grade_entries_staff_insert on public.grade_entries
  for insert to authenticated with check ((select grade_private.is_staff()));
drop policy if exists grade_entries_staff_update on public.grade_entries;
create policy grade_entries_staff_update on public.grade_entries
  for update to authenticated
  using ((select grade_private.is_staff()))
  with check ((select grade_private.is_staff()));
drop policy if exists grade_entries_staff_delete on public.grade_entries;
create policy grade_entries_staff_delete on public.grade_entries
  for delete to authenticated using ((select grade_private.is_staff()));

-- Suggested private verification before production (run with real test users):
--  * anon cannot SELECT any gradebook table or call either public RPC.
--  * student A sees only A's roster row and published scores; unpublished
--    scores and every row of student B remain hidden, including count queries.
--  * student A cannot INSERT/UPDATE/DELETE grades or change passing threshold.
--  * TA can publish/adjust grades but cannot change passing threshold.
--  * Instructor can set pass_threshold and both staff roles can inspect all.
--  * A code for B cannot claim A; replay from another auth account fails.
--  * With allowed_email set, a valid code from another email account fails.

commit;
