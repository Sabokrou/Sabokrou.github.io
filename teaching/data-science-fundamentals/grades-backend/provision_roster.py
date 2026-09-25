#!/usr/bin/env python3
"""Prepare a one-time private roster import and student invitation handout.

The program contains no roster or secrets. Its output must stay outside this
public repository. Run it once for a fresh gradebook before sharing any codes.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import os
from pathlib import Path
import re
import secrets


REPO_ROOT = Path(__file__).resolve().parents[3]
EXPECTED_HEADER = ("learner_id", "id_student_univer", "full_name", "group")
OUTPUT_CSV = "student_invitations_PRIVATE.csv"
OUTPUT_SQL = "roster_seed_PRIVATE.sql"


def clean(value: str) -> str:
    return " ".join(value.split())


def read_roster(path: Path, expected_count: int) -> list[tuple[str, str, str, str]]:
    lines = [line for line in path.read_text(encoding="utf-8-sig").splitlines() if line.startswith("|")]
    if len(lines) < 4:
        raise ValueError("Expected a Markdown roster table with a header and student rows")
    rows = [[clean(cell) for cell in line[1:-1].split("|")] for line in lines]
    if tuple(rows[0][:4]) != EXPECTED_HEADER:
        raise ValueError("Roster columns do not match expected learner_id, IDSS, name, group")
    width = len(rows[0])
    if width != 34 or any(len(row) != width for row in rows):
        raise ValueError("Roster must have four identity columns and 30 mark columns")
    if not all(re.fullmatch(r":?-+:?", item) for item in rows[1]):
        raise ValueError("Malformed Markdown table separator")

    students: list[tuple[str, str, str, str]] = []
    seen_learner: set[str] = set()
    seen_university: set[str] = set()
    for line_number, row in enumerate(rows[3:], start=4):
        learner_id, university_id, full_name, cohort = row[:4]
        if not learner_id.isdecimal() or not university_id.isdecimal():
            raise ValueError(f"Invalid numeric student identifiers at table row {line_number}")
        if not full_name or full_name[0] in "=+-@" or not re.fullmatch(r"[A-Z0-9]+", cohort):
            raise ValueError(f"Invalid name or cohort at table row {line_number}")
        if any(row[4:]):
            raise ValueError(f"Nonempty lecture marks found at table row {line_number}; inspect before importing")
        if learner_id in seen_learner or university_id in seen_university:
            raise ValueError(f"Duplicate student identifier at table row {line_number}")
        seen_learner.add(learner_id)
        seen_university.add(university_id)
        students.append((learner_id, university_id, full_name, cohort))
    if len(students) != expected_count:
        raise ValueError(f"Expected {expected_count} students, found {len(students)}")
    return students


def quote_sql(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def make_outputs(students: list[tuple[str, str, str, str]]) -> tuple[str, str]:
    invitation_rows = []
    roster_values = []
    invite_values = []
    for learner_id, university_id, full_name, cohort in students:
        code = secrets.token_hex(24)  # 192 random bits; never in SQL or Git.
        code_hash = hashlib.sha256(code.encode("utf-8")).hexdigest()
        invitation_rows.append((learner_id, university_id, full_name, cohort, code))
        roster_values.append("(" + ", ".join(map(quote_sql, (learner_id, university_id, full_name, cohort))) + ")")
        invite_values.append("(" + ", ".join(map(quote_sql, (learner_id, code_hash))) + ")")

    output = io.StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow((*EXPECTED_HEADER, "invitation_code"))
    writer.writerows(invitation_rows)

    sql = (
        "-- PRIVATE, one-time import for a new dedicated gradebook.\n"
        "-- Run grades-backend/schema.sql first as a database admin.\n"
        "-- This file holds identifiable student data and hashed invitation codes.\n"
        "-- Keep it out of GitHub and student-facing storage.\n"
        "-- The original invitation codes exist only in the separate private CSV.\n"
        "BEGIN;\n"
        "DO $provision$ BEGIN\n"
        "  IF EXISTS (SELECT 1 FROM public.course_students)\n"
        "     OR EXISTS (SELECT 1 FROM grade_private.student_invites) THEN\n"
        "    RAISE EXCEPTION 'Provisioning requires empty student and invitation tables';\n"
        "  END IF;\n"
        "END $provision$;\n\n"
        "INSERT INTO public.course_students\n"
        "  (learner_id, university_id, full_name, cohort)\nVALUES\n  "
        + ",\n  ".join(roster_values)
        + ";\n\n"
        "INSERT INTO grade_private.student_invites (student_id, code_hash)\n"
        "SELECT s.id, pg_catalog.decode(v.code_hash_hex, 'hex')\n"
        "FROM (VALUES\n  "
        + ",\n  ".join(invite_values)
        + "\n) AS v(learner_id, code_hash_hex)\n"
        "JOIN public.course_students AS s ON s.learner_id = v.learner_id;\n\n"
        "DO $verify$ BEGIN\n"
        f"  IF (SELECT count(*) FROM public.course_students) <> {len(students)}\n"
        f"     OR (SELECT count(*) FROM grade_private.student_invites) <> {len(students)} THEN\n"
        "    RAISE EXCEPTION 'Roster import counts failed';\n"
        "  END IF;\n"
        "END $verify$;\n"
        "COMMIT;\n"
    )
    return output.getvalue(), sql


def write_private(path: Path, contents: str) -> None:
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8", newline="") as handle:
        handle.write(contents)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--roster", type=Path, required=True, help="Private Markdown roster input")
    parser.add_argument("--output-dir", type=Path, required=True, help="Private output directory outside public repository")
    parser.add_argument("--expected-count", type=int, default=155)
    args = parser.parse_args()
    output_dir = args.output_dir.resolve()
    if output_dir == REPO_ROOT or REPO_ROOT in output_dir.parents:
        parser.error("Output directory must be outside the public Git repository")
    if args.expected_count < 1:
        parser.error("Expected count must be positive")
    if not args.roster.is_file():
        parser.error("Roster file not found")
    students = read_roster(args.roster, args.expected_count)
    csv_data, sql_data = make_outputs(students)
    output_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(output_dir, 0o700)
    csv_path = output_dir / OUTPUT_CSV
    sql_path = output_dir / OUTPUT_SQL
    if csv_path.exists() or sql_path.exists():
        parser.error("Private outputs already exist; refusing to rotate invitation codes")
    write_private(csv_path, csv_data)
    write_private(sql_path, sql_data)
    print(f"Prepared {len(students)} student invitations. Private files: {csv_path} and {sql_path}")
    print("No existing marks were imported. Keep codes private and distribute each to its matching student.")


if __name__ == "__main__":
    main()
