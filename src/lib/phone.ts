/**
 * Nigerian phone number normalization to E.164 (+234...) form.
 *
 * Accepts:
 *  - International form already present: +2348012345678
 *  - Country code without the leading plus: 2348012345678
 *  - Local GSM format with trunk prefix 0: 08012345678, 09012345678,
 *    07012345678 — optional spaces/dashes are stripped, e.g. "0801 234 5678"
 *
 * Returns the E.164 form matching the database CHECK constraint
 * `^\+[0-9]{7,15}$`. Throws if the number cannot be normalised.
 */
export function normalizePhone(raw: string): string {
  if (typeof raw !== "string") {
    throw new Error("phone_unnormalisable: phone number must be a string");
  }

  const trimmed = raw.trim();
  if (trimmed === "") {
    throw new Error("phone_unnormalisable: phone number is required");
  }

  // Strip spaces and dashes — the separators staff most commonly type or write.
  const cleaned = trimmed.replace(/[\s\-]+/g, "");

  let digits: string;

  if (cleaned.startsWith("+")) {
    // Already in international form: +234... — keep the digits after the plus.
    digits = cleaned.slice(1);
  } else if (cleaned.startsWith("234")) {
    // Country code present without the leading plus.
    digits = cleaned;
  } else if (cleaned.startsWith("0")) {
    // Local Nigerian GSM format: replace the trunk prefix 0 with 234.
    // Covers the 070x / 080x / 090x mobile prefixes.
    digits = "234" + cleaned.slice(1);
  } else {
    throw new Error(`phone_unnormalisable: unable to parse phone number "${raw}"`);
  }

  if (!/^[0-9]+$/.test(digits)) {
    throw new Error(`phone_unnormalisable: phone number contains invalid characters "${raw}"`);
  }

  const e164 = "+" + digits;

  if (!/^\+[0-9]{7,15}$/.test(e164)) {
    throw new Error(`phone_unnormalisable: phone number out of E.164 range "${raw}"`);
  }

  return e164;
}
