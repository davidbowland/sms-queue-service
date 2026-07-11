# Inbound SMS Receiving & Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add inbound SMS receiving to `sms-queue-service` — a Router Lambda that reads phone-number registration rules from DynamoDB and fans matched messages out to the correct consumer project via a filtered SNS topic.

**Architecture:** Pinpoint two-way SMS publishes raw inbound messages to a new `sms-inbound-raw` SNS topic. A new Router Lambda (SNS-triggered) looks up the sender's phone number in a new DynamoDB registrations table, matches it against a registered keyword (first word of the message) or a registered default, and republishes matched messages to a new `sms-inbound-routed` SNS topic with a `consumerId` message attribute that downstream consumers filter on. Unmatched messages are logged and dropped; genuine failures throw so SNS's built-in retry (backed by a DLQ) applies.

**Tech Stack:** TypeScript, AWS Lambda (Node 24), AWS SAM/CloudFormation, `@aws-sdk/client-dynamodb` + `@aws-sdk/lib-dynamodb`, `@aws-sdk/client-sns`, `@aws-sdk/client-pinpoint-sms-voice-v2` (two-way SMS enablement custom resource), Jest.

Full design: `docs/superpowers/specs/2026-07-11-inbound-sms-routing-design.md`

## Global Constraints

- Functional style: dependency injection, no mutation of objects/values (from `CLAUDE.md`).
- Jest: `clearMocks: true` is automatic — never call `jest.clearAllMocks()`. Never use `beforeEach`; set shared defaults in `beforeAll`, override per-test with `mockReturnValueOnce`/`mockResolvedValueOnce`/`mockRejectedValueOnce`.
- Any function producing a value from `Date.now()`/`Math.random()`/`crypto.randomUUID()` that affects test outcomes must accept it as an injectable parameter with a default (from `CLAUDE.md`).
- No `if` statements in test bodies, no live `Date.now()`/`Math.random()` in test bodies, no wall-clock-dependent date arithmetic.
- Prettier/ESLint: single quotes, no semicolons, 2-space indent, object literal keys sorted alphabetically (`sort-keys` rule) — run `npm run lint` before every commit.
- IAM policies scoped to specific resource ARNs — never `Resource: '*'` (from `CLAUDE.md`).
- Test files import via path aliases (`@handlers/*`, `@services/*`, `@utils/*`, `@types`, `@events/*`); source files use relative imports (existing repo convention — see `src/handlers/sqs-payload-processor.ts`).
- Existing coverage thresholds in `jest.config.ts` (branches 90, functions 90, lines 80) apply to all new code.

---

## Task 1: Keyword matching & routed-message logic (pure functions)

**Files:**

- Modify: `src/types.ts`
- Create: `src/utils/message-routing.ts`
- Test: `__tests__/unit/utils/message-routing.test.ts`
- Modify: `__tests__/unit/__mocks__.ts`

**Interfaces:**

- Produces: `extractCandidateKeyword(messageBody: string): string | undefined`, `matchRegistration(registrations: Registration[], messageBody: string): MatchResult | undefined`, `buildRoutedMessage(message: PinpointInboundSmsMessage, match: MatchResult, now?: () => string): RoutedSmsMessage` — all consumed by Task 4's handler.
- Produces types: `Registration`, `PinpointInboundSmsMessage`, `MatchType`, `MatchResult`, `RoutedSmsMessage` — consumed by Tasks 2, 3, 4.

- [ ] **Step 1: Add new types to `src/types.ts`**

Append to the end of `src/types.ts` (existing content unchanged):

```ts
export interface Registration {
  phoneNumber: string
  ruleKey: string
  consumerId: string
}

export interface PinpointInboundSmsMessage {
  originationNumber: string
  destinationNumber: string
  messageBody: string
  messageKeyword?: string
  inboundMessageId: string
  previousPublishedMessageId?: string
}

export type MatchType = 'KEYWORD' | 'DEFAULT'

export interface MatchResult {
  matchType: MatchType
  consumerId: string
  keyword?: string
  body: string
}

export interface RoutedSmsMessage {
  phoneNumber: string
  destinationNumber: string
  body: string
  matchType: MatchType
  keyword?: string
  inboundMessageId: string
  receivedAt: string
}
```

- [ ] **Step 2: Add fixtures to `__tests__/unit/__mocks__.ts`**

Append to the end of the existing file (add `Registration`, `PinpointInboundSmsMessage`, and `RoutedSmsMessage` to the existing `import { SMSMessage, SQSRecord } from '@types'` line, making it `import { PinpointInboundSmsMessage, Registration, RoutedSmsMessage, SMSMessage, SQSRecord } from '@types'`):

```ts
export const defaultRegistration: Registration = {
  consumerId: 'garage-app',
  phoneNumber: '+15551234567',
  ruleKey: 'DEFAULT',
}

export const keywordRegistration: Registration = {
  consumerId: 'garage-app',
  phoneNumber: '+15551234567',
  ruleKey: 'KEYWORD#GARAGE',
}

export const registration = defaultRegistration

export const pinpointInboundMessage: PinpointInboundSmsMessage = {
  destinationNumber: '+18449163034',
  inboundMessageId: 'aaaa-bbbb-cccc-dddd',
  messageBody: 'GARAGE open the gate',
  originationNumber: '+15551234567',
}

export const routedSmsMessage: RoutedSmsMessage = {
  body: 'open the gate',
  destinationNumber: '+18449163034',
  inboundMessageId: 'aaaa-bbbb-cccc-dddd',
  keyword: 'GARAGE',
  matchType: 'KEYWORD',
  phoneNumber: '+15551234567',
  receivedAt: '2026-07-11T12:00:00.000Z',
}
```

- [ ] **Step 3: Write the failing test**

Create `__tests__/unit/utils/message-routing.test.ts`:

