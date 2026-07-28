---
title: RFC-007 - Unified Orchestrator And Finance Automation Platform
date: 2026-07-28
status: Proposed
owner: nurrizky
depends_on:
  - RFC-001-openclaw-telegram-receipt-assistant.md
  - RFC-002-openclaw-whatsapp-channel-integration.md
  - RFC-003-receipt-payment-method-confirmation.md
  - RFC-004-cicilan-intake-monthly-projection.md
  - RFC-005-credit-card-weekly-payment-calendar.md
  - RFC-006-weekly-finance-digest.md
---

# RFC-007: Unified Orchestrator And Finance Automation Platform

## 1) Status And Decision

Status: Proposed. No implementation is authorized by this RFC yet.

Evolve `openclaw-platform` from a collection of reactive task handlers into a
unified, policy-controlled automation platform.

The proposed direction is:

1. Normalize Telegram and WhatsApp events into one canonical message.
2. Give one orchestrator ownership of routing, suppression, task execution,
   and reply delivery.
3. Keep deterministic financial calculations and writes outside the language
   model.
4. Allow models to understand natural language only through narrow,
   validated tools.
5. Add durable operational state for confirmations, scheduled jobs, retries,
   idempotency, and delivery status.
6. Add proactive finance automation in small, reversible phases.

This RFC does not approve automatic transfers, payments, or other movement of
money.

## 2) Context

The current platform already supports:

- Telegram and WhatsApp through OpenClaw;
- receipt image and optional PDF intake;
- Gemini or Mistral receipt extraction;
- receipt classification and payment-method resolution;
- human confirmation before saving;
- Google Sheets receipt and cicilan storage;
- monthly breakdown formulas;
- credit-card weekly planning;
- a deterministic `/finance` digest;
- Markdown receipt and wishlist memory;
- path-scoped Git commits for vault changes.

The current architecture is a modular monolith:

```text
                           USERS
                 +-----------------------+
                 | Telegram | WhatsApp   |
                 +-----------+-----------+
                             |
                             v
+------------------------------------------------------------------+
|                     OPENCLAW GATEWAY                              |
|                                                                  |
|  Authentication | Pairing | Mentions | Sessions | General Agent  |
|                                                                  |
|  +--------------------+       +-------------------------------+   |
|  | task-router hook   |       | task-gate plugin              |   |
|  | policy + dispatch  |       | suppression + reply shaping   |   |
|  +---------+----------+       +---------------+---------------+   |
+------------|----------------------------------|-------------------+
             |                                  |
             +----------------+-----------------+
                              |
                              v
+------------------------------------------------------------------+
|                    APPLICATION CORE                              |
|                                                                  |
| Trigger Detector -> Task Registry -> Handler -> Use Case          |
|                                                                  |
| Receipt | Cicilan | Wishlist | Calory | Health | Finance Digest  |
+------------------------------+-----------------------------------+
                               |
                               v
+------------------------------------------------------------------+
|                       INTEGRATIONS                               |
|                                                                  |
| Gemini/Mistral | Google Sheets | Obsidian Vault | Git            |
+------------------------------------------------------------------+
```

## 3) Problem Statement

### 3.1 Overlapping message ownership

The task-router hook and task-gate plugin can both suppress, reshape, or
deliver replies.

```text
task-router hook ----+
                     +---- overlapping message ownership
task-gate plugin ----+
```

This makes it difficult to prove:

- whether the general agent will run;
- whether a deterministic result reaches the channel unchanged;
- which component owns a WhatsApp reply;
- whether one task can produce duplicate or rewritten responses.

### 3.2 Channel-specific event shapes

Telegram and WhatsApp expose identifiers, media, quoted messages, mentions,
and reply behavior differently. Task modules currently need knowledge of
these differences.

### 3.3 Volatile workflow state

Pending receipt confirmations are process-local. A container restart can
invalidate pending work.

Future scheduled work, retries, and outbound delivery tracking also require a
durable operational-state boundary.

### 3.4 Reactive rather than proactive finance

Most capabilities run only after the user sends a message. The platform does
not yet continuously detect:

- budget thresholds;
- missing or mismatched transactions;
- recurring subscriptions;
- unusual spending;
- upcoming payment risk;
- incomplete finance records.

### 3.5 Model safety boundary

The general agent may understand natural requests, but it must not gain broad
write access to financial storage or arbitrary Markdown files. Natural
language understanding and financial mutation need a controlled boundary.

## 4) Goals

