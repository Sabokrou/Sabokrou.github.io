-- Computer Vision gradebook extension. Run in the existing grading project.
-- Separate tables preserve the Data Science roster and assessment scheme.
begin;

create table if not exists public.cv_students (
  id uuid primary key default gen_random_uuid(),
  learner_id text not null unique,
  university_id text not null unique check (university_id ~ '^[0-9]{6}$'),
  full_name text not null check (length(btrim(full_name)) > 0),
  cohort text not null,
  auth_user_id uuid unique references auth.users(id) on delete set null,
  claimed_at timestamptz
);
create table if not exists public.cv_assessments (
  key text primary key,
  label text not null,
  category text not null check (category in ('lab','project','exam')),
  max_score numeric(7,2) not null check (max_score > 0),
  weight numeric(5,2) not null check (weight between 0 and 100),
  sort_order integer not null unique
);
create table if not exists public.cv_grades (
  student_id uuid not null references public.cv_students(id) on delete cascade,
  assessment_key text not null references public.cv_assessments(key),
  score numeric(7,2) check (score is null or score >= 0),
  published boolean not null default false,
  note text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  primary key (student_id, assessment_key)
);
create table if not exists grade_private.cv_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  university_id text not null,
  email text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null
);
create unique index if not exists cv_connections_one_pending on grade_private.cv_connections(user_id) where status='pending';
create index if not exists cv_connections_status on grade_private.cv_connections(status,submitted_at);
create table if not exists grade_private.cv_grade_changes (
  id bigint generated always as identity primary key,
  student_id uuid not null,
  assessment_key text not null,
  operation text not null,
  before_row jsonb,
  after_row jsonb,
  actor_user_id uuid,
  changed_at timestamptz not null default now()
);

insert into public.cv_assessments(key,label,category,max_score,weight,sort_order)
select 'lab_' || lpad(n::text,2,'0'), 'Lab ' || n, 'lab', 20, 0, n
from generate_series(1,15) n on conflict(key) do nothing;
insert into public.cv_assessments(key,label,category,max_score,weight,sort_order)
values ('project','Project work','project',100,15,16) on conflict(key) do nothing;
-- Exam scores can be recorded, but the source slide does not state their
-- weights. Zero here means "unconfigured", not that exams count for zero
-- in the official course grade. Do not calculate a final total yet.
insert into public.cv_assessments(key,label,category,max_score,weight,sort_order)
values ('midterm','Midterm exam','exam',100,0,17),
       ('final','Final exam','exam',100,0,18)
on conflict(key) do nothing;

create or replace function grade_private.cv_validate_grade()
returns trigger language plpgsql security definer set search_path = '' as $$
declare maximum numeric;
begin
  select max_score into maximum from public.cv_assessments where key=new.assessment_key;
  if maximum is null or new.score > maximum then raise exception 'Score exceeds assessment maximum'; end if;
  if new.published and new.score is null then raise exception 'Enter a numeric score before publishing'; end if;
  new.updated_at := now(); new.updated_by := auth.uid(); return new;
end $$;
drop trigger if exists cv_grade_validate on public.cv_grades;
create trigger cv_grade_validate before insert or update on public.cv_grades
for each row execute function grade_private.cv_validate_grade();

create or replace function grade_private.cv_audit_grade()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into grade_private.cv_grade_changes(student_id,assessment_key,operation,before_row,after_row,actor_user_id)
  values(coalesce(new.student_id,old.student_id),coalesce(new.assessment_key,old.assessment_key),tg_op,
    case when tg_op='INSERT' then null else to_jsonb(old) end,
    case when tg_op='DELETE' then null else to_jsonb(new) end,auth.uid());
  return null;
end $$;
drop trigger if exists cv_grade_audit on public.cv_grades;
create trigger cv_grade_audit after insert or update or delete on public.cv_grades
for each row execute function grade_private.cv_audit_grade();

create or replace function grade_private.cv_request_connection(student_id text)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); account_email text; pending_id text;
begin
  if actor is null then raise exception 'Sign in first'; end if;
  select u.email into account_email from auth.users u where u.id=actor and u.email_confirmed_at is not null;
  if account_email is null then raise exception 'Confirm your email first'; end if;
  if coalesce(grade_private.is_staff(),false) then raise exception 'Staff do not need a student connection'; end if;
  if exists(select 1 from public.cv_students s where s.auth_user_id=actor) then raise exception 'Account already connected'; end if;
  if student_id is null or btrim(student_id) !~ '^[0-9]{6}$' then raise exception 'Enter your six-digit student ID'; end if;
  select university_id into pending_id from grade_private.cv_connections where user_id=actor and status='pending';
  if pending_id is not null then
    if pending_id=btrim(student_id) then return; end if;
    raise exception 'A request is pending; ask staff to reject it before correcting the ID';
  end if;
  if (select count(*) from grade_private.cv_connections where user_id=actor and submitted_at>now()-interval '1 day')>=5 then
    raise exception 'Too many requests; try tomorrow or contact staff';
  end if;
  -- Do not disclose roster membership to an unapproved account.
  insert into grade_private.cv_connections(user_id,university_id,email) values(actor,btrim(student_id),account_email);
