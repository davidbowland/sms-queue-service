# Inbound SMS Receiving & Routing — Design

Date: 2026-07-11
Repo: `sms-queue-service`
Companion spec: `sms-queue-api` — `docs/superpowers/specs/2026-07-11-sms-registration-api-design.md`

## Problem

`sms-queue-service` currently only sends outbound SMS (SQS → Pinpoint). Several personal projects ("consumers") need to _receive_ SMS replies/messages sent to the existing Pinpoint number, and each consumer must only see the messages meant for it — never another consumer's traffic, whether by accident or by a user guessing another consumer's keyword.

## Non-goals

- No UI/CLI for managing registrations (API only — see companion spec).
- No rate limiting/abuse protection beyond existing API-key gating on the registration API.
- No multi-number support (single existing Pinpoint number/app, reused for two-way SMS).
- No auto-expiring registrations (TTL). A registration lives until explicitly overwritten or deleted via the registration API.
- No special-casing of `STOP`/opt-out content. Pinpoint manages carrier-level opt-out for _sending_ independently of this pipeline; an opted-out number's inbound `STOP` text still flows through this pipeline like any other message.

## Architecture

```
Carrier ──▶ Pinpoint (two-way SMS, existing number/app)
              │
              ▼
      "sms-inbound-raw" SNS topic
              │  (SNS-triggered Lambda)
              ▼
      Router Lambda
      - first whitespace-delimited word of message body = candidate keyword
      - Query registrations table by phoneNumber (see Data Model)
      - match candidate keyword ▸ else DEFAULT row ▸ else drop (log + no publish)
              │
              ▼
      "sms-inbound-routed" SNS topic
      - MessageAttributes: { consumerId: <matched consumer> }
      - consumer projects subscribe with a FilterPolicy on consumerId, in their own stacks
```

Two SNS topics are required because Pinpoint's raw inbound payload carries no knowledge of consumers — the Router Lambda must resolve `consumerId` via the registrations table before fan-out, since SNS filter policies only match on message attributes.

Note: Pinpoint has its own unrelated "keyword" concept (tied to short codes). This design's keyword matching is independent, purely content-based (first word of the SMS body), and Pinpoint's own keyword field is ignored.

## Data Model

New DynamoDB table, explicit `TableName` (e.g. `sms-queue-service-registrations`, environment-suffixed like other resources) so `sms-queue-api` can reference it deterministically without a manual copy-paste of a generated name.

| Attribute          | Type   | Notes                                                                      |
| ------------------ | ------ | -------------------------------------------------------------------------- |
| `phoneNumber` (PK) | String | E.164, e.g. `+15551234567`                                                 |
| `ruleKey` (SK)     | String | `DEFAULT` or `KEYWORD#<UPPERCASED_KEYWORD>`                                |
| `consumerId`       | String | Free-form identifier chosen by the registering consumer, e.g. `garage-app` |

- A phone number may have at most one `DEFAULT` row and any number of distinct `KEYWORD#...` rows.
- Registrations are unconditional overwrites (`PutItem`, no `ConditionExpression`) — re-registering `DEFAULT` or the same `KEYWORD#...` for a number replaces the existing row. This table is written to only by `sms-queue-api`'s registration endpoints (see companion spec); this repo only reads it.
- Router issues one `Query` on `phoneNumber` per inbound message (returns all rows for that number — small, bounded set for personal-scale usage).

## Router Lambda

Trigger: SNS subscription to `sms-inbound-raw`.

1. Parse Pinpoint's two-way SMS SNS payload for `originationNumber`, `destinationNumber`, `messageBody`.
2. `candidateKeyword` = first whitespace-delimited token of `messageBody`, uppercased.
3. `Query` registrations table where `phoneNumber = originationNumber`.
4. Resolve match:
   - Row with `ruleKey = KEYWORD#<candidateKeyword>` exists → `consumerId` = that row's value; forwarded body = `messageBody` with the matched token and following whitespace stripped, then trimmed.
   - Else row with `ruleKey = DEFAULT` exists → `consumerId` = that row's value; forwarded body = `messageBody` unchanged.
   - Else → structured log (`info`/`warn`, includes number + candidate keyword, no PII beyond the phone number itself) and drop. No publish. Not treated as an error.
5. On a match, publish to `sms-inbound-routed`:
   - `MessageAttributes`: `{ consumerId: { DataType: 'String', StringValue: <consumerId> } }`
   - `MessageBody` (JSON): `{ phoneNumber, destinationNumber, body, matchType: "KEYWORD" | "DEFAULT", keyword?: <candidateKeyword, only if matchType is KEYWORD>, inboundMessageId, receivedAt }`

## Error Handling

- No registration found (step 4's else branch): expected traffic, not an error. Log and drop.
- Malformed Pinpoint payload or DynamoDB/SNS API failures: throw, so SNS's built-in Lambda retry applies. Configure an `OnFailure` destination (small SQS DLQ) on the `sms-inbound-raw` subscription so exhausted retries are inspectable rather than silently lost.
- Registration writes are out of this repo's scope (handled and validated entirely in `sms-queue-api`); this repo trusts table contents as already validated.

## New/Changed Infrastructure (`template.yaml`)

- The existing `PinpointSms` (`AWS::Pinpoint::SMSChannel`) resource is unchanged — that resource type has no two-way-SMS properties. Two-way SMS is instead a property of the phone number itself under the separate "AWS End User Messaging SMS" service (`UpdatePhoneNumber` API: `TwoWayEnabled`/`TwoWayChannelArn`). Since the phone number isn't a CloudFormation-managed resource in this template (it arrives as a plain string `Parameter`, provisioned manually), a small custom resource (`TwoWaySmsFunction`/`TwoWaySmsCustomResource`) calls that API imperatively at deploy time to enable it, pointed at the new raw inbound SNS topic. On stack deletion it disables two-way SMS on that number.
- New `SmsInboundRawTopic` (SNS topic) with a resource policy allowing the `sms-voice.amazonaws.com` service principal (AWS End User Messaging SMS) to publish, matching the account's existing "Use SNS topic policies" two-way channel role configuration.
- New `SmsInboundRoutedTopic` (SNS topic).
- New `RegistrationsTable` (DynamoDB, explicit `TableName`, PK `phoneNumber`, SK `ruleKey`).
- New `RouterFunction` (Lambda): SNS event source on `SmsInboundRawTopic`; read access (`Query`) scoped to `RegistrationsTable` ARN only; publish access scoped to `SmsInboundRoutedTopic` ARN only; `OnFailure` destination DLQ.
- `LambdaLogGroup`-style log group for `RouterFunction`, following the existing pattern (30-day retention, same tags).

## Testing

- Follow existing Jest conventions in this repo (`clearMocks: true`, no `beforeEach`, injectable non-determinism per `CLAUDE.md`).
- Unit test the Router Lambda's matching logic (keyword match / default match / no match) and payload construction, with mocked DynamoDB and SNS clients — no live AWS calls.
- Add a sample two-way-SMS SNS event to `events/` (mirroring the existing `events/event-sqs.json`) for local/manual invocation of the router.
- Existing coverage thresholds in `jest.config.ts` apply; no changes needed there.

## Security

Per `CLAUDE.md`: IAM policies scoped to specific resource ARNs (table, topics) — no `Resource: "*"`. No external/user-facing input validation needed in this repo since it only reads already-validated registration data and Pinpoint-originated payloads (not directly user-supplied to an API this repo owns).
