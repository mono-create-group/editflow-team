# EditFlow release operations

This checklist is for a no-downtime static release. QA scripts are read-only; the
Firestore emulator option is local-only and must never be replaced with a live test.

## Stage and approve

1. Run `python3 scripts/operational-qa.py --release`. It must pass before release.
2. Run `scripts/firestore-rules-dry-run.sh --check`. For rule behavior fixtures,
   set a local `FIRESTORE_EMULATOR_TEST_CMD` and run with `--emulator`; do not
   supply a production project or production credentials.
3. A manager confirms each access request's identity, the least-privilege role,
   and that `動画編集者` is not combined with any other role. Record the approval
   in the normal access workflow before the editor signs in.
4. Confirm the version in `index.html` equals the `mcshanai-…` cache version in
   `sw.js`, and that `firestore.rules` plus `firebase.json` are tracked.

## Release with no downtime

1. Download the in-app operations backup before changing access enforcement.
2. Keep the current GitHub Pages bundle live. Through an owner-authenticated Firebase
   administration session, create `system/access_control` with `enforced:false`,
   `phase:"compatibility"`, and the exact non-empty `compatibilityEmails` list taken
   from the current member register. Read it back and compare the count and addresses.
   Never deploy the new rules with a missing or empty list.
3. Deploy the reviewed Firestore rules. The current page remains live and current
   allowlisted staff continue working; unknown accounts are denied, every UID-backed
   dedicated editor is denied `shared/**`, and the allowlist itself is hidden from
   editors and unknown accounts.
4. Publish the static bundle as one immutable GitHub Pages deployment, including
   `index.html`, `editor.html`, `sw.js`, and the matching application version.
   Track `firestore.rules` and `firebase.json` in the same reviewed revision, but
   deploy rules with Firebase rather than treating GitHub Pages as a rules deploy.
5. Open the public editor URL in a fresh browser profile and verify the sign-in,
   pending-access, and denied-access screens. Do not use a shared browser profile
   or a browser logged in as an administrator for editor validation.
6. Give an approved editor only the dedicated `editor.html` URL. Confirm that the
   portal exposes only the editor's assigned work and own invoice records.
7. In Settings, approve every existing staff UID and confirm the seven-role migration
   table is complete. Only then enable access enforcement. If anyone is blocked,
   use the emergency compatibility rollback; do not delete their records.

## v29 strict privacy release and legacy-finance migration

This release intentionally differs from the no-downtime path above. Deploy the
strict Firestore rules **first**. Until the v29 static files are public, old v24
owner/core-staff tabs can fail closed; do not weaken the rules to keep them open.

1. Finish the release QA and keep a restricted, mode-0600 migration backup outside
   of the repository. Never put its path, service account, ADC token, or backup
   contents in GitHub Actions logs.
2. Deploy the reviewed strict rules first. This creates the short, expected v24
   fail-closed window for old owner/core-staff tabs.
3. Push `main`, then verify the public `index.html`, `editor.html`, and `sw.js`
   all report v29 before any data migration. Confirm the exact deployed commit and
   cache version from a fresh public request.
4. Close or force-reload every owner/core app tab before Stage 2 or restore. The
   server-side restore acknowledgement rejects v24-v28 tabs and v29 tabs that
   have not received the latest migration token, but this guard does not replace
   the operational requirement to stop old tabs during the transaction.
5. Use a pinned, isolated Admin SDK runtime. Do not add it to the app package or
   enable billing.

   ```bash
   export EDITFLOW_MIGRATION_RUNTIME="$(mktemp -d /tmp/editflow-migration-XXXXXX)"
   npm install --prefix "$EDITFLOW_MIGRATION_RUNTIME" --no-save --package-lock=false \
     firebase-admin@13.5.0 --no-audit --no-fund
   export NODE_PATH="$EDITFLOW_MIGRATION_RUNTIME/node_modules"
   ```

6. Run a live **dry-run only** with the migration CLI and a secure backup path.
   It must report zero conflicts before continuing.

   ```bash
   node scripts/migrate-owner-job-finance.cjs \
     --project editflow-mono-create --adc \
     --backup /secure/restricted/editflow-v29-before-stage1.json
   ```

7. Stage 1 creates immutable `owner_legacy_finance` snapshots without clearing
   legacy money fields. Require the project confirmation and preserve the generated
   backup.

   ```bash
   node scripts/migrate-owner-job-finance.cjs \
     --apply --project editflow-mono-create --confirm-project editflow-mono-create \
     --adc --migrated-by owner-migration \
     --backup /secure/restricted/editflow-v29-stage1.json
   ```

