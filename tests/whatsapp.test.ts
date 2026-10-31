import { describe, expect, it } from "vitest";
import {
  buildSignInMessage,
  buildSignOutMessage,
  buildWhatsAppUrl,
} from "../src/lib/whatsapp";

describe("WhatsApp attendance messages", () => {
  it("builds a short arrival note with the sign-in time", () => {
    expect(buildSignInMessage(
      "Ada Lovelace",
      "8:40 AM",
      "Grace House School",
      "Saturday, 31 October 2026",
    )).toBe([
      "Grace House School",
      "",
      "Ada Lovelace has arrived at school.",
      "Sign-in: 8:40 AM",
      "Date: Saturday, 31 October 2026",
    ].join("\n"));
  });

  it("builds a short departure note with both attendance times", () => {
    expect(buildSignOutMessage(
      "Ada Lovelace",
      "8:40 AM",
      "1:15 PM",
      "Grace House School",
    )).toBe([
      "Grace House School",
      "",
      "Ada Lovelace has left school.",
      "Sign-in: 8:40 AM",
      "Sign-out: 1:15 PM",
    ].join("\n"));
  });

  it("does not add app or runbook explanations to the parent message", () => {
    const message = buildSignOutMessage("Chidiebere", "9:00 AM", "12:30 PM", "Grace House School");
    expect(message).not.toContain("runbook");
    expect(message).not.toContain("link was opened");
    expect(message).not.toContain("actual sending");
  });
});

describe("buildWhatsAppUrl", () => {
  it("builds a wa.me deep link with the pre-filled, URI-encoded message", () => {
    const message = buildSignInMessage("O'Brien", "8:40 AM", "Grace House School");
    expect(buildWhatsAppUrl(message)).toBe("https://wa.me/?text=" + encodeURIComponent(message));
  });

  it("encodes characters that would break the URL", () => {
    const url = buildWhatsAppUrl("a & b?c=1");
    expect(url).toContain("text=" + encodeURIComponent("a & b?c=1"));
  });

  it("addresses the parent’s phone when one is supplied", () => {
    expect(buildWhatsAppUrl("Hello", "+2348012345678")).toBe(
      "https://wa.me/2348012345678?text=Hello",
    );
  });
});