- Establish one message owner for each incoming event.
- Support deterministic tasks and natural conversation without collisions.
- Provide identical task semantics across Telegram and WhatsApp.
- Preserve human confirmation for sensitive financial writes.
- Keep calculations reproducible and testable without AI or credentials.
- Make temporary workflows survive process restarts.
- Add scheduled and proactive automation.
- Preserve Google Sheets as the current structured finance source of truth.
- Preserve Obsidian and Git as human-readable memory and audit storage.
- Make new finance modules easy to add without modifying channel code.
- Keep application and finance logic independent from OpenClaw, Nous Hermes,
  or any future agent runtime.
- Allow the active agent runtime to change without migrating finance data or
  rewriting application modules.

## 5) Non-Goals

- Moving money automatically.
- Paying credit-card or paylater bills automatically.
- Replacing Google Sheets in the first rollout.
- Giving the language model direct filesystem, Git, or spreadsheet access.
- Introducing microservices.
- Choosing a final operational-state backend in this RFC.
- Rewriting all existing modules at once.
- Allowing AI-generated totals to become financial records.

## 6) Design Principles

### 6.1 One owner per message

Every message must resolve to exactly one owner:

```text
deterministic task
natural-language tool workflow
general conversation
ignored
```

### 6.2 Model proposes; application validates

```text
User language
     |
     v
Model proposes structured intent
     |
     v
Schema validation
     |
     v
Deterministic application operation
```

### 6.3 Read-only before write

New finance capabilities should begin as read-only reports or previews.
Writes are introduced only after validation, confirmation, and audit behavior
are defined.

### 6.4 No silent partial success

If one enabled sink fails, the response and logs must identify which sink
failed. Retry behavior must not duplicate successful writes.

### 6.5 Financial calculations are deterministic

Models may classify intent or explain results. Totals, thresholds, matching,
due dates, and forecasts must come from deterministic code and validated
data.

## 7) Target Architecture

```text
                            USERS
                +---------------------------+
                | Telegram | WhatsApp | UI  |
                +-------------+-------------+
                              |
                              v
+-------------------------------------------------------------------+
|                       OPENCLAW GATEWAY                             |
|                                                                   |
| Authentication | Pairing | Allowlists | Mentions | Sessions       |
+-------------------------------+-----------------------------------+
                                |
                                v
+-------------------------------------------------------------------+
|                    CANONICAL MESSAGE ADAPTER                       |
|                                                                   |
| Telegram event ----+                                              |
|                    +--> CanonicalMessage                           |
| WhatsApp event ----+                                              |
+-------------------------------+-----------------------------------+
                                |
                                v
+-------------------------------------------------------------------+
|                     UNIFIED ORCHESTRATOR                           |
|                                                                   |
|  Channel Policy                                                   |
|       |                                                           |
|       v                                                           |
|  Intent Resolution                                                |
|       |                                                           |
|       +-- deterministic command                                   |
|       +-- controlled model/tool workflow                          |
|       +-- general agent                                           |
|       `-- ignore                                                  |
|                                                                   |
|  Command Dispatcher -> Module Handler -> Use Case                  |
|                                                                   |
|  Reply Dispatcher -> Telegram / WhatsApp outbound adapter          |
+-------------------------------+-----------------------------------+
                                |
                                v
+-------------------------------------------------------------------+
|                     APPLICATION MODULES                            |
|                                                                   |
| Receipt | Cicilan | Wishlist | Finance | Budget | Reconciliation  |
| Subscription | Goals | Finance Inbox | Forecasting                 |
+-------------------------------+-----------------------------------+
                                |
             +------------------+------------------+
             |                                     |
             v                                     v
+-------------------------------+   +-------------------------------+
|       OPERATIONAL STATE       |   |        FINANCE STORAGE        |
|                               |   |                               |
| confirmations                 |   | Google Sheets transactions    |
| scheduled jobs                |   | Google Sheets planning        |
| retries                       |   | Obsidian reports and rules    |
| idempotency keys              |   | Git audit history             |
| delivery status               |   | statement imports             |
+-------------------------------+   +-------------------------------+
```

## 8) Canonical Message Contract

All channel events should map into:

```ts
type CanonicalMessage = {
  platform: "telegram" | "whatsapp";
  chatId: string;
  senderId: string;
  messageId: string;
  text: string;
  quotedText?: string;
  quotedMessageId?: string;
  media: CanonicalMedia[];
  nativeMentioned: boolean;
  isGroup: boolean;
  receivedAt: string;
  rawEvent: unknown;
};
```

The raw event remains available only at the channel boundary. Application
modules should depend on canonical fields.

Quoted WhatsApp text must be captured here instead of reconstructed inside
the wishlist module.

## 9) Unified Orchestrator

### 9.1 Responsibility

The orchestrator owns:

- channel policy resolution;
- mention and allowlist enforcement;
- deterministic trigger detection;
- model/tool eligibility;
- handler selection;
- downstream-agent suppression;
- response delivery;
- correlation IDs and structured logs.

### 9.2 Ownership decision

```text
Incoming CanonicalMessage
          |
          v
