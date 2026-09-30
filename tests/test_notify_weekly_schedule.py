import contextlib
import importlib.util
import io
import os
import subprocess
import sys
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "scripts" / "notify-weekly-schedule.py"


class RetiredChatworkSenderTest(unittest.TestCase):
    def test_import_and_main_never_open_a_connection_or_read_credentials(self):
        spec = importlib.util.spec_from_file_location("retired_sender", SCRIPT)
        module = importlib.util.module_from_spec(spec)
        with mock.patch("socket.socket.connect", side_effect=AssertionError("network forbidden")), mock.patch.dict(os.environ, {"CHATWORK_API_TOKEN": "fixture-not-a-secret"}), mock.patch("os.getenv", side_effect=AssertionError("credential lookup forbidden")):
            spec.loader.exec_module(module)
            with contextlib.redirect_stderr(io.StringIO()) as result:
                self.assertEqual(module.main(["--send", "--version", "fixture"]), 0)
            self.assertIn("no message sent", result.getvalue())
        self.assertFalse(hasattr(module, "request"))
        self.assertFalse(hasattr(module, "notify_all"))

    def test_legacy_cli_arguments_cannot_restore_sending(self):
        result = subprocess.run([sys.executable, str(SCRIPT), "--send", "--version", "fixture", "--room-ids", "0"], capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, 0)
        self.assertIn("no message sent", result.stderr)


if __name__ == "__main__":
    unittest.main()
