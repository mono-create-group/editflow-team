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
