/**
 * Server-only environment validation for the Supabase connection.
 *
 * This module is guarded by the `server-only` package: importing it from a
 * client component fails the production build, so the service-role key can
 * never reach browser code, page source or client bundles (SYSTEM_
 * ARCHITECTURE_v1.0.md §4.7, S2/S3, AC-G1).
 *
 * Validation is lazy — it runs when a server client is first requested, not
 * at module import — so `next build` succeeds even when credentials are
 * absent (e.g. CI without secrets) and missing configuration surfaces as a
 * clear, safe runtime error instead of a build failure.
 *
 * Error messages name environment variables but never contain their values.
 */
import "server-only";

/** Raised when server-side Supabase configuration is missing or malformed. */
export class SupabaseConfigError extends Error {
  /** Environment variable names involved (names only — never values). */
  readonly variables: readonly string[];

  constructor(message: string, variables: readonly string[] = []) {
    super(message);
    this.name = "SupabaseConfigError";
    this.variables = variables;
  }
}

/** Validated Supabase connection settings (server-side only). */
export interface ServerSupabaseConfig {
  /** Supabase project URL, e.g. `https://<project-ref>.supabase.co`. */
  url: string;
  /** Service-role key. Privileged — must never leave the server. */
  serviceRoleKey: string;
}

const SETUP_HINT =
  "Set them in .env.local for local development and in Vercel → Project → " +
  "Settings → Environment Variables for deployment. See .env.example and " +
  "docs/SUPABASE_SETUP_v1.0.md.";

/**
 * Read and validate the Supabase connection environment variables.
 *
 * @throws {SupabaseConfigError} if a variable is missing/empty or the URL is
 *   malformed. The message names the offending variables and how to fix them;
 *   it never includes credential values.
 */
export function getServerSupabaseConfig(): ServerSupabaseConfig {
  const url = process.env.SUPABASE_URL?.trim() ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";

  const missing: string[] = [];
  if (!url) missing.push("SUPABASE_URL");
  if (!serviceRoleKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");

  if (missing.length > 0) {
    throw new SupabaseConfigError(
      `Supabase is not configured: missing or empty ${missing.join(", ")}. ${SETUP_HINT}`,
      missing,
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SupabaseConfigError(
      "SUPABASE_URL is not a valid URL. Expected the form " +
        "https://<project-ref>.supabase.co. " +
        SETUP_HINT,
      ["SUPABASE_URL"],
    );
  }

  // https is required in real environments; plain http is tolerated only for
  // a local Supabase CLI stack on loopback.
  const isLoopback =
    parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol !== "https:" && !(isLoopback && parsed.protocol === "http:")) {
    throw new SupabaseConfigError(
      "SUPABASE_URL must use https:// (http:// is only allowed for a local " +
        "Supabase CLI instance on localhost).",
      ["SUPABASE_URL"],
    );
  }

  // Normalise: strip trailing slash so path joins are predictable.
  const normalised = parsed.toString().replace(/\/+$/, "");

  return { url: normalised, serviceRoleKey };
}
