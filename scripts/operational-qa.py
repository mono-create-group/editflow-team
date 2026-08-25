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
        "編集者管理", "契約区分と担当ディレクター", "クライアント → アカウント登録",
        "編集可能スケジュール", "マニュアル保管庫", "外部編集者の支払い確定",
        "編集者からの請求書", "匿名目安箱",
    ]
    missing_manager_markers = [marker for marker in manager_feature_markers if marker not in manager_features]
    if missing_manager_markers:
        fail(f"manager feature markers missing: {', '.join(missing_manager_markers)}")
    else:
        ok("owner and director operations features")

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

    require_values("editor portal job statuses", quoted_values(editor, "HAKEN_STATUSES"), CONTRACT["editor_job_statuses"])
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
        "_autoIntegratePortalJobs", "_portalLegacyId",
        "accessEnableEnforcement", "accessDisableEnforcement",
    ]
    absent = [marker for marker in workflow_markers if marker not in index]
    if absent:
        fail(f"no-downtime workflow markers missing: {', '.join(absent)}")
    else:
        ok("legacy fallback, completion checklist, integration, and access rollback markers")
    if "jobDraftKey" not in editor or "saveJobDraft" not in editor or "clearJobDraft" not in editor:
        fail("editor progress draft protection markers missing")
    else:
        ok("editor progress drafts survive real-time rerenders")

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
