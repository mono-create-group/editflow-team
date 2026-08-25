#!/usr/bin/env bash
# Local-only wrapper. It has no credentials, no project selection, and no live writes.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
python3 scripts/operational-qa.py

if [[ "${1:-}" == "--check" ]]; then
  echo "PASS rules static dry-run; no emulator or Firebase project was contacted"
  exit 0
fi
if [[ "${1:-}" != "--emulator" ]]; then
  echo "usage: scripts/firestore-rules-dry-run.sh [--check|--emulator]" >&2
  exit 2
fi
if ! command -v firebase >/dev/null 2>&1; then
  echo "FAIL Firebase CLI is required only for --emulator; no live fallback is allowed" >&2
  exit 1
fi
if [[ -z "${FIRESTORE_EMULATOR_TEST_CMD:-}" ]]; then
  echo "FAIL set FIRESTORE_EMULATOR_TEST_CMD to a local fixture-test command before --emulator" >&2
  exit 1
fi
firebase emulators:exec --only firestore "$FIRESTORE_EMULATOR_TEST_CMD"
