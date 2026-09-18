import fs from "node:fs";
import dotenv from "dotenv";
dotenv.config({ quiet: true });
fs.mkdirSync("build", { recursive: true });
// A strict allow-list: provider, billing, signing and service-role secrets can never enter the app.
fs.writeFileSync(
  "build/service-config.json",
  JSON.stringify(
    {
      supabaseUrl: process.env.QUIP_SUPABASE_URL || "",
      supabaseAnonKey: process.env.QUIP_SUPABASE_ANON_KEY || "",
    },
    null,
    2,
  ),
);
