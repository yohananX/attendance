"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  AttendanceEvent,
  AttendanceRecord,
  clearCachedStaffSession,
  clearAttendanceForDataset,
  getAttendanceForDay,
  getCachedStaffSession,
  getDeviceId,
  getStoredAttendanceDatasetId,
  getPendingEvents,
  matchAttendanceDataset,
  mergeServerAttendance,
  retryFailedEvents,
  saveCachedStaffSession,
  saveSignIn,
  saveSignOut,
  setLocalWhatsAppLaunch,
  updatePendingEvent,
} from "@/lib/attendance-store";
import { normalizePhone } from "@/lib/phone";
import { buildSignInMessage, buildSignOutMessage, buildWhatsAppUrl } from "@/lib/whatsapp";

interface ServerDay {
  datasetId: string;
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
  const datasetIdRef = useRef<string | null>(null);
  const datasetResetRequiredRef = useRef(false);
  const [dayKey] = useState(currentLagosDay);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [staff, setStaff] = useState<LoginSession | null>(null);
  const [ready, setReady] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const [datasetResetRequired, setDatasetResetRequired] = useState(false);
  const [datasetVerified, setDatasetVerified] = useState(false);
  const [clearingDataset, setClearingDataset] = useState(false);
  const [online, setOnline] = useState(true);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [studentName, setStudentName] = useState("");
  const [parentPhone, setParentPhone] = useState("");
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<"in-school" | "signed-out">("in-school");
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
    if (typeof data.datasetId !== "string" || !data.datasetId) {
      throw new Error("The server did not identify this attendance dataset.");
    }
    datasetIdRef.current = data.datasetId;
    const datasetMatches = await matchAttendanceDataset(data.datasetId);
    datasetResetRequiredRef.current = !datasetMatches;
    setDatasetResetRequired(!datasetMatches);
    setDatasetVerified(datasetMatches);
    if (!datasetMatches) {
      setRecords([]);
      return false;
    }
    const merged = await mergeServerAttendance(dayKey, data.sessions);
    setRecords(merged);
    return true;
  }, [dayKey, router]);

  const syncPending = useCallback(async () => {
    if (!navigator.onLine || syncingRef.current || datasetResetRequiredRef.current) return;
    const datasetId = datasetIdRef.current;
    if (!datasetId) return;
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
          body: JSON.stringify({ datasetId, events: [event] }),
        });
        if (response.status === 401) {
          clearCachedStaffSession();
          router.replace("/login");
          return;
        }
        if (!response.ok) {
          if (response.status === 409) {
            const body = await response.json() as { error?: string; datasetId?: string };
            if (body.error === "dataset_mismatch" && body.datasetId) {
              datasetIdRef.current = body.datasetId;
              datasetResetRequiredRef.current = true;
              setDatasetResetRequired(true);
              setRecords([]);
              setPageError("This device has attendance from a different database. Clear old device data to continue.");
              return;
            }
          }
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
      if (datasetIdRef.current && !datasetResetRequiredRef.current) {
        await refreshLocal();
      } else {
        setRecords([]);
      }
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
    let shouldRedirect = false;
    const redirectToLogin = (path: string) => {
      shouldRedirect = true;
      if (!active) return;
      setRedirecting(true);
      window.location.replace(path);
    };
    const updateOnline = () => setOnline(navigator.onLine);
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    updateOnline();

    async function initialise() {
      try {
        const cached = getCachedStaffSession();
        const storedDatasetId = getStoredAttendanceDatasetId();
        datasetIdRef.current = storedDatasetId;
        if (storedDatasetId) setDatasetVerified(true);
        if (navigator.onLine) {
          try {
            const response = await fetch("/api/session", {
              credentials: "include",
              cache: "no-store",
            });
            if (response.status === 401) {
              clearCachedStaffSession();
              redirectToLogin("/login");
              return;
            }
            if (!response.ok) {
              throw new Error("Could not check the staff session.");
            }
            const data = await response.json() as {
              staffName: string;
              expiresAt?: number;
              datasetId?: string;
            };
            if (typeof data.datasetId !== "string" || !data.datasetId) {
              throw new Error("The server did not identify this attendance dataset.");
            }
            datasetIdRef.current = data.datasetId;
            const datasetMatches = await matchAttendanceDataset(data.datasetId);
            datasetResetRequiredRef.current = !datasetMatches;
            setDatasetResetRequired(!datasetMatches);
            setDatasetVerified(datasetMatches);
            if (!datasetMatches) setRecords([]);
            const session = cached?.staffName === data.staffName
              ? cached
              : saveCachedStaffSession(data.staffName, data.expiresAt);
            if (active) setStaff(session);
          } catch {
            if (cached && active) setStaff(cached);
            else {
              redirectToLogin("/login?offline=1");
              return;
            }
          }
        } else if (cached) {
          if (active) setStaff(cached);
        } else {
          redirectToLogin("/login?offline=1");
          return;
        }

        await refreshLocal();
        if (navigator.onLine) {
          try {
            if (await refreshFromServer()) await syncPending();
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
        if (active && !shouldRedirect) {
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
  }, [refreshFromServer, refreshLocal, syncPending]);

  useEffect(() => {
    if (!online || !ready) return;
    void syncPending();
  }, [online, ready, syncPending]);

  async function handleSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    setNotice("");

    if (datasetResetRequiredRef.current) {
      setFormError("Clear the old device data before recording attendance for this database.");
      return;
    }
    if (!datasetVerified) {
      setFormError("Connect to the internet to verify this attendance database before recording.");
      return;
    }

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
    if (
      datasetResetRequiredRef.current ||
      !datasetVerified ||
      !staff ||
      !record.signedInAt ||
      record.signedOutAt ||
      signingOut.has(record.sessionRef)
    ) return;
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

  async function handleClearOldDeviceData() {
    const datasetId = datasetIdRef.current;
    if (!datasetId || !datasetResetRequiredRef.current || clearingDataset) return;
    const confirmed = window.confirm(
      "This permanently deletes attendance and pending offline records saved on this device. Continue?",
    );
    if (!confirmed) return;

    setClearingDataset(true);
    setPageError("");
    try {
      await clearAttendanceForDataset(datasetId);
      datasetResetRequiredRef.current = false;
      setDatasetResetRequired(false);
      setDatasetVerified(true);
      await refreshLocal();
      if (await refreshFromServer()) {
        setNotice("Old device records cleared. Showing attendance from this database.");
      }
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Could not clear old device data.");
    } finally {
      setClearingDataset(false);
    }
  }

  async function handleMessage(record: AttendanceRecord, type: "sign_in" | "sign_out") {
    if (
      datasetResetRequiredRef.current ||
      !datasetVerified ||
      !record.signedInAt ||
      !online ||
      (type === "sign_out" && !record.signedOutAt)
    ) return;
    setOpeningMessage((current) => new Set(current).add(record.sessionRef));
    setPageError("");
    const message = type === "sign_in"
      ? buildSignInMessage(
        record.studentName,
        formatTime(record.signedInAt),
        schoolName,
        formatDayKey(dayKey),
      )
      : buildSignOutMessage(
        record.studentName,
        formatTime(record.signedInAt),
        formatTime(record.signedOutAt),
        schoolName,
        formatDayKey(dayKey),
      );
    const opened = window.open(buildWhatsAppUrl(message, record.parentPhone), "_blank");
    if (!opened) {
      setPageError("WhatsApp could not be opened. Check your browser’s pop-up settings or copy the number and send manually.");
      setOpeningMessage((current) => {
        const next = new Set(current);
        next.delete(record.sessionRef);
        return next;
      });
      return;
    }
    opened.opener = null;

    if (type === "sign_in") {
      setNotice("WhatsApp opened. Check the message before sending.");
      setOpeningMessage((current) => {
        const next = new Set(current);
        next.delete(record.sessionRef);
        return next;
      });
      return;
    }

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
    const message = buildSignOutMessage(
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
    try {
      const response = await fetch("/logout", { method: "POST", credentials: "include" });
      if (!response.ok) {
        throw new Error("Could not log out. Please try again.");
      }
      clearCachedStaffSession();
      window.location.replace("/login");
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Could not log out. Please try again.");
    }
  }

  const dateLabel = formatDayKey(dayKey);

  if (!ready || !staff) {
    return (
      <main className="app-shell app-shell--narrow">
        <p className="loading-message">
          {redirecting ? "Taking you to log in…" : loading ? "Opening attendance…" : "Could not open attendance."}
        </p>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="header-brand">
          <img
            className="brand-logo"
            src="/branding/school-logo.webp"
            alt={`${schoolName} logo`}
            width={1000}
            height={368}
          />
          <div className="brand-date">{dateLabel}</div>
        </div>
        <div className="header-tools">
          <a className="text-button" href="/review">Day review</a>
          <button
            className="text-button"
            onClick={handleLogout}
            disabled={!online}
            title={!online ? "Reconnect to log out" : undefined}
          >
            {staff.staffName}, log out
          </button>
        </div>
      </header>

      {!online && <p className="offline-note" role="status">Offline · records saved on this phone</p>}
      {!datasetVerified && !datasetResetRequired && (
        <p className="dataset-reset-notice" role="status">
          Connect to the internet to verify this attendance database before recording.
        </p>
      )}
      {datasetResetRequired && (
        <section className="dataset-reset-notice" role="alert">
          <div>
            <strong>This device has data from a different database.</strong>
            <p>Old attendance and unsynced records are hidden and will not sync. Clear them before using this database.</p>
          </div>
          <button
            className="button button-secondary"
            onClick={() => void handleClearOldDeviceData()}
            disabled={clearingDataset}
          >
            {clearingDataset ? "Clearing…" : "Clear old device data"}
          </button>
        </section>
      )}
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

      <section className="attendance-board" aria-label="Attendance register">
        <div className="attendance-tabs" role="tablist" aria-label="Attendance status">
          <button
            id="in-school-tab"
            className={`attendance-tab${activeTab === "in-school" ? " attendance-tab--active" : ""}`}
            type="button"
            role="tab"
            aria-selected={activeTab === "in-school"}
            aria-controls="in-school-panel"
            onClick={() => setActiveTab("in-school")}
          >
            In school <span>{inSchool.length}</span>
          </button>
          <button
            id="signed-out-tab"
            className={`attendance-tab${activeTab === "signed-out" ? " attendance-tab--active" : ""}`}
            type="button"
            role="tab"
            aria-selected={activeTab === "signed-out"}
            aria-controls="signed-out-panel"
            onClick={() => setActiveTab("signed-out")}
          >
            Signed out <span>{signedOut.length}</span>
          </button>
        </div>

        <div className="list-tools">
          <input
            type="search"
            aria-label="Search children"
            placeholder="Search children"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        <section
          className="roster-section"
          id="in-school-panel"
          role="tabpanel"
          aria-labelledby="in-school-tab"
          hidden={activeTab !== "in-school"}
        >
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
                      <div className="student-identity">
                        <strong className="student-name">{record.studentName}</strong>
                        <span className="student-phone">{record.parentPhone}</span>
                        <span className={sync.className}>{sync.label}</span>
                      </div>
                      <span className="student-time">{formatTime(record.signedInAt)}</span>
                      {record.syncError && <span className="sync-error">{record.syncError}</span>}
                    </div>
                    <div className="arrival-actions">
                      <button
                        className="button button-message"
                        disabled={!online || !datasetVerified || datasetResetRequired || openingMessage.has(record.sessionRef)}
                        onClick={() => void handleMessage(record, "sign_in")}
                        title={!online ? "Connect to the internet to open WhatsApp" : undefined}
                      >
                        {openingMessage.has(record.sessionRef) ? "Opening…" : "Send msg"}
                      </button>
                      <button
                        className="button button-checkout"
                        disabled={!datasetVerified || datasetResetRequired || signingOut.has(record.sessionRef)}
                        onClick={() => void handleSignOut(record)}
                      >
                        {signingOut.has(record.sessionRef) ? "Saving…" : "Sign out"}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section
          className="roster-section checked-out-section"
          id="signed-out-panel"
          role="tabpanel"
          aria-labelledby="signed-out-tab"
          hidden={activeTab !== "signed-out"}
        >
          {outstandingCount > 0 && (
            <p className="message-hint">
              <strong>{outstandingCount} message{outstandingCount === 1 ? "" : "s"} not sent</strong>
              <span>Each opens WhatsApp with the text ready.</span>
            </p>
          )}
          {visibleSignedOut.length === 0 ? (
            <p className="empty-state empty-state--compact">{search ? "No children found." : "No one signed out yet."}</p>
          ) : (
            <ul className="student-list">
              {visibleSignedOut.map((record) => {
                const sync = syncSummary(record);
                return (
                  <li className="student-card student-card--completed" key={record.sessionRef}>
                    <div className="student-details">
                      <div className="student-identity">
                        <strong className="student-name">{record.studentName}</strong>
                        <span className="student-divider">•</span>
                        <span className="student-phone">{record.parentPhone}</span>
                        <span className={sync.className}>{sync.label}</span>
                      </div>
                      <span className="student-time student-time--range">
                        {formatTime(record.signedInAt)} to {formatTime(record.signedOutAt)}
                      </span>
                      {record.syncError && <span className="sync-error">{record.syncError}</span>}
                    </div>
                    <div className="message-actions">
                      {record.whatsappLaunchedAt && (
                        <span className="message-opened">✓ Sent {formatTime(record.whatsappLaunchedAt)}</span>
                      )}
                      <button
                        className="button button-message"
                        disabled={!online || !datasetVerified || datasetResetRequired || openingMessage.has(record.sessionRef)}
                        onClick={() => void handleMessage(record, "sign_out")}
                        title={!online ? "Connect to the internet to open WhatsApp" : undefined}
                      >
                        {openingMessage.has(record.sessionRef) ? "Opening…" : "Send again?"}
                      </button>
                      <button className="copy-button" onClick={() => void handleCopy(record)}>Copy</button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {activeTab === "signed-out" && inSchool.length > 0 && (
          <div className="attendance-footer">
            <span>{inSchool.length} {inSchool.length === 1 ? "child is" : "children are"} still in school.</span>
            <button className="button button-secondary" onClick={() => setActiveTab("in-school")}>See who</button>
          </div>
        )}
      </section>

      <section className="sign-in" aria-labelledby="sign-in-title">
        <div className="sign-in-body">
          <div className="section-heading">
            <h2 id="sign-in-title">Sign in a child</h2>
          </div>
          <form className="attendance-form" onSubmit={handleSignIn}>
          <label className="field">
            <span>Student name</span>
            <input
              ref={nameInput}
              autoComplete="off"
              maxLength={100}
              placeholder="Full name"
              value={studentName}
              onChange={(event) => setStudentName(event.target.value)}
              disabled={datasetResetRequired || !datasetVerified}
              required
            />
          </label>
          <label className="field">
            <span>Parent’s phone</span>
            <input
              autoComplete="tel"
              inputMode="tel"
              placeholder="0801 234 5678"
              value={parentPhone}
              onChange={(event) => setParentPhone(event.target.value)}
              disabled={datasetResetRequired || !datasetVerified}
              required
            />
          </label>
          {formError && <p className="inline-error" role="alert">{formError}</p>}
          <button
            className="button button-primary button-sign-in"
            type="submit"
            disabled={saving || datasetResetRequired || !datasetVerified}
          >
            {saving ? "Saving…" : "Sign in"}
          </button>
        </form>
        </div>
      </section>
    </main>
  );
}
