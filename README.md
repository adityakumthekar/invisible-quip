# Quip

An AI workspace for everyday desktop work: capture context, ask or transform it, refine the result, and save it to a project. The beta targets individual professionals on Apple Silicon macOS.

## Workspace

- A normal project window and a floating assistant share conversations and drafts.
- Explicit screen capture, region cropping, pasted text, and file previews let you review context before sending it.
- Summarize, explain, draft a reply, rewrite, translate, and extract action items, with follow-up edits and copying.
- Private projects contain instructions, conversations, document sources, and editable saved notes. Search previous work and export notes or conversations.
- Text-based PDF, DOCX, TXT, Markdown, PNG, and JPEG sources are supported. Document answers show source excerpts and PDF page references. Files are limited to 20 MB; PDFs to 100 pages. Scanned and encrypted PDFs return an explanatory error.
- Email-code sign-in, managed Gemini streaming, usage visibility, Paddle checkout/portal, feedback, export, account deletion, and update installation are implemented.

The cloud service and release configuration must be deployed before these features can be used in a distributed build. This repository does **not** yet represent a launched or signed production service. Local projects, saved notes, and drafts work without credentials; managed answers require a configured backend and sign-in.

## Development

Use Node.js 24 and npm on macOS:

```sh
npm ci
npm start
```

No API key is needed to reach onboarding. Use **Start with local drafts** to try the workspace. To connect a development build to a deployed service, supply only `QUIP_SUPABASE_URL` and `QUIP_SUPABASE_ANON_KEY` in the build environment; see `.env.example`. Provider and service-role keys belong exclusively in backend secrets.

`Cmd+Shift+Space` or `Cmd+B` toggles the assistant. The tray menu opens the full workspace. Screen capture runs only after an explicit action and requires the macOS Screen Recording permission.

## Cloud and distribution

Follow [Deployment](docs/DEPLOYMENT.md) for Supabase migration/functions, OTP email configuration, Gemini, Paddle sandbox verification, Apple signing/notarization, and release CI. See [Beta evaluation](docs/beta-evaluation.md) for the invited-user validation plan.

Supabase stores private projects, conversations, source originals, indexes, and saved outputs. The backend authenticates every request, enforces ownership and usage, and assembles project-scoped retrieval. The desktop uses OS-protected session storage and encrypted account caches. Captures remain temporary unless explicitly saved. Conversation drafts stay on the Mac; saved cloud work refreshes on focus and every 30 seconds. A stale edit is rejected so newer work from another Mac is not silently overwritten.

The default commercial configuration is a seven-day, 30-request trial and US$19/month for 300 requests and 1 GB of storage. Request limits and indexing budgets are configured on the server. Expired access and exhausted usage preserve reading and export. Live provider calls, billing, two-Mac sync, signed installation, capture permissions, and updates still require staging and packaged-app validation before invitations.

## Checks

```sh
npm run typecheck       # desktop, renderer, and remote client
npm run check:cloud     # all Supabase functions
npm test               # unit tests and Postgres ownership/usage tests
npm run build
npm run build:electron
npm run test:e2e        # isolated real Electron profile
```

Some legacy network tests bind local sockets and need an environment that permits them. CI runs on macOS. The release workflow requires explicit production configuration and creates signed/notarized ARM64 DMG and ZIP artifacts; it has not been executed as part of the local implementation.

## Advanced development

Audio, teaching, autonomous actions, phone control, and local Ollama/Qwen adapters remain in the repository behind `QUIP_LEGACY_FEATURES=true` in unpackaged development builds. They are outside the beta. [Legacy development notes](docs/legacy-development.md) describe that older interface; its shortcuts and provider setup do not apply to the workspace.

## License

[Apache License 2.0](LICENSE). © 2026 Aditya Kumthekar. This is a substantially modified derivative of [free-cluely](https://github.com/Prat011/free-cluely).