```ts
import { defaultRegistration, keywordRegistration, pinpointInboundMessage } from '../__mocks__'
import { buildRoutedMessage, extractCandidateKeyword, matchRegistration } from '@utils/message-routing'

describe('message-routing', () => {
  describe('extractCandidateKeyword', () => {
    it('should return the first word uppercased', () => {
      const result = extractCandidateKeyword('garage open the gate')

      expect(result).toEqual('GARAGE')
    })

    it('should uppercase a mixed-case keyword', () => {
      const result = extractCandidateKeyword('GaRaGe open the gate')

      expect(result).toEqual('GARAGE')
    })

    it('should return undefined for an empty message', () => {
      const result = extractCandidateKeyword('   ')

      expect(result).toBeUndefined()
    })
  })

  describe('matchRegistration', () => {
    it('should match a registered keyword and strip it from the body', () => {
      const result = matchRegistration([keywordRegistration], 'GARAGE open the gate')

      expect(result).toEqual({
        body: 'open the gate',
        consumerId: 'garage-app',
        keyword: 'GARAGE',
        matchType: 'KEYWORD',
      })
    })

    it('should match a keyword regardless of message casing', () => {
      const result = matchRegistration([keywordRegistration], 'garage open the gate')

      expect(result).toEqual({
        body: 'open the gate',
        consumerId: 'garage-app',
        keyword: 'GARAGE',
        matchType: 'KEYWORD',
      })
    })

    it('should fall back to the default registration when no keyword matches', () => {
      const result = matchRegistration([defaultRegistration], 'hello there')

      expect(result).toEqual({
        body: 'hello there',
        consumerId: 'garage-app',
        matchType: 'DEFAULT',
      })
    })

    it('should prefer a keyword match over a default registration', () => {
      const result = matchRegistration([defaultRegistration, keywordRegistration], 'GARAGE open the gate')

      expect(result).toEqual({
        body: 'open the gate',
        consumerId: 'garage-app',
        keyword: 'GARAGE',
        matchType: 'KEYWORD',
      })
    })

    it('should return undefined when nothing matches', () => {
      const result = matchRegistration([], 'hello there')

      expect(result).toBeUndefined()
    })

    it('should return undefined when only an unrelated keyword is registered', () => {
      const result = matchRegistration([keywordRegistration], 'PARKING open the gate')

      expect(result).toBeUndefined()
    })
  })

  describe('buildRoutedMessage', () => {
    const match = {
      body: 'open the gate',
      consumerId: 'garage-app',
      keyword: 'GARAGE',
      matchType: 'KEYWORD' as const,
    }

    it('should build a routed message using the injected clock', () => {
      const result = buildRoutedMessage(pinpointInboundMessage, match, () => '2026-07-11T12:00:00.000Z')

      expect(result).toEqual({
        body: 'open the gate',
        destinationNumber: '+18449163034',
        inboundMessageId: 'aaaa-bbbb-cccc-dddd',
        keyword: 'GARAGE',
        matchType: 'KEYWORD',
        phoneNumber: '+15551234567',
        receivedAt: '2026-07-11T12:00:00.000Z',
      })
    })

    it('should default matchType DEFAULT matches to no keyword', () => {
      const result = buildRoutedMessage(
        pinpointInboundMessage,
        { body: 'hello', consumerId: 'garage-app', matchType: 'DEFAULT' },
        () => '2026-07-11T12:00:00.000Z',
      )

      expect(result.keyword).toBeUndefined()
    })
  })
})
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx jest __tests__/unit/utils/message-routing.test.ts`
Expected: FAIL with "Cannot find module '@utils/message-routing'"

- [ ] **Step 5: Write the implementation**

Create `src/utils/message-routing.ts`:

```ts
import { MatchResult, PinpointInboundSmsMessage, Registration, RoutedSmsMessage } from '../types'

/* Keyword matching */

export const extractCandidateKeyword = (messageBody: string): string | undefined => {
  const firstWord = messageBody.trim().split(/\s+/)[0]
  return firstWord ? firstWord.toUpperCase() : undefined
}

const stripKeyword = (messageBody: string, keyword: string): string => messageBody.trim().slice(keyword.length).trim()

export const matchRegistration = (registrations: Registration[], messageBody: string): MatchResult | undefined => {
  const candidateKeyword = extractCandidateKeyword(messageBody)
  if (candidateKeyword) {
    const keywordMatch = registrations.find((registration) => registration.ruleKey === `KEYWORD#${candidateKeyword}`)
    if (keywordMatch) {
      return {
        body: stripKeyword(messageBody, candidateKeyword),
        consumerId: keywordMatch.consumerId,
        keyword: candidateKeyword,
        matchType: 'KEYWORD',
      }
    }
  }

  const defaultMatch = registrations.find((registration) => registration.ruleKey === 'DEFAULT')
  if (defaultMatch) {
    return {
      body: messageBody.trim(),
      consumerId: defaultMatch.consumerId,
      matchType: 'DEFAULT',
    }
  }

  return undefined
}

/* Routed message */

export const buildRoutedMessage = (
  message: PinpointInboundSmsMessage,
  match: MatchResult,
  now: () => string = () => new Date().toISOString(),
): RoutedSmsMessage => ({
  body: match.body,
  destinationNumber: message.destinationNumber,
  inboundMessageId: message.inboundMessageId,
  keyword: match.keyword,
  matchType: match.matchType,
  phoneNumber: message.originationNumber,
  receivedAt: now(),
})
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx jest __tests__/unit/utils/message-routing.test.ts`
Expected: PASS, all 12 tests green

- [ ] **Step 7: Lint and typecheck**

Run: `npm run lint && npm run typecheck`
Expected: both exit 0 with no errors

- [ ] **Step 8: Commit**

```bash
git add src/types.ts src/utils/message-routing.ts __tests__/unit/utils/message-routing.test.ts __tests__/unit/__mocks__.ts
git commit -m "Add keyword-matching and routed-message logic for inbound SMS"
```

---

## Task 2: DynamoDB registrations lookup service

**Files:**

- Modify: `package.json` (add `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`)
- Modify: `src/config.ts`
- Modify: `jest.setup-test-env.js`
- Create: `src/services/dynamodb.ts`
- Test: `__tests__/unit/services/dynamodb.test.ts`

**Interfaces:**

- Consumes: `Registration` type from Task 1.
- Produces: `getRegistrationsForNumber(phoneNumber: string): Promise<Registration[]>` — consumed by Task 4's handler.

- [ ] **Step 1: Install dependencies**

Run: `npm install @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb`
Expected: `package.json` gains both packages under `dependencies`; `package-lock.json` updates.

- [ ] **Step 2: Add table name to config**

Append to `src/config.ts`:

```ts
// Registrations

export const registrationsTableName = process.env.REGISTRATIONS_TABLE_NAME as string
```

- [ ] **Step 3: Add test env var**

Append to `jest.setup-test-env.js`:

```js
// Registrations

process.env.REGISTRATIONS_TABLE_NAME = 'sms-queue-service-registrations'
```

- [ ] **Step 4: Write the failing test**

Create `__tests__/unit/services/dynamodb.test.ts`:

```ts
import { registration } from '../__mocks__'
import { getRegistrationsForNumber } from '@services/dynamodb'

