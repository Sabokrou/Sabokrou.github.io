# Official grade portal setup

This page is a private, staff-managed gradebook. The static course site cannot authenticate students or keep grades private by itself. `official.html` requires the backend in `../grades-backend/schema.sql` and must not be linked to students until email delivery, roster enrollment, and access checks are complete.

## 1. Create the private gradebook

1. Create a dedicated Supabase project. In **Integrations → Data API**, turn **Default privileges for new entities** off so future public tables/functions are not automatically granted to `anon` and `authenticated`. Run `../grades-backend/schema.sql` in its SQL editor as an administrator. The migration explicitly revokes and grants access for the current objects. Keep the `grade_private` schema **out of the exposed API schemas**. See [Supabase's Data API access guide](https://supabase.com/docs/guides/api/securing-your-api).
2. Import the attached course roster privately into `public.course_students`: `learner_id`, six-digit `university_id`, `full_name`, and `cohort`. The source has no lab, exam, or assignment marks. Do not put the roster in this repository or a public bucket.
3. For each student, generate an independent cryptographically random 24-byte invitation code (48 lowercase hexadecimal characters). Store only its SHA-256 hash in `grade_private.student_invites`, tied to the correct `student_id`; keep and distribute the original code privately to that student. Add `allowed_email` where a verified university email is known. An ID or name is never a credential.
4. **Set up custom SMTP before enabling student sign-in.** Supabase's built-in sender delivers Auth messages only to addresses belonging to the project's team, so it cannot send OTPs to the class. It is currently limited to two messages per hour. For a new Free project created after 3 June 2026, the default sender also does not permit editing the Auth email template. Custom SMTP enables delivery to students and template editing. Keep SMTP credentials in Supabase Auth settings, never in GitHub. See [Supabase's SMTP guide](https://supabase.com/docs/guides/auth/auth-smtp) and [Free template change](https://supabase.com/changelog/46599-changes-to-email-template-customisation-on-free-tier).
5. Edit the **Magic Link / OTP** Auth template to include `{{ .Token }}`. The portal expects the six-digit code and verifies it with the student's email; the unmodified template sends a Magic Link instead. Allow `https://sabokrou.github.io/teaching/data-science-fundamentals/grade-tracker/official.html` as an Auth redirect URL. Test a code on a staff-owned address and then on one consenting student account. See [Supabase's OTP guide](https://supabase.com/docs/guides/auth/auth-email-passwordless).
6. Plan for **155 students**. Supabase initially limits a newly configured custom SMTP project to 30 Auth emails per hour; adjust the project Auth email limit only after confirming the provider's own sending quota, or stagger first sign-ins. Check the project's current limits in **Authentication → Rate Limits**, including the per-user resend window and shared-campus IP traffic. Keep a support path for students whose code is delayed or filtered. See [SMTP setup](https://supabase.com/docs/guides/auth/auth-smtp) and [Auth rate limits](https://supabase.com/docs/guides/auth/rate-limits).
7. Have the instructor and TA sign in once, then insert their corresponding `auth.users.id` values into `grade_private.staff_users` as `instructor` or `ta`. The template SQL is at the top of `schema.sql`. Check that each staff account resolves to exactly one intended person.

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

Only after SMTP delivery, the OTP template, private roster invitations, and all access checks work should `official.html` be linked from the live course page. To correct a mark, staff can edit the row and save again; publication is an explicit per-result control. To clear a result entirely, clear its score and status, turn publication off, and save.
