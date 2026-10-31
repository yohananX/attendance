/**
 * WhatsApp message generation for the Grace House attendance handoff (T7).
 *
 * Honesty rule (BR-13, AC-G8): message text and UI text never claim a
 * message was "sent" or "delivered". The application can only verify that
 * the WhatsApp link was opened (link launch initiated); actual sending is a
 * staff action confirmed outside the app by the school runbook. Q15 wording
 * is implemented to the safe default: "WhatsApp opened", never "sent".
 *
 * Times are formatted by the caller in Africa/Lagos 12-hour format
 * (architecture §1.2; display formatting is client-side only). This module
 * interpolates them without re-parsing, so what appears in the message is
 * exactly what appears on screen.
 */

/** Prefilled WhatsApp message body for a parent, ready for wa.me `?text=`. */
export function buildMessage(
  studentName: string,
  signInTime: string,
  signOutTime: string,
  schoolName: string,
  attendanceDate?: string,
): string {
  return [
    schoolName,
    "",
    `Attendance for ${studentName}`,
    ...(attendanceDate ? [`Date: ${attendanceDate}`] : []),
    "",
    `Signed in: ${signInTime}`,
    `Signed out: ${signOutTime}`,
    "",
    "This message shares sign-in and sign-out times with the parent.",
    "It records that the WhatsApp link was opened; actual sending is a staff",
    "action confirmed by the school runbook, not by this application.",
  ].join("\n");
}

/**
 * Build a wa.me deep link with the message fully pre-filled.
 * encodeURIComponent guarantees the text survives the URL intact.
 */
export function buildWhatsAppUrl(message: string, parentPhone?: string): string {
  const phonePath = parentPhone ? parentPhone.replace(/\D/g, "") : "";
  return `https://wa.me/${phonePath}?text=${encodeURIComponent(message)}`;
}

/** Words that must never appear in message or UI text (BR-13). */
export const BANNED_MESSAGE_WORDS = ["sent", "delivered"];
