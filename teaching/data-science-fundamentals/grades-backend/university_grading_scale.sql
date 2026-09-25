-- Run after schema.sql for the Fall 2026/27 Data Science Fundamentals course.
-- Source: New Uzbekistan University, Academic Regulations, approved
-- March 2026 and effective Fall 2026/27, sections 14.1-14.2. The university
-- grading scale places the minimum passing course grade (D) at 40%.
--
-- This sets the course threshold only if no instructor threshold has yet been
-- configured. It does not change any existing instructor decision or encode
-- the full letter-grade bands. The instructor can still adjust the threshold
-- if an approved course-specific rule requires a higher passing mark.

begin;

update public.grading_settings
set pass_threshold = 40.00,
    updated_at = now()
where id = 1 and pass_threshold is null;

comment on column public.grading_settings.pass_threshold is
  'Course pass threshold out of 100. Seeded to the NewUU minimum D (40%) only when unset, per Academic Regulations approved March 2026, effective Fall 2026/27, sections 14.1-14.2; instructor may configure an approved course-specific threshold.';

commit;

-- Read-only post-migration check:
-- select id, pass_threshold, updated_at
-- from public.grading_settings where id = 1;
-- Expected: 40.00 if previously NULL; an existing non-NULL value is unchanged.
