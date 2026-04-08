---
title: RFC-002 - OpenClaw WhatsApp Channel Integration (M2)
date: 2026-04-07
status: Draft
owner: nurrizky
depends_on:
  - RFC-001-openclaw-telegram-receipt-assistant.md
---

# RFC-002: OpenClaw WhatsApp Channel Integration (M2)

## 1) Goal
Extend the existing receipt assistant beyond Telegram by adding WhatsApp as a second inbound channel in OpenClaw, while preserving the same extraction pipeline and Google Sheets output contract from RFC-001.

M2 target behavior:
- You can DM the WhatsApp bot/number and run receipt processing.
- You can add the WhatsApp bot account to a group and trigger it by mention.
- The processed output lands in the same `receipts_raw` and `monthly_breakdown` sheets used in M1.

## 2) Outcome Summary
After M2, the assistant supports:
- Telegram (existing, from RFC-001)
- WhatsApp DM (new)
- WhatsApp group mention trigger (new)

The business output remains identical:
- one normalized row per receipt
- same `receipt.v1.1` schema
- same idempotency concept (`receipt_id`)

## 3) Scope (M2 Locked)

In scope:
- Add WhatsApp channel to OpenClaw gateway.
- Support two WhatsApp trigger modes:
  - DM trigger: `/receipt` + image/PDF
  - Group trigger: mention pattern + `/receipt` + image/PDF
- Reuse M1 parser, validator, classifier, and sheets writer.
- Extend source metadata to include provider/channel context.
- Add channel-specific access control and hardening.

Out of scope:
- Replacing Telegram flow.
- New extraction schema version.
- Item-level parsing/analytics.
- Cross-channel dedupe beyond deterministic `receipt_id` rule in this RFC.

## 4) M2 Design Principles
- Keep one pipeline implementation; only the channel adapter differs.
- Preserve M1 result shape and quality targets.
- Restrict inbound access via allowlist/pairing before enabling broad group usage.
- Prefer dedicated WhatsApp number for operational hygiene.

## 5) OpenClaw WhatsApp Integration Model

Based on OpenClaw channel docs and FAQ:
- WhatsApp channel runs via WhatsApp Web session managed by Gateway.
- Session login is done with QR pairing (`openclaw channels login`).
- DM access is controlled by policy (`dmPolicy`) plus `allowFrom`/pairing.
- Group handling is mention-driven in group-chat config patterns.

M2 channel strategy:
1. Keep existing Telegram integration from RFC-001.
2. Add WhatsApp channel config side-by-side.
3. Route both Telegram and WhatsApp inbound events into the same receipt pipeline.

## 6) Phone Number Strategy (Decision)

Recommended (locked for M2):
- Use a **dedicated WhatsApp number** for the assistant.

Why:
- Cleaner separation from personal chats.
- Lower risk of accidental self-chat or contact confusion.
- Better for adding to groups as a bot-like assistant identity.

Fallback:
- Personal number mode with self-chat can work, but is not the default for M2.

### 6.1 How to get a dedicated number (step-by-step)

Goal: get a stable number that can stay active for months, receive WhatsApp verification SMS once, and remain cheap to maintain.

#### Option A (recommended): local carrier eSIM
Best for reliability and long-term use.

1. Pick a mobile carrier in your country that supports prepaid or low-cost monthly eSIM plans.
2. Buy an eSIM plan that can receive SMS (data-only eSIM without SMS is not enough).
3. Install eSIM on a spare phone (Android preferred for always-on setup) or your current phone temporarily.
4. Activate the line and verify it can receive SMS.
5. Install WhatsApp or WhatsApp Business for that number.
6. Complete WhatsApp verification for the new number.
7. Keep this phone powered and connected to Wi-Fi during initial OpenClaw pairing and early testing.
8. Record renewal cadence (weekly/monthly) and set reminders so the number is never recycled.

#### Option B: physical prepaid SIM
Good fallback if eSIM is unavailable.

1. Buy a prepaid SIM from a local carrier with SMS support.
2. Insert SIM into a spare phone and activate it.
3. Top up the minimum amount required to keep the number alive.
4. Verify SMS reception.
5. Register WhatsApp with this number.
6. Keep periodic top-ups to prevent expiry/reassignment.

#### Option C: second-line/postpaid add-on (family or business plan)
Good for predictable billing and fewer expiry issues.

1. Ask your carrier for an additional line under your existing account.
2. Ensure the new line can receive verification SMS and supports WhatsApp registration.
3. Register WhatsApp and dedicate that line to the assistant.

