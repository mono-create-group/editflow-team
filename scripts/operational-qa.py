#!/usr/bin/env python3
"""Read-only release checks for the EditFlow static application.

This script never initializes Firebase, opens a browser, or performs a network call.
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONTRACT = json.loads((ROOT / "tests" / "operational-contract.json").read_text())
FAILURES: list[str] = []


def fail(message: str) -> None:
    FAILURES.append(message)
    print(f"FAIL {message}")


def ok(message: str) -> None:
    print(f"PASS {message}")


def read(name: str) -> str:
    path = ROOT / name
    if not path.is_file():
        fail(f"required file missing: {name}")
        return ""
    return path.read_text(encoding="utf-8")


def inline_js_syntax(name: str) -> None:
    html = read(name)
    scripts = re.findall(r"<script(?:\s[^>]*)?>(.*?)</script>", html, re.I | re.S)
    if not scripts:
        fail(f"{name}: no inline JavaScript found")
        return
    node = shutil.which("node")
    if not node:
        fail("node is required for inline JavaScript syntax checks")
        return
    for number, source in enumerate(scripts, 1):
        # node --check reports syntax only and does not execute the page code.
        result = subprocess.run([node, "--check", "-"], input=source, text=True,
                                capture_output=True, cwd=ROOT)
        if result.returncode:
            fail(f"{name}: inline script {number} has invalid syntax: {result.stderr.strip()}")
        else:
            ok(f"{name}: inline script {number} syntax")


def external_js_syntax(name: str) -> None:
    source = read(name)
    if not source:
        return
    node = shutil.which("node")
    if not node:
        fail("node is required for external JavaScript syntax checks")
        return
    result = subprocess.run([node, "--check", name], text=True, capture_output=True, cwd=ROOT)
    if result.returncode:
        fail(f"{name}: invalid syntax: {result.stderr.strip()}")
    else:
        ok(f"{name}: syntax")


def quoted_values(source: str, name: str) -> list[str] | None:
    match = re.search(rf"const\s+{re.escape(name)}\s*=\s*\[(.*?)\]", source, re.S)
    if not match:
        return None
    return re.findall(r"['\"]([^'\"]+)['\"]", match.group(1))


def quoted_set_values(source: str, name: str) -> list[str] | None:
    match = re.search(rf"const\s+{re.escape(name)}\s*=\s*new Set\(\[(.*?)\]\)", source, re.S)
    if not match:
        return None
    return re.findall(r"['\"]([^'\"]+)['\"]", match.group(1))


def require_values(label: str, actual: list[str] | None, expected: list[str]) -> None:
    if actual is None:
        fail(f"{label}: declaration missing")
    elif actual != expected:
        fail(f"{label}: expected exact {expected!r}, got {actual!r}")
    else:
        ok(f"{label}: exact contract")


def static_contract_checks() -> None:
    index = read("index.html")
    editor = read("editor.html")
    rules = read("firestore.rules")
    sw = read("sw.js")
    firebase_json = read("firebase.json")
    editor_features = read("editor-features.js")
    manager_features = read("manager-features.js")

    app_version = re.search(r"const\s+APP_VERSION\s*=\s*['\"]([^'\"]+)['\"]", index)
    cache_version = re.search(r"const\s+CACHE\s*=\s*['\"]mcshanai-([^'\"]+)['\"]", sw)
    if not app_version or not cache_version:
        fail("APP_VERSION/SW cache declaration missing")
    elif app_version.group(1) != cache_version.group(1):
        fail(f"APP_VERSION/SW cache mismatch: {app_version.group(1)} != {cache_version.group(1)}")
    else:
        ok(f"APP_VERSION/SW cache parity: {app_version.group(1)}")

    expected_version = app_version.group(1) if app_version else None
    editor_query = re.search(r'editor-features\.js\?v=([^"\']+)', editor)
    manager_query = re.search(r'manager-features\.js\?v=([^"\']+)', index)
    query_versions = {
        "editor feature query": editor_query.group(1) if editor_query else None,
        "manager feature query": manager_query.group(1) if manager_query else None,
    }
    mismatched_queries = [name for name, value in query_versions.items() if value != expected_version]
    if mismatched_queries:
        fail(f"feature cache-busting version mismatch: {', '.join(mismatched_queries)}")
    else:
        ok(f"feature cache-busting parity: {expected_version}")

    release_assets = ["editor-features.js", "manager-features.js"]
    missing_cache_assets = [asset for asset in release_assets if asset not in sw]
    if missing_cache_assets:
        fail(f"service worker cache assets missing: {', '.join(missing_cache_assets)}")
    else:
        ok("editor and manager feature bundles cached")

    editor_feature_markers = [
        "案件を探す", "編集可能スケジュール", "マニュアル保管庫", "匿名目安箱",
        "editor_job_board", "editor_schedules", "editor_manuals", "editor_suggestions",
    ]
    missing_editor_markers = [marker for marker in editor_feature_markers if marker not in editor_features]
    if missing_editor_markers:
        fail(f"editor feature markers missing: {', '.join(missing_editor_markers)}")
    else:
        ok("editor job board, schedule, manual, and suggestion features")

    manager_feature_markers = [
        "編集者管理", "契約区分と担当ディレクター", "既存クライアントを編集者へ共有",
        "legacyClients", "legacyWorkers", "crmClients", "sourceClientId", "_clientSource",
        "編集可能スケジュール", "マニュアル保管庫", "外部編集者の支払い確定",
        "編集者からの請求書", "匿名目安箱",
    ]
    missing_manager_markers = [marker for marker in manager_feature_markers if marker not in manager_features]
    if missing_manager_markers:
        fail(f"manager feature markers missing: {', '.join(missing_manager_markers)}")
    else:
        ok("owner and director operations features")

    role_preview_markers = [
        "役職別の実データ画面を確認", "rolePreviewStart", "rolePreviewOpenEditor",
        "デモデータは使いません", "applyRolePreviewReadOnly",
    ]
    absent = [marker for marker in role_preview_markers if marker not in index]
    if absent:
        fail(f"real-data role preview missing: {', '.join(absent)}")
    else:
        ok("owner real-data role preview is available and read-only")

    editor_name_markers = [
        "PREVIEW_UID_PARAM", "applyAdminPreviewReadOnly", "Chatwork表示名",
        "saveDisplayName", "Chatworkと同じ名前",
    ]
    absent = [marker for marker in editor_name_markers if marker not in editor]
    if absent:
        fail(f"editor preview/name controls missing: {', '.join(absent)}")
    else:
        ok("editor actual-data preview and Chatwork-aligned name controls")

    overdue_exclusions = ["完了", "キャンセル", "初稿提出済み", "初稿完成", "修正中", "修正稿提出済み", "D確認OK", "確認待ち", "FB待ち", "納品", "納品済み"]
    require_values("manager overdue exclusions",
                   quoted_set_values(index, "VIDEO_OVERDUE_EXCLUDED_STATUSES"),
                   overdue_exclusions)
    require_values("editor overdue exclusions",
                   quoted_set_values(editor, "JOB_OVERDUE_EXCLUDED_STATUSES"),
                   overdue_exclusions)

    board_choice_markers = [
        "DIRECT_ALL_ID='__direct_all__'", "mono.create直接編集者全員",
        "クライアントを選択", "先にクライアントを選択",
        "managerAddBoardAccount", "このクライアントにアカウントを登録",
        "managerBoardAudienceChanged", "openAll=target===DIRECT_ALL_ID",
    ]
    absent = [marker for marker in board_choice_markers if marker not in manager_features]
    if absent:
        fail(f"manager board selection guidance missing: {', '.join(absent)}")
    else:
        ok("manager board target, client, and account choices")

    video_split_markers = [
        "{id:'videoedit',label:'編集代行案件'",
        "{id:'videohaken',label:'編集者派遣案件'",
        "function rVideoEditProjects()", "function rVideoHakenProjects()",
        "function _portalVideoBiz(j)", "j.biz===biz",
        "businessType:'dispatch'", "businessType:'edit_agency'",
    ]
    absent = [marker for marker in video_split_markers
              if marker not in index and marker not in editor_features and marker not in manager_features]
    if absent:
        fail(f"video agency/dispatch screen separation missing: {', '.join(absent)}")
    else:
        ok("video agency and editor-dispatch cases use separate screens and data routes")

    editor_accept_markers = [
        "accept-entry", "accept-count", "accept-howto", "claim-button",
        "この案件を受ける", "view='jobs'",
        "担当案件に反映しました",
    ]
    absent = [marker for marker in editor_accept_markers if marker not in editor_features]
    if absent:
        fail(f"editor job acceptance emphasis/redirect missing: {', '.join(absent)}")
    else:
        ok("editor job search and acceptance are emphasized and redirect to assigned jobs")

    owner_acceptance_markers = [
        "編集者の受託画面を確認（デモ）", "./editor.html?demo=editor",
        "この管理画面は案件を掲載する側です",
        "編集者の「案件を探す」に表示",
    ]
    absent = [marker for marker in owner_acceptance_markers
              if marker not in index and marker not in manager_features]
    if absent:
        fail(f"owner acceptance preview/guidance missing: {', '.join(absent)}")
    else:
        ok("owner can open and understand the editor acceptance flow")

    if "'businessType','title','caseName'" not in rules or "request.resource.data.businessType == 'edit_agency'" not in rules:
        fail("editor job board rules do not accept only edit-agency publications")
    else:
        ok("editor job board rules accept the edit-agency publication payload")
    if "_autoIntegratePortalJobs" in index or "_syncPortalLinkedJobsToLegacy" in index:
        fail("opening the owner app must not auto-write or synthesize portal cases")
    else:
        ok("owner app load keeps existing portal and legacy case records unchanged")

    guide_markers = [
        "最初に覚える3つ", "いつ使う？", "まず最初に",
        "操作の順番", "完了の目印", "GUIDE_PAGE_CHECKS", "GUIDE_PAGE_TIPS",
    ]
    absent = [marker for marker in guide_markers if marker not in index]
    if absent:
        fail(f"first-time internal guide detail missing: {', '.join(absent)}")
    else:
        ok("first-time internal guide purpose, steps, completion, and cautions")
    editor_guide_markers = [
        "最初の1回だけすること", "毎週月曜日にすること",
        "案件を受ける2つの方法", "案件を受けた後の順番",
        "確認待ち", "修正中", "期限超過には数えません",
    ]
    absent = [marker for marker in editor_guide_markers if marker not in editor]
    if absent:
        fail(f"first-time editor guide detail missing: {', '.join(absent)}")
    else:
        ok("first-time editor guide onboarding and full workflow")

    if "rGcalReminder" in index or "Googleカレンダーを確認してください" in index:
        fail("Google Calendar confirmation banner must be removed")
    else:
        ok("Google Calendar confirmation banner removed")
    if "mono.create社内対応" not in index or re.search(r'value="__self"[^>]*>\s*自分', index):
        fail("internal assignee label is ambiguous")
    else:
        ok("internal assignee label is explicit")

    for workspace in CONTRACT["workspaces"]:
        if workspace not in index:
            fail(f"workspace label missing: {workspace}")
    if all(workspace in index for workspace in CONTRACT["workspaces"]):
        ok("three required workspace labels")

    roles = quoted_values(index, "APP_ROLES")
    require_values("seven application roles", roles, CONTRACT["roles"])
    for role in CONTRACT["roles"]:
        if role not in rules:
            fail(f"Firestore role marker missing: {role}")
    if all(role in rules for role in CONTRACT["roles"]):
        ok("Firestore role markers")
    director_editor_markers = [
        "rolesGrantVideoEditor", "role==='動画編集者'&&rolesGrantVideoEditor(roles)",
        "hasVideoEditorPermission", "roles.includes('動画編集ディレクター')",
        "hasRole(uid, '動画編集ディレクター')", "editor(request.auth.uid)",
    ]
    combined = index + editor + rules
    absent = [marker for marker in director_editor_markers if marker not in combined]
    if absent:
        fail(f"video director editor inheritance missing: {', '.join(absent)}")
    else:
        ok("video director inherits editor portal and self-service permissions")

    require_values("editor portal job statuses", quoted_values(editor, "HAKEN_STATUSES"), CONTRACT["editor_job_statuses"])
    review_schema_markers = ["workflow", "progressEvents", "parentJobId", "parentJobTitle"]
    absent = [marker for marker in review_schema_markers if marker not in rules]
    if absent:
        fail(f"review-cycle storage schema missing: {', '.join(absent)}")
    else:
        ok("review-cycle storage schema is present and legacy-compatible")
    for stage in CONTRACT["editor_review_workflow_stages"]:
        if f"'{stage}'" not in rules:
            fail(f"review-cycle workflow stage missing from rules: {stage}")
    if all(f"'{stage}'" in rules for stage in CONTRACT["editor_review_workflow_stages"]):
        ok("review-cycle workflow stages are constrained in rules")
    for event_type in CONTRACT["editor_review_event_types"]:
        if event_type not in editor and event_type not in index:
            fail(f"review-cycle event type missing from portal/manager UI: {event_type}")
    if all(event_type in editor or event_type in index for event_type in CONTRACT["editor_review_event_types"]):
        ok("review-cycle event types are surfaced by the portal or manager UI")
    review_rule_markers = [
        "function validEditorReviewTransition()", "function validManagerReviewTransition()",
        "function preservesFinalJob()", "reviewRound(request.resource.data) == reviewRound(resource.data) + 1",
    ]
    absent = [marker for marker in review_rule_markers if marker not in rules]
    if absent:
        fail(f"review-cycle role transition safeguards missing: {', '.join(absent)}")
    else:
        ok("review-cycle role transitions and final-case lock are guarded")
    for field in CONTRACT["editor_job_schedule_fields"]:
        if field not in editor or field not in index or field not in rules:
            fail(f"editor dispatch schedule field missing from a layer: {field}")
    if all(field in editor and field in index and field in rules
           for field in CONTRACT["editor_job_schedule_fields"]):
        ok("editor dispatch schedule parity across portal, ledger, and rules")
    invoice_final = quoted_values(editor, "INVOICE_FINAL")
    if invoice_final != ["提出済み", "再提出", "承認済み", "支払処理中", "支払済み"]:
        fail(f"editor invoice final statuses: unexpected {invoice_final!r}")
    else:
        ok("editor invoice final statuses")
    rule_invoice = re.search(r"function\s+validInvoiceStatus\(status\)\s*\{.*?return\s+status\s+in\s+\[(.*?)\]", rules, re.S)
    rule_values = re.findall(r"'([^']+)'", rule_invoice.group(1)) if rule_invoice else None
    require_values("Firestore invoice statuses", rule_values, CONTRACT["invoice_statuses"])

    pdf_markers = [
        "html2canvas@1.4.1", "jspdf@2.5.1", "integrity=", "generateInvoicePdf",
        "hashBlob", "sha256", "application/pdf", "ownerShareStatus == 'shared'",
        "invoiceDocumentId", "invoiceVersion",
    ]
    absent = [marker for marker in pdf_markers if marker not in editor and marker not in rules]
    if absent:
        fail(f"invoice PDF/SRI markers missing: {', '.join(absent)}")
    else:
        ok("invoice PDF, SHA-256, owner-share, and SRI markers")

    security_markers = [
        "validInvoiceAuthorization(uid, invoiceId)",
        "get(path).data.invoiceDocumentId == invoiceId",
        "validCompletedJobEvidence()",
        "compatibilityAllowed()",
        "compatibilityEmails",
        "match /invoice_authorizations/{authorizationId}",
        "match /shared/{document=**}",
        "!pureEditor(request.auth.uid)",
    ]
    absent = [marker for marker in security_markers if marker not in rules]
    if absent:
        fail(f"Firestore operational security markers missing: {', '.join(absent)}")
    else:
        ok("Firestore editor isolation, evidence, and invoice authorization markers")
    compatibility_body = re.search(r"function\s+compatibilityAllowed\(\)\s*\{(.*?)\n\s*\}", rules, re.S)
    if not compatibility_body or "!exists(accessControlPath())" in compatibility_body.group(1):
        fail("compatibility mode must fail closed when access_control is missing")
    else:
        ok("compatibility mode fails closed without an allowlist")
    access_control_match = re.search(r"match /system/access_control\s*\{(.*?)\n\s*\}", rules, re.S)
    if not access_control_match or "allow read: if signedIn();" in access_control_match.group(1):
        fail("access allowlist must not be readable by every signed-in account")
    else:
        ok("access allowlist is hidden from editors and unknown accounts")
    if "compatibilityAllowed=ACCESS_CONTROL.configured!==true" in index or "phase:'denied'" not in index:
        fail("client compatibility fallback must fail closed when config cannot be read")
    else:
        ok("client access resolution fails closed when config is unavailable")
    local_cache_markers = ["const LS_OMIT_KEYS=[...TEAM_KEYS,'bizBoard']", "delete c.settings.issuer", "legacy local cache sanitize"]
    absent = [marker for marker in local_cache_markers if marker not in index]
    if absent:
        fail(f"shared-browser local cache sanitization missing: {', '.join(absent)}")
    else:
        ok("shared-browser cache excludes team and invoice identity data")
    invoice_update = re.search(r"match /editor_invoices/\{invoiceId\}.*?allow update: if editor\(uid\)(.*?)allow update: if owner\(\)", rules, re.S)
    if not invoice_update or "validInvoiceAuthorization(uid, invoiceId)" not in invoice_update.group(1):
        fail("editor invoice updates must revalidate the exact authorization")
    else:
        ok("editor invoice updates revalidate authorization")

    workflow_markers = [
        "従来の案件管理", "OPS_CHECKLISTS", "opsRequiresChecklist",
        "promotePortalJob", "_newPortalLegacyJob", "accessPrepareCompatibilityAllowlist",
        "_portalLegacyId",
        "accessEnableEnforcement", "accessDisableEnforcement",
    ]
    absent = [marker for marker in workflow_markers if marker not in index]
    if absent:
        fail(f"no-downtime workflow markers missing: {', '.join(absent)}")
    else:
        ok("legacy fallback, completion checklist, explicit integration, and access rollback markers")
    if "jobDraftKey" not in editor or "saveJobDraft" not in editor or "clearJobDraft" not in editor:
        fail("editor progress draft protection markers missing")
    else:
        ok("editor progress drafts survive real-time rerenders")

    ledger_safety_markers = [
        "let _teamCloudLoaded=false",
        "if(!_teamCloudLoaded){console.warn('team share save skipped: cloud snapshot is not loaded');return;}",
        "['jobs','clients','workers'].includes(k)&&known>0&&cur===0",
        "if(!doc.exists){_teamCloudLoaded=true;_teamSave();return;}",
        "if(Array.isArray(remote))_teamKnownCounts[k]=remote.length",
        "const TEAM_LEDGER_RESTORE_KEY='mc_team_ledger_restore_token'",
        "replaceLedgers&&TEAM_LEDGER_KEYS.includes(k)&&Array.isArray(remote)",
        "data.restoreMode==='replace'",
        "改修直前へ完全復元",
        "function previewOperationsRestoreFile(input)",
        "function applyOperationsRestore()",
        "if(!_isOwner())return toast('オーナーのみ操作できます','err');",
    ]
    absent = [marker for marker in ledger_safety_markers if marker not in index]
    if absent:
        fail(f"case ledger startup protection/recovery markers missing: {', '.join(absent)}")
    else:
        ok("case ledger waits for cloud load, blocks empty overwrite, and restores owner-only")

    financial_markers = [
        "function _canViewFinancials(){return _isOwner();}",
        "bc.tabs.filter(_canOpenProjectTab)",
        "function rProjProfit(){\n  if(!_canViewFinancials())",
        "function rProjPayment(){\n  if(!_canViewFinancials())",
        "function rProjInvoice(){\n  if(!_canViewFinancials())",
        "function openRewardModal(type){\n  if(!_canViewFinancials())",
        "function saveReward(){\n  if(!_canViewFinancials())",
        "function toggleRewardPaid(id){\n  if(!_canViewFinancials())",
        "function delReward(id){\n  if(!_canViewFinancials())",
    ]
    absent = [marker for marker in financial_markers if marker not in index]
    if absent:
        fail(f"owner-only financial route markers missing: {', '.join(absent)}")
    else:
        ok("financial project routes fail closed for non-owners")

    try:
        config = json.loads(firebase_json)
        if config.get("firestore", {}).get("rules") != "firestore.rules":
            fail("firebase.json must map firestore.rules")
        else:
            ok("firebase.json Firestore rules mapping")
    except json.JSONDecodeError as error:
        fail(f"firebase.json invalid JSON: {error}")


def release_preflight() -> None:
    if not (ROOT / ".git").exists():
        fail("release preflight requires an EditFlow git worktree")
        return
    required = [
        "firestore.rules", "firebase.json", "editor.html", "editor-features.js",
        "manager-features.js", "scripts/notify-system-update.py",
        ".github/workflows/system-update-notify.yml",
    ]
    missing = []
    for name in required:
        tracked = subprocess.run(["git", "ls-files", "--error-unmatch", name],
                                 cwd=ROOT, text=True, capture_output=True)
        if tracked.returncode:
            missing.append(name)
    if missing:
        fail(f"release preflight: required files are untracked: {', '.join(missing)}")
    else:
        ok("release preflight: rules, portal, and update notification tracked")


def main() -> int:
    release = "--release" in sys.argv
    if set(sys.argv[1:]) - {"--release"}:
        print("usage: operational-qa.py [--release]", file=sys.stderr)
        return 2
    inline_js_syntax("index.html")
    inline_js_syntax("editor.html")
    external_js_syntax("editor-features.js")
    external_js_syntax("manager-features.js")
    static_contract_checks()
    if release:
        release_preflight()
    print(f"\n{'FAILED' if FAILURES else 'PASSED'}: {len(FAILURES)} issue(s)")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    raise SystemExit(main())
