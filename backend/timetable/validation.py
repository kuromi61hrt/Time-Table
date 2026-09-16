from __future__ import annotations

from collections import Counter, defaultdict
from typing import Any

from .models import Dataset


def validate_output(dataset: Dataset, timetables: list[dict[str, Any]]) -> list[dict[str, Any]]:
    violations: list[dict[str, Any]] = []
    class_by_id = {section.id: section for section in dataset.classes}
    staff_daily: Counter[tuple[str, str]] = Counter()
    for timetable in timetables:
        class_id = timetable["class_id"]
        section = class_by_id[class_id]
        template = dataset.templates[section.template_id]
        policy = dataset.overrides[section.department_id]
        period_map = {period.period_number: period for period in template.periods if period.type == "TEACHING"}
        counts: Counter[str] = Counter()
        subject_days: defaultdict[str, Counter[str]] = defaultdict(Counter)
        for day_data in timetable["days"]:
            day = day_data["day"]
            theory = [slot for slot in day_data["periods"] if slot["slot_type"] == "THEORY"]
            by_number = {slot["period_number"]: slot for slot in theory}
            for slot in theory:
                subject_id, staff_id, number = slot["subject_id"], slot["staff_id"], slot["period_number"]
                counts[subject_id] += 1
                subject_days[subject_id][day] += 1
                staff_daily[(staff_id, day)] += 1
                if number == 1 and staff_id in {dataset.departments[section.department_id].hod_staff_id, section.cc_staff_id}:
                    violations.append(_violation(class_id, subject_id, "R3", f"Staff {staff_id} is excluded from Period 1"))
                for other_number, other in by_number.items():
                    if other_number > number and other["subject_id"] == subject_id:
                        first, second = period_map[number], period_map[other_number]
                        if first.end_time == second.start_time or second.end_time == first.start_time:
                            violations.append(_violation(class_id, subject_id, "R2", f"Consecutive placements on {day}, periods {number} and {other_number}"))
            for subject_id, daily_count in Counter(slot["subject_id"] for slot in theory).items():
                allowed = 2 if policy.allow_same_subject_twice_per_day_fallback else 1
                if daily_count > allowed:
                    violations.append(_violation(class_id, subject_id, "R1", f"{daily_count} theory periods on {day}; maximum is {allowed}"))
        for requirement in section.subjects:
            if counts[requirement.subject_id] < requirement.weekly_theory_periods:
                # Missing periods are reported in the unresolved list by the generator.
                continue
            used_periods = [slot["period_number"] for day in timetable["days"] for slot in day["periods"] if slot.get("subject_id") == requirement.subject_id and slot["slot_type"] == "THEORY"]
            if len(used_periods) > 1 and len(set(used_periods)) == 1:
                violations.append(_violation(class_id, requirement.subject_id, "R6", "Every weekly placement uses the same period number"))
    for (staff_id, day), assigned in staff_daily.items():
        staff = dataset.staff[staff_id]
        related_classes = [section for section in dataset.classes if any(requirement.subject_id in staff.subjects_taught for requirement in section.subjects)]
        caps = [dataset.overrides[section.department_id].daily_staff_hour_cap for section in related_classes] or [5]
        cap = min(caps)
        if assigned + staff.external_daily_hours.get(day, 0) > cap:
            violations.append(_violation("*", "*", "R4", f"Staff {staff_id} has {assigned} theory plus {staff.external_daily_hours.get(day, 0)} external hours on {day}, above cap {cap}"))
    return violations


def _violation(class_id: str, subject_id: str, rule: str, reason: str) -> dict[str, str]:
    return {"class_id": class_id, "subject_id": subject_id, "rule": rule, "reason": reason}

