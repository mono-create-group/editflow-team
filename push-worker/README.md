# EditFlow editor push worker

This is a fail-closed, free-tier-only foundation for Web Push on installed iPhone web apps.

It does not contain credentials. Before deployment, set these Wrangler secrets outside Git:

- `FIREBASE_ADMIN_SA_JSON`: the dedicated service-account JSON for `editflow-mono-create`.
- `WEB_PUSH_VAPID_PUBLIC_KEY`: public key supplied to the portal at release time.
- `WEB_PUSH_VAPID_PRIVATE_KEY`: private VAPID key; never expose it to the browser.

The `/v1/push/direct-thread` endpoint verifies a Firebase ID token, then reads the named direct thread **with that caller's own ID token**. Firestore Rules therefore confirm the caller is still a participant. The worker derives the other participant from the two saved participant IDs. It accepts no recipient UID.

The dedicated service-account token is used only after that authorization check, to list the recipient's `editor_portals/{uid}/push_devices` records. At most 20 devices are sent a generic locked-screen-safe message. New devices must declare one of the two strict app paths (`./?notification=1` for the owner app or `./editor.html?notification=1` for the editor portal); the worker uses that device-local path and ignores malformed records. Editor subscriptions created before `appPath` existed keep the legacy editor route, so an app update does not silently disable their notifications. The payload contains no DM, case, sender, or financial details. `404` and `410` endpoint responses cause the matching stored device record to be removed.

Firestore permits only the signed-in owner, director, or editor to read and change that account's own `push_devices` records. This deliberately does not depend on the existence of an `editor_portals/{uid}` document, so the owner can register a device from the owner app safely.

Web Push encryption uses `@block65/webcrypto-web-push`, which is compatible with Cloudflare Workers. No D1 binding is created: it is not required for delivery and no paid resource is enabled. Add durable rate limiting/idempotency only after a free existing D1/KV binding has been explicitly reviewed.

## `POST /v1/push/notify`

The general notification endpoint. It shares the origin allow-list, the 4 KB body cap, the ID-token verification, the 20-device cap, and the expired-endpoint cleanup with `/v1/push/direct-thread`.

Request body:

| field | required for | meaning |
| --- | --- | --- |
| `kind` | always | `invoice_submitted` / `invoice_returned` / `feedback` / `case_message` |
| `portalUid` | `invoice_returned`, `feedback`, `case_message` | the editor portal the record lives under |
| `invoiceId` | `invoice_submitted`, `invoice_returned` | `editor_portals/{portalUid}/editor_invoices/{invoiceId}` |
| `jobId` | `case_message` (optional elsewhere) | `editor_portals/{portalUid}/editor_jobs/{jobId}` |

`Authorization: Bearer <Firebase ID token>` is required. **A recipient is never accepted from the caller**: a `targetUid` in the body is ignored, and the client helper does not send one.

Recipients are derived per kind, and only after the caller's own ID token has been used to re-read the named record so Firestore Rules confirm the caller still has it:

| kind | authorization read (caller's token) | recipients |
| --- | --- | --- |
| `invoice_submitted` | `editor_portals/{caller}/editor_invoices/{invoiceId}`, whose `editorUid` must be the caller | every owner account |
| `invoice_returned` | `editor_portals/{portalUid}/editor_invoices/{invoiceId}`, whose `editorUid` must be `portalUid` | `portalUid` |
| `feedback` | one-row list of `editor_portals/{portalUid}/feedback` | `portalUid`, or — when the caller *is* `portalUid` — that editor's assigned director, else the owners |
| `case_message` | `editor_portals/{portalUid}/editor_jobs/{jobId}` | the job's `editorUid`, or — when the caller *is* that editor — the assigned director, else the owners |

Owner accounts are resolved with the service account from `access` rows whose `email` is in the `OWNER_NOTIFY_EMAILS` var or whose `owner` field is `true`. Keep that var in step with `owner()` in `firestore.rules`. The caller is always removed from the recipient list, recipients are capped at 8, and one signed-in account is limited to 30 dispatches per minute per isolate (`429 rate_limited`).

The notification body is one of four fixed sentences chosen by `kind`; no name, amount, client, case title, or message text is encrypted into the payload. The destination URL is still the recipient device's own registered `appPath`, so an owner device opens `./?notification=1` and an editor device opens `./editor.html?notification=1`. `tag` and `notificationId` are derived as `editflow-{kind}-{recordId}` and `{kind}:{recordId}`, so a repeated dispatch for the same record collapses on the device instead of stacking.

Responses: `200 {ok:true,sent,expired,failed,attempted,recipients}`; `400` for a malformed `kind`/id; `401` for a bad token; `403 notify_access_denied` when Firestore Rules refuse the caller; `404 notify_target_not_found`; `429 rate_limited`; `503` for a server/config fault.

Push TTL is 86400 seconds (was 60), so a phone that is asleep or offline still receives the notification when it reconnects.

## Calling it from the app

```js
// After the underlying Firestore write has already committed.
const push = window.EditorPush;
const idToken = await firebase.auth().currentUser.getIdToken();

// Editor submitted an invoice -> tells every owner.
await push.dispatchNotify({ kind: 'invoice_submitted', invoiceId, idToken });

// Owner returned an invoice -> tells that editor.
await push.dispatchNotify({ kind: 'invoice_returned', portalUid, invoiceId, idToken });

// Feedback posted or reviewed -> tells the other side.
await push.dispatchNotify({ kind: 'feedback', portalUid, jobId, idToken });

// New case-chat message -> tells the editor, or the editor's reviewer.
await push.dispatchNotify({ kind: 'case_message', portalUid, jobId, idToken });
```

`dispatchNotify` never throws: it resolves to `{ok:true,...}` or `{ok:false,reason}`. Show a soft warning on `ok:false` (`通知は届かなかった可能性があります`) and never unwind the saved record — see `notifyPush()` in `feedback-workflow.js` for the shape to copy.

`EditorPush.ensureSubscribed({db, uid})` is an idempotent re-registration. Call it once after sign-in: if the push service expired the endpoint (this worker then deleted the device row), it silently re-subscribes. It never asks for notification permission, so it is safe to call on every start.

### Status codes for the setup UI

`EditorPush.status({db, uid})` now returns a machine-readable `reason` **and** a Japanese `message`:

`unsupported` / `ios_not_installed` / `ios_open_from_home` / `permission_denied` / `permission_default` / `server_not_ready` / `not_subscribed` / `unknown` / `ok`.

`EditorPush.reasonMessages` holds the same sentences. **UI callers must render `status.message`, not `status.reason`** — `reason` used to carry the sentence itself.
