-- Apply after the gradebook schema. No roster data or credentials belong here.
create table grade_private.connection_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  university_id text not null check (university_id ~ '^[0-9]{6}$'),
  email text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null
);
create unique index one_pending_connection_per_user on grade_private.connection_requests(user_id) where status='pending';
create index connection_requests_user_date on grade_private.connection_requests(user_id, submitted_at desc);
create index connection_requests_pending_date on grade_private.connection_requests(submitted_at,id) where status='pending';
alter table grade_private.connection_requests enable row level security;
revoke all on grade_private.connection_requests from public, anon, authenticated;

create function grade_private.request_student_connection(student_id text) returns void
language plpgsql security definer set search_path='' as $$
declare actor uuid := auth.uid(); account_email text; pending_id text;
begin
  if actor is null then raise exception 'Sign in first.'; end if;
  select u.email into account_email from auth.users u where u.id=actor and u.email_confirmed_at is not null for update;
  if account_email is null then raise exception 'Confirm your email first.'; end if;
  if coalesce(grade_private.is_staff(),false) then raise exception 'Teaching staff do not need a student connection.'; end if;
  if exists(select 1 from public.course_students s where s.auth_user_id=actor) then raise exception 'Your account is already connected.'; end if;
  if student_id is null or btrim(student_id) !~ '^[0-9]{6}$' then raise exception 'Enter your six-digit student ID.'; end if;
  select r.university_id into pending_id from grade_private.connection_requests r where r.user_id=actor and r.status='pending';
  if pending_id is not null then
    if pending_id=btrim(student_id) then return; end if;
    raise exception 'A request is already pending. Ask the teaching team to reject it if the ID needs correcting.';
  end if;
  if (select count(*) from grade_private.connection_requests r where r.user_id=actor and r.submitted_at>now()-interval '1 day') >=5 then
    raise exception 'Too many requests. Contact the teaching team or try tomorrow.';
  end if;
  -- Deliberately do not reveal whether an ID exists or belongs to someone else.
  insert into grade_private.connection_requests(user_id,university_id,email) values(actor,btrim(student_id),account_email);
end $$;

create function grade_private.my_student_connection_request() returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',r.id,'university_id',r.university_id,'status',r.status,'submitted_at',r.submitted_at)
  from grade_private.connection_requests r where r.user_id=auth.uid() order by r.submitted_at desc,r.id desc limit 1
$$;

create function grade_private.list_student_connection_requests(page_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if not coalesce(grade_private.is_staff(),false) then raise exception 'Teaching staff access required.'; end if;
  if page_offset is null or page_offset<0 then raise exception 'Invalid page.'; end if;
  select coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb) into result from (
    select r.id,r.email,r.university_id,r.submitted_at,s.full_name,s.cohort,
      (s.id is not null and s.auth_user_id is null and u.email_confirmed_at is not null and u.email=r.email) as available
    from grade_private.connection_requests r
    join auth.users u on u.id=r.user_id
    left join public.course_students s on s.university_id=r.university_id
    where r.status='pending' order by r.submitted_at,r.id limit 200 offset page_offset
  ) q;
  return result;
end $$;

create function grade_private.review_student_connection(request_id uuid, approve boolean) returns void
language plpgsql security definer set search_path='' as $$
declare request grade_private.connection_requests%rowtype; target public.course_students%rowtype; account_email text;
begin
  if not coalesce(grade_private.is_staff(),false) then raise exception 'Teaching staff access required.'; end if;
  if approve is null then raise exception 'Choose approve or reject.'; end if;
  select * into request from grade_private.connection_requests r where r.id=request_id for update;
  if not found or request.status<>'pending' then raise exception 'This request is no longer pending. Refresh the list.'; end if;
  if approve then
    select u.email into account_email from auth.users u where u.id=request.user_id and u.email_confirmed_at is not null for update;
    if account_email is null or account_email<>request.email then raise exception 'The verified email has changed. Reject this request and ask the student to submit again.'; end if;
    if exists(select 1 from public.course_students s where s.auth_user_id=request.user_id) then raise exception 'This account is already connected to a record.'; end if;
    select * into target from public.course_students s where s.university_id=request.university_id for update;
    if not found then raise exception 'Student ID not found in the course roster. Reject this request and check the ID.'; end if;
    if target.auth_user_id is not null then raise exception 'This record is already connected. Contact the instructor.'; end if;
    update public.course_students set auth_user_id=request.user_id,claimed_at=now() where id=target.id;
  end if;
  update grade_private.connection_requests set status=case when approve then 'approved' else 'rejected' end,
    reviewed_at=now(),reviewed_by=auth.uid() where id=request.id;
end $$;

create function public.request_student_connection(student_id text) returns void language sql security invoker set search_path='' as $$ select grade_private.request_student_connection(student_id) $$;
create function public.my_student_connection_request() returns jsonb language sql stable security invoker set search_path='' as $$ select grade_private.my_student_connection_request() $$;
create function public.list_student_connection_requests(page_offset integer default 0) returns jsonb language sql stable security invoker set search_path='' as $$ select grade_private.list_student_connection_requests(page_offset) $$;
create function public.review_student_connection(request_id uuid, approve boolean) returns void language sql security invoker set search_path='' as $$ select grade_private.review_student_connection(request_id,approve) $$;

revoke all on function grade_private.request_student_connection(text), grade_private.my_student_connection_request(), grade_private.list_student_connection_requests(integer), grade_private.review_student_connection(uuid,boolean), public.request_student_connection(text), public.my_student_connection_request(), public.list_student_connection_requests(integer), public.review_student_connection(uuid,boolean) from public, anon, authenticated;
grant execute on function grade_private.request_student_connection(text), grade_private.my_student_connection_request(), grade_private.list_student_connection_requests(integer), grade_private.review_student_connection(uuid,boolean), public.request_student_connection(text), public.my_student_connection_request(), public.list_student_connection_requests(integer), public.review_student_connection(uuid,boolean) to authenticated;
-- Disable the old immediate-claim route so approval cannot be bypassed.
revoke execute on function public.claim_my_student(text), grade_private.claim_student(text), public.issue_unclaimed_invites(), grade_private.issue_unclaimed_invites() from public,anon,authenticated;