end $$;
create or replace function public.cv_request_connection(student_id text)
returns void language sql security invoker set search_path = '' as $$
  select grade_private.cv_request_connection(student_id);
$$;

create or replace function grade_private.cv_my_connection()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('university_id',r.university_id,'status',r.status,'submitted_at',r.submitted_at)
  from grade_private.cv_connections r where r.user_id=auth.uid()
  order by r.submitted_at desc,r.id desc limit 1;
$$;
create or replace function public.cv_my_connection()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select grade_private.cv_my_connection();
$$;

create or replace function grade_private.cv_list_connections()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if not coalesce(grade_private.is_staff(),false) then raise exception 'Staff access required'; end if;
  select coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) into result from (
    select r.id,r.email,r.university_id,r.submitted_at,s.full_name,s.cohort,
      (s.id is not null and s.auth_user_id is null and u.email_confirmed_at is not null and u.email=r.email) available
    from grade_private.cv_connections r join auth.users u on u.id=r.user_id
    left join public.cv_students s on s.university_id=r.university_id
    where r.status='pending' order by r.submitted_at,r.id limit 200
  ) q;
  return result;
end $$;
create or replace function public.cv_list_connections()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select grade_private.cv_list_connections();
$$;

create or replace function grade_private.cv_review_connection(request_id uuid, approve boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare request grade_private.cv_connections%rowtype; target public.cv_students%rowtype; account_email text;
begin
  if not coalesce(grade_private.is_staff(),false) then raise exception 'Staff access required'; end if;
  if approve is null then raise exception 'Choose approve or reject'; end if;
  select * into request from grade_private.cv_connections where id=request_id for update;
  if not found or request.status<>'pending' then raise exception 'Request is no longer pending'; end if;
  if approve then
    select email into account_email from auth.users where id=request.user_id and email_confirmed_at is not null;
    if account_email is null or account_email<>request.email then raise exception 'Verified email has changed'; end if;
    if exists(select 1 from public.cv_students where auth_user_id=request.user_id) then raise exception 'Account already connected'; end if;
    select * into target from public.cv_students where university_id=request.university_id for update;
    if not found or target.auth_user_id is not null then raise exception 'Student record unavailable'; end if;
    update public.cv_students set auth_user_id=request.user_id,claimed_at=now() where id=target.id;
  end if;
  update grade_private.cv_connections set status=case when approve then 'approved' else 'rejected' end,
    reviewed_at=now(),reviewed_by=auth.uid() where id=request.id;
end $$;
create or replace function public.cv_review_connection(request_id uuid, approve boolean)
returns void language sql security invoker set search_path = '' as $$
  select grade_private.cv_review_connection(request_id,approve);
$$;

alter table public.cv_students enable row level security;
alter table public.cv_assessments enable row level security;
alter table public.cv_grades enable row level security;
alter table grade_private.cv_connections enable row level security;
alter table grade_private.cv_grade_changes enable row level security;
revoke all on public.cv_students,public.cv_assessments,public.cv_grades from public,anon,authenticated;
grant select on public.cv_students,public.cv_assessments,public.cv_grades to authenticated;
grant insert,update,delete on public.cv_grades to authenticated;
revoke all on grade_private.cv_connections,grade_private.cv_grade_changes from public,anon,authenticated;
revoke all on function grade_private.cv_validate_grade(),grade_private.cv_audit_grade(),
  grade_private.cv_request_connection(text),grade_private.cv_my_connection(),grade_private.cv_list_connections(),
  grade_private.cv_review_connection(uuid,boolean),public.cv_request_connection(text),public.cv_my_connection(),
  public.cv_list_connections(),public.cv_review_connection(uuid,boolean) from public,anon,authenticated;
grant execute on function grade_private.cv_request_connection(text),grade_private.cv_my_connection(),grade_private.cv_list_connections(),
  grade_private.cv_review_connection(uuid,boolean),public.cv_request_connection(text),public.cv_my_connection(),
  public.cv_list_connections(),public.cv_review_connection(uuid,boolean) to authenticated;

create policy cv_students_read on public.cv_students for select to authenticated
using (auth_user_id=(select auth.uid()) or (select grade_private.is_staff()));
create policy cv_assessments_read on public.cv_assessments for select to authenticated using (true);
create policy cv_grades_read on public.cv_grades for select to authenticated
using ((select grade_private.is_staff()) or (published and exists
  (select 1 from public.cv_students s where s.id=cv_grades.student_id and s.auth_user_id=(select auth.uid()))));
create policy cv_grades_insert on public.cv_grades for insert to authenticated
with check ((select grade_private.is_staff()));
create policy cv_grades_update on public.cv_grades for update to authenticated
using ((select grade_private.is_staff())) with check ((select grade_private.is_staff()));
create policy cv_grades_delete on public.cv_grades for delete to authenticated
using ((select grade_private.is_staff()));

commit;
