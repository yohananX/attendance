const SCHOOL_NAME_FALLBACK = "Grace House School";

/**
 * Minimal entry page for T1.1 (deployment skeleton).
 *
 * It exists to prove the app is installed, built and deployed over HTTPS.
 * It deliberately contains no attendance logic — see
 * docs/IMPLEMENTATION_PLAN_v1.0.md for what comes next (T1.2 database,
 * T1.3 PWA, T3.1 login).
 *
 * SCHOOL_NAME is public, non-secret application configuration
 * (SYSTEM_ARCHITECTURE_v1.0.md §6.1) and is the only environment variable
 * this page may read. No secrets (service-role key, session secret, PIN)
 * are ever rendered here or sent to the client.
 *
 * Rendered at request time so the school name follows the deployment's
 * environment configuration rather than being frozen at build time.
 */
export const dynamic = "force-dynamic";

export default function Home() {
  const schoolName = process.env.SCHOOL_NAME || SCHOOL_NAME_FALLBACK;

  return (
    <main className="home">
      <h1>{schoolName}</h1>
      <p className="status">Attendance app — environment is running.</p>
      <p className="meta">
        Skeleton deployment (T1.1). Login and attendance features are not yet
        implemented.
      </p>
    </main>
  );
}
