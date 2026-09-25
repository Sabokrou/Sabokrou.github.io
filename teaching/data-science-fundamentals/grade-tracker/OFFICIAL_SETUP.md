# Official grade portal setup

This page is a private, staff-managed gradebook. The static course site cannot authenticate students or keep grades private by itself. `official.html` requires the backend in `../grades-backend/schema.sql` and must not be linked to students until setup and access checks are complete.

## 1. Create the private gradebook

1. Create a dedicated Supabase project. Run `../grades-backend/schema.sql` in its SQL editor as an administrator. Keep the `grade_private` schema **out of the exposed API schemas**.
2. Import the attached course roster privately into `public.course_students`: `learner_id`, six-digit `university_id`, `full_name`, and `cohort`. The source has no lab, exam, or assignment marks. Do not put the roster in this repository or a public bucket.
3. For each student, generate an independent cryptographically random 24-byte invitation code (48 lowercase hexadecimal characters). Store only its SHA-256 hash in `grade_private.student_invites`, tied to the correct `student_id`; keep and distribute the original code privately to that student. Add `allowed_email` where a verified university email is known. An ID or name is never a credential.
4. Configure Supabase Auth email OTP. The email template must include `{{ .Token }}` so students receive the code used by `official.html`. Allow `https://sabokrou.github.io/teaching/data-science-fundamentals/grade-tracker/official.html` as an Auth redirect URL. Configure an appropriate sending provider and rate limits before inviting the class.
5. Have the instructor and TA sign in once, then insert their corresponding `auth.users.id` values into `grade_private.staff_users` as `instructor` or `ta`. The template SQL is at the top of `schema.sql`. Check that each staff account resolves to exactly one intended person.

## 2. Connect the page

Set `SUPABASE_URL` and `SUPABASE_ANON_KEY` in `official-config.mjs` to this project's URL and **publishable/anon** key. These are browser-visible values; database row-level security is the access control. Never use a `service_role` key in a web page. Keep invitation codes, private roster, and actual grade data off GitHub.

The instructor sets the course pass mark from the staff screen once the official number is confirmed. Until then, students see “Not set,” and the page does not make a pass/fail decision. The assessment scheme is seeded in `schema.sql`: 12 weekly labs (best nine worth 15 course points), midterm 20, final 25, and four assignments worth 10 each. A numeric lab score takes precedence in the weighted calculation; with no numeric score, Pass counts as 100% and Revise/Fail count as 0%. The staff outcome is displayed separately. Do not infer official course policy from the old browser-only planner.

The displayed total and its pass-mark comparison are rounded to two decimal course points. The university's final grade record remains authoritative.

## 3. Verify before linking

- As an anonymous visitor, confirm there is no roster or gradebook access.
- As student A, claim A's code, see only A's name and published grades, and confirm A cannot read B's record or edit any grades. An unpublished result must remain hidden even when entered by staff.
- Confirm student B cannot claim A's already-used code. If `allowed_email` is set, a different signed-in email must fail even with the code.
- As the TA, enter a lab Pass/Revise/Fail and optional score; save, then explicitly check **Visible to student** and save again. Confirm that only the intended student sees it. For a midterm or assignment, enter a numeric score before publishing. The database rejects numeric-only released labs and outcome-only released exams or assignments.
- Confirm that the TA cannot set the course pass mark; the instructor can. Verify course totals using the best nine lab results and all published weighted assessments. A final course Pass/Below pass mark appears only when the threshold is set and every assessment is published.
- If staff supply a `note` in a grade record by another method, it is shown to the student as feedback; do not store internal remarks there.

Once these checks pass, link `official.html` from the course page. To correct a mark, staff can edit the row and save again; publication is an explicit per-result control. To clear a result entirely, clear its score and status, turn publication off, and save.
