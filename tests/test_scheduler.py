import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from timetable.errors import InputError
from timetable.export import export
from timetable.input import parse_dataset
from timetable.scheduler import generate_timetables


class SchedulerTests(unittest.TestCase):
    def test_empty_dataset_is_valid_and_complete(self):
        raw = json.loads(Path("examples/empty-input.json").read_text(encoding="utf-8"))
        result = generate_timetables(parse_dataset(raw))
        self.assertEqual(result["timetables"], [])
        self.assertTrue(result["report"]["complete"])

    def test_places_subject_with_spread_variety_and_period_one_exclusion(self):
        raw = _dataset(weekly_periods=3)
        result = generate_timetables(parse_dataset(raw))
        slots = [slot for day in result["timetables"][0]["days"] for slot in day["periods"] if slot["slot_type"] == "THEORY"]
        self.assertEqual(len(slots), 3)
        self.assertEqual(len({slot["period_number"] for slot in slots}), 3)
        self.assertNotIn(1, {slot["period_number"] for slot in slots})
        self.assertTrue(result["report"]["complete"])

    def test_unresolvable_periods_are_reported(self):
        raw = _dataset(weekly_periods=4)
        raw["templates"][0]["days"] = ["Day-1", "Day-2"]
        result = generate_timetables(parse_dataset(raw))
        self.assertFalse(result["report"]["complete"])
        self.assertEqual(len(result["report"]["unresolved"]), 2)

    def test_bad_reference_is_rejected(self):
        raw = _dataset(weekly_periods=1)
        raw["classes"][0]["cc_staff_id"] = "missing"
        with self.assertRaises(InputError):
            parse_dataset(raw)

    def test_generates_three_distinct_alternatives(self):
        result = generate_timetables(parse_dataset(_dataset(weekly_periods=3)), variant_count=3)
        self.assertEqual(result["report"]["generated"], 3)
        self.assertTrue(result["report"]["complete"])
        signatures = {
            tuple(
                (day["day"], slot["period_number"], slot.get("subject_id"))
                for day in alternative["timetables"][0]["days"]
                for slot in day["periods"]
            )
            for alternative in result["alternatives"]
        }
        self.assertEqual(len(signatures), 3)

    def test_export_overwrites_tables_and_removes_stale_variants(self):
        with TemporaryDirectory() as directory:
            output = Path(directory)
            input_path = Path("examples/ai-ds-ii-i-input.json")
            export(input_path, output)
            self.assertTrue((output / "timetables.json").exists())
            self.assertTrue((output / "timetable-3.md").exists())

            stale = output / "timetable-4.md"
            stale.write_text("stale", encoding="utf-8")
            export(input_path, output)
            self.assertFalse(stale.exists())
            self.assertIn("Timetable Alternative 1", (output / "timetable-1.md").read_text(encoding="utf-8"))


def _dataset(weekly_periods: int):
    periods = [
        {"period_number": 1, "start_time": "09:00", "end_time": "10:00", "type": "TEACHING"},
        {"period_number": 2, "start_time": "10:00", "end_time": "11:00", "type": "TEACHING"},
        {"period_number": 3, "start_time": "11:15", "end_time": "12:15", "type": "TEACHING"},
        {"period_number": 4, "start_time": "12:15", "end_time": "13:00", "type": "TEACHING"},
    ]
    return {
        "departments": [{"id": "CSE", "name": "Computer Science", "hod_staff_id": "S1"}],
        "staff": [{"id": "S1", "name": "Teacher", "designation": "HOD", "home_department_id": "CSE", "subjects_taught": ["MATH"], "external_daily_hours": {}}],
        "subjects": [{"id": "MATH", "name": "Math", "department_id": "CSE", "has_lab": False, "eligible_staff": ["S1"]}],
        "templates": [{"id": "T1", "days": ["Day-1", "Day-2", "Day-3"], "periods": periods}],
        "classes": [{"id": "CSE_A", "name": "Section A", "department_id": "CSE", "cc_staff_id": "S1", "template_id": "T1", "subjects": [{"subject_id": "MATH", "weekly_theory_periods": weekly_periods}], "external_allotments": []}],
        "overrides": {},
    }


if __name__ == "__main__":
    unittest.main()
