"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import {
  getCachedStaffSession,
  getDeviceId,
  matchAttendanceDataset,
  saveCachedStaffSession,
} from "@/lib/attendance-store";

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
        datasetId?: string;
      };
      if (!response.ok) {
        if (body.error === "invalid_pin") setError("That PIN wasn’t recognised. Check it and try again.");
        else if (body.error === "rate_limited") setError("Too many attempts. Wait a few minutes before trying again.");
        else if (body.error === "server_not_configured") setError("Sign-in is not set up yet. Please contact the person managing the app.");
        else if (body.error === "dataset_not_configured") setError("The attendance database is not set up yet. Please contact the person managing the app.");
        else setError("Could not sign in. Check your connection and try again.");
        return;
      }

      try {
        saveCachedStaffSession(body.staffName ?? name, body.expiresAt);
      } catch {
        setError("Sign-in worked, but this browser cannot save the offline session. Keep this page open and check browser storage settings.");
        return;
      }
      if (typeof body.datasetId !== "string" || !body.datasetId) {
        setError("Sign-in worked, but the attendance database could not be identified. Please contact the person managing the app.");
        return;
      }
      try {
        await matchAttendanceDataset(body.datasetId);
      } catch {
        setError("Sign-in worked, but local attendance storage could not be checked. Check browser storage settings.");
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
      <section className="login-panel" aria-labelledby="login-title">
        <header className="login-panel-header">
          <img
            className="login-logo"
            src="/branding/school-logo.webp"
            alt="Grace House School"
            width={1000}
            height={368}
          />
          <h1 id="login-title" className="login-title">LOG IN</h1>
          <p className="login-intro">Attendance Register.</p>
        </header>

        <div className="login-panel-body">
        {!online && (
          <p className="alert alert--warning">
            Offline. Connect to log in. If you have already logged in on this phone, return to attendance.
          </p>
        )}

        <form className="login-form" onSubmit={handleSubmit}>
          <label className="field login-field">
            <span>Enter Your name</span>
            <input
              autoComplete="given-name"
              maxLength={100}
              value={staffName}
              onChange={(event) => setStaffName(event.target.value)}
              placeholder="Enter your name"
              required
            />
          </label>

          <label className="field login-field">
            <span>PIN</span>
            <input
              autoComplete="current-password"
              inputMode="numeric"
              maxLength={32}
              type="password"
              value={pin}
              onChange={(event) => setPin(event.target.value)}
              placeholder="Enter staff PIN"
              required
            />
          </label>

          {error && <p className="inline-error" role="alert">{error}</p>}

          <button className="button button-primary login-submit" type="submit" disabled={submitting || !online}>
            {submitting ? "Logging in…" : "Log in to attendance"}
          </button>
        </form>

        <div className="login-panel-footer">
          <span>Don’t have the PIN? Ask Yohanan.</span>
        </div>
        </div>
      </section>
    </main>
  );
}