Is sender/chat allowed?
    | no                 | yes
    v                    v
 ignore             Resolve policy
                           |
                           v
                 Deterministic trigger?
                    | yes       | no
                    v           v
               Run handler   Tool-eligible intent?
                               | yes       | no
                               v           v
                          Model + tool   General agent
                                           or ignore
```

### 9.3 Result contract

```ts
type OrchestrationResult = {
  owner: "task" | "tool" | "agent" | "ignored";
  handled: boolean;
  suppressAgent: boolean;
  replies: ControlledReply[];
  audit?: AuditEvent[];
};
```

No handler should directly decide channel-specific delivery.

## 10) Outbound Channel Port

Introduce one outbound interface:

```ts
interface ChannelReplyPort {
  sendText(reply: TextReply): Promise<DeliveryResult>;
  sendConfirmation(reply: ConfirmationReply): Promise<DeliveryResult>;
}
```

Implementations:

```text
ChannelReplyPort
|
+-- TelegramReplyAdapter
`-- WhatsAppReplyAdapter
```

This replaces implicit event-message mutation as the primary WhatsApp
delivery mechanism.

## 11) Module Contract

Each module should expose:

```ts
interface TaskModule {
  name: string;
  detect(message: CanonicalMessage): TaskIntent | null;
  execute(context: TaskContext, intent: TaskIntent): Promise<TaskResult>;
}
```

Suggested module boundaries:

```text
modules/
|
+-- receipt/
+-- cicilan/
+-- wishlist/
+-- finance-digest/
+-- budget/
+-- reconciliation/
+-- subscription/
+-- goals/
`-- finance-inbox/
```

Each module may contain:

```text
domain/
usecases/
ports/
adapters/
tests/
```

The first refactor should not physically move every current file. Interfaces
and ownership should stabilize before directory migration.

## 12) Controlled AI Tool Boundary

Natural language may call narrow tools:

```text
finance_query(...)
transaction_reclassify(...)
receipt_correct(...)
wishlist_update(...)
budget_update(...)
finance_inbox_resolve(...)
```

Example:

```text
User:
mark the Super Indo transaction from yesterday as groceries

Model proposal:
{
  "tool": "transaction_reclassify",
  "merchantQuery": "Super Indo",
  "dateQuery": "yesterday",
  "classification": "groceries"
}

Application:
1. Resolve the date.
2. Find matching transactions.
3. Reject zero or multiple matches.
4. Show a confirmation.
5. Apply the update deterministically.
6. Write an audit event.
7. Send a controlled result.
```

The model must not:

- edit Sheets directly;
- write arbitrary files;
- execute Git commands;
- invent transaction identifiers;
- calculate authoritative totals;
- bypass confirmation policy.

## 13) Durable Operational State

Introduce an interface before selecting a backend:

```ts
interface WorkflowStateRepository {
  saveConfirmation(state: PendingConfirmation): Promise<void>;
  getConfirmation(token: string): Promise<PendingConfirmation | null>;
  consumeConfirmation(token: string): Promise<boolean>;
  enqueueJob(job: ScheduledJob): Promise<void>;
  recordDelivery(result: DeliveryRecord): Promise<void>;
  claimIdempotencyKey(key: string): Promise<boolean>;
}
```

Required properties:

- survives gateway restart;
- supports expiry;
- supports atomic token consumption;
- supports idempotency;
- can be backed up;
- stores no raw credentials;
- remains separate from financial source-of-truth records.

Candidate backends should be evaluated in a later implementation decision.

## 14) Finance Automation Capabilities

### 14.1 Finance Control Tower

Extend the existing read-only digest:

```text
[finance-bot] Finance Control Tower

Available to spend this week: Rp1,350,000
Upcoming payments: Rp3,800,000
Food budget used: 78%
Receipts needing review: 2

Suggested action:
Reserve Rp2,100,000 for BCA before 3 August.
```

The underlying data and calculations remain deterministic. Suggestions must
identify their source values.

### 14.2 Budget guardrails

```text
Budget configuration
        |
        v
Current month spending
        |
        v
