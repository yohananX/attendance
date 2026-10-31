"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { getCachedStaffSession, getDeviceId, saveCachedStaffSession } from "@/lib/attendance-store";

export default function LoginPage() {
  const router = useRouter();
  const [staffName, setStaffName] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setOnline(navigator.onLine);
    if (!navigator.onLine && getCachedStaffSession()) {
      router.replace("/dashboard");
      return;
    }
    const updateOnline = () => setOnline(navigator.onLine);
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    return () => {
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
    };
  }, [router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const name = staffName.trim();
    if (!name || !pin) {
      setError("Enter your name and the staff PIN.");
      return;
    }
    if (!online) {
      setError("Connect to the internet to sign in. After that, attendance can be recorded offline.");
      return;
    }

    setSubmitting(true);
    try {
      const deviceId = getDeviceId();
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ staffName: name, pin, deviceId }),
      });
      const body = await response.json().catch(() => ({})) as {
        error?: string;
        staffName?: string;
        expiresAt?: number;
      };
      if (!response.ok) {
        if (body.error === "invalid_pin") setError("That PIN wasn’t recognised. Check it and try again.");
        else if (body.error === "rate_limited") setError("Too many attempts. Wait a few minutes before trying again.");
        else if (body.error === "server_not_configured") setError("Sign-in is not set up yet. Please contact the person managing the app.");
        else setError("Could not sign in. Check your connection and try again.");
        return;
      }

      try {
        saveCachedStaffSession(body.staffName ?? name, body.expiresAt);
      } catch {
        setError("Sign-in worked, but this browser cannot save the offline session. Keep this page open and check browser storage settings.");
        return;
      }
      setPin("");
      window.location.assign("/dashboard");
    } catch (error) {
      setError(error instanceof Error && error.name === "SecurityError"
        ? "This browser cannot save the device identity required for offline attendance."
        : "Could not sign in. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-screen">
      <div className="login-brand">
        <span className="login-mark" aria-hidden="true">GH</span>
        <div>
          <strong>Attendance</strong>
          <span>Saturday extra lesson</span>
        </div>
      </div>
      <section className="login-card">
        <h1>Log in</h1>
        <p className="login-intro">Use the shared staff PIN.</p>
        {!online && (
          <p className="alert alert--warning">
            Offline. Connect to log in. If you have already logged in on this phone, return to attendance.
          </p>
        )}
        <form className="login-form" onSubmit={handleSubmit}>
          <label className="field">
            <span>Your first name</span>
            <input
              autoComplete="given-name"
              maxLength={100}
              value={staffName}
              onChange={(event) => setStaffName(event.target.value)}
              placeholder="e.g. Grace"
              required
            />
          </label>
          <label className="field">
            <span>PIN</span>
            <input
              autoComplete="current-password"
              inputMode="numeric"
              maxLength={32}
              type="password"
              value={pin}
              onChange={(event) => setPin(event.target.value)}
              placeholder="Enter your PIN"
              required
            />
          </label>
          {error && <p className="inline-error" role="alert">{error}</p>}
          <button className="button button-primary login-submit" type="submit" disabled={submitting || !online}>
            {submitting ? "Logging in…" : "Log in"}
          </button>
        </form>
        <p className="login-footnote">Your name is recorded with each action.</p>
      </section>
      <p className="login-bottom">Grace House School</p>
    </main>
  );
}