const mockSend = jest.fn()
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(),
}))
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn(() => ({
      send: (...args: unknown[]) => mockSend(...args),
    })),
  },
  QueryCommand: jest.fn().mockImplementation((x) => x),
}))
jest.mock('@utils/logging', () => ({
  xrayCapture: jest.fn().mockImplementation((x) => x),
}))

describe('dynamodb', () => {
  describe('getRegistrationsForNumber', () => {
    beforeAll(() => {
      mockSend.mockResolvedValue({ Items: [registration] })
    })

    it('should query the registrations table by phone number', async () => {
      await getRegistrationsForNumber('+15551234567')

      expect(mockSend).toHaveBeenCalledWith({
        ExpressionAttributeValues: { ':phoneNumber': '+15551234567' },
        KeyConditionExpression: 'phoneNumber = :phoneNumber',
        TableName: 'sms-queue-service-registrations',
      })
    })

    it('should return the items from the query result', async () => {
      const result = await getRegistrationsForNumber('+15551234567')

      expect(result).toEqual([registration])
    })

    it('should return an empty array when there are no items', async () => {
      mockSend.mockResolvedValueOnce({ Items: undefined })
      const result = await getRegistrationsForNumber('+15551234567')

      expect(result).toEqual([])
    })
  })
})
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npx jest __tests__/unit/services/dynamodb.test.ts`
Expected: FAIL with "Cannot find module '@services/dynamodb'"

- [ ] **Step 6: Write the implementation**

Create `src/services/dynamodb.ts`:

```ts
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb'

import { registrationsTableName } from '../config'
import { Registration } from '../types'
import { xrayCapture } from '../utils/logging'

const dynamoDb = xrayCapture(DynamoDBDocumentClient.from(new DynamoDBClient({})))

