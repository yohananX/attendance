const DATASET_ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;

export function getAttendanceDatasetId(): string | null {
  const configured = process.env.ATTENDANCE_DATASET_ID?.trim();
  if (!configured && process.env.NODE_ENV !== "production") return "development";
  if (!configured || !DATASET_ID_PATTERN.test(configured)) return null;
  return configured;
}