Threshold detector
   70% | 90% | 100%
        |
        v
Controlled notification
```

Budget rules may live in Obsidian Markdown while actual spending comes from
Google Sheets.

### 14.3 Payment calendar and reminders

Use RFC-005 planning data to schedule:

- upcoming due-date reminders;
- weekly card-fund reserve reminders;
- overdue-calendar warnings;
- installment obligations.

Payment status must not be inferred unless explicitly stored.

### 14.4 Automatic reconciliation

```text
Receipts ------------------+
                           |
Statement imports ---------+--> Matching Engine
                           |
Cicilan records -----------+
                           |
                           v
                +----------------------+
                | exact match          |
                | probable match       |
                | missing receipt      |
                | duplicate            |
                | amount mismatch      |
                | unknown payment      |
                +----------------------+
```

Probable matches go to the finance inbox for confirmation.

### 14.5 Subscription radar

Detect repeated merchant, amount, and interval patterns:

- likely subscription;
- price increase;
- duplicate charge;
- missing expected renewal;
- upcoming renewal.

Detection creates suggestions, not automatic classifications, until the user
confirms the rule.

### 14.6 Safe-to-spend calculator

```text
Expected income
    - upcoming bills
    - installments
    - required savings
    - expected essentials
    = safe-to-spend estimate
```

The result must show assumptions and data freshness. It is a planning estimate,
not a bank-balance guarantee.

### 14.7 Finance inbox

```text
FINANCE INBOX
|
+-- low-confidence receipt
+-- missing payment method
+-- possible duplicate
+-- unmatched statement row
+-- ambiguous correction
+-- suspected subscription
`-- failed enabled sink
```

Example commands:

```text
/finance inbox
/finance resolve 2 payment-method cc-bca
/finance dismiss 4
```

### 14.8 Personal finance memory

Store confirmed rules rather than unconstrained model memory:

```text
Merchant: Super Indo
default_category: groceries
usual_payment_method: cc-bca
average_transaction: calculated, not manually written
unusual_threshold: configurable
```

Rule changes should be auditable.

## 15) Scheduler

The scheduler invokes the same use cases as manual commands:

```text
Scheduler
|
+-- daily payment reminder
+-- weekly finance digest
+-- weekly finance inbox summary
+-- month-end report
`-- subscription renewal check
```

```text
Manual /finance ------+
                      +--> GetFinanceDigest use case
Monday schedule ------+
```

No separate calculation implementation should exist for scheduled delivery.

## 16) Storage Responsibilities

```text
Google Sheets
|
+-- structured financial transactions
+-- receipt and cicilan rows
+-- planning tables
`-- deterministic calculation outputs

Obsidian Vault
|
+-- budgets and goals
+-- confirmed personal rules
+-- human-readable reports
+-- decision records
`-- Git-backed audit notes

Operational State
|
+-- temporary confirmation state
+-- scheduled jobs
+-- retries
+-- delivery records
`-- idempotency keys
```

No storage layer should silently become authoritative for data owned by
another layer.

## 17) Reliability

### 17.1 Idempotency

Every write command should have an idempotency key based on:

```text
platform + chatId + messageId + operation
```

### 17.2 Retry policy

```text
Validation failure  -> do not retry
Permission failure  -> report configuration error
Rate limit          -> bounded exponential backoff
Network timeout     -> bounded retry
Duplicate           -> return existing result
Unknown failure     -> finance inbox / operator alert
```

### 17.3 Partial sink behavior

```text
Sheets saved + journal failed
|
+-- do not append Sheets again on retry
+-- retry only journal
`-- report exact sink states
```

## 18) Security And Privacy

- Keep channel allowlists and group mention requirements.
- Validate every model-produced tool argument.
- Limit tools by chat policy.
- Do not include credentials or raw receipt JSON in logs.
- Mount service-account credentials read-only.
- Scope vault Git commits to the touched file.
- Require explicit confirmation for financial corrections.
- Never expose arbitrary shell or filesystem tools to finance chat.
- Record who requested each mutation.

## 19) Observability

Every event should carry a correlation ID:

```text
channel event
  -> routing decision
  -> intent
  -> handler
  -> use case
  -> integrations
  -> outbound delivery