export const getRegistrationsForNumber = async (phoneNumber: string): Promise<Registration[]> => {
  const command = new QueryCommand({
    ExpressionAttributeValues: { ':phoneNumber': phoneNumber },
    KeyConditionExpression: 'phoneNumber = :phoneNumber',
    TableName: registrationsTableName,
  })
  const result = await dynamoDb.send(command)
  return (result.Items ?? []) as Registration[]
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx jest __tests__/unit/services/dynamodb.test.ts`
Expected: PASS, all 3 tests green

- [ ] **Step 8: Lint and typecheck**

Run: `npm run lint && npm run typecheck`
Expected: both exit 0 with no errors

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json src/config.ts src/services/dynamodb.ts jest.setup-test-env.js __tests__/unit/services/dynamodb.test.ts
git commit -m "Add DynamoDB registrations lookup service"
```

---

## Task 3: SNS routed-message publish service

**Files:**

- Modify: `package.json` (add `@aws-sdk/client-sns`)
- Modify: `src/config.ts`
- Modify: `jest.setup-test-env.js`
- Create: `src/services/sns.ts`
- Test: `__tests__/unit/services/sns.test.ts`

**Interfaces:**

- Consumes: `RoutedSmsMessage` type from Task 1.
- Produces: `publishRoutedMessage(consumerId: string, message: RoutedSmsMessage): Promise<void>` — consumed by Task 4's handler.

- [ ] **Step 1: Install dependency**

Run: `npm install @aws-sdk/client-sns`
Expected: `package.json` gains the package under `dependencies`; `package-lock.json` updates.

- [ ] **Step 2: Add topic ARN to config**

Append to `src/config.ts`:

```ts
// Inbound routing

export const routedTopicArn = process.env.ROUTED_TOPIC_ARN as string
```

- [ ] **Step 3: Add test env var**

Append to `jest.setup-test-env.js`:

```js
// Inbound routing

process.env.ROUTED_TOPIC_ARN = 'arn:aws:sns:us-east-1:123456789012:sms-inbound-routed'
```

- [ ] **Step 4: Write the failing test**

Create `__tests__/unit/services/sns.test.ts`:

```ts
import { routedSmsMessage } from '../__mocks__'
import { publishRoutedMessage } from '@services/sns'

const mockSend = jest.fn()
jest.mock('@aws-sdk/client-sns', () => ({
  PublishCommand: jest.fn().mockImplementation((x) => x),
  SNSClient: jest.fn(() => ({
    send: (...args: unknown[]) => mockSend(...args),
  })),
}))
jest.mock('@utils/logging', () => ({
  xrayCapture: jest.fn().mockImplementation((x) => x),
}))

describe('sns', () => {
  describe('publishRoutedMessage', () => {
    beforeAll(() => {
      mockSend.mockResolvedValue(undefined)
    })

    it('should publish the message with a consumerId attribute', async () => {
      await publishRoutedMessage('garage-app', routedSmsMessage)

      expect(mockSend).toHaveBeenCalledWith({
        Message: JSON.stringify(routedSmsMessage),
        MessageAttributes: {
          consumerId: {
            DataType: 'String',
            StringValue: 'garage-app',
          },
        },
        TopicArn: 'arn:aws:sns:us-east-1:123456789012:sms-inbound-routed',
      })
    })
  })
})
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npx jest __tests__/unit/services/sns.test.ts`
Expected: FAIL with "Cannot find module '@services/sns'"

- [ ] **Step 6: Write the implementation**

Create `src/services/sns.ts`:

```ts
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns'

import { routedTopicArn } from '../config'
import { RoutedSmsMessage } from '../types'
import { xrayCapture } from '../utils/logging'

const sns = xrayCapture(new SNSClient({}))

export const publishRoutedMessage = async (consumerId: string, message: RoutedSmsMessage): Promise<void> => {
  const command = new PublishCommand({
    Message: JSON.stringify(message),
    MessageAttributes: {
      consumerId: {
        DataType: 'String',
        StringValue: consumerId,
      },
    },
    TopicArn: routedTopicArn,
  })
  await sns.send(command)
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx jest __tests__/unit/services/sns.test.ts`
Expected: PASS, 1 test green

- [ ] **Step 8: Lint and typecheck**

Run: `npm run lint && npm run typecheck`
Expected: both exit 0 with no errors

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json src/config.ts src/services/sns.ts jest.setup-test-env.js __tests__/unit/services/sns.test.ts
git commit -m "Add SNS routed-message publish service"
```

---

## Task 4: Router Lambda handler

**Files:**

- Create: `src/handlers/sms-inbound-router.ts`
- Create: `events/event-sns-inbound.json`
- Test: `__tests__/unit/handlers/sms-inbound-router.test.ts`

**Interfaces:**

- Consumes: `getRegistrationsForNumber` (Task 2), `publishRoutedMessage` (Task 3), `matchRegistration` + `buildRoutedMessage` (Task 1), `obscurePhoneNumber` (existing, `src/utils/message-processing.ts`), `log`/`logError` (existing, `src/utils/logging.ts`).
- Produces: `smsInboundRouterHandler: SNSHandler` — the Lambda entry point wired up in Task 5's `template.yaml`.

- [ ] **Step 1: Create the sample SNS event**

Create `events/event-sns-inbound.json`:

```json
{
  "Records": [
    {
      "EventSource": "aws:sns",
      "EventVersion": "1.0",
      "EventSubscriptionArn": "arn:aws:sns:us-east-1:123456789012:sms-inbound-raw:11111111-2222-3333-4444-555555555555",
      "Sns": {
        "Type": "Notification",
        "MessageId": "12345678-1234-1234-1234-123456789012",
        "TopicArn": "arn:aws:sns:us-east-1:123456789012:sms-inbound-raw",
        "Subject": null,
        "Message": "{\"originationNumber\":\"+15551234567\",\"destinationNumber\":\"+18449163034\",\"messageBody\":\"GARAGE open the gate\",\"messageKeyword\":\"KEYWORD_ABC123\",\"inboundMessageId\":\"aaaa-bbbb-cccc-dddd\",\"previousPublishedMessageId\":\"eeee-ffff-gggg-hhhh\"}",
        "Timestamp": "2026-07-11T12:00:00.000Z",
        "SignatureVersion": "1",
        "Signature": "EXAMPLE",
        "SigningCertUrl": "EXAMPLE",
        "UnsubscribeUrl": "EXAMPLE",
        "MessageAttributes": {}
      }
    }
  ]
}
```

- [ ] **Step 2: Write the failing test**

Create `__tests__/unit/handlers/sms-inbound-router.test.ts`:

```ts
import { keywordRegistration, routedSmsMessage } from '../__mocks__'
import eventJson from '@events/event-sns-inbound.json'
import { smsInboundRouterHandler } from '@handlers/sms-inbound-router'
import * as dynamodb from '@services/dynamodb'
import * as sns from '@services/sns'
import { SNSEvent } from '@types'
import * as logging from '@utils/logging'
import * as messageRouting from '@utils/message-routing'

jest.mock('@services/dynamodb')
jest.mock('@services/sns')
jest.mock('@utils/logging')
jest.mock('@utils/message-routing')

describe('sms-inbound-router', () => {
  const event = eventJson as undefined as SNSEvent

  beforeAll(() => {
    jest.mocked(logging).log.mockReturnValue(undefined)
    jest.mocked(dynamodb).getRegistrationsForNumber.mockResolvedValue([keywordRegistration])
    jest.mocked(messageRouting).matchRegistration.mockReturnValue({
      body: 'open the gate',
      consumerId: 'garage-app',
      keyword: 'GARAGE',
      matchType: 'KEYWORD',
    })
    jest.mocked(messageRouting).buildRoutedMessage.mockReturnValue(routedSmsMessage)
    jest.mocked(sns).publishRoutedMessage.mockResolvedValue(undefined)
  })

  describe('smsInboundRouterHandler', () => {
    it('should look up registrations for the origination number', async () => {
      await smsInboundRouterHandler(event, undefined, undefined)

      expect(dynamodb.getRegistrationsForNumber).toHaveBeenCalledWith('+15551234567')
    })

    it('should match against the message body', async () => {
      await smsInboundRouterHandler(event, undefined, undefined)

      expect(messageRouting.matchRegistration).toHaveBeenCalledWith([keywordRegistration], 'GARAGE open the gate')
    })

    it('should publish the routed message to the matched consumer', async () => {
      await smsInboundRouterHandler(event, undefined, undefined)

      expect(sns.publishRoutedMessage).toHaveBeenCalledWith('garage-app', routedSmsMessage)
    })

    it('should not publish when there is no match', async () => {
      jest.mocked(messageRouting).matchRegistration.mockReturnValueOnce(undefined)
      await smsInboundRouterHandler(event, undefined, undefined)

      expect(sns.publishRoutedMessage).not.toHaveBeenCalled()
    })

    it('should throw when the registration lookup fails', async () => {
      jest.mocked(dynamodb).getRegistrationsForNumber.mockRejectedValueOnce(new Error('fnord'))

      await expect(smsInboundRouterHandler(event, undefined, undefined)).rejects.toThrow('fnord')
    })

    it('should throw when publishing fails', async () => {
      jest.mocked(sns).publishRoutedMessage.mockRejectedValueOnce(new Error('fnord'))

      await expect(smsInboundRouterHandler(event, undefined, undefined)).rejects.toThrow('fnord')
    })
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest __tests__/unit/handlers/sms-inbound-router.test.ts`
Expected: FAIL with "Cannot find module '@handlers/sms-inbound-router'"

- [ ] **Step 4: Write the implementation**

Create `src/handlers/sms-inbound-router.ts`:

```ts
import { getRegistrationsForNumber } from '../services/dynamodb'
import { publishRoutedMessage } from '../services/sns'
import { PinpointInboundSmsMessage, SNSEvent, SNSHandler } from '../types'
import { log } from '../utils/logging'
import { obscurePhoneNumber } from '../utils/message-processing'
import { buildRoutedMessage, matchRegistration } from '../utils/message-routing'

/* Inbound SMS routing */

const processSingleRecord = async (message: PinpointInboundSmsMessage): Promise<void> => {
  const registrations = await getRegistrationsForNumber(message.originationNumber)
  const match = matchRegistration(registrations, message.messageBody)
  if (!match) {
    log('No registration found for inbound SMS', { phoneNumber: obscurePhoneNumber(message.originationNumber) })
    return
  }

  log('Routing inbound SMS', {
    consumerId: match.consumerId,
    matchType: match.matchType,
    phoneNumber: obscurePhoneNumber(message.originationNumber),
  })
  const routedMessage = buildRoutedMessage(message, match)
  await publishRoutedMessage(match.consumerId, routedMessage)
}

export const smsInboundRouterHandler: SNSHandler = async (event: SNSEvent): Promise<void> => {
  log('Received inbound SMS event', { ...event, Records: undefined })
  for (const record of event.Records) {
    const message: PinpointInboundSmsMessage = JSON.parse(record.Sns.Message)
    await processSingleRecord(message)
  }
}
```

Note: unlike `sqsPayloadProcessorHandler`, failures here are **not** caught per-record — they propagate so SNS's built-in Lambda retry (backed by the DLQ configured in Task 5) applies, per the design spec's error-handling section. A missing registration is not a failure and does not throw.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest __tests__/unit/handlers/sms-inbound-router.test.ts`
Expected: PASS, all 6 tests green

- [ ] **Step 6: Lint and typecheck**

Run: `npm run lint && npm run typecheck`
Expected: both exit 0 with no errors

- [ ] **Step 7: Run full test suite with coverage**

Run: `npm run test`
Expected: PASS, coverage thresholds met (branches 90, functions 90, lines 80)

- [ ] **Step 8: Commit**

```bash
git add src/handlers/sms-inbound-router.ts events/event-sns-inbound.json __tests__/unit/handlers/sms-inbound-router.test.ts
git commit -m "Add router Lambda handler for inbound SMS"
```

---

## Task 5: Infrastructure — `template.yaml`

**Files:**

- Modify: `template.yaml` (append new resources after the existing `LambdaLogGroup` resource, and a new `Outputs` section at the end of the file)

**Interfaces:**

- Consumes: `src/handlers/sms-inbound-router.smsInboundRouterHandler` (Task 4's export), env vars `REGISTRATIONS_TABLE_NAME`/`ROUTED_TOPIC_ARN` (Tasks 2/3's `config.ts` reads).
- Produces: `SmsInboundRoutedTopic` ARN and `RegistrationsTable` name as stack `Outputs`, consumed by `sms-queue-api` (registration writes) and downstream consumer projects (topic subscription) per `SMS-CONSUMER-INTEGRATION.md`. Also produces `SmsInboundRawTopic` (ARN via `!Ref`), consumed by Task 6's custom resource.

**Note:** the existing `PinpointSms` (`AWS::Pinpoint::SMSChannel`) resource is NOT modified by this task — that resource type has no two-way-SMS properties (verified against AWS's CloudFormation schema; an earlier draft of this plan incorrectly added `TwoWayEnabled`/`TwoWayChannelArn` to it). Two-way SMS is a property of the phone number itself under the separate "AWS End User Messaging SMS" service, and is enabled by Task 6's custom resource, not by anything in this task.

- [ ] **Step 1: Append the new resources**

Add the following after the existing `LambdaLogGroup` resource (after line 121), keeping one blank line between resources like the rest of the file:

```yaml

  SmsInboundRawTopic:
    Type: AWS::SNS::Topic
    Properties:
      Tags:
        - Key: 'created-by'
          Value: 'sms-queue-service'
        - Key: 'created-for'
          Value: 'dbowland'
        - Key: 'environment'
          Value: !Ref Environment

  SmsInboundRawTopicPolicy:
    Type: AWS::SNS::TopicPolicy
    Properties:
      PolicyDocument:
        Version: 2012-10-17
        Statement:
          - Sid: AllowEndUserMessagingSmsPublish
            Effect: Allow
            Principal:
              Service: sms-voice.amazonaws.com
            Action: 'sns:Publish'
            Resource: !Ref SmsInboundRawTopic
            Condition:
              StringEquals:
                'AWS:SourceAccount': !Ref AWS::AccountId
      Topics:
        - !Ref SmsInboundRawTopic

  SmsInboundRoutedTopic:
    Type: AWS::SNS::Topic
    Properties:
      Tags:
        - Key: 'created-by'
          Value: 'sms-queue-service'
        - Key: 'created-for'
          Value: 'dbowland'
        - Key: 'environment'
          Value: !Ref Environment

  RegistrationsTable:
    Type: AWS::DynamoDB::Table
    Properties:
      TableName: !Sub
        - '${Project}-registrations'
        - Project: !FindInMap [EnvironmentMap, !Ref Environment, project]
      AttributeDefinitions:
        - AttributeName: phoneNumber
          AttributeType: S
        - AttributeName: ruleKey
          AttributeType: S
      KeySchema:
        - AttributeName: phoneNumber
          KeyType: HASH
        - AttributeName: ruleKey
          KeyType: RANGE
      BillingMode: PAY_PER_REQUEST
      Tags:
        - Key: 'created-by'
          Value: 'sms-queue-service'
        - Key: 'created-for'
          Value: 'dbowland'
        - Key: 'environment'
          Value: !Ref Environment

  RouterDeadLetterQueue:
    Type: AWS::SQS::Queue
    Properties:
      MessageRetentionPeriod: 1209600 # 14 days
      Tags:
        - Key: 'created-by'
          Value: 'sms-queue-service'
        - Key: 'created-for'
          Value: 'dbowland'
        - Key: 'environment'
          Value: !Ref Environment

  RouterFunction:
    Type: AWS::Serverless::Function
    Properties:
      Description: Routes inbound SMS messages to the correct consumer based on registered rules.
      Runtime: nodejs24.x
      Architectures:
        - x86_64
      Handler: src/handlers/sms-inbound-router.smsInboundRouterHandler
      Environment:
        Variables:
          REGISTRATIONS_TABLE_NAME: !Ref RegistrationsTable
          ROUTED_TOPIC_ARN: !Ref SmsInboundRoutedTopic
      Events:
        SNSEvent:
          Type: SNS
          Properties:
            Topic: !Ref SmsInboundRawTopic
      MemorySize: 256
      Policies:
        # Give Lambda basic execution Permission
        - AWSLambdaBasicExecutionRole
        # Read access to the registrations table
        - DynamoDBReadPolicy:
            TableName: !Ref RegistrationsTable
        # Publish routed messages
        - Version: 2012-10-17
          Statement:
            - Action:
                - 'sns:Publish'
              Effect: Allow
              Resource: !Ref SmsInboundRoutedTopic
        # Send failed invocations to the dead-letter queue
        - SQSSendMessagePolicy:
            QueueName: !GetAtt RouterDeadLetterQueue.QueueName
      Tags:
        'created-by': 'sms-queue-service'
        'created-for': 'dbowland'
        'environment': !Ref Environment
      Timeout: 30
      Tracing: Active
    Metadata:
      BuildMethod: esbuild
      BuildProperties:
        Minify: true
        Target: 'es2020'
        Sourcemap: true
        EntryPoints:
          - src/handlers/sms-inbound-router.ts

  RouterFunctionEventInvokeConfig:
    Type: AWS::Lambda::EventInvokeConfig
    Properties:
      FunctionName: !Ref RouterFunction
      Qualifier: '$LATEST'
      DestinationConfig:
        OnFailure:
          Destination: !GetAtt RouterDeadLetterQueue.Arn

  RouterLambdaLogGroup:
    Type: AWS::Logs::LogGroup
    DependsOn: [RouterFunction]
    Properties:
      LogGroupName: !Sub /aws/lambda/${RouterFunction}
      RetentionInDays: 30
      Tags:
        - Key: 'created-by'
          Value: 'sms-queue-service'
        - Key: 'created-for'
          Value: 'dbowland'
        - Key: 'environment'
          Value: !Ref Environment

Outputs:
  SmsInboundRoutedTopicArn:
    Description: SNS topic ARN consumer projects subscribe to for routed inbound SMS messages.
    Value: !Ref SmsInboundRoutedTopic
    Export:
      Name: !Sub '${AWS::StackName}-SmsInboundRoutedTopicArn'
  RegistrationsTableName:
    Description: DynamoDB table name for phone number registrations, written by sms-queue-api.
    Value: !Ref RegistrationsTable
    Export:
      Name: !Sub '${AWS::StackName}-RegistrationsTableName'
```

- [ ] **Step 2: Validate and build the template**

Run: `sam validate --lint`
Expected: no errors reported

Run: `sam build --template template.yaml`
Expected: build succeeds, `.aws-sam/build/RouterFunction/` contains the bundled handler

- [ ] **Step 3: Commit**

```bash
git add template.yaml
git commit -m "Add inbound SMS infrastructure: raw/routed SNS topics, registrations table, router function"
```

---

## Task 6: Two-way SMS enablement (custom resource)

**Files:**

- Create: `src/services/sms-voice.ts`
- Create: `src/utils/cfn-response.ts`
- Create: `src/handlers/two-way-sms-custom-resource.ts`
- Test: `__tests__/unit/services/sms-voice.test.ts`
- Test: `__tests__/unit/utils/cfn-response.test.ts`
- Test: `__tests__/unit/handlers/two-way-sms-custom-resource.test.ts`
- Modify: `package.json` (add `@aws-sdk/client-pinpoint-sms-voice-v2`)
- Modify: `template.yaml` (append `TwoWaySmsFunction` and `TwoWaySmsCustomResource` after the resources Task 5 added, before `Outputs`)

**Interfaces:**

- Consumes: `SmsInboundRawTopic` (Task 5's SNS topic, referenced by ARN), the existing `PhoneNumber` template Parameter (already used by `SQSPayloadProcessor`'s `SMS_FROM` env var — same origination number).
- Produces: `twoWaySmsCustomResourceHandler` (`CloudFormationCustomResourceHandler`), wired as a `Custom::TwoWaySms` resource's `ServiceToken`.

**Background:** the phone number this repo already sends SMS from is managed by AWS's "End User Messaging SMS" service (formerly Pinpoint SMS Voice v2) — a separate service/API (`sms-voice`) from the classic Pinpoint application/channel this repo already provisions (`PinpointApplication`/`PinpointSms`). Two-way SMS is a property of the phone number itself in that service (`UpdatePhoneNumber` API, fields `TwoWayEnabled`/`TwoWayChannelArn`), not of anything CloudFormation-native this template currently owns (the phone number arrives as a plain string `Parameter`, provisioned manually outside this template, matching how it's already handled). There is no supported CloudFormation resource type in this template's control that can set this declaratively without either importing the phone number as an `AWS::SMSVOICE::PhoneNumber` resource (higher risk — unverified whether the existing number is even eligible, and it's a live production number) or calling the API imperatively. This task uses a small custom resource that calls the API imperatively — confirmed as the right tradeoff for this project's scale.

The two-way channel role setting is "Use SNS topic policies" (matching the account's existing manual configuration, confirmed by screenshot) — meaning `TwoWayChannelRole` is never set; the `SmsInboundRawTopicPolicy` resource Task 5 already added (granting `sms-voice.amazonaws.com` publish access) is the only permission needed on the SNS side.

- [ ] **Step 1: Install dependency**

Run: `npm install @aws-sdk/client-pinpoint-sms-voice-v2`
Expected: `package.json` gains the package under `dependencies`; `package-lock.json` updates.

- [ ] **Step 2: Write the failing test for the phone-number/two-way-SMS service**

Create `__tests__/unit/services/sms-voice.test.ts`:

```ts
import { findPhoneNumberId, setTwoWaySms } from '@services/sms-voice'

const mockSend = jest.fn()
jest.mock('@aws-sdk/client-pinpoint-sms-voice-v2', () => ({
  DescribePhoneNumbersCommand: jest.fn().mockImplementation((x) => x),
  PinpointSMSVoiceV2Client: jest.fn(() => ({
    send: (...args: unknown[]) => mockSend(...args),
  })),
  UpdatePhoneNumberCommand: jest.fn().mockImplementation((x) => x),
}))
jest.mock('@utils/logging', () => ({
  xrayCapture: jest.fn().mockImplementation((x) => x),
}))

describe('sms-voice', () => {
  describe('findPhoneNumberId', () => {
    beforeAll(() => {
      mockSend.mockResolvedValue({
        PhoneNumbers: [{ PhoneNumber: '+15551234567', PhoneNumberId: 'phone-abc123' }],
      })
    })

    it('should return the id of the matching phone number', async () => {
      const result = await findPhoneNumberId('+15551234567')

      expect(result).toEqual('phone-abc123')
    })

    it('should throw when no phone number matches', async () => {
      mockSend.mockResolvedValueOnce({ PhoneNumbers: [] })

      await expect(findPhoneNumberId('+15551234567')).rejects.toThrow('No phone number found matching +15551234567')
    })
  })

  describe('setTwoWaySms', () => {
    beforeAll(() => {
      mockSend.mockResolvedValue(undefined)
    })

    it('should enable two-way SMS with a channel ARN', async () => {
      await setTwoWaySms('phone-abc123', true, 'arn:aws:sns:us-east-1:123456789012:sms-inbound-raw')

      expect(mockSend).toHaveBeenCalledWith({
        PhoneNumberId: 'phone-abc123',
        TwoWayChannelArn: 'arn:aws:sns:us-east-1:123456789012:sms-inbound-raw',
        TwoWayEnabled: true,
      })
    })

    it('should disable two-way SMS', async () => {
      await setTwoWaySms('phone-abc123', false)

      expect(mockSend).toHaveBeenCalledWith({
        PhoneNumberId: 'phone-abc123',
        TwoWayChannelArn: undefined,
        TwoWayEnabled: false,
      })
    })
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest __tests__/unit/services/sms-voice.test.ts`
Expected: FAIL with "Cannot find module '@services/sms-voice'"

- [ ] **Step 4: Write the service implementation**

Create `src/services/sms-voice.ts`:

```ts
import {
  DescribePhoneNumbersCommand,
  PinpointSMSVoiceV2Client,
  UpdatePhoneNumberCommand,
} from '@aws-sdk/client-pinpoint-sms-voice-v2'

import { xrayCapture } from '../utils/logging'

const smsVoice = xrayCapture(new PinpointSMSVoiceV2Client({}))

export const findPhoneNumberId = async (phoneNumber: string): Promise<string> => {
  const result = await smsVoice.send(new DescribePhoneNumbersCommand({}))
  const match = (result.PhoneNumbers ?? []).find((entry: { PhoneNumber?: string }) => entry.PhoneNumber === phoneNumber)
  if (!match?.PhoneNumberId) {
    throw new Error(`No phone number found matching ${phoneNumber}`)
  }
  return match.PhoneNumberId
}

export const setTwoWaySms = async (phoneNumberId: string, enabled: boolean, channelArn?: string): Promise<void> => {
  await smsVoice.send(
    new UpdatePhoneNumberCommand({
      PhoneNumberId: phoneNumberId,
      TwoWayChannelArn: channelArn,
      TwoWayEnabled: enabled,
    }),
  )
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest __tests__/unit/services/sms-voice.test.ts`
Expected: PASS, all 4 tests green

- [ ] **Step 6: Write the failing test for the CloudFormation response helper**

Create `__tests__/unit/utils/cfn-response.test.ts`:

```ts
import { sendCfnResponse } from '@utils/cfn-response'

describe('cfn-response', () => {
  const event = {
    LogicalResourceId: 'TwoWaySmsCustomResource',
    PhysicalResourceId: 'phone-abc123',
    RequestId: 'request-1',
    ResponseURL: 'https://example.com/cfn-response',
    StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/my-stack/abc',
  }

  beforeAll(() => {
    global.fetch = jest.fn().mockResolvedValue(undefined)
  })

  it('should PUT a response to the response URL', async () => {
    await sendCfnResponse(event, 'SUCCESS', undefined, 'phone-abc123')

    expect(fetch).toHaveBeenCalledWith('https://example.com/cfn-response', expect.objectContaining({ method: 'PUT' }))
  })

  it('should include the status and reason in the body', async () => {
    await sendCfnResponse(event, 'FAILED', 'boom')

    const [, options] = jest.mocked(fetch).mock.calls[0]
    const body = JSON.parse(options?.body as string)
    expect(body).toMatchObject({ Reason: 'boom', Status: 'FAILED' })
  })

  it('should default the physical resource id to the event value when not provided', async () => {
    await sendCfnResponse(event, 'SUCCESS')

    const [, options] = jest.mocked(fetch).mock.calls[0]
    const body = JSON.parse(options?.body as string)
    expect(body).toMatchObject({ PhysicalResourceId: 'phone-abc123' })
  })
})
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npx jest __tests__/unit/utils/cfn-response.test.ts`
Expected: FAIL with "Cannot find module '@utils/cfn-response'"

- [ ] **Step 8: Write the response helper implementation**

Create `src/utils/cfn-response.ts`:

```ts
export type CfnResponseStatus = 'FAILED' | 'SUCCESS'

interface CfnCustomResourceEventLike {
  LogicalResourceId: string
  PhysicalResourceId?: string
  RequestId: string
  ResponseURL: string
  StackId: string
}

export const sendCfnResponse = async (
  event: CfnCustomResourceEventLike,
  status: CfnResponseStatus,
  reason?: string,
  physicalResourceId?: string,
): Promise<void> => {
  const body = JSON.stringify({
    LogicalResourceId: event.LogicalResourceId,
    PhysicalResourceId: physicalResourceId ?? event.PhysicalResourceId ?? event.LogicalResourceId,
    Reason: reason ?? status,
    RequestId: event.RequestId,
    StackId: event.StackId,
    Status: status,
  })
  await fetch(event.ResponseURL, { body, method: 'PUT' })
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `npx jest __tests__/unit/utils/cfn-response.test.ts`
Expected: PASS, all 3 tests green

- [ ] **Step 10: Write the failing test for the custom resource handler**

Create `__tests__/unit/handlers/two-way-sms-custom-resource.test.ts`:

```ts
import { twoWaySmsCustomResourceHandler } from '@handlers/two-way-sms-custom-resource'
import * as smsVoice from '@services/sms-voice'
import * as cfnResponse from '@utils/cfn-response'
import * as logging from '@utils/logging'

jest.mock('@services/sms-voice')
jest.mock('@utils/cfn-response')
jest.mock('@utils/logging')

describe('two-way-sms-custom-resource', () => {
  const baseEvent = {
    LogicalResourceId: 'TwoWaySmsCustomResource',
    RequestId: 'request-1',
    ResourceProperties: {
      PhoneNumber: '+15551234567',
      ServiceToken: 'arn:aws:lambda:us-east-1:123456789012:function:fn',
      TwoWayChannelArn: 'arn:aws:sns:us-east-1:123456789012:sms-inbound-raw',
    },
    ResourceType: 'Custom::TwoWaySms',
    ResponseURL: 'https://example.com/cfn-response',
    StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/my-stack/abc',
  }

  beforeAll(() => {
    jest.mocked(logging).log.mockReturnValue(undefined)
    jest.mocked(logging).logError.mockReturnValue(undefined)
    jest.mocked(smsVoice).findPhoneNumberId.mockResolvedValue('phone-abc123')
    jest.mocked(smsVoice).setTwoWaySms.mockResolvedValue(undefined)
    jest.mocked(cfnResponse).sendCfnResponse.mockResolvedValue(undefined)
  })

  describe('twoWaySmsCustomResourceHandler', () => {
    it('should enable two-way SMS on create', async () => {
      const event = { ...baseEvent, RequestType: 'Create' } as any
      await twoWaySmsCustomResourceHandler(event, undefined as any, undefined as any)

      expect(smsVoice.setTwoWaySms).toHaveBeenCalledWith(
        'phone-abc123',
        true,
        'arn:aws:sns:us-east-1:123456789012:sms-inbound-raw',
      )
    })

    it('should enable two-way SMS on update', async () => {
      const event = { ...baseEvent, RequestType: 'Update' } as any
      await twoWaySmsCustomResourceHandler(event, undefined as any, undefined as any)

      expect(smsVoice.setTwoWaySms).toHaveBeenCalledWith(
        'phone-abc123',
        true,
        'arn:aws:sns:us-east-1:123456789012:sms-inbound-raw',
      )
    })

    it('should disable two-way SMS on delete', async () => {
      const event = { ...baseEvent, RequestType: 'Delete' } as any
      await twoWaySmsCustomResourceHandler(event, undefined as any, undefined as any)

      expect(smsVoice.setTwoWaySms).toHaveBeenCalledWith('phone-abc123', false)
    })

    it('should send a SUCCESS response with the resolved physical resource id', async () => {
      const event = { ...baseEvent, RequestType: 'Create' } as any
      await twoWaySmsCustomResourceHandler(event, undefined as any, undefined as any)

      expect(cfnResponse.sendCfnResponse).toHaveBeenCalledWith(event, 'SUCCESS', undefined, 'phone-abc123')
    })

    it('should send a FAILED response when the lookup fails, without throwing', async () => {
      jest.mocked(smsVoice).findPhoneNumberId.mockRejectedValueOnce(new Error('boom'))
      const event = { ...baseEvent, RequestType: 'Create' } as any

      await expect(twoWaySmsCustomResourceHandler(event, undefined as any, undefined as any)).resolves.toBeUndefined()
      expect(cfnResponse.sendCfnResponse).toHaveBeenCalledWith(event, 'FAILED', 'Error: boom')
    })
  })
})
```

- [ ] **Step 11: Run test to verify it fails**

Run: `npx jest __tests__/unit/handlers/two-way-sms-custom-resource.test.ts`
Expected: FAIL with "Cannot find module '@handlers/two-way-sms-custom-resource'"

- [ ] **Step 12: Write the handler implementation**

Create `src/handlers/two-way-sms-custom-resource.ts`:

```ts
import { findPhoneNumberId, setTwoWaySms } from '../services/sms-voice'
import { CloudFormationCustomResourceEvent, CloudFormationCustomResourceHandler } from '../types'
import { sendCfnResponse } from '../utils/cfn-response'
import { log, logError } from '../utils/logging'

const applyTwoWaySms = async (event: CloudFormationCustomResourceEvent): Promise<string> => {
  const phoneNumber = event.ResourceProperties.PhoneNumber as string
  const channelArn = event.ResourceProperties.TwoWayChannelArn as string
  const phoneNumberId = await findPhoneNumberId(phoneNumber)

  if (event.RequestType === 'Delete') {
    await setTwoWaySms(phoneNumberId, false)
  } else {
    await setTwoWaySms(phoneNumberId, true, channelArn)
  }

  return phoneNumberId
}

export const twoWaySmsCustomResourceHandler: CloudFormationCustomResourceHandler = async (event) => {
  log('Received two-way SMS custom resource event', { RequestType: event.RequestType })
  try {
    const physicalResourceId = await applyTwoWaySms(event)
    await sendCfnResponse(event, 'SUCCESS', undefined, physicalResourceId)
  } catch (error) {
    logError(error)
    await sendCfnResponse(event, 'FAILED', String(error))
  }
}
```

Note: unlike the router handler (Task 4), this handler MUST catch all errors — a CloudFormation custom resource that never sends a response (success or failure) leaves the stack operation hanging until CloudFormation's ~1 hour timeout. The try/catch here is required, not a shortcut.

- [ ] **Step 13: Run test to verify it passes**

Run: `npx jest __tests__/unit/handlers/two-way-sms-custom-resource.test.ts`
Expected: PASS, all 6 tests green

- [ ] **Step 14: Lint, typecheck, and full suite**

Run: `npm run lint && npm run typecheck && npm run test`
Expected: all pass, coverage thresholds met

- [ ] **Step 15: Append the custom resource to `template.yaml`**

Add the following after the resources Task 5 added (after the `RouterLambdaLogGroup` resource, before the `Outputs:` section):

```yaml
TwoWaySmsFunction:
  Type: AWS::Serverless::Function
  Properties:
    Description: CloudFormation custom resource that enables two-way SMS on the existing origination phone number.
    Runtime: nodejs24.x
    Architectures:
      - x86_64
    Handler: src/handlers/two-way-sms-custom-resource.twoWaySmsCustomResourceHandler
    Policies:
      - AWSLambdaBasicExecutionRole
      - Version: 2012-10-17
        Statement:
          # DescribePhoneNumbers is a list operation with no per-resource ARN to scope to
          - Action:
              - 'sms-voice:DescribePhoneNumbers'
            Effect: Allow
            Resource: '*'
          - Action:
              - 'sms-voice:UpdatePhoneNumber'
            Effect: Allow
            Resource: !Sub 'arn:aws:sms-voice:${AWS::Region}:${AWS::AccountId}:phone-number/*'
    Tags:
      'created-by': 'sms-queue-service'
      'created-for': 'dbowland'
      'environment': !Ref Environment
    Timeout: 30
  Metadata:
    BuildMethod: esbuild
    BuildProperties:
      Minify: true
      Target: 'es2020'
      Sourcemap: true
      EntryPoints:
        - src/handlers/two-way-sms-custom-resource.ts

TwoWaySmsCustomResource:
  Type: Custom::TwoWaySms
  DependsOn: [SmsInboundRawTopicPolicy]
  Properties:
    ServiceToken: !GetAtt TwoWaySmsFunction.Arn
    PhoneNumber: !Ref PhoneNumber
    TwoWayChannelArn: !Ref SmsInboundRawTopic
```

- [ ] **Step 16: Validate and build the template**

Run: `sam validate --lint`
Expected: no errors reported

Run: `sam build --template template.yaml`
Expected: build succeeds, `.aws-sam/build/TwoWaySmsFunction/` contains the bundled handler

- [ ] **Step 17: Commit**

```bash
git add package.json package-lock.json src/services/sms-voice.ts src/utils/cfn-response.ts src/handlers/two-way-sms-custom-resource.ts __tests__/unit/services/sms-voice.test.ts __tests__/unit/utils/cfn-response.test.ts __tests__/unit/handlers/two-way-sms-custom-resource.test.ts template.yaml
git commit -m "Add custom resource to enable two-way SMS on the existing phone number"
```

---

## Task 7: Update README

**Files:**

- Modify: `README.md`

- [ ] **Step 1: Update the description to cover inbound messages**

In `README.md`, replace:

```markdown
Lambdas for sms queue service, which processes and sends the outbound SMS queue.
```

with:

```markdown
Lambdas for sms queue service, which processes and sends the outbound SMS queue, and routes inbound SMS replies to the registered consumer project.
```

- [ ] **Step 2: Document the inbound routing pieces**

Add a new section after the "Deploying to Production" section (before "## Additional Documentation"):

```markdown
## Inbound SMS Routing

In addition to sending outbound messages, this service receives inbound SMS via AWS Pinpoint two-way SMS and routes each message to the consumer project registered for the sender's phone number (by keyword or default). See `docs/superpowers/specs/2026-07-11-inbound-sms-routing-design.md` for the full design, and `SMS-CONSUMER-INTEGRATION.md` for how another project registers a phone number and subscribes to routed messages.

Registrations are managed via `sms-queue-api` (`POST`/`DELETE /v1/registrations`), not by this service.
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "Document inbound SMS routing in README"
```
