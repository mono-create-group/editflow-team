import importlib.util
import json
import sys
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location(
    "notify_recovery_announcements", ROOT / "scripts" / "notify-recovery-announcements.py"
)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class RecoveryAnnouncementTest(unittest.TestCase):
    def test_exact_approved_bodies_and_fixed_destinations(self):
        self.assertEqual([notice.room_id for notice in MODULE.NOTICES], ["434016937", "441865949", "436866454"])
        self.assertEqual(MODULE.NOTICES[0].room_name, "菅野樹")
        self.assertEqual(MODULE.NOTICES[1].room_name, "幸林 大地")
        self.assertEqual(MODULE.NOTICES[2].room_name, "案件依頼")
        self.assertTrue(all(notice.body.endswith("これはAIでの送信です。") for notice in MODULE.NOTICES))
        self.assertEqual(MODULE.NOTICES[2].body.splitlines()[0], "[toall]")
        self.assertEqual(MODULE.NOTICES[0].body, """菅野樹さん
お疲れ様です！
「進捗を保存できませんでした」と表示された件ですが、修正が完了しました。

前回の【台本100】の初稿提出は保存されていない可能性が高いため、社内アプリを一度読み込み直し、初稿URLを再入力して「初稿提出」をもう一度お願いいたします。
ご迷惑をおかけして申し訳ございません。

これはAIでの送信です。""")
        self.assertEqual(MODULE.NOTICES[1].body, """幸林 大地さん
お疲れ様です！
請求書はまだ「下書き」の状態でしたので、差戻しは不要です。

請求書画面から内容を修正し、PDF・Drive保存をやり直した上で、そのまま提出していただけます。
よろしくお願いいたします！

これはAIでの送信です。""")
        self.assertEqual(MODULE.NOTICES[2].body, """[toall]

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

これはAIでの送信です。""")

    def test_only_exact_body_is_a_duplicate(self):
        notice = MODULE.NOTICES[0]
        exact = json.dumps([{"body": notice.body}], ensure_ascii=False)
        self.assertEqual(MODULE.notice_state(exact, notice), "duplicate")
        similar = json.dumps([{"body": notice.identity + "\n別の内容"}], ensure_ascii=False)
        with self.assertRaises(MODULE.NotificationError):
            MODULE.notice_state(similar, notice)

    def test_invalid_history_fails_closed(self):
        with self.assertRaises(MODULE.NotificationError):
            MODULE.notice_state("not-json", MODULE.NOTICES[0])

    def test_preflight_ambiguity_posts_nothing(self):
        histories = [json.dumps([{ "body": MODULE.NOTICES[0].identity }], ensure_ascii=False)]
        with mock.patch.object(MODULE, "request", side_effect=histories) as request:
            with self.assertRaises(MODULE.NotificationError):
                MODULE.notify_all("test-token")
        self.assertEqual(request.call_count, 1)
        self.assertEqual(request.call_args.args[1], "GET")

    def test_posts_only_missing_notices_and_verifies_each(self):
        empty = json.dumps([])
        responses = [empty, empty, empty]
        for notice in MODULE.NOTICES:
            responses.extend(["{}", json.dumps([{ "body": notice.body }], ensure_ascii=False)])
        with mock.patch.object(MODULE, "request", side_effect=responses) as request:
            self.assertEqual(MODULE.notify_all("test-token"), 0)
        post_calls = [call for call in request.call_args_list if call.args[1] == "POST"]
        self.assertEqual([call.args[2] for call in post_calls], [
            "/rooms/434016937/messages", "/rooms/441865949/messages", "/rooms/436866454/messages",
        ])
        self.assertEqual([call.args[3]["body"] for call in post_calls], [notice.body for notice in MODULE.NOTICES])

    def test_send_flag_is_required_without_network(self):
        with mock.patch.object(MODULE, "request") as request:
            self.assertEqual(MODULE.main([]), 2)
        request.assert_not_called()


if __name__ == "__main__":
    unittest.main()
