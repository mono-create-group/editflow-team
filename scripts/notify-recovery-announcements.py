#!/usr/bin/env python3
"""Send the three approved recovery notices once, with fail-closed verification.

This script intentionally has no configurable destinations or body text.  It is
only callable with ``--send`` by the manually dispatched GitHub Actions
workflow.  Each room is checked for the *exact* approved body before posting;
an earlier, similar recovery notice is treated as ambiguous and stops the run.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass


API = "https://api.chatwork.com/v2"
AI_DISCLOSURE = "これはAIでの送信です。"


@dataclass(frozen=True)
class Notice:
    room_id: str
    room_name: str
    identity: str
    body: str


NOTICES = (
    Notice(
        room_id="434016937",
        room_name="菅野樹",
        identity="「進捗を保存できませんでした」と表示された件ですが、修正が完了しました。",
        body="""菅野樹さん
お疲れ様です！
「進捗を保存できませんでした」と表示された件ですが、修正が完了しました。

前回の【台本100】の初稿提出は保存されていない可能性が高いため、社内アプリを一度読み込み直し、初稿URLを再入力して「初稿提出」をもう一度お願いいたします。
ご迷惑をおかけして申し訳ございません。

これはAIでの送信です。""",
    ),
    Notice(
        room_id="441865949",
        room_name="幸林 大地",
        identity="請求書はまだ「下書き」の状態でしたので、差戻しは不要です。",
        body="""幸林 大地さん
お疲れ様です！
請求書はまだ「下書き」の状態でしたので、差戻しは不要です。

請求書画面から内容を修正し、PDF・Drive保存をやり直した上で、そのまま提出していただけます。
よろしくお願いいたします！

これはAIでの送信です。""",
    ),
    Notice(
        room_id="436866454",
        room_name="案件依頼",
        identity="社内アプリの復旧が完了しました。",
        body="""[toall]

お疲れ様です！
社内アプリの復旧が完了しました。

案件一覧の表示、進捗の保存、案件内チャットが正常に利用できることを確認しています。

お手数ですが、
一度画面を再読み込みしてからご利用ください！

【社内アプリ】
https://mono-create-group.github.io/editflow-team/editor.html

もし保存や表示でエラーが出た場合は、
このチャットにご連絡ください。

よろしくお願いいたします！

これはAIでの送信です。""",
    ),
)


class NotificationError(RuntimeError):
    """An unsafe or unverified notification state."""


def request(token: str, method: str, path: str, data: dict[str, str] | None = None) -> str:
    encoded = urllib.parse.urlencode(data).encode("utf-8") if data else None
    req = urllib.request.Request(
        API + path,
        data=encoded,
        method=method,
        headers={"X-ChatWorkToken": token, "Content-Type": "application/x-www-form-urlencoded"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            return response.read().decode("utf-8")
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as error:
        # Do not include request headers or response text: either could expose a secret.
        raise NotificationError(f"Chatwork {method} request failed for {path}") from error


def parse_history(raw_history: str) -> list[dict[str, object]]:
    try:
        parsed = json.loads(raw_history)
    except json.JSONDecodeError as error:
        raise NotificationError("Chatwork history was not valid JSON") from error
    if not isinstance(parsed, list) or not all(isinstance(item, dict) and isinstance(item.get("body"), str) for item in parsed):
        raise NotificationError("Chatwork history had an unexpected shape")
    return parsed


def notice_state(raw_history: str, notice: Notice) -> str:
    """Return duplicate/send; reject a similar-but-not-exact prior announcement."""
    bodies = [str(item["body"]) for item in parse_history(raw_history)]
    if any(body == notice.body for body in bodies):
        return "duplicate"
    if any(notice.identity in body for body in bodies):
        raise NotificationError(f"room {notice.room_id}: similar recovery notice found; refusing to guess")
    return "send"


def validate_notices() -> None:
    room_ids = [notice.room_id for notice in NOTICES]
    if len(room_ids) != len(set(room_ids)):
        raise NotificationError("duplicate Chatwork room IDs are not allowed")
    for notice in NOTICES:
        if not notice.room_id.isdigit() or not notice.body.endswith(AI_DISCLOSURE):
            raise NotificationError("approved recovery notice configuration is invalid")


def notify_all(token: str) -> int:
    """Preflight all rooms, then post and verify every still-missing exact body.

    Chatwork has no multi-room transaction.  The all-room preflight prevents any
    posts when any destination is already ambiguous; each individual post is
    verified before moving to the next destination.
    """
    validate_notices()
    states: list[tuple[Notice, str]] = []
    for notice in NOTICES:
        history = request(token, "GET", f"/rooms/{notice.room_id}/messages?force=1")
        states.append((notice, notice_state(history, notice)))

    failures = 0
    for notice, state in states:
        if state == "duplicate":
            print(f"room {notice.room_id}: approved recovery notice already present")
            continue
        try:
            request(token, "POST", f"/rooms/{notice.room_id}/messages", {"body": notice.body, "self_unread": "0"})
            posted_history = request(token, "GET", f"/rooms/{notice.room_id}/messages?force=1")
            if notice_state(posted_history, notice) != "duplicate":
                raise NotificationError(f"room {notice.room_id}: exact recovery notice was not confirmed")
            print(f"room {notice.room_id}: approved recovery notice sent and verified")
        except NotificationError as error:
            failures += 1
            print(str(error), file=sys.stderr)

    return 1 if failures else 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Send the three approved recovery announcements once.")
    parser.add_argument("--send", action="store_true", help="required explicit send gate")
    args = parser.parse_args(argv)
    if not args.send:
        print("refusing to send without --send", file=sys.stderr)
        return 2
    token = os.getenv("CHATWORK_API_TOKEN", "").strip()
    if not token:
        print("CHATWORK_API_TOKEN is not configured; notification failed closed", file=sys.stderr)
        return 2
    try:
        return notify_all(token)
    except NotificationError as error:
        print(str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
