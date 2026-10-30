# Executive Summary — PD Decision Review

**Review Date:** 30 October 2026  
**Scope:** PD-D1–D11, PD-A1–A8, PD-S1–S7 (26 decisions)  
**Status:** Preparation only — no decisions approved, no documents modified

## Decisions requiring owner approval before implementation
| ID | Decision | Reason | Blocks |
|---|---|---|---|
| **PD-A4** | Day-close enforcement (client enforces outbox empty, server authorizes) | Server cannot observe device outbox. Only viable safe approach. Critical for FR-35/AC-35.4. | **T8.3 (Day close)** |
| **PD-D3** | Orphaned sign-out handling (accept into log, provisional session, re-project) | Cross-device/offline case not specified in architecture. Preserves evidence, required for offline-first. | **T2.3 (Projection logic)** |
| **PD-S6** | Failed-review resolution mechanics (explicit "Resolve" action with audit) | Required for AC-15.4 (rejected events must not disappear until resolved). Day close blocked by failed-review. | **Failed-review UI/handling** |
| **PD-D1** | Late-sync window (configurable, default 7 days) | Tied to **Q5**. Needed for FR-15 validation. | **T2.2 (Ingest validation)** |
| **PD-A1** | Full API endpoint catalogue | Needed for route implementation. | **API routes** |
| **PD-A5** | "Same child" definition for competing_sign_in (name+phone+dayKey) | Affects conflict detection. Needs confirmation of matching rules. | **T2.3 (Conflict detection)** |
| **PD-A8** | Dedicated E5 endpoint for corrections | Tied to **Q13** (online-only for pilot). | **T8.2 (Corrections)** |
| **PD-D2** | Partial unique indexes for sign-out enforcement | Defence-in-depth for BR-06. Strongly recommended before schema finalization. | **T2.1 (Schema)** |

## Decisions safe to defer
| ID | Decision | Notes |
|---|---|---|
| PD-D6, PD-D8, PD-D9, PD-D10, PD-D11 | Schema/audit details | Non-blocking, safe defaults available |
| PD-A2, PD-A3, PD-A6, PD-A7 | API details | Safe defaults or features cut for pilot |
| PD-S1, PD-S2, PD-S3, PD-S4, PD-S5, PD-S7 | Sync/persistence details | Tuneable, safe defaults available |

## Decisions that can use their proposed defaults
- **PD-D4:** Server stamps staff_name from cookie (enforce strictly) — aligns with BR-01/S7
- **PD-D5:** (device_id, day_key, device_seq) uniqueness as flag not rejection
- **PD-D7:** Launch marker first-write-wins
- Most PD-S* except PD-S6

## Interaction with Stakeholder Questions
| Question | Impact | Action |
|---|---|---|
| **Q5** | PD-D1 (late-sync window), PD-A2 (probe threshold), validation logic | **Must answer before finalizing PD-D1.** Use configurable defaults (7 days, 5 min) pending approval. |
| **Q13** | PD-A8 (correction endpoint), offline corrections | Default online-only for pilot (AD-5). E5 design must be schema-compatible for future offline support. |
| **Q14** | PD-A4 (day-close enforcement), blocking rule | **Must answer.** PD-A4 assumes blocking is required; this matches AD-10 default. |
| **Q15** | Wording policy | PD decisions already enforce "WhatsApp opened" (BR-13). Q15 is confirmation of wording policy. |
| **Q16** | Residual risks | Risks documented (unencrypted local storage, clock manipulation, storage clearing). No structural changes needed; requires explicit acknowledgement. |

## Recommended next implementation task
**Phase 0 first:** Resolve blocking decisions (PD-A4, PD-D3, PD-S6, PD-D1 with Q5) before coding.  
**Then:** T1.1–T2.1 (setup + schema) applying approved decisions, but **do NOT implement day-close (E6/T8.3) until PD-A4 approved, do NOT implement orphaned sign-out until PD-D3 approved, do NOT finalize failed-review until PD-S6 approved.** Keep all thresholds configurable.

**Critical:** No proposed decision has been marked as approved. All recommendations require owner review and explicit approval.
