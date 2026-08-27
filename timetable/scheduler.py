from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass
from typing import Any

from .models import ClassSection, Dataset, Period, Policy
from .validation import validate_output


@dataclass(frozen=True)
class Placement:
    day: str
    period_number: int
    subject_id: str
    staff_id: str


def _are_adjacent(first: Period, second: Period) -> bool:
    return first.end_time == second.start_time or second.end_time == first.start_time


def _schedule_class(
    dataset: Dataset,
    section: ClassSection,
    staff_load: Counter[tuple[str, str]],
    variant_index: int = 0,
) -> tuple[list[Placement], list[dict[str, Any]], list[dict[str, Any]]]:
    template = dataset.templates[section.template_id]
    policy = dataset.overrides[section.department_id]
    periods = {period.period_number: period for period in template.periods if period.type == "TEACHING"}
    external = {(item.day, number): item for item in section.external_allotments for number in item.period_numbers}
    open_slots = [(day, number) for day in template.days for number in sorted(periods) if (day, number) not in external and number not in policy.excluded_periods]
    placements: list[Placement] = []
    unresolved: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []
    subject_days: Counter[tuple[str, str]] = Counter()
    subject_periods: defaultdict[str, list[int]] = defaultdict(list)
    day_rank = {day: (index - variant_index) % len(template.days) for index, day in enumerate(template.days)}
    period_numbers = sorted(periods)
    period_rank = {
        number: (index - (variant_index * 2)) % len(period_numbers)
        for index, number in enumerate(period_numbers)
    }
    requirements = sorted(
        section.subjects,
        key=lambda item: (
            len(dataset.subjects[item.subject_id].eligible_staff),
            -item.weekly_theory_periods,
            (sum(ord(char) for char in item.subject_id) + variant_index) % max(len(section.subjects), 1),
            item.subject_id,
        ),
    )

    for requirement in requirements:
        subject = dataset.subjects[requirement.subject_id]
        for occurrence in range(requirement.weekly_theory_periods):
            candidates: list[tuple[tuple[Any, ...], str, int, str, bool]] = []
            for day, number in open_slots:
                same_day_count = subject_days[(subject.id, day)]
                fallback = same_day_count > 0
                if fallback and (not policy.allow_same_subject_twice_per_day_fallback or same_day_count >= 2):
                    continue
                if any(item.day == day and item.subject_id == subject.id and _are_adjacent(periods[number], periods[item.period_number]) for item in placements):
                    continue
                for staff_id in sorted(subject.eligible_staff):
                    department = dataset.departments[section.department_id]
                    if number == 1 and staff_id in {department.hod_staff_id, section.cc_staff_id}:
                        continue
                    external_hours = dataset.staff[staff_id].external_daily_hours.get(day, 0)
                    if external_hours + staff_load[(staff_id, day)] >= policy.daily_staff_hour_cap:
                        continue
                    period_reuse = subject_periods[subject.id].count(number)
                    score = (
                        fallback,
                        same_day_count,
                        period_reuse,
                        staff_load[(staff_id, day)],
                        day_rank[day],
                        period_rank[number],
                        staff_id,
                    )
                    candidates.append((score, day, number, staff_id, fallback))
            if not candidates:
                unresolved.append({
                    "class_id": section.id,
                    "subject_id": subject.id,
                    "rule": "UNRESOLVED",
                    "reason": f"No valid slot/staff combination for required occurrence {occurrence + 1} of {requirement.weekly_theory_periods}",
                })
                continue
            _, day, number, staff_id, used_fallback = min(candidates, key=lambda item: item[0])
            placement = Placement(day, number, subject.id, staff_id)
            placements.append(placement)
            open_slots.remove((day, number))
            subject_days[(subject.id, day)] += 1
            subject_periods[subject.id].append(number)
            staff_load[(staff_id, day)] += 1
            if used_fallback:
                warnings.append({
                    "class_id": section.id, "subject_id": subject.id, "rule": "R5_FALLBACK",
                    "reason": f"Placed a second non-adjacent theory period on {day} because the configured fallback policy allows it",
                })
    return placements, unresolved, warnings


def _serialize_class(dataset: Dataset, section: ClassSection, placements: list[Placement]) -> dict[str, Any]:
    template = dataset.templates[section.template_id]
    theory = {(item.day, item.period_number): item for item in placements}
    external = {(item.day, number): item for item in section.external_allotments for number in item.period_numbers}
    days = []
    for day in template.days:
        slots = []
        for period in sorted(template.periods, key=lambda item: (item.start_time, item.period_number)):
            if period.type != "TEACHING":
                continue
            key = (day, period.period_number)
            if key in theory:
                item = theory[key]
                slots.append({"period_number": period.period_number, "slot_type": "THEORY", "subject_id": item.subject_id, "staff_id": item.staff_id})
            elif key in external:
                item = external[key]
                slot = {"period_number": period.period_number, "slot_type": "EXTERNAL", "external_type": item.type, "subject_id": item.subject_id, "staff_id": item.staff_id}
                slots.append(slot)
            else:
                slots.append({"period_number": period.period_number, "slot_type": "OPEN"})
        days.append({"day": day, "periods": slots})
    return {"class_id": section.id, "days": days}


def _generate_one(dataset: Dataset, variant_index: int = 0) -> dict[str, Any]:
    staff_load: Counter[tuple[str, str]] = Counter()
    generated = []
    unresolved: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []
    for section in sorted(dataset.classes, key=lambda item: (item.department_id, item.id)):
        placements, class_unresolved, class_warnings = _schedule_class(dataset, section, staff_load, variant_index)
        generated.append(_serialize_class(dataset, section, placements))
        unresolved.extend(class_unresolved)
        warnings.extend(class_warnings)
    violations = validate_output(dataset, generated)
    return {
        "timetables": generated,
        "report": {
            "complete": not unresolved and not violations,
            "unresolved": unresolved,
            "violations": violations,
            "warnings": warnings,
            "known_limitations": ["Cross-class staff double-booking by time slot is not checked in v1."],
        },
    }


def generate_timetables(dataset: Dataset, variant_count: int = 1) -> dict[str, Any]:
    if variant_count < 1 or variant_count > 10:
        raise ValueError("variant_count must be between 1 and 10")
    if variant_count == 1:
        return _generate_one(dataset)

    alternatives = []
    incomplete_alternatives = []
    signatures: set[tuple[Any, ...]] = set()
    attempt = 0
    max_attempts = max(100, variant_count * 20)
    while len(alternatives) < variant_count and attempt < max_attempts:
        result = _generate_one(dataset, attempt)
        signature = tuple(
            (timetable["class_id"], day["day"], slot["period_number"], slot.get("subject_id"), slot.get("staff_id"))
            for timetable in result["timetables"]
            for day in timetable["days"]
            for slot in day["periods"]
        )
        if signature not in signatures:
            signatures.add(signature)
            if result["report"]["complete"]:
                alternatives.append({"alternative": len(alternatives) + 1, **result})
            else:
                incomplete_alternatives.append(result)
        attempt += 1

    if len(alternatives) < variant_count:
        for result in incomplete_alternatives[: variant_count - len(alternatives)]:
            alternatives.append({"alternative": len(alternatives) + 1, **result})

    return {
        "alternatives": alternatives,
        "report": {
            "requested": variant_count,
            "generated": len(alternatives),
            "complete": len(alternatives) == variant_count and all(item["report"]["complete"] for item in alternatives),
        },
    }
