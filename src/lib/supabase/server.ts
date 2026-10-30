/**
 * Server-only Supabase client for the Grace House attendance app.
 *
 * This module is guarded by the `server-only` package: importing it from a
 * client component fails the production build, so the service-role key can
 * never reach browser code, page source or client bundles (SYSTEM_
 * ARCHITECTURE_v1.0.md §4.7, S2/S3, AC-G1).
 *
 * All database access in this project flows through a single service-role
 * client held in server environment variables only. The browser holds no
 * database key at all (RLS is enabled with no policies on every table —
 * docs/DATABASE_CONTRACT_v1.0.md §9).
 *
 * Validation is lazy: it runs when a client is first requested, not at module
 * import, so `next build` succeeds even when credentials are absent (CI
 * without secrets) and missing configuration surfaces as a clear, safe error
 * instead of a build failure.
 */
import "server-only";

import { createClient } from "@supabase/supabase-js";

import { getServerSupabaseConfig, SupabaseConfigError } from "./env";

/**
 * Create a Supabase client authenticated with the service-role key.
 *
 * The service-role key bypasses RLS and is privileged: it must never leave the
 * server. Every route that uses this client must first validate the session
 * cookie (architecture §4.7).
 *
 * @throws {SupabaseConfigError} if Supabase configuration is missing or
 *   malformed. The message names the offending variables and never contains
 *   credential values.
 */
export function getServerSupabaseClient() {
  const { url, serviceRoleKey } = getServerSupabaseConfig();
  return createClient(url, serviceRoleKey);
}

/** Re-exported so route handlers can import both the config error type and the
 * client factory from one place. */
export { SupabaseConfigError };
