import { writeFile } from "node:fs/promises";

const config = {
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: "",
  BACKEND_API_URL: process.env.BACKEND_API_URL || "",
  CLERK_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || process.env.CLERK_PUBLISHABLE_KEY || "",
};

await writeFile(new URL("../config.js", import.meta.url), `window.TTS_CONFIG = ${JSON.stringify(config, null, 2)};\n`, "utf8");
console.log("Wrote config.js from deployment environment.");
