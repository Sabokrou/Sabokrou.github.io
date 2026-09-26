-- Run in SQL editor after student-connections.sql. All fixtures are rolled back.
begin;
select set_config('test.student',gen_random_uuid()::text,true);
select set_config('test.other',gen_random_uuid()::text,true);
select set_config('test.unverified',gen_random_uuid()::text,true);
select set_config('test.ta',gen_random_uuid()::text,true);
insert into auth.users(id,email,email_confirmed_at,role,aud)
select current_setting('test.'||x)::uuid, 'connection-test-'||current_setting('test.'||x)||'@example.invalid',case when x='unverified' then null else now() end,'authenticated','authenticated'
from unnest(array['student','other','unverified','ta']) x;
insert into grade_private.staff_users(user_id,role,active) values(current_setting('test.ta')::uuid,'ta',true);
-- Fail rather than touch real records if these reserved test IDs are ever present.
insert into public.course_students(learner_id,university_id,full_name,cohort) values
('connection-test-a','000001','Connection Test A','Test'),('connection-test-b','000002','Connection Test B','Test');
select set_config('request.jwt.claim.sub',current_setting('test.ta'),true);
insert into public.grade_entries(student_id,assessment_key,score,outcome,published)
select id,'midterm',80,'pass',true from public.course_students where university_id in ('000001','000002');
insert into public.grade_entries(student_id,assessment_key,score,outcome,published)
select id,'final',90,'pass',false from public.course_students where university_id='000001';

do $$ begin if not (not has_function_privilege('authenticated','public.claim_my_student(text)','execute')) then raise exception 'FAIL: legacy claim disabled'; end if; end $$;
do $$ begin if not (not has_function_privilege('anon','public.request_student_connection(text)','execute')) then raise exception 'FAIL: anonymous request denied'; end if; end $$;
do $$ begin if not (not has_table_privilege('authenticated','grade_private.connection_requests','select')) then raise exception 'FAIL: private request table denied'; end if; end $$;
reset role; select set_config('request.jwt.claim.sub',current_setting('test.unverified'),true); set local role authenticated;
do $$ begin begin perform public.request_student_connection('000001'); exception when others then if position('Confirm your email first' in sqlerrm)>0 then return; end if; raise; end; raise exception 'FAIL: expected Confirm your email first'; end $$;
reset role; select set_config('request.jwt.claim.sub',current_setting('test.student'),true); set local role authenticated;
do $$ begin begin perform public.request_student_connection('abc'); exception when others then if position('six-digit' in sqlerrm)>0 then return; end if; raise; end; raise exception 'FAIL: expected six-digit'; end $$;
select public.request_student_connection('000001'); select public.request_student_connection('000001');
do $$ begin if not ((select count(*)=0 from public.course_students)) then raise exception 'FAIL: pending student cannot read roster'; end if; end $$;
do $$ begin if not ((select count(*)=0 from public.grade_entries)) then raise exception 'FAIL: pending student cannot read grades'; end if; end $$;
do $$ begin if not (public.my_student_connection_request()->>'status'='pending') then raise exception 'FAIL: own status visible'; end if; end $$;
select set_config('test.request_a',public.my_student_connection_request()->>'id',true);
do $$ begin begin perform public.list_student_connection_requests(0); exception when others then if position('Teaching staff access required' in sqlerrm)>0 then return; end if; raise; end; raise exception 'FAIL: expected Teaching staff access required'; end $$;
do $$ begin begin perform public.review_student_connection(current_setting('test.request_a')::uuid,true); exception when others then if position('Teaching staff access required' in sqlerrm)>0 then return; end if; raise; end; raise exception 'FAIL: expected Teaching staff access required'; end $$;
do $$ begin begin perform public.request_student_connection('000002'); exception when others then if position('already pending' in sqlerrm)>0 then return; end if; raise; end; raise exception 'FAIL: expected already pending'; end $$;
reset role; select set_config('request.jwt.claim.sub',current_setting('test.other'),true); set local role authenticated;
do $$ begin if not (public.my_student_connection_request() is null) then raise exception 'FAIL: other user cannot read status'; end if; end $$;
select public.request_student_connection('000001'); select set_config('test.request_b',public.my_student_connection_request()->>'id',true);
reset role; select set_config('request.jwt.claim.sub',current_setting('test.ta'),true); set local role authenticated;
do $$ begin if not (jsonb_array_length(public.list_student_connection_requests(0))>=2) then raise exception 'FAIL: TA can review pending requests'; end if; end $$;
select public.review_student_connection(current_setting('test.request_a')::uuid,true);
do $$ begin begin perform public.review_student_connection(current_setting('test.request_b')::uuid,true); exception when others then if position('already connected' in sqlerrm)>0 then return; end if; raise; end; raise exception 'FAIL: expected already connected'; end $$;
select public.review_student_connection(current_setting('test.request_b')::uuid,false);
do $$ begin begin perform public.review_student_connection(current_setting('test.request_a')::uuid,true); exception when others then if position('no longer pending' in sqlerrm)>0 then return; end if; raise; end; raise exception 'FAIL: expected no longer pending'; end $$;
reset role; select set_config('request.jwt.claim.sub',current_setting('test.student'),true); set local role authenticated;
do $$ begin if not ((select count(*)=1 and min(university_id)='000001' from public.course_students)) then raise exception 'FAIL: approved student sees own record only'; end if; end $$;
do $$ begin if not ((select count(*)=1 and min(assessment_key)='midterm' and bool_and(published) from public.grade_entries)) then raise exception 'FAIL: approved student sees only own published grades'; end if; end $$;
do $$ begin begin perform public.request_student_connection('000002'); exception when others then if position('already connected' in sqlerrm)>0 then return; end if; raise; end; raise exception 'FAIL: expected already connected'; end $$;
reset role; select set_config('request.jwt.claim.sub',current_setting('test.other'),true); set local role authenticated;
do $$ begin if not (public.my_student_connection_request()->>'status'='rejected') then raise exception 'FAIL: rejection visible'; end if; end $$;
do $$ begin if not ((select count(*)=0 from public.grade_entries)) then raise exception 'FAIL: rejected student cannot read grades'; end if; end $$;
select public.request_student_connection('000002'); select set_config('test.request_c',public.my_student_connection_request()->>'id',true);
reset role; select set_config('request.jwt.claim.sub',current_setting('test.ta'),true); set local role authenticated;
select public.review_student_connection(current_setting('test.request_c')::uuid,true);
reset role; select set_config('request.jwt.claim.sub',current_setting('test.other'),true); set local role authenticated;
do $$ begin if not ((select count(*)=1 and min(university_id)='000002' from public.course_students)) then raise exception 'FAIL: corrected request connects right record'; end if; end $$;
reset role; rollback; select 'PASS: verification, privacy, idempotency, TA approval, rejection, duplicate protection, corrected request, and legacy-route checks; all fixtures rolled back' as result;
