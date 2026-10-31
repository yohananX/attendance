import { describe, expect, it } from "vitest";
import { buildMessage, buildWhatsAppUrl } from "../src/lib/whatsapp";

describe("lib/whatsapp — buildMessage (T7)", () => {
  it("includes school name, student name and both Lagos 12-hour times", () => {
    const message = buildMessage("O'Brien", "8:40 AM", "1:15 PM", "Grace House School");
    expect(message).toContain("Grace House School");
    expect(message).toContain("O'Brien");
    expect(message).toContain("Signed in: 8:40 AM");
    expect(message).toContain("Signed out: 1:15 PM");
  });

  it("closes with a privacy sentence about logging only the link opening", () => {
    const message = buildMessage("Chidiebere", "9:00 AM", "12:30 PM", "Grace House School");
    expect(message).toContain("runbook");
    expect(message).toContain("link was opened");
  });

  it("never claims the message was sent or delivered (BR-13, AC-G8)", () => {
    const message = buildMessage("Ada Lovelace", "12:00 AM", "11:59 PM", "X School");
    const lower = message.toLowerCase();
    expect(lower).not.toContain("sent");
    expect(lower).not.toContain("delivered");
  });
});

describe("lib/whatsapp — buildWhatsAppUrl (T7)", () => {
  it("builds a wa.me deep link with the pre-filled, URI-encoded message", () => {
    const message = buildMessage("O'Brien", "8:40 AM", "1:15 PM", "Grace House School");
    const url = buildWhatsAppUrl(message);
    expect(url).toBe("https://wa.me/?text=" + encodeURIComponent(message));
    expect(url.startsWith("https://wa.me/")).toBe(true);
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
