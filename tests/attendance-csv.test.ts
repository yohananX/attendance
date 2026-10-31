import { describe, expect, it } from "vitest";

import { buildAttendanceCsv } from "../src/lib/attendance-csv";

describe("buildAttendanceCsv", () => {
  it("exports only the requested columns and escapes CSV values", () => {
    const csv = buildAttendanceCsv([
      {
        studentName: 'Ada "Dee" Lovelace',
        parentPhone: "+2348012345678",
        signedInAt: "2026-10-31T08:00:00.000Z",
        signedOutAt: null,
      },
    ], (value) => value ? "9:00 am" : "—");

    expect(csv).toBe([
      '"Student name","Parent phone","Sign in","Sign out"',
      '"Ada ""Dee"" Lovelace","+2348012345678","9:00 am","—"',
    ].join("\r\n"));
  });
});
