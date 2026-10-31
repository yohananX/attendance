"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  AttendanceEvent,
  AttendanceRecord,
  clearCachedStaffSession,
  getAttendanceForDay,
  getCachedStaffSession,
  getDeviceId,
  getPendingEvents,
  mergeServerAttendance,
  retryFailedEvents,
  saveCachedStaffSession,
  saveSignIn,
  saveSignOut,
  setLocalWhatsAppLaunch,
  updatePendingEvent,
} from "@/lib/attendance-store";
import { normalizePhone } from "@/lib/phone";
import { buildMessage, buildWhatsAppUrl } from "@/lib/whatsapp";

interface ServerDay {
  dayKey: string;
  sessions: Omit<AttendanceRecord, "pendingEvents" | "syncError">[];
}

interface LoginSession {
  staffName: string;
  expiresAt: number;
}

function currentLagosDay(): string {
  const now = new Date();
  return new Date(now.getTime() + 60 * 60 * 1000).toISOString().slice(0, 10);
}

function formatTime(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleTimeString("en-GB", {
    timeZone: "Africa/Lagos",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatDayKey(dayKey: string): string {
  return new Date(`${dayKey}T12:00:00+01:00`).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Africa/Lagos",
  });
}

function syncSummary(record: AttendanceRecord): { label: string; className: string } {
  if (record.pendingEvents.some((event) => event.syncState === "failed")) {
    return { label: "Failed", className: "sync-label sync-label--failed" };
  }
  if (record.pendingEvents.length > 0) {
    return { label: "Pending", className: "sync-label sync-label--pending" };
  }
  return { label: "Synced", className: "sync-label sync-label--synced" };
}

export default function AttendanceDashboard({ schoolName }: { schoolName: string }) {
  const router = useRouter();
  const nameInput = useRef<HTMLInputElement>(null);
  const syncingRef = useRef(false);
  const [dayKey] = useState(currentLagosDay);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [staff, setStaff] = useState<LoginSession | null>(null);
  const [ready, setReady] = useState(false);
  const [online, setOnline] = useState(true);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [studentName, setStudentName] = useState("");
  const [parentPhone, setParentPhone] = useState("");
  const [search, setSearch] = useState("");
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [pageError, setPageError] = useState("");
  const [saving, setSaving] = useState(false);
  const [signingOut, setSigningOut] = useState<Set<string>>(new Set());
  const [openingMessage, setOpeningMessage] = useState<Set<string>>(new Set());

  const inSchool = useMemo(
    () => records.filter((record) => record.signedInAt && !record.signedOutAt),
    [records],
  );
  const signedOut = useMemo(
    () => records.filter((record) => record.signedOutAt),
    [records],
  );
  const pendingCount = useMemo(
    () => records.reduce((count, record) => count + record.pendingEvents.length, 0),
    [records],
  );
  const failedCount = useMemo(
    () => records.reduce(
      (count, record) => count + record.pendingEvents.filter((event) => event.syncState === "failed").length,
      0,
    ),
    [records],
  );
  const outstandingCount = useMemo(
    () => signedOut.filter((record) => !record.whatsappLaunchedAt).length,
    [signedOut],
  );
  const visibleInSchool = useMemo(
    () => inSchool.filter((record) => (
      `${record.studentName} ${record.parentPhone}`.toLowerCase().includes(search.trim().toLowerCase())
    )),
    [inSchool, search],
  );
  const visibleSignedOut = useMemo(
    () => signedOut.filter((record) => (
      `${record.studentName} ${record.parentPhone}`.toLowerCase().includes(search.trim().toLowerCase())
    )),
    [signedOut, search],
  );

  const refreshLocal = useCallback(async () => {
    const saved = await getAttendanceForDay(dayKey);
    setRecords(saved);
  }, [dayKey]);

  const refreshFromServer = useCallback(async (): Promise<boolean> => {
    if (!navigator.onLine) return false;
    const response = await fetch(`/api/day?dayKey=${encodeURIComponent(dayKey)}`, {
      credentials: "include",
      cache: "no-store",
    });
    if (response.status === 401) {
      clearCachedStaffSession();
      router.replace("/login");
      return false;
    }
    if (!response.ok) {
      throw new Error("Could not refresh attendance from the server.");
    }
    const data = (await response.json()) as ServerDay;
    const merged = await mergeServerAttendance(dayKey, data.sessions);
    setRecords(merged);
    return true;
  }, [dayKey, router]);

  const syncPending = useCallback(async () => {
    if (!navigator.onLine || syncingRef.current) return;
    syncingRef.current = true;
    setSyncing(true);
    setPageError("");
    try {
      const pending = await getPendingEvents();
      for (const event of pending) {
        const response = await fetch("/api/events", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ events: [event] }),
        });
        if (response.status === 401) {
          clearCachedStaffSession();
          router.replace("/login");
          return;
        }
        if (!response.ok) {
          throw new Error("Could not sync attendance. Your saved records are still on this phone.");
        }
        const body = await response.json() as {
          results?: Array<{ eventId: string; result: string; message?: string }>;
        };
        const result = body.results?.find((item) => item.eventId === event.eventId);
        if (!result) {
          throw new Error("The server did not confirm an attendance record. It remains saved on this phone.");
        }
        const accepted = result.result === "accepted" || result.result === "duplicate";
        await updatePendingEvent(
          event.eventId,
          accepted,
          result.message ?? (result.result === "conflict"
            ? "This record conflicts with another device. Ask the lead teacher to check it."
            : "The server did not accept this record."),
        );
      }
      await refreshLocal();
      await refreshFromServer();
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Sync failed. Records remain saved on this phone.");
      await refreshLocal();
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }, [refreshFromServer, refreshLocal, router]);

  useEffect(() => {
    let active = true;
    const updateOnline = () => setOnline(navigator.onLine);
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    updateOnline();

    async function initialise() {
      try {
        const cached = getCachedStaffSession();
        if (navigator.onLine) {
          try {
            const response = await fetch("/api/session", {
              credentials: "include",
              cache: "no-store",
            });
            if (response.ok) {
              const data = await response.json() as { staffName: string; expiresAt?: number };
              const session = cached?.staffName === data.staffName
                ? cached
                : saveCachedStaffSession(data.staffName, data.expiresAt);
              if (active) setStaff(session);
            } else {
              clearCachedStaffSession();
              router.replace("/login");
              return;
            }
          } catch {
            if (cached && active) setStaff(cached);
            else {
              router.replace("/login?offline=1");
              return;
            }
          }
        } else if (cached) {
          if (active) setStaff(cached);
        } else {
          router.replace("/login?offline=1");
          return;
        }

        await refreshLocal();
        if (navigator.onLine) {
          try {
            await refreshFromServer();
            await syncPending();
          } catch (error) {
            if (active) {
              setPageError(error instanceof Error
                ? error.message
                : "Could not reach the server. New attendance will be saved on this phone.");
            }
          }
        }
      } catch (error) {
        if (active) {
          setPageError(error instanceof Error
            ? error.message
            : "Could not open attendance saved on this phone.");
        }
      } finally {
        if (active) {
          setReady(true);
          setLoading(false);
        }
      }
    }

    void initialise();
    return () => {
      active = false;
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
    };
  }, [refreshFromServer, refreshLocal, router, syncPending]);

  useEffect(() => {
    if (!online || !ready) return;
    void syncPending();
  }, [online, ready, syncPending]);

  async function handleSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    setNotice("");

    const cleanName = studentName.trim();
    if (!cleanName) {
      setFormError("Enter the child’s name.");
      return;
    }

    let phone: string;
    try {
      phone = normalizePhone(parentPhone);
    } catch {
      setFormError("Enter a valid phone number, for example 08012345678.");
      return;
    }

    if (!staff) {
      setFormError("Your staff session has expired. Connect to the internet and sign in again.");
      return;
    }

    setSaving(true);
    try {
      const deviceId = getDeviceId();
      const previousSequence = Number.parseInt(localStorage.getItem("gh_device_seq") ?? "0", 10);
      const deviceSeq = Number.isFinite(previousSequence) ? previousSequence + 1 : 1;
      localStorage.setItem("gh_device_seq", String(deviceSeq));
      const now = new Date().toISOString();
      const event: AttendanceEvent = {
        eventId: crypto.randomUUID(),
        eventType: "sign_in",
        sessionRef: crypto.randomUUID(),
        studentName: cleanName,
        parentPhone: phone,
        deviceEventAt: now,
        capturedOffline: !navigator.onLine,
        deviceId,
        deviceSeq,
        dayKey,
        staffName: staff.staffName,
        syncState: "pending",
      };
      const record: AttendanceRecord = {
        sessionRef: event.sessionRef,
        studentName: cleanName,
        parentPhone: phone,
        dayKey,
        signedInAt: now,
        signedOutAt: null,
        signedInBy: staff.staffName,
        signedOutBy: null,
        serverVersion: 0,
        corrected: false,
        conflictType: null,
        lateSynced: false,
        needsReview: false,
        whatsappLaunchedAt: null,
        pendingEvents: [event],
        syncError: null,
      };

      await saveSignIn(record);
      await refreshLocal();
      setStudentName("");
      setParentPhone("");
      nameInput.current?.focus();
      setNotice(navigator.onLine
        ? "Attendance saved on this phone."
        : "Saved on this phone. It will sync when you’re back online.");
      if (navigator.onLine) await syncPending();
    } catch (error) {
      setFormError(error instanceof Error
        ? error.message
        : "Could not save on this phone. Please record the attendance on paper.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSignOut(record: AttendanceRecord) {
    if (!staff || !record.signedInAt || record.signedOutAt || signingOut.has(record.sessionRef)) return;
    setSigningOut((current) => new Set(current).add(record.sessionRef));
    setNotice("");
    setPageError("");
    try {
      const deviceId = getDeviceId();
      const previousSequence = Number.parseInt(localStorage.getItem("gh_device_seq") ?? "0", 10);
      const deviceSeq = Number.isFinite(previousSequence) ? previousSequence + 1 : 1;
      localStorage.setItem("gh_device_seq", String(deviceSeq));
      const event: AttendanceEvent = {
        eventId: crypto.randomUUID(),
        eventType: "sign_out",
        sessionRef: record.sessionRef,
        deviceEventAt: new Date().toISOString(),
        capturedOffline: !navigator.onLine,
        deviceId,
        deviceSeq,
        dayKey,
        staffName: staff.staffName,
        syncState: "pending",
      };
      const result = await saveSignOut(record.sessionRef, event, staff.staffName);
      if (result === "already_signed_out") return;
      if (result === "not_found") {
        setPageError("This attendance record is no longer on the device. Refresh when online.");
        return;
      }
      await refreshLocal();
      setNotice(navigator.onLine
        ? `${record.studentName} signed out.`
        : `${record.studentName} signed out and saved on this phone.`);
      if (navigator.onLine) await syncPending();
    } catch (error) {
      setPageError(error instanceof Error
        ? error.message
        : "Could not save sign-out. Please record it on paper.");
    } finally {
      setSigningOut((current) => {
        const next = new Set(current);
        next.delete(record.sessionRef);
        return next;
      });
    }
  }

  async function handleRetry() {
    setPageError("");
    try {
      await retryFailedEvents();
      await refreshLocal();
      await syncPending();
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Could not retry sync.");
    }
  }

  async function handleMessage(record: AttendanceRecord) {
    if (!record.signedInAt || !record.signedOutAt || !online) return;
    setOpeningMessage((current) => new Set(current).add(record.sessionRef));
    setPageError("");
    const signInTime = formatTime(record.signedInAt);
    const signOutTime = formatTime(record.signedOutAt);
    const message = buildMessage(record.studentName, signInTime, signOutTime, schoolName, formatDayKey(dayKey));
    const opened = window.open(buildWhatsAppUrl(message, record.parentPhone), "_blank");
    if (!opened) {
      setPageError("WhatsApp could not be opened. Check your browser’s pop-up settings or copy the number and times.");
      setOpeningMessage((current) => {
        const next = new Set(current);
        next.delete(record.sessionRef);
        return next;
      });
      return;
    }
    opened.opener = null;

    try {
      const response = await fetch(
        `/api/messages/${encodeURIComponent(record.sessionRef)}/launched`,
        { method: "POST", credentials: "include" },
      );
      if (!response.ok) {
        throw new Error("The WhatsApp link opened, but the app could not confirm the launch online.");
      }
      const result = await response.json() as { whatsappLaunchedAt: string | null };
      await setLocalWhatsAppLaunch(record.sessionRef, result.whatsappLaunchedAt ?? new Date().toISOString());
      await refreshLocal();
      setNotice("WhatsApp opened. Check the message in WhatsApp before sending.");
    } catch (error) {
      setPageError(error instanceof Error
        ? error.message
        : "WhatsApp opened, but the app could not confirm it with the server.");
    } finally {
      setOpeningMessage((current) => {
        const next = new Set(current);
        next.delete(record.sessionRef);
        return next;
      });
    }
  }

  async function handleCopy(record: AttendanceRecord) {
    if (!record.signedInAt || !record.signedOutAt) return;
    const message = buildMessage(
      record.studentName,
      formatTime(record.signedInAt),
      formatTime(record.signedOutAt),
      schoolName,
      formatDayKey(dayKey),
    );
    try {
      await navigator.clipboard.writeText(message);
      setNotice("Message copied. Paste it into WhatsApp when you have a connection.");
    } catch {
      setPageError("Could not copy the message. Please select and copy it manually.");
    }
  }

  async function handleLogout() {
    if (!online) {
      setNotice("Reconnect to log out. Your offline attendance session will stay available on this phone.");
      return;
    }
    clearCachedStaffSession();
    try {
      await fetch("/logout", { method: "POST", credentials: "include" });
    } finally {
      router.replace("/login");
    }
  }

  const dateLabel = formatDayKey(dayKey);

  if (!ready || !staff) {
    return (
      <main className="app-shell app-shell--narrow">
        <p className="loading-message">{loading ? "Opening attendance…" : "Please sign in to continue."}</p>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <span className="staff-line">{staff.staffName} · staff</span>
        <div className="header-tools">
          <a className="text-button" href="/review">Day review</a>
          <button
            className="text-button"
            onClick={handleLogout}
            disabled={!online}
            title={!online ? "Reconnect to log out" : undefined}
          >
            Log out
          </button>
        </div>
      </header>

      <section className="day-intro">
        <div>
          <h1>Attendance</h1>
          <p className="date-line">{dateLabel}</p>
        </div>
      </section>

      <div className="list-tools">
        <input
          type="search"
          aria-label="Search children"
          placeholder="Search child"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <span>{inSchool.length} in school</span>
      </div>

      {!online && <p className="offline-note" role="status">Offline · records saved on this phone</p>}
      {pendingCount > 0 && (
        <div className="pending-note" aria-live="polite">
          <span>{failedCount ? `${failedCount} failed to sync` : `${pendingCount} waiting to sync`}</span>
          {online && (
            <button className="text-button" onClick={handleRetry} disabled={syncing}>
              {syncing ? "Syncing…" : "Sync now"}
            </button>
          )}
        </div>
      )}

      {pageError && <p className="alert alert--error" role="alert">{pageError}</p>}
      {notice && <p className="alert alert--success" role="status">{notice}</p>}

      <section className="sign-in-card" aria-labelledby="sign-in-title">
        <div className="section-heading">
          <h2 id="sign-in-title">Sign in</h2>
        </div>
        <form className="attendance-form" onSubmit={handleSignIn}>
          <label className="field">
            <span>Child’s name</span>
            <input
              ref={nameInput}
              autoComplete="off"
              maxLength={100}
              placeholder="Child’s full name"
              value={studentName}
              onChange={(event) => setStudentName(event.target.value)}
              required
            />
          </label>
          <label className="field">
            <span>Parent phone</span>
            <input
              autoComplete="tel"
              inputMode="tel"
              placeholder="0801 234 5678"
              value={parentPhone}
              onChange={(event) => setParentPhone(event.target.value)}
              required
            />
          </label>
          {formError && <p className="inline-error" role="alert">{formError}</p>}
          <button className="button button-primary button-sign-in" type="submit" disabled={saving}>
            <span aria-hidden="true">＋</span>
            {saving ? "Saving…" : "Sign in"}
          </button>
        </form>
      </section>

      <section className="roster-section" aria-labelledby="in-school-title">
        <div className="roster-heading">
          <div>
            <h2 id="in-school-title">In school <span className="count-pill">{inSchool.length}</span></h2>
          </div>
        </div>
        {loading && records.length === 0 ? (
          <p className="empty-state">Loading attendance…</p>
        ) : visibleInSchool.length === 0 ? (
          <div className="empty-state">
            <strong>{search ? "No children found." : "No one signed in yet."}</strong>
          </div>
        ) : (
          <ul className="student-list">
            {visibleInSchool.map((record) => {
              const sync = syncSummary(record);
              return (
                <li className="student-card" key={record.sessionRef}>
                  <div className="student-details">
                    <strong className="student-name">{record.studentName}</strong>
                    <span className="student-meta">
                      {formatTime(record.signedInAt)}
                    </span>
                    <span className={sync.className}>{sync.label}</span>
                    {record.syncError && <span className="sync-error">{record.syncError}</span>}
                  </div>
                  <button
                    className="button button-checkout"
                    disabled={signingOut.has(record.sessionRef)}
                    onClick={() => void handleSignOut(record)}
                  >
                    {signingOut.has(record.sessionRef) ? "Saving…" : "Sign out"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="roster-section checked-out-section" aria-labelledby="checked-out-title">
        <div className="roster-heading">
          <div>
            <h2 id="checked-out-title">Signed out today <span className="count-pill count-pill--muted">{signedOut.length}</span></h2>
          </div>
        </div>
        {visibleSignedOut.length === 0 ? (
          <p className="empty-state empty-state--compact">{search ? "No children found." : "No one signed out yet."}</p>
        ) : (
          <ul className="student-list">
            {visibleSignedOut.map((record) => {
              const sync = syncSummary(record);
              return (
                <li className="student-card student-card--completed" key={record.sessionRef}>
                  <div className="student-details">
                    <strong className="student-name">{record.studentName}</strong>
                    <span className="student-meta">
                      {formatTime(record.signedInAt)} – {formatTime(record.signedOutAt)}
                    </span>
                    <span className={sync.className}>{sync.label}</span>
                    {record.syncError && <span className="sync-error">{record.syncError}</span>}
                  </div>
                  <div className="message-actions">
                    {!record.whatsappLaunchedAt ? (
                      <button
                        className="button button-message"
                        disabled={!online || openingMessage.has(record.sessionRef)}
                        onClick={() => void handleMessage(record)}
                        title={!online ? "Connect to the internet to open WhatsApp" : undefined}
                      >
                        {openingMessage.has(record.sessionRef) ? "Opening…" : "WhatsApp"}
                      </button>
                    ) : (
                      <span className="message-opened">WhatsApp opened</span>
                    )}
                    <button className="copy-button" onClick={() => void handleCopy(record)}>Copy</button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {outstandingCount > 0 && <p className="app-footer">{outstandingCount} messages to send</p>}
    </main>
  );
}