```

Suggested structured event names:

```text
orchestrator.message.received
orchestrator.owner.selected
task.started
task.completed
task.failed
tool.validation_failed
workflow.confirmation.created
workflow.confirmation.consumed
sink.write.completed
sink.write.failed
delivery.completed
delivery.failed
```

Metrics:

- messages by owner;
- task success rate;
- duplicate rate;
- confirmation expiry rate;
- model-classifier fallback rate;
- sink failure rate;
- outbound delivery failure rate;
- scheduled-job delay.

## 20) Testing Strategy

### 20.1 Pure unit tests

- canonical event mapping;
- policy resolution;
- trigger detection;
- budget threshold calculations;
- matching and reconciliation scoring;
- subscription-pattern detection;
- safe-to-spend calculations;
- response formatting.

### 20.2 Contract tests

- Telegram event to canonical message;
- WhatsApp event to canonical message;
- quoted-message extraction;
- model output to validated tool command;
- Google Sheets row parsing by header name;
- outbound adapter behavior.

### 20.3 Integration tests

- deterministic command does not call the general model;
- general conversation does not run a deterministic mutation;
- one incoming event produces one reply owner;
- confirmation survives orchestrator recreation;
- retry does not duplicate a successful sink;
- WhatsApp and Telegram run equivalent application commands.

### 20.4 Credential-free CI

Pure financial calculations and parsers must run:

- without `.env`;
- without Google credentials;
- without network access;
- without live model calls.

## 21) Rollout Plan

### Phase 1 - Normalize and observe

- Add `CanonicalMessage`.
- Add correlation IDs.
- Log ownership decisions.
- Keep existing behavior unchanged.

Exit criteria:

- Telegram and WhatsApp fixtures map correctly.
- Existing receipt, finance, and wishlist tests remain green.

### Phase 2 - Unified outbound replies

- Add `ChannelReplyPort`.
- Implement Telegram and WhatsApp adapters.
- Route deterministic task replies through the port.
- Preserve the existing task-gate behavior behind a compatibility switch.

Exit criteria:

- Exact deterministic responses reach both channels.
- One task produces one reply.
- General agent replies remain unaffected.

### Phase 3 - Unified orchestration

- Move policy, ownership, suppression, and dispatch into one orchestrator.
- Reduce task-gate to a compatibility adapter.
- Remove duplicate reply-shaping paths after production verification.

Exit criteria:

- One component owns each message.
- Existing chat policies remain backward compatible.

### Phase 4 - Durable workflow state

- Introduce `WorkflowStateRepository`.
- Persist confirmation state, expiry, and idempotency.
- Add delivery records and retry state.

Exit criteria:

- A gateway restart does not lose a valid pending confirmation.
- Replayed callbacks cannot duplicate saves.

### Phase 5 - Proactive read-only finance

- Add scheduler abstraction.
- Schedule RFC-006 digest.
- Add payment reminders and finance inbox summaries.
- Add budget monitoring in preview mode.

Exit criteria:

- Scheduled and manual paths use the same use cases.
- No financial source is mutated.

### Phase 6 - Controlled finance tools

- Add natural-language query tools.
- Add preview-only corrections.
- Add confirmed transaction corrections with audit history.

Exit criteria:

- Models cannot bypass schemas or confirmation.
- Every mutation is attributable and reversible.

### Phase 7 - Finance intelligence

- Statement import.
- Reconciliation.
- Subscription radar.
- Anomaly detection.
- Safe-to-spend forecasting.

Each capability requires a focused follow-up RFC before write behavior is
enabled.

## 22) Backward Compatibility

During migration:

- current commands retain their existing syntax;
- current chat IDs and policy configuration remain valid;
- `/finance` remains deterministic and read-only;
- existing receipt schemas remain unchanged;
- Sheets tabs and formulas remain unchanged unless separately approved;
- old routing can be restored through a compatibility switch;
- no vault file is migrated automatically.

## 23) Risks

### Risk: orchestrator becomes a large central class

Mitigation: keep policy, detection, dispatch, and delivery behind separate
interfaces even when composed by one orchestrator.

### Risk: model calls the wrong mutation tool

Mitigation: schema validation, match disambiguation, previews, confirmation,
and audit events.

### Risk: scheduled notifications become noisy

Mitigation: configurable frequency, deduplication, quiet hours, and digest
aggregation.

### Risk: conflicting sources of truth

Mitigation: explicitly assign ownership to Sheets, vault, and operational
state as defined in section 16.

### Risk: migration breaks working receipt intake

Mitigation: phased rollout, compatibility mode, fixture-based channel tests,
and no big-bang directory rewrite.

### Risk: safe-to-spend creates false confidence

Mitigation: label it as an estimate, display assumptions and data freshness,
and never present it as a confirmed bank balance.

## 24) Acceptance Criteria

Architecture foundation:

- One orchestrator selects exactly one owner for every message.
- Telegram and WhatsApp use the canonical message contract.
- Deterministic replies use explicit outbound adapters.
- Existing receipt, cicilan, wishlist, health, calory, and finance modules
  remain backward compatible.
- The general model is not invoked for deterministic financial commands.
- Controlled model tools cannot access arbitrary files or Sheets ranges.

Reliability:

- Confirmation state can survive gateway restarts.
- Duplicate callbacks cannot duplicate writes.
- Partial sink failure is reported and retryable by sink.
- Every mutation has an audit trail.

Finance automation:

- Scheduled and manual runs share the same use case.
- Budget and reminder automation begins read-only.
- Finance calculations pass credential-free, network-blocked tests.
- No automatic money movement exists.

## 25) Runtime-Agnostic Agent Host Architecture

### 25.1 Decision

OpenClaw must become one replaceable agent runtime adapter rather than the
owner of application business logic.

Nous Hermes may be added as a second runtime. Future runtimes should be able
to implement the same contracts.

```text
OpenClaw is a host.
Hermes is a host.
Neither host owns finance business logic.

