#!/usr/bin/env python3
"""Retired Chatwork sender. Kept only to make old local callers harmless.

2026-09-30: the user revoked every automated Chatwork message, including
system-update notices. This entrypoint never reads credentials or contacts
Chatwork. No command-line option can re-enable it.
"""
from __future__ import annotations
import sys


def main(argv: list[str] | None = None) -> int:
    print("Chatwork automation retired: no message sent.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
