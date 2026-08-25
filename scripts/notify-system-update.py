#!/usr/bin/env python3
"""Notify an existing Chatwork room after the matching Pages release is live.

No room is created. The current room history is checked first so a version is
announced at most once per room.
"""
from __future__ import annotations

import argparse
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request


API = "https://api.chatwork.com/v2"
DEFAULT_APP_URL = "https://mono-create-group.github.io/editflow-team/"
DEFAULT_ROOM_IDS = "436866454"  # Existing editor job-listing room.


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


def wait_until_live(app_url: str, version: str, timeout_seconds: int) -> None:
    sw_url = app_url.rstrip("/") + "/sw.js"
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        try:
            req = urllib.request.Request(sw_url + "?release_check=" + str(int(time.time())), headers={"Cache-Control": "no-cache"})
            with urllib.request.urlopen(req, timeout=20) as response:
                text = response.read().decode("utf-8")
            if f"mcshanai-{version}" in text:
                return
        except (urllib.error.URLError, TimeoutError):
            pass
        time.sleep(15)
    raise RuntimeError(f"live version did not become {version} within {timeout_seconds} seconds")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--version", required=True)
    parser.add_argument("--app-url", default=DEFAULT_APP_URL)
    parser.add_argument("--room-ids", default=os.getenv("CHATWORK_SYSTEM_UPDATE_ROOM_IDS", "") or DEFAULT_ROOM_IDS)
    parser.add_argument("--timeout", type=int, default=600)
    args = parser.parse_args()
    token = os.getenv("CHATWORK_API_TOKEN", "").strip()
    if not token:
        print("CHATWORK_API_TOKEN is not configured; notification failed closed", file=sys.stderr)
        return 2

    wait_until_live(args.app_url, args.version, args.timeout)
    marker = f"システム更新 {args.version}"
    message = (
        f"[info][title]{marker}[/title]\n"
        "社内アプリを更新しました。\n\n"
        "【主な変更】\n"
        "・編集代行案件の受託と担当変更\n"
        "・編集者派遣案件の直接登録\n"
        "・案件内チャット、スケジュール、マニュアル、匿名目安箱\n"
        "・編集者・ディレクターの請求書提出\n\n"
        f"【アプリ】\n{args.app_url}\n\n"
        "入力中の内容がある場合は、画面上の「保存して再読み込み」を押してください。\n"
        "[/info]"
    )
    for raw_room_id in args.room_ids.split(","):
        room_id = raw_room_id.strip()
        if not room_id.isdigit():
            raise RuntimeError(f"invalid existing room id: {room_id!r}")
        history = request(token, "GET", f"/rooms/{room_id}/messages?force=1")
        if marker in history:
            print(f"room {room_id}: version already announced")
            continue
        request(token, "POST", f"/rooms/{room_id}/messages", {"body": message, "self_unread": "0"})
        print(f"room {room_id}: notification sent")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
