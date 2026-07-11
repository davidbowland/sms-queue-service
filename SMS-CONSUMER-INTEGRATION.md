# Integrating Your Project with Inbound/Outbound SMS

This is a hand-off doc for an AI agent implementing SMS support in one of David's other personal projects (a "consumer" of this SMS infrastructure). It assumes the reader has no context on `sms-queue-service` or `sms-queue-api` beyond what's written here.

Full design detail lives in:

- `sms-queue-service`: `docs/superpowers/specs/2026-07-11-inbound-sms-routing-design.md`
- `sms-queue-api`: `docs/superpowers/specs/2026-07-11-sms-registration-api-design.md`

Read those if you need the "why." This doc is the "how do I hook my project up."

## The model

- One shared phone number is used for both sending and receiving SMS across all of David's projects.
- Your project is a **consumer**, identified by a `consumerId` you choose (a short, stable, kebab-case string, e.g. `garage-app`). Pick one and use it consistently everywhere below.
- Inbound SMS is only ever delivered to your project for phone numbers you've explicitly **registered**. Nothing is delivered to you by default — if a number hasn't been registered to your `consumerId`, you'll never see its messages.
- A phone number can be registered to your project two ways:
  - **`default`** — every message from this number that doesn't match anyone else's registered keyword comes to you.
  - **`keyword`** — messages from this number that start with a specific word (e.g. `GARAGE open the gate`) come to you, with that word stripped from the body before you receive it.
- The same phone number can be registered to _different_ consumers for different keywords, and to at most one consumer as its default. Registering the same `(phoneNumber, type[, keyword])` again overwrites the previous registration — this is intentional, not an error condition you need to guard against.

## Step 1: Register the phone numbers you care about

Call `sms-queue-api` — see its README for the base URL and how to obtain an API key (same key/auth mechanism used for sending outbound messages).

**Register a number as your default:**

```
POST /v1/registrations
{
  "phoneNumber": "+15551234567",
  "consumerId": "garage-app",
  "type": "default"
}
```

**Register a number against a keyword:**

```
POST /v1/registrations
{
  "phoneNumber": "+15551234567",
  "consumerId": "garage-app",
  "type": "keyword",
  "keyword": "GARAGE"
}
```

`phoneNumber` must be E.164 (`+1...`). `keyword` must be a single word (no spaces) — do this whenever a user provides a phone number to your project (e.g. during their signup/setup flow). There's no bulk/backfill endpoint; register each number as you learn about it.

**Remove a registration** (e.g. a user disconnects from your project):

```
DELETE /v1/registrations
{
  "phoneNumber": "+15551234567",
  "type": "default"
}
```

(or `type: "keyword", keyword: "GARAGE"` to remove a specific keyword rule). This is idempotent — deleting something that isn't there is not an error.

There is no "list my registrations" endpoint currently. Track what you've registered on your own side if you need to look it up later.

## Step 2: Subscribe to inbound messages

`sms-queue-service` publishes matched inbound messages to an SNS topic named `sms-inbound-routed`. In your own project's SAM/CloudFormation template, add a subscription with a **filter policy** on the `consumerId` message attribute so you only receive messages addressed to you:

```yaml
InboundSmsSubscription:
  Type: AWS::SNS::Subscription
  Properties:
    TopicArn: <sms-inbound-routed topic ARN — ask David for the current value, or find it in sms-queue-service's stack outputs>
    Protocol: sqs # or lambda, your choice
    Endpoint: !GetAtt YourQueue.Arn
    FilterPolicy:
      consumerId:
        - 'garage-app' # your consumerId
    FilterPolicyScope: MessageAttributes
```

The topic ARN isn't fixed/known ahead of time — get the current value from David or from `sms-queue-service`'s deployed stack outputs before wiring this up.

**Message payload you'll receive** (JSON, as the SNS message body):

```json
{
  "phoneNumber": "+15551234567",
  "destinationNumber": "+18005551234",
  "body": "open the gate",
  "matchType": "KEYWORD",
  "keyword": "GARAGE",
  "inboundMessageId": "...",
  "receivedAt": "2026-07-11T12:00:00.000Z"
}
```

- `body` has the matched keyword already stripped (for `matchType: "KEYWORD"`) — you don't need to re-parse it out.
- `keyword` is only present when `matchType` is `"KEYWORD"`.
- `phoneNumber` is who sent the message — use this to look up which of your users it belongs to.

## Step 3: Sending replies

Use `sms-queue-api`'s existing `POST /v1/messages` endpoint (unrelated to registration — it's the pre-existing outbound path). See that repo's README for the current request shape. Nothing about this SMS-receiving work changes how you send.

## Conventions to follow

This constellation of projects shares some house rules (from `CLAUDE.md` in `sms-queue-service`/`sms-queue-api`) — worth matching if your project is in the same style:

- Functional style: dependency injection, avoid mutating objects/values.
- Validate all external input (the registration payloads you send, the inbound messages you receive) at your boundaries.
- If you use Jest: `clearMocks: true`, no `beforeEach` (use an explicit `setup()` helper if needed), inject `Date.now`/`Math.random`/`crypto.randomUUID` as parameters rather than calling them live in code paths under test.

## Things that are explicitly NOT your problem

- Opt-out (`STOP`) handling at the carrier level — Pinpoint handles this for sending.
- Any other consumer's traffic — the filter policy guarantees you only see messages for your `consumerId`.
- Retrying failed inbound delivery — that's handled between Pinpoint and the router in `sms-queue-service`.
