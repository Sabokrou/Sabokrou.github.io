# Make-up class planner

Open `makeup.html` from the Common Hour navigation. Select faculty and inclusive travel dates, review weekly affected sessions and groups, then select a date range. The planner checks every 30 minutes for the full original class duration. All calendar dates and times use Asia/Tashkent.

## Evidence and ranking

- `timetable.json`: existing reviewed EduPage snapshot, 16 October 2026; 607 teaching blocks. Group and room identifiers are parsed from published labels. Two-part labels matching a known room are not mistaken for student groups.
- `curricula.json`: public NewUU program pages retrieved 5 November 2026. 21 of 22 programs have structured course-code/semester tables. Medicine has an explicit coverage gap.
- Published groups are preferred. Missing groups are inferred conservatively from other sections with the same course code and require faculty review. Curriculum program/semester matches and Fall cohort prefixes (F/S/J/Se) are estimates, not student enrolment records. All semester alternatives can be deselected.
- All schools contribute to conflicts. Direct lecturer/student-group overlaps and unavailable rooms block selection. Curriculum-based potential conflicts are amber and need explicit acknowledgement. Weekdays always precede weekend fallbacks; within each, options with fewer possible curriculum conflicts rank higher, followed by lunch/edge-of-day preferences. Original rooms are preferred, then rooms without laboratory-style names. Room labels are not proof of suitability.
- Selected proposals block subsequent overlapping make-ups for the same lecturer, groups or room. Removing or changing input invalidates dependent results/drafts. Nothing is booked or emailed.

## Limits

The timetable is a weekly snapshot, not a live reservation feed. It does not prove non-teaching room availability, capacity, equipment, term validity, holidays or individual attendance. Faculty must review affected dates and can exclude dates. Room needs/student counts are included in the Academic Affairs draft for verification. Do not label options as confirmed availability. Plans are session-only; editable email drafts can be copied or downloaded.

## Maintenance

Run `python scripts/refresh-curricula.py` (requests and beautifulsoup4 required) to refresh curriculum tables. Review changes and coverage before publishing. To update the timetable, replace `timetable.json` with a verified snapshot using the documented faculty/classes/source structure; the UI also accepts a session-only JSON import. Preserve provenance and verify dates/rooms/groups. The original meeting page maintains its existing embedded snapshot separately.

## Validation

`node makeup-engine.test.cjs` tests date handling, full-duration collisions, cross-group matches, room parsing, curriculum inference, Saturday teaching, weekday ranking, travel/excluded/past-date suppression and mutual make-up conflicts. Browser smoke test: lecturer → December sample travel → four affected sessions → inferred-group review → heatmap → room selection → student and Academic Affairs editable drafts. No messages sent.