#### Avoid these for M2
- Most VoIP/free virtual SMS numbers (often blocked by WhatsApp).
- Shared/public SMS inbox services.
- Numbers without guaranteed long-term ownership.

### 6.2 Sustainability checklist (keep number healthy)
- Keep ownership in your name/account.
- Use auto-renew or recurring top-up.
- Do a monthly health check: can receive SMS, WhatsApp session still valid, no carrier suspension.
- Keep a backup recovery path (PIN, carrier app access, recovery email).
- Document costs and renewal date in ops notes.

### 6.3 Cost ranges (typical, varies by country)
- Local prepaid eSIM/SIM: usually low-cost monthly (often the cheapest sustainable path).
- Postpaid second line: higher monthly cost, but easier continuity/support.
- Business/dedicated plans: highest cost, best operational separation.

Decision rule for this RFC:
- Choose the lowest-cost option that guarantees long-term control and SMS reliability.

## 7) Trigger Semantics (WhatsApp)

### 7.1 DM Trigger
Process receipt when:
- inbound channel is WhatsApp DM
- message contains `/receipt`
- message includes image or PDF attachment

### 7.2 Group Trigger
Process receipt when:
- inbound channel is WhatsApp group
- message mentions the assistant using configured mention patterns
- message includes `/receipt`
- message includes image or PDF attachment

### 7.3 Non-trigger cases
Do not process when:
- no `/receipt`
- no mention in group context
- no valid media

User gets a short usage hint in these cases.

## 8) Unified Pipeline (Reuse from RFC-001)

No new parser stack for M2. Reuse:
- `extractReceiptFromImage`
- `normalizeReceiptDate`
- `selectTotalAmount`
- `extractTaxAmountAndLabel`
- `classifyReceipt`
- `validateReceiptV11`
- `appendReceiptsRawRow`

M2 adds only channel-aware ingestion and metadata mapping.

## 9) Event + Hook Wiring

Integration mechanism:
- OpenClaw internal hook on `message:preprocessed`.

Handler behavior:
1. Detect provider/channel (`telegram` or `whatsapp`).
2. Apply channel-specific trigger checks.
3. Build canonical input payload for pipeline.
4. Call shared receipt pipeline.
5. Send channel-appropriate confirmation message.

Operational note:
- Restart gateway after hook/config changes.

## 10) Source Metadata Update (M2)

`receipt.v1.1` remains valid, but M2 writes richer `source` values:

```json
{
  "source": {
    "platform": "telegram|whatsapp",
    "chat_id": "<channel-specific chat id>",
    "message_id": "<channel-specific message id>",
    "received_at": "ISO-8601 timestamp"
  }
}
```

`receipt_id` rule for M2:
- `receipt_id = <platform>:<chat_id>:<message_id>`

Example:
- `telegram:123456789:98765`
- `whatsapp:1203630xxxxx@g.us:ABCDEF1234`

This avoids collisions across channels.

## 11) Google Sheets Output (No Breaking Change)

No new tab required for M2.

Keep `receipts_raw` append in `A:M` from RFC-001.
Optional enhancement (recommended):
- Add `source_platform` column (`N`) for easier filtering/reporting.

If optional column `N` is added:
- Update append mapping and docs accordingly.
- `monthly_breakdown` formula can remain unchanged if built from existing columns.

## 12) Access Control and Security (M2)

### 12.1 DM policy
For WhatsApp, start with:
- `dmPolicy: "allowlist"` for controlled rollout
- explicit `allowFrom` containing your own number(s)

Alternative:
- `dmPolicy: "pairing"` for controlled approvals.

### 12.2 Group behavior
- Enable group mention handling only after DM flow is stable.
- Require explicit mention pattern to wake the agent.
- Ignore non-mentioned group messages.

### 12.3 Secrets
Keep in `.env`/secure config only:
- OpenAI API key
- Google credentials path
- any channel auth artifacts

Never commit credentials/session artifacts.

## 13) Sandbox / Network Requirements

When sandbox policy is default-deny, allow at minimum:
- `api.openai.com`
- `sheets.googleapis.com`
- `oauth2.googleapis.com` / `www.googleapis.com` (token flow as needed)
- endpoints used by OpenClaw WhatsApp channel runtime

Rollout rule:
- verify parity in non-sandbox first
- then enforce egress allowlist

## 14) User Prerequisites for M2

In addition to RFC-001 prerequisites:

