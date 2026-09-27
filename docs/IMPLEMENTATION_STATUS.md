# Implementation status — 9 September 2026

The desktop workspace and backend implementation are ready for staging configuration. The service is not deployed, and no production installer has been signed or notarized.

| Milestone | Implemented locally | Remaining acceptance work |
| --- | --- | --- |
| Safe foundation | Credential-free onboarding, email OTP flow, named IPC, sender validation, sandboxed renderers, encrypted sessions/cache, CI including the remote client, Mac packaging and signing workflow | Configure Supabase and SMTP; verify sign-in; provide Apple signing credentials; validate signed/notarized installation |
| Everyday workflow | Shared assistant/workspace, projects, conversation drafts, source previews/cropping, isolated extraction, project retrieval, citations, writing actions, saved notes, search and export | Validate real managed answers, two-Mac sync, concurrent cloud edits, capture permissions and multiple displays on staging hardware |
| Paid service | Server-side quota/storage enforcement, Paddle checkout/portal, verified/idempotent webhooks, reconciliation endpoint, account export/deletion, update flow, feedback and content-free metrics | Configure Paddle and reconciliation scheduling; exercise sandbox billing and live provider failures; verify complete cloud export/deletion and signed updates |
| Invited beta | Curated task evaluation and deployment/QA checklist | Invite 20–30 users, measure activation/usefulness/cost and week-four return rate |

## Verification performed

- Full suite: **743 tests passed across 57 files**, including the previously socket-blocked tests.
- Two additional database regressions for private file access and indexing retries subsequently passed; the affected database/service subset passed **19 tests**.
- Renderer, Electron, and remote-client TypeScript checks passed; all three cloud functions passed Deno type checking.
- Production renderer/remote builds and Electron build passed.
- Real Electron smoke test passed: fresh-profile onboarding, project/note creation, shared drafts, restart recovery, sandbox boundary, and PDF/DOCX extraction in the utility process.
- A local unsigned ARM64 app bundle was built. Archive inspection found no bundled `.env` files; public service configuration contains only the Supabase URL and anonymous key fields.

Tests also cover tenant ownership, quota preservation after deletion, request/webhook/index retry idempotency, monthly indexing limits, interrupted streams, cancellation during sign-out, drafts typed while streaming, selected image context, and document limits.

## Current behavior and limits

Without a configured service, users can create local projects, notes, and drafts. A first managed answer requires a deployed backend and sign-in. Guest projects stay separate from cloud accounts. Saved cloud work is cached for reading; unsent conversation drafts remain editable locally. Cloud mutations require connectivity, and interrupted generation offers a retry with the draft preserved. Screen images are transient unless explicitly saved.

Provider calls and Paddle webhooks were not exercised against live services. Cross-device synchronization and account lifecycle operations need the staging checks in [Deployment](DEPLOYMENT.md). The unsigned development bundle is not a distributable paid beta. Installation, update, permission-denial and multiple-display checks remain required on signed builds.

## Next step

Configure the Supabase project and OTP sender, server-side Gemini and Paddle secrets, public build configuration, and Apple release credentials using [Deployment](DEPLOYMENT.md). Run the staging checklist before inviting beta users. The evaluation plan is in [Beta evaluation](beta-evaluation.md).
