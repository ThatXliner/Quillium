"""test_evaluate.py verifies evaluation process cleanup and command output."""

import os
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
from pathlib import Path

import evaluate


class CommandTests(unittest.TestCase):
    def test_command_preserves_exit_code_and_combined_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            log = root / "command.log"
            status = evaluate.run(
                [
                    sys.executable, "-c",
                    "import sys; print('out'); print('err', file=sys.stderr); sys.exit(7)",
                ],
                root,
                log,
                os.environ,
            )
            self.assertEqual(status, 7)
            self.assertIn("out", log.read_text())
            self.assertIn("err", log.read_text())

    def test_timeout_stops_descendants_before_returning(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            ready = root / "ready"
            trigger = root / "trigger"
            survived = root / "survived"
            child = """
from pathlib import Path
import time
Path('ready').touch()
deadline = time.monotonic() + 5
while not Path('trigger').exists() and time.monotonic() < deadline:
    time.sleep(0.01)
if Path('trigger').exists():
    Path('survived').touch()
"""
            parent = (
                "import subprocess, sys, time; "
                f"subprocess.Popen([sys.executable, '-c', {child!r}]); "
                "time.sleep(60)"
            )
            with patch.object(evaluate, "PROCESS_TIMEOUT_SECONDS", 1):
                status = evaluate.run(
                    [sys.executable, "-c", parent], root, root / "timeout.log", os.environ
                )
            self.assertEqual(status, 124)
            self.assertTrue(ready.exists(), "descendant must start before the timeout")
            trigger.touch()
            deadline = time.monotonic() + 1
            while not survived.exists() and time.monotonic() < deadline:
                time.sleep(0.01)
            self.assertFalse(survived.exists(), "descendant remained alive after timeout")


if __name__ == "__main__":
    unittest.main()
