# Stakeholder Decision Register
# Grace House School Attendance Sign-In

| | |
|---|---|
| **Document** | Stakeholder Decision Register v1.0 |
| **Version** | 1.0 — 30 October 2026 |
| **Author** | Lead Software Architect |
| **Status** | **Proposed defaults — pending stakeholder approval** |
| **Purpose** | Resolve outstanding product and architecture decisions before the controlled pilot. |
| **Related documents** | `PRD_v1.2.md` (§27.2 Q5, §27 Q13–Q16), `SYSTEM_ARCHITECTURE_v1.0.md` (AD-3, AD-5, AD-7, AD-10), `IMPLEMENTATION_PLAN_v1.0.md` |

---

## 1. Decision summary

| Decision | Recommended default | Status |
|---|---|---|
| Q5 — Clock and late-sync thresholds | 5-minute clock tolerance; 5-minute maximum future timestamp; 7-day late-sync window | Pending |
| Q13 — Offline attendance corrections | Online-only for the first pilot | Pending |
| Q14 — Closing the attendance day | Block closure until all events are synchronised and acknowledged | Pending |
| Q15 — WhatsApp success wording | Report only what the application can verify | Pending |
| Q16 — Residual technical risks | Explicitly acknowledge the remaining risks | Pending |

## 2. Decision details

### Q5 — Clock and late-sync thresholds

**Recommendation**
- Flag a device clock estimate when its offset exceeds 5 minutes.
- Reject or flag manually captured timestamps more than 5 minutes in the future, subject to the final PRD rule.
- Permit late synchronisation for up to 7 days, retaining the original attendance date and event timestamp.
- Never silently discard an event outside the permitted window; flag it for review.

**Reason:** These thresholds provide an operational starting point while preserving the distinction between device-clock error and time spent offline.

**Approval required:** Confirm all three values.

### Q13 — Offline attendance corrections

**Recommendation:** Corrections require an online connection during the first pilot.

**Reason:** Corrections can affect attendance records and must use server-side version checks and audit logging. Ordinary sign-in and sign-out remain offline-capable.

**Approval required:** Confirm online-only corrections for the pilot.

### Q14 — Closing the attendance day

**Recommendation:** Day closure is online-only and blocked until the server has acknowledged all captured events.

**Reason:** Closing while events remain on devices could create incomplete attendance records or premature cleanup.

**Approval required:** Confirm the blocking rule.

### Q15 — WhatsApp status wording

**Recommendation:** The interface must distinguish between:
1. Message prepared.
2. WhatsApp link launched.
3. Message manually sent — not independently verifiable.
4. Message delivered — not independently verifiable.

The application must never claim that a message was sent or delivered merely because WhatsApp opened.

**Approval required:** Approve the verifiable wording.

### Q16 — Residual-risk acknowledgement

**Recommendation:** Explicitly acknowledge these remaining risks:
- Device clock manipulation can affect offline timestamps.
- Locally stored attendance data is not encrypted by the application.
- Browser storage can be cleared or evicted.
- Offline authentication expiry is enforced against an untrusted device clock. Device clock manipulation may affect the effective offline session expiry.

Mitigations and operational fallback procedures must be documented. Acknowledging these risks does not mean they have been eliminated.

**Approval required:** Stakeholder acknowledgement.

## 3. Implementation rule

Until approval is recorded:
- Treat each recommendation as a proposed safe default, not an approved stakeholder decision.
- Do not represent pending decisions as accepted.
- Implement only features that remain safe under either outcome.
- Keep unresolved thresholds configurable where practical.
- Record the final decision, approver and date in the project documentation.

## 4. Sign-off record

| Decision | Approved by | Date | Final decision |
|---|---|---|---|
| Q5 | Pending | — | — |
| Q13 | Pending | — | — |
| Q14 | Pending | — | — |
| Q15 | Pending | — | — |
| Q16 | Pending | — | — |
