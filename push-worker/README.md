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
