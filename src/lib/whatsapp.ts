/**
 * WhatsApp message generation for the Grace House attendance handoff (T7).
 *
 * Times are formatted by the caller in Africa/Lagos 12-hour format
 * (architecture §1.2; display formatting is client-side only). This module
 * interpolates them without re-parsing, so what appears in the message is
 * exactly what appears on screen.
 */

/** Short arrival message, ready for a WhatsApp handoff. */
export function buildSignInMessage(
  studentName: string,
  signInTime: string,
  schoolName: string,
  attendanceDate?: string,
): string {
  return [
    schoolName,
    "",
    `${studentName} has arrived at school.`,
    `Sign-in: ${signInTime}`,
    ...(attendanceDate ? [`Date: ${attendanceDate}`] : []),
  ].join("\n");
}

/** Short departure message, ready for a WhatsApp handoff. */
export function buildSignOutMessage(
  studentName: string,
  signInTime: string,
  signOutTime: string,
  schoolName: string,
  attendanceDate?: string,
): string {
  return [
    schoolName,
    "",
    `${studentName} has left school.`,
    `Sign-in: ${signInTime}`,
    `Sign-out: ${signOutTime}`,
    ...(attendanceDate ? [`Date: ${attendanceDate}`] : []),
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
