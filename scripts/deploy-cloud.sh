#!/usr/bin/env bash
set -euo pipefail
: "${QUIP_SUPABASE_PROJECT_REF:?Set the target Supabase project reference}"
: "${SUPABASE_ACCESS_TOKEN:?Provide Supabase CLI access through your environment}"
: "${SUPABASE_DB_PASSWORD:?Provide the database password through your environment}"
command -v supabase >/dev/null || { echo "Install the official Supabase CLI first."; exit 1; }
npm run check:cloud
npm test -- --run electron/workspaceDatabase.test.ts electron/workspaceSecurity.test.ts
supabase link --project-ref "$QUIP_SUPABASE_PROJECT_REF"
supabase db push
supabase functions deploy workspace
supabase functions deploy paddle-webhook
supabase functions deploy reconcile-billing