The automation core owns:
- financial rules;
- controlled tools;
- workflows;
- storage contracts;
- confirmation policy;
- audit behavior.
```

The initial runtime selection should be explicit:

```env
AGENT_RUNTIME=openclaw
```

Supported future values:

```text
openclaw
hermes
direct
```

Only one runtime may own a given production Telegram bot or WhatsApp account
at a time.

### 25.2 Runtime-agnostic architecture

```text
                              USERS
                +--------------------------------+
                | Telegram | WhatsApp | Web | CLI|
                +----------------+---------------+
                                 |
                                 v
+--------------------------------------------------------------------+
|                    ACTIVE AGENT RUNTIME                             |
|                                                                    |
|       AGENT_RUNTIME=openclaw | hermes | direct                     |
|                                                                    |
|   +-------------------+        +-------------------+                |
|   | OpenClaw Gateway  |        | Nous Hermes      |                |
|   |                   |        | Gateway           |                |
|   | Messaging         |        | Messaging         |                |
|   | Sessions          |        | Sessions          |                |
|   | Agent loop        |        | Agent loop        |                |
|   +---------+---------+        +---------+---------+                |
|             |                            |                          |
|             +-------------+--------------+                          |
|                           |                                         |
|                           v                                         |
|                  Agent Runtime Adapter                              |
+---------------------------+----------------------------------------+
                            |
                            v
+--------------------------------------------------------------------+
|                    CANONICAL MESSAGE PORT                           |
|                                                                    |
| Runtime-specific event -> CanonicalMessage                         |
|                                                                    |
| platform | chatId | senderId | messageId | text | quote | media    |
| mention  | sessionId | timestamp | runtime                         |
+---------------------------+----------------------------------------+
                            |
                            v
+--------------------------------------------------------------------+
|                     AUTOMATION CORE                                 |
|                                                                    |
|                  Runtime-independent code                          |
|                                                                    |
|  +----------------------+       +-------------------------------+   |
|  | Access Policy        |       | Intent Resolver               |   |
|  |                      |       |                               |   |
|  | User/chat allowed?   |       | Rules first                   |   |
|  | Mention required?    |       | Agent fallback                |   |
|  | Tool permitted?      |       | Confidence handling           |   |
|  +----------+-----------+       +---------------+---------------+   |
|             |                                   |                   |
|             +------------------+----------------+                   |
|                                v                                    |
|                       Command Dispatcher                            |
+--------------------------------+-----------------------------------+
                                 |
          +----------------------+----------------------+
          |                      |                      |
          v                      v                      v
+-------------------+  +-------------------+  +----------------------+
| Deterministic     |  | Controlled Agent  |  | General Conversation |
| Tasks             |  | Workflow          |  |                      |
|                   |  |                   |  | Uses selected runtime|
| Receipt parsing   |  | Understand intent |  | personality/session  |
| Finance digest    |  | Select tool       |  |                      |
| Confirmation      |  | Validate arguments|  | OpenClaw or Hermes   |
+---------+---------+  +---------+---------+  +----------+-----------+
          |                      |                       |
          +----------------------+-----------------------+
                                 |
                                 v
+--------------------------------------------------------------------+
|                      APPLICATION MODULES                           |
|                                                                    |
| Receipt | Cicilan | Wishlist | Budget | Goals | Reconciliation     |
| Digest  | Calendar | Subscription | Anomaly | Inbox | Forecasting   |
+--------------------------------+-----------------------------------+
                                 |
                                 v
