#!/usr/bin/env python3
"""Post one Monday availability reminder to the existing editor Chatwork room."""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
import urllib.parse
import urllib.request


API = "https://api.chatwork.com/v2"
DEFAULT_EDITOR_URL = "https://mono-create-group.github.io/editflow-team/editor.html"
DEFAULT_ROOM_IDS = "436866454"
JST = dt.timezone(dt.timedelta(hours=9))


def request(token: str, method: str, path: str, data: dict[str, str] | None = None) -> str:
    body = urllib.parse.urlencode(data).encode() if data else None
    req = urllib.request.Request(
        API + path,
        data=body,
        method=method,
        headers={"X-ChatWorkToken": token, "Content-Type": "application/x-www-form-urlencoded"},
    )
    with urllib.request.urlopen(req, timeout=30) as response:
        return response.read().decode("utf-8")


def history_has_marker(history_text: str, marker: str) -> bool:
    try:
        history = json.loads(history_text) if history_text else []
    except json.JSONDecodeError:
        return False
    return any(marker in str(item.get("body", "")) for item in history if isinstance(item, dict))


def monday_of(value: dt.date) -> dt.date:
    return value - dt.timedelta(days=value.weekday())


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--editor-url", default=DEFAULT_EDITOR_URL)
    parser.add_argument("--room-ids", default=os.getenv("CHATWORK_SYSTEM_UPDATE_ROOM_IDS", "") or DEFAULT_ROOM_IDS)
    parser.add_argument("--date", help="JST date for a deterministic dry run, YYYY-MM-DD")
    args = parser.parse_args()
    token = os.getenv("CHATWORK_API_TOKEN", "").strip()
    if not token:
        print("CHATWORK_API_TOKEN is not configured; notification failed closed", file=sys.stderr)
        return 2

    today = dt.date.fromisoformat(args.date) if args.date else dt.datetime.now(JST).date()
    monday = monday_of(today)
    sunday = monday + dt.timedelta(days=6)
    iso_year, iso_week, _ = monday.isocalendar()
    marker = f"編集可能スケジュール {iso_year}-W{iso_week:02d}"
    message = (
        f"[info][title]{marker}[/title]\n"
        f"今週（{monday:%m/%d}〜{sunday:%m/%d}）の編集可能日を、社内アプリに入力してください。\n\n"
        "・入力は1週間分だけです\n"
        "・同じ予定は「一括登録」が使えます\n"
        "・毎週同じ場合は「ルーティン保存」が使えます\n\n"
        f"【編集者用アプリ】\n{args.editor_url}\n"
        "[/info]"
    )
    for raw_room_id in args.room_ids.split(","):
        room_id = raw_room_id.strip()
        if not room_id.isdigit():
            raise RuntimeError(f"invalid existing room id: {room_id!r}")
        history = request(token, "GET", f"/rooms/{room_id}/messages?force=1")
        if history_has_marker(history, marker):
            print(f"room {room_id}: week already reminded")
            continue
        request(token, "POST", f"/rooms/{room_id}/messages", {"body": message, "self_unread": "0"})
        print(f"room {room_id}: weekly reminder sent")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
