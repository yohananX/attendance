export interface AttendanceCsvRow {
  studentName: string;
  parentPhone: string;
  signedInAt: string | null;
  signedOutAt: string | null;
}

function escapeCsv(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export function buildAttendanceCsv(
  rows: AttendanceCsvRow[],
  formatTime: (value: string | null) => string,
): string {
  const header = ["Student name", "Parent phone", "Sign in", "Sign out"];
  const body = rows.map((row) => [
    row.studentName,
    row.parentPhone,
    formatTime(row.signedInAt),
    formatTime(row.signedOutAt),
  ]);
  return [header, ...body]
    .map((row) => row.map(escapeCsv).join(","))
    .join("\r\n");
}
