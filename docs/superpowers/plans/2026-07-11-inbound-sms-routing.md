# Inbound SMS Receiving & Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add inbound SMS receiving to `sms-queue-service` — a Router Lambda that reads phone-number registration rules from DynamoDB and fans matched messages out to the correct consumer project via a filtered SNS topic.

**Architecture:** Pinpoint two-way SMS publishes raw inbound messages to a new `sms-inbound-raw` SNS topic. A new Router Lambda (SNS-triggered) looks up the sender's phone number in a new DynamoDB registrations table, matches it against a registered keyword (first word of the message) or a registered default, and republishes matched messages to a new `sms-inbound-routed` SNS topic with a `consumerId` message attribute that downstream consumers filter on. Unmatched messages are logged and dropped; genuine failures throw so SNS's built-in retry (backed by a DLQ) applies.

**Tech Stack:** TypeScript, AWS Lambda (Node 24), AWS SAM/CloudFormation, `@aws-sdk/client-dynamodb` + `@aws-sdk/lib-dynamodb`, `@aws-sdk/client-sns`, Jest.

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

- Modify: `template.yaml:103-107` (existing `PinpointSms` resource)
- Modify: `template.yaml` (append new resources after the existing `LambdaLogGroup` resource, and a new `Outputs` section at the end of the file)

**Interfaces:**

- Consumes: `src/handlers/sms-inbound-router.smsInboundRouterHandler` (Task 4's export), env vars `REGISTRATIONS_TABLE_NAME`/`ROUTED_TOPIC_ARN` (Tasks 2/3's `config.ts` reads).
- Produces: `SmsInboundRoutedTopic` ARN and `RegistrationsTable` name as stack `Outputs`, consumed by `sms-queue-api` (registration writes) and downstream consumer projects (topic subscription) per `SMS-CONSUMER-INTEGRATION.md`.

- [ ] **Step 1: Enable two-way SMS on the existing Pinpoint channel**

In `template.yaml`, replace the existing `PinpointSms` resource (lines 103-107):

```yaml
PinpointSms:
  Type: AWS::Pinpoint::SMSChannel
  DependsOn: [SmsInboundRawTopicPolicy]
  Properties:
    ApplicationId: !Ref PinpointApplication
    Enabled: true
    TwoWayEnabled: true
    TwoWayChannelArn: !Ref SmsInboundRawTopic
```

- [ ] **Step 2: Append the new resources**

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
          - Sid: AllowPinpointPublish
            Effect: Allow
            Principal:
              Service: pinpoint.amazonaws.com
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

- [ ] **Step 3: Validate and build the template**

Run: `sam validate --lint`
Expected: no errors reported

Run: `sam build --template template.yaml`
Expected: build succeeds, `.aws-sam/build/RouterFunction/` contains the bundled handler

- [ ] **Step 4: Commit**

```bash
git add template.yaml
git commit -m "Add inbound SMS infrastructure: raw/routed SNS topics, registrations table, router function"
```

---

## Task 6: Update README

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
