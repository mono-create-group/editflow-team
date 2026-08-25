import importlib.util
import json
import unittest
from datetime import date
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location(
    "notify_weekly_schedule", ROOT / "scripts" / "notify-weekly-schedule.py"
)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


class WeeklyScheduleNotificationTest(unittest.TestCase):
    def test_monday_range(self):
        self.assertEqual(MODULE.monday_of(date(2026, 8, 26)), date(2026, 8, 24))

    def test_finds_week_marker(self):
        marker = "編集可能スケジュール 2026-W35"
        raw = json.dumps([{"body": f"[title]{marker}[/title]"}], ensure_ascii=True)
        self.assertTrue(MODULE.history_has_marker(raw, marker))

    def test_rejects_invalid_history(self):
        self.assertFalse(MODULE.history_has_marker("not-json", "marker"))


if __name__ == "__main__":
    unittest.main()
