# Quip beta deployment

The desktop app and cloud functions are implemented in this repository. A production deployment requires your Supabase project, Paddle account, and Apple signing identity. None is created, purchased, or configured automatically. Local drafts work without those services; AI requires sign-in to a deployed backend.

## Supabase

1. Create a Supabase project and enable email OTP authentication. In **Authentication → Email Templates → Magic Link**, include `{{ .Token }}` in the email so users can enter the code in the desktop app. Configure a production SMTP sender and auth abuse protection before public invitations.
2. Apply `supabase/migrations/202609080001_workspace.sql`. The database includes ownership policies, composite foreign keys, atomic usage reservations, document search, source indexing, and ordered/idempotent billing updates. Do not grant authenticated clients write access to these tables or privileged functions.
3. Configure backend secrets with the Supabase dashboard or `supabase secrets set --env-file <private-file-outside-repo>`. Required names:

   - `GEMINI_API_KEY`; optional `GEMINI_MODEL` (default `gemini-3.6-flash`). Use a billing-enabled production key.
   - `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET`, `PADDLE_PRICE_ID`, `PADDLE_HOSTED_CHECKOUT_URL`.
   - `PADDLE_ENVIRONMENT=sandbox` during billing testing; set `production` for live billing.
   - `BILLING_RECONCILIATION_SECRET`: a separate random secret for the reconciliation endpoint.
   - Optional `TRIAL_REQUEST_LIMIT=30`, `PRO_REQUEST_LIMIT=300`.
   - Optional `TRIAL_INDEX_CHARACTER_LIMIT=1000000`, `PRO_INDEX_CHARACTER_LIMIT=20000000`: monthly limits on document text sent for embedding, including retries. These protect service cost separately from the storage allowance. Deleting conversations or sources does not reset provider usage.

4. Run `bash scripts/deploy-cloud.sh` with `QUIP_SUPABASE_PROJECT_REF`, `SUPABASE_ACCESS_TOKEN`, and `SUPABASE_DB_PASSWORD` in the environment. It validates code/tests before applying the migration and deploying the three functions. Every workspace request verifies its access token using Supabase Auth; gateway JWT verification is disabled only because authentication happens explicitly inside the function. Webhooks and reconciliation use separate authentication.
5. Set the two **public** app values, `QUIP_SUPABASE_URL` and `QUIP_SUPABASE_ANON_KEY`, in the build environment. `npm run build:electron` creates the allow-listed `build/service-config.json`. Never put the service-role key in the app. The renderer receives no tokens; main stores the auth session and cached work using Electron's OS-protected `safeStorage`.

Cloud changes appear on focus, manual refresh, or the 30-second refresh interval. If document indexing is interrupted, use Refresh to resume it. Offline reading and draft editing use the encrypted per-account cache. Sign-out removes that account's local cache. Local unsigned-in projects are deliberately separate and can be exported; they are never silently uploaded.

## Paddle

Create one monthly US$19 price. The application provides the seven-day, 30-request trial; do not configure an additional Paddle trial unless intentionally changing that policy. Configure a default payment link as required by Paddle, then create a **hosted checkout** and set its URL in `PADDLE_HOSTED_CHECKOUT_URL`. The app uses a server-created transaction, with account identity in `custom_data`, and opens the hosted checkout with `transaction_id`. It never trusts a desktop-provided price or subscription status.

Paddle's live hosted-checkout feature requires separate approval; sandbox testing is available beforehand. See [Paddle's hosted checkout documentation](https://developer.paddle.com/paddle-js/about/hosted-checkout/). Supported destinations are Paddle's `pay.paddle.io`/sandbox hosts and customer portal hosts. Arbitrary checkout redirects are rejected.

Register the `paddle-webhook` function URL for subscription events. Signatures are verified against the exact body with a five-minute timestamp tolerance. Duplicate event IDs are ignored; older events cannot overwrite newer subscription state. Schedule an hourly authenticated POST to `reconcile-billing` using `BILLING_RECONCILIATION_SECRET`. Monitor failed webhook deliveries and reconciliation responses. Cancellation and quota exhaustion leave saved work accessible. Account deletion cancels an active subscription before removing storage and account records.

## Signed Mac release

Run `npm run typecheck`, `npm run check:cloud`, `npm test`, `npm run build`, `npm run build:electron`, and `npm run test:e2e` first. The E2E test uses a temporary profile, not your normal Quip data.

Configure the repository's **production** environment with the two public Supabase variables and these secrets: `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID`. `CSC_LINK` is your Developer ID Application signing certificate. The manual **Signed Mac beta** workflow refuses to run with missing configuration, then creates and publishes signed/notarized DMG and ZIP artifacts plus update metadata. Set the package version before each release; never republish different bytes under an existing version.

For local packaging, export the same signing variables and run `npm run dist:mac`. Unsigned development builds are not suitable for distribution. The application does not bundle `.env` or provider credentials. The beta exposes only the workspace preload API; the legacy interface requires `QUIP_LEGACY_FEATURES=true` in an unpackaged development build.

## Launch verification

Before inviting 20–30 users, verify against a staging deployment:

- Email OTP, expired sessions, two-account isolation, two-Mac synchronization, and concurrent editing.
- PDF/DOCX extraction, scanned/encrypted PDF errors, index retries, citations, and deletion of file originals and indexes.
- Real streamed answers, network interruption, cancellation, usage reset, trial expiry, and preservation of drafts typed while a response streams.
- Paddle sandbox checkout, duplicated/out-of-order webhooks, failed payment, renewal, cancellation, and reconciliation.
- Export complete originals plus metadata; account deletion; sign-out cache removal.
- Signed installation and upgrade on a fresh Mac, screen-recording permission denial, multiple displays, keyboard navigation, and the stop control.

The local tests exercise actual Postgres policies/functions using PGlite and pgvector, plus a real Electron session. They do not replace these staging/provider/signing checks.

## Beta measurement

`product_events` records only a fixed event name, owner ID, and timestamp. No prompts, screenshots, files, or generated text belong in logs or analytics. `generation_requests` records status and provider token counts for reliability and cost measurement. Feedback is a separate explicit submission.

Review first-use completion, weekly returning accounts, saved-output use, error rates and token cost. Use the manually scored tasks in `docs/beta-evaluation.md`; target 80% useful answers and 40% week-four retention before broadening scope. Provider pricing and production backup retention must be documented in the published privacy/terms materials before public launch; deletion removes active data, while provider and backup retention follow the configured services' policies.