8. Run a fresh dry-run. The expected result is **228 already migrated, 0
   candidates, 0 conflicts, 0 skips**. Any other count stops the rollout.
9. Only after that fresh result, run Stage 2 with `--clear-shared-finance`. It
   removes amount keys only; delivery, invoice, and payment dates remain.

   ```bash
   node scripts/migrate-owner-job-finance.cjs \
     --apply --clear-shared-finance \
     --project editflow-mono-create --confirm-project editflow-mono-create \
     --adc --migrated-by owner-migration \
     --backup /secure/restricted/editflow-v29-stage2.json
   ```

10. Run a new dry-run and the read-only production verification. Confirm no shared
   legacy amount keys remain, every immutable snapshot matches, and editor/director
   reads are denied while the owner can read the private ledgers.
11. If Stage 2 must be reversed, stop every owner/core tab and use the secure Stage 1/2
    backup with the explicit restore confirmation. This is the only documented
    restore command; never reconstruct financial rows by hand.

    ```bash
    node scripts/migrate-owner-job-finance.cjs \
      --restore-backup /secure/restricted/editflow-v29-stage2.json \
      --project editflow-mono-create --adc --apply \
      --confirm-project editflow-mono-create \
      --confirm-restore-owner-legacy-finance \
      --backup /secure/restricted/editflow-v29-pre-restore.json
    ```

    The restore route rejects token-only input, `--clear-shared-finance`, and
    unconfirmed projects. With a service account, replace `--adc` with the
    restricted `--service-account` path.
12. Do not send the editor system-update notice before strict rules and public v29
    verification both pass. The existing GitHub workflow sends it after that check;
    if its automatic run was disabled or missed, start the existing
    `workflow_dispatch` manually only after the same checks pass.

## Daily operating flow

1. The owner publishes editing-agency work to the job board. Eligible direct editors
   accept it in `editor.html`; the Firestore transaction allows only the first claim.
2. Dispatch editors choose a client and its account, register the work directly,
   then update status, dates, chat, draft/revision/delivery links, and evidence.
3. Editors share only availability and capacity in the schedule. They read global,
   client, and account manuals in the app and record required-manual completion.
4. Suggestions are stored without UID, name, or email. A manager replies with the
   random reply code; do not ask an editor to identify themselves in the response.
5. The owner's app automatically gives every new portal case a deterministic legacy
   link and creates the matching dispatch row. Status, received date, first-draft
   dates, thumbnail date, delivery date, progress, blocker, and evidence continue to
   synchronize without manual re-entry. If a save is interrupted, the next owner
   snapshot retries the same ID without creating a duplicate.
6. After completion, the owner sets the editor-only payable amount and month. The
   app issues a versioned invoice authorization; editors cannot select arbitrary
   jobs or amounts.
7. A directly contracted editor submits to mono.create. An external editor submits
   to their director; the director aggregates only their own team and submits one
   director invoice to mono.create.
8. The editor creates the invoice, saves the PDF to Drive, and submits it. Every
   editor-side save and submission is rechecked against the current exact
   authorization; approval also requires SHA-256 metadata and owner Drive share.
9. A return creates a new authorized immutable version. Approved invoices proceed
   through payment processing to paid; old files and event records remain.
10. HP, AI advisory, and AI app work cannot enter their public/operational/completed
   milestones until their business-specific acceptance checklist is complete.

## System-update notice

1. Every app release must change `APP_VERSION` and the `sw.js` cache version together.
2. The GitHub Actions workflow waits until that exact version is live, checks the
   existing Chatwork room history, and posts one `システム更新` notice per version.
3. It never creates a room. A missing API token, invalid existing room ID, or a Pages
   timeout fails closed without sending a partial or duplicate notice.

## Rollback

1. Stop the rollout if the preflight fails, access boundaries look wrong, or a
   service-worker version is inconsistent. Preserve the observed error and release ID.
2. Re-publish the last known-good static bundle and its matching rules/configuration.
   Do not delete Firestore records to roll back.
3. Keep the legacy internal-app flow available as the temporary fallback while the
   dedicated editor portal is corrected. Do not grant editors access to the legacy
   shared workspace as a workaround.
4. Re-run the read-only QA and local rules dry-run before attempting the next release.
