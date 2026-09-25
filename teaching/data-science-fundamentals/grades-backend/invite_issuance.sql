-- Run after schema.sql. This migration contains no invitation codes or roster.
-- Its one-time RPC response is sensitive: download it directly into a private
-- CSV, distribute each code privately, and never store that CSV in this repo.
-- A second call rotates every still-unclaimed code again, invalidating the
-- first download. Already-claimed students are never changed.

begin;

-- Audit metadata only. No plaintext code, email, or student name is stored.
create table if not exists grade_private.invite_issuance_events (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  batch_id uuid not null,
  student_id uuid not null,
  issued_by uuid not null,
  replaced_existing boolean not null,
  issued_at timestamptz not null default now()
);
create index if not exists invite_issuance_events_batch_idx
  on grade_private.invite_issuance_events(batch_id);
create index if not exists invite_issuance_events_student_idx
  on grade_private.invite_issuance_events(student_id, issued_at desc);
alter table grade_private.invite_issuance_events enable row level security;
revoke all on grade_private.invite_issuance_events
  from public, anon, authenticated;

-- All row changes and returned codes are part of one RPC transaction. The
-- advisory lock serializes two instructor issuance calls. For each student,
-- lock the invitation first and then the student row, matching claim_student()
-- so an invitation claim racing with issuance cannot produce a usable code
-- for a student who has just claimed their profile.
create or replace function grade_private.issue_unclaimed_invites()
returns table (
  university_id text,
  full_name text,
  cohort text,
  invitation_code text
)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  requester uuid := auth.uid();
  batch uuid;
  candidate record;
  locked_student public.course_students%rowtype;
  prior_invite grade_private.student_invites%rowtype;
  invite_existed boolean;
  new_code text;
begin
  if requester is null or not grade_private.is_instructor() then
    raise exception 'Only an active instructor may issue invitations'
      using errcode = '42501';
  end if;

  batch := pg_catalog.gen_random_uuid();

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('data-science-fundamentals:issue-unclaimed-invites')
  );

  for candidate in
    select s.id from public.course_students as s
    where s.auth_user_id is null
    order by s.university_id
  loop
    -- The claim RPC first locks an existing invitation, then the student.
    select * into prior_invite
    from grade_private.student_invites as i
    where i.student_id = candidate.id
    for update;
    invite_existed := found;

    select * into locked_student
    from public.course_students as s
    where s.id = candidate.id
    for update;
    if not found or locked_student.auth_user_id is not null then
      continue;
    end if;

    -- A used invitation with an unclaimed student is inconsistent state;
    -- stop the whole issuance transaction for administrative review.
    if invite_existed and prior_invite.used_by is not null then
      raise exception 'Invitation claim state needs administrative review'
        using errcode = '23514';
    end if;

    new_code := pg_catalog.encode(extensions.gen_random_bytes(24), 'hex');
    insert into grade_private.student_invites as i
      (student_id, code_hash, expires_at, used_by, used_at, created_at)
    values (
      locked_student.id,
      pg_catalog.sha256(pg_catalog.convert_to(new_code, 'UTF8')),
      null, null, null, now()
    )
    on conflict (student_id) do update
      set code_hash = excluded.code_hash,
          expires_at = null,
          used_by = null,
          used_at = null,
          created_at = now();
    -- An existing allowed_email remains in place through the rotation.

    insert into grade_private.invite_issuance_events
      (batch_id, student_id, issued_by, replaced_existing)
    values (batch, locked_student.id, requester, invite_existed);

    university_id := locked_student.university_id;
    full_name := locked_student.full_name;
    cohort := locked_student.cohort;
    invitation_code := new_code;
    return next;
  end loop;
end;
$$;

-- The exposed RPC has the caller's privileges. The only privileged operation
-- is in grade_private, whose first action verifies the active instructor role.
create or replace function public.issue_unclaimed_invites()
returns table (
  university_id text,
  full_name text,
  cohort text,
  invitation_code text
)
language sql volatile security invoker set search_path = ''
as $$
  select * from grade_private.issue_unclaimed_invites();
$$;

revoke all on function grade_private.issue_unclaimed_invites(),
  public.issue_unclaimed_invites()
  from public, anon, authenticated;
grant execute on function grade_private.issue_unclaimed_invites(),
  public.issue_unclaimed_invites() to authenticated;

commit;

-- Verification plan on a disposable branch, never with real student codes:
-- 1. Anon cannot call public.issue_unclaimed_invites(); a student and TA get
--    42501. An active instructor gets exactly one row per unclaimed student.
-- 2. The returned code is 48 lowercase hex chars; sha256(convert_to(code,
--    'UTF8')) equals only the corresponding private student_invites.code_hash.
--    It does not appear in either database audit table or source control.
-- 3. Reissue rotates all unclaimed codes; old codes fail claim_my_student().
--    The private issuance audit has one metadata row per issued student.
-- 4. A claimed student's invite hash and used_by/used_at stay unchanged.
--    Issuance after all students claim returns [] and changes no invites.
-- 5. Race claim against issuance in both lock orders: claimed students are
--    skipped; old codes cannot bind a different account after rotation.
-- 6. If one insert fails (for example, forced duplicate code_hash), the RPC
--    fails and all rotations and audit rows in that call roll back.
