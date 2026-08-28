import importlib.util
import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location(
    "notify_system_update", ROOT / "scripts" / "notify-system-update.py"
)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


class NotificationHistoryTest(unittest.TestCase):
    def test_finds_marker_in_json_escaped_japanese(self):
        marker = "システム更新 20260825-02"
        raw = json.dumps([{"body": f"[title]{marker}[/title]"}], ensure_ascii=True)
        self.assertTrue(MODULE.history_has_marker(raw, marker))

    def test_rejects_empty_or_invalid_history(self):
        self.assertFalse(MODULE.history_has_marker("", "システム更新 1"))
        self.assertFalse(MODULE.history_has_marker("not-json", "システム更新 1"))

    def test_fixed_release_message_has_marker_url_and_ai_disclosure(self):
        message = MODULE.build_message("20260828-06", "https://example.com/app/")
        self.assertIn("[title]システム更新 20260828-06[/title]", message)
        self.assertIn("https://example.com/app/", message)
        self.assertEqual(message.count(MODULE.AI_DISCLOSURE), 1)
        self.assertTrue(message.endswith(f"{MODULE.AI_DISCLOSURE}\n[/info]"))


if __name__ == "__main__":
    unittest.main()