+--------------------------------------------------------------------+
|                         TOOL CONTRACTS                              |
|                                                                    |
| finance_query             receipt_correct                          |
| wishlist_update           transaction_reclassify                   |
| budget_update             reconciliation_confirm                   |
| finance_inbox_resolve     payment_calendar_query                    |
+----------------------------+---------------------------------------+
                             |
                             v
+--------------------------------------------------------------------+
|                         STORAGE PORTS                               |
|                                                                    |
| FinanceRepository     MemoryRepository      WorkflowStateRepository |
|        |                     |                        |              |
|        v                     v                        v              |
| Google Sheets          Obsidian Vault        Durable state backend  |
| Statement imports      Git audit             Jobs / confirmations  |
+--------------------------------------------------------------------+
```

### 25.3 Agent runtime port

The automation core should depend on one interface:

```ts
interface AgentRuntimePort {
  run(request: AgentRequest): Promise<AgentResult>;
  send(reply: ControlledReply): Promise<DeliveryResult>;
  capabilities(): RuntimeCapabilities;
  healthCheck(): Promise<RuntimeHealth>;
}
```

Implementations:

```text
AgentRuntimePort
|
+-- OpenClawRuntimeAdapter
+-- HermesRuntimeAdapter
+-- DirectModelRuntimeAdapter
`-- FutureRuntimeAdapter
```

Application modules must not import OpenClaw or Hermes APIs directly:

```text
AVOID

Finance module
    |
    v
OpenClaw plugin API


TARGET

Finance module
    |
    v
AgentRuntimePort
    |
    +-- OpenClaw adapter
    `-- Hermes adapter
```

### 25.4 Shared tools through MCP

Controlled application tools should be exposed through one MCP server:

```text
                       Finance MCP Server
                              |
       +----------------------+----------------------+
       |                      |                      |
       v                      v                      v
finance_query()        wishlist_update()      receipt_correct()
budget_update()        finance_inbox()        reconcile()
```

Both runtimes connect to the same tool implementation:

```text
OpenClaw --------+
                 |
                 +---- MCP ----> Finance Automation Core
                 |
Nous Hermes -----+
```

This provides:

- one tool implementation;
- one argument-validation layer;
- one permission policy;
- one audit system;
- identical finance behavior across agent runtimes;
- deterministic testing without starting either runtime.

Hermes currently supports local and remote MCP servers with automatic tool
discovery and per-server tool filtering. OpenClaw integration may use MCP or
a thin adapter around the same application tool contracts.

### 25.5 Runtime capability negotiation

Runtime features will not always be identical. Each adapter should report:

```ts
type RuntimeCapabilities = {
  telegram: boolean;
  whatsapp: boolean;
  nativeButtons: boolean;
  quotedMessages: boolean;
  streaming: boolean;
  mcp: boolean;
  scheduledJobs: boolean;
  sessionMemory: boolean;
};
```

Application behavior can then degrade safely:

```text
Need confirmation buttons
          |
          v
Runtime supports buttons?
     | yes             | no
     v                 v
Native buttons     Text confirmation fallback
```

Feature code should not accumulate runtime checks:

```text
if OpenClaw ...
if Hermes ...
if Telegram ...
if WhatsApp ...
```

Those differences belong in runtime and channel adapters.

### 25.6 Deterministic and agent execution paths

Deterministic financial operations should not require an agent runtime:

```text
/finance
    |
    v
Canonical message
    |
    v
Deterministic trigger
    |
    v
Finance use case
    |
    v
Controlled reply
```

Natural requests use the selected runtime:

```text
"mark yesterday's Super Indo as groceries"
                    |
                    v
          OpenClaw or Hermes agent
                    |
                    v
     transaction_reclassify proposal
                    |
                    v
       schema and permission validation
                    |
                    v
             confirmation
                    |
                    v
       deterministic application write
```

The runtime interprets language. The automation core decides whether an
operation is valid and performs the operation.

### 25.7 Runtime selection

Startup resolution:

```text
Read AGENT_RUNTIME
        |
        +-- openclaw
        |      |
        |      `--> OpenClawRuntimeAdapter
        |
        +-- hermes
        |      |
        |      `--> HermesRuntimeAdapter
        |
        `-- direct
               |
               `--> DirectModelRuntimeAdapter
```

Changing the runtime must not change:

```text
CanonicalMessage
Channel policies
Intent definitions
Finance tools
Receipt rules
Wishlist rules
Google Sheets integrations
Obsidian storage
Git commits
Workflow state
Audit logs
Deterministic tests
```

Runtime-specific responsibilities are limited to:

```text
Messaging gateway
Agent session implementation
Model and tool loop
Runtime-specific delivery
Runtime health checks
Capability reporting
```

### 25.8 Deployment topology

```text
                            VPS