1. **Dedicated WhatsApp number** (recommended; see section 6.1 for acquisition options and section 6.2 for sustainability).
2. Phone with WhatsApp/WhatsApp Business for initial verification.
3. OpenClaw configured with WhatsApp channel.
4. QR login completed (`openclaw channels login`).
5. DM policy set (`allowlist` or `pairing`) and tested in DM first.
6. (If using group mode) assistant account added to target WhatsApp group.
7. Mention pattern configured and verified.

## 15) Config Sketch (Illustrative)

Example structure (keys may differ by OpenClaw version; verify against current docs):

```json
{
  "channels": {
    "telegram": {
      "enabled": true
    },
    "whatsapp": {
      "enabled": true,
      "dmPolicy": "allowlist",
      "allowFrom": ["+62XXXXXXXXXX"]
    }
  },
  "messages": {
    "groupChat": {
      "mentionPatterns": ["@receipt-bot", "receipt bot", "clawd"]
    }
  }
}
```

Important:
- Treat this as a template, not exact final config.
- Use channel docs for your OpenClaw version before applying.

## 16) Milestone Plan (M2)

### Phase 1: Channel bring-up
- Configure WhatsApp channel.
- Complete QR login and confirm gateway reconnect stability.
- Validate DM `/receipt` end-to-end with one sample receipt.

### Phase 2: Shared pipeline integration
- Hook routes WhatsApp messages into existing pipeline.
- Validate Sheets append + idempotency.
- Confirm `receipt_id` format includes platform prefix.

### Phase 3: Group mention mode
- Add bot account to test group.
- Configure mention patterns.
- Verify only mention-triggered messages execute.

### Phase 4: Hardening + parity
- Apply sandbox egress allowlist.
- Run mixed golden set across Telegram + WhatsApp.
- Compare output quality against M1 thresholds.

## 17) Acceptance Criteria (M2)

M2 is complete when all pass:
- WhatsApp DM `/receipt` with media appends correct row in Sheets.
- WhatsApp group mention + `/receipt` + media appends correct row.
- Telegram flow still works unchanged.
- `receipt_id` stays unique across channels.
- No unauthorized DM sender can trigger processing under chosen policy.
- Accuracy remains within M1 target floors.

## 18) Risks and Mitigations

- Session instability/reconnect in WhatsApp Web channel.
  - Mitigation: monitor channel health and reconnect behavior before production use.
- Group noise causes accidental triggers.
  - Mitigation: strict mention + `/receipt` requirement.
- Cross-channel duplicate submissions by user.
  - Mitigation: deterministic `receipt_id` plus optional content hash in future M3.
- Config drift across OpenClaw versions.
  - Mitigation: verify final keys against current docs before rollout.

## 19) Test Matrix (M2)

Minimum matrix:
- WhatsApp DM image receipt: success
- WhatsApp DM PDF receipt: success
- WhatsApp DM without `/receipt`: no process
- WhatsApp group with mention + `/receipt`: success
- WhatsApp group without mention: no process
- Unauthorized DM sender: blocked/pairing flow
- Telegram regression test: still success

Dataset:
- Reuse M1 60 receipts where possible, plus at least 20 WhatsApp-origin samples.

## 20) Implementation Notes

Proposed repo additions under `openclaw-platform/`:
- `channels/whatsapp/` (channel-specific normalization helpers)
- `hooks/receipt-intake/handler.ts` updated for multi-channel logic
- `tests/fixtures/whatsapp/` for DM/group payload fixtures

No OpenClaw core modifications for M2.

## 21) Open Questions (to resolve during implementation)

1. Do we add `source_platform` as a new sheet column now or defer?
2. For group messages with multiple attachments, process all or first only?
3. Should we keep `/receipt` mandatory in group mode forever, or allow mention-only later?

## 22) Decision Log (M2 Snapshot, 2026-04-07)
- M2 objective is additive: WhatsApp added, Telegram remains.
- Dedicated WhatsApp number selected as recommended operating mode.
- Group processing requires explicit mention + `/receipt` + media.
- Shared parser pipeline reused from RFC-001; no schema breaking changes.
- Multi-channel uniqueness uses `receipt_id` with platform prefix.

## 23) References
- RFC-001: `obsidian-vault/rfc-vault/RFC-001-openclaw-telegram-receipt-assistant.md`
- OpenClaw WhatsApp docs: https://docs.openclaw.ai/channels/whatsapp
- OpenClaw Group Messages: https://docs.openclaw.ai/concepts/group-messages
- OpenClaw Hooks: https://docs.openclaw.ai/automation/hooks
