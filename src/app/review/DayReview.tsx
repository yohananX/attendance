"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { buildAttendanceCsv } from "@/lib/attendance-csv";
import {
  AttendanceRecord,
  clearCachedStaffSession,
  getAttendanceForDay,
  getCachedStaffSession,
  mergeServerAttendance,
} from "@/lib/attendance-store";

interface ServerDay {
  sessions: Omit<AttendanceRecord, "pendingEvents" | "syncError">[];
}

function currentLagosDay(): string {
  return new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 10);
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

function formatDay(dayKey: string): string {
  return new Date(`${dayKey}T12:00:00+01:00`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Africa/Lagos",
  });
}

export default function DayReview() {
  const router = useRouter();
  const [dayKey] = useState(currentLagosDay);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [online, setOnline] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadRecords = useCallback(async () => {
    setError("");
    try {
      const localRecords = await getAttendanceForDay(dayKey);
      setRecords(localRecords);
      if (!navigator.onLine) return;

      const response = await fetch(`/api/day?dayKey=${encodeURIComponent(dayKey)}`, {
        credentials: "include",
        cache: "no-store",
      });
      if (response.status === 401) {
        clearCachedStaffSession();
        router.replace("/login");
        return;
      }
      if (!response.ok) throw new Error("Could not load today’s attendance.");

      const data = (await response.json()) as ServerDay;
      setRecords(await mergeServerAttendance(dayKey, data.sessions));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load attendance.");
    } finally {
      setLoading(false);
    }
  }, [dayKey, router]);

  useEffect(() => {
    if (!getCachedStaffSession()) {
      router.replace("/login");
      return;
    }
    const handleOnline = () => {
      setOnline(true);
      void loadRecords();
    };
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    setOnline(navigator.onLine);
    void loadRecords();
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [loadRecords, router]);

  function exportCsv() {
    const csv = buildAttendanceCsv(records, formatTime);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `attendance-${dayKey}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="app-shell review-shell">
      <header className="review-header">
        <a className="review-back" href="/dashboard">← Back</a>
        <h1>Day review · {formatDay(dayKey)}</h1>
        <button className="button button-primary export-button" onClick={exportCsv} disabled={loading}>
          Export CSV
        </button>
      </header>

      {!online && <p className="review-note">Offline · showing records saved on this phone</p>}
      {error && <p className="alert alert--error" role="alert">{error}</p>}

      <div className="review-table-wrap">
        <table className="review-table">
          <thead>
            <tr>
              <th scope="col">Student name</th>
              <th scope="col">Parent phone</th>
              <th scope="col">Sign in</th>
              <th scope="col">Sign out</th>
            </tr>
          </thead>
          <tbody>
            {records.map((record) => (
              <tr key={record.sessionRef}>
                <td>{record.studentName}</td>
                <td>{record.parentPhone}</td>
                <td>{formatTime(record.signedInAt)}</td>
                <td>{formatTime(record.signedOutAt)}</td>
              </tr>
            ))}
            {!loading && records.length === 0 && (
              <tr>
                <td className="review-empty" colSpan={4}>No attendance recorded today.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