+-----------------------------------------------------------+
|                                                           |
|  +------------------+     +----------------------------+   |
|  | Automation Core  |     | Finance MCP Server         |   |
|  | always running   |<--->| controlled tools           |   |
|  +------------------+     +----------------------------+   |
|            ^                                              |
|            |                                              |
|  +---------+------------------------------------------+   |
|  | Active Runtime                                     |   |
|  |                                                    |   |
|  | OpenClaw container OR Hermes container             |   |
|  | Never both connected to the same account           |   |
|  +----------------------------------------------------+   |
|                                                           |
|  Google Sheets | Obsidian | Git | Workflow State          |
+-----------------------------------------------------------+
```

For migration testing:

```text
Production Telegram bot ------> OpenClaw
Testing Telegram bot ---------> Hermes
```

Production switching:

```text
Stop current gateway
       |
       v
Change AGENT_RUNTIME
       |
       v
Start selected gateway
       |
       v
Run health, tool, and delivery tests
       |
       v
Enable production traffic
```

### 25.9 Suggested repository shape

The first implementation may remain in one repository:

```text
chief-of-staff/
|
+-- openclaw-platform/
|   |
|   +-- src/
|   |   |
|   |   +-- core/
|   |   |   +-- orchestrator/
|   |   |   +-- canonical-message/
|   |   |   +-- policies/
|   |   |   `-- ports/
|   |   |
|   |   +-- modules/
|   |   +-- runtime-adapters/
|   |   |   +-- openclaw/
|   |   |   +-- hermes/
|   |   |   `-- direct-model/
|   |   |
|   |   +-- channel-adapters/
|   |   +-- integrations/
|   |   `-- mcp/
|   |
|   +-- deployment/
|   |   +-- openclaw/
|   |   `-- hermes/
|   |
|   `-- docker-compose.yml
|
`-- openclaw-obsidian-vault/
```

Separate services or repositories should be introduced only when deployment
or ownership boundaries require them.

### 25.10 Runtime migration phases

```text
PHASE A
CanonicalMessage
      |
      `-- normalize current OpenClaw events

PHASE B
Define ports
      |
      +-- AgentRuntimePort
      +-- ChannelReplyPort
      `-- WorkflowStateRepository

PHASE C
Extract controlled tools
      |
      `-- runtime-independent application functions

PHASE D
Expose tools through MCP
      |
      +-- connect OpenClaw adapter
      `-- test Hermes adapter

PHASE E
Add Hermes runtime
      |
      `-- separate test messaging account

PHASE F
Runtime switching
      |
      `-- AGENT_RUNTIME=openclaw|hermes|direct

PHASE G
Remove remaining runtime imports
from application modules
```

### 25.11 Runtime acceptance criteria

- Application modules compile without importing OpenClaw or Hermes packages.
- The same controlled tool contract works through OpenClaw and Hermes.
- Deterministic tasks work when no general agent runtime is available.
- A runtime capability mismatch produces a defined fallback.
- Only one runtime can claim a production messaging account.
- Runtime switching does not modify Sheets, vault data, or workflow records.
- OpenClaw and Hermes pass the same canonical-message and tool-contract tests.
- Runtime-specific credentials remain isolated from the automation core.

### 25.12 References

- Nous Research Hermes Agent:
  `https://github.com/NousResearch/hermes-agent`
- Hermes MCP documentation:
  `https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/mcp.md`
- Hermes programmatic integration:
  `https://github.com/NousResearch/hermes-agent/blob/main/website/docs/developer-guide/programmatic-integration.md`

## 26) Follow-Up RFC Candidates

```text
RFC-008  Runtime-Agnostic Agent Host And MCP Boundary
RFC-009  Durable Workflow State
RFC-010  Budget Guardrails
RFC-011  Finance Inbox And Corrections
RFC-012  Statement Import And Reconciliation
RFC-013  Subscription Radar
RFC-014  Safe-To-Spend Forecast
```

## 27) Final Architecture Summary

```text
Runtime adapter receives channel traffic
        |
Canonical adapter removes runtime differences
        |
Channel policy decides access
        |
Orchestrator selects one owner
        |
Intent selects a controlled module
        |
Use case coordinates the workflow
        |
Domain rules protect correctness
        |
Adapters access external systems
        |
Outbound port delivers one response
        |
Audit and operational state preserve history
```
