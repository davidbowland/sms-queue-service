import { PinpointInboundSmsMessage, Registration, RoutedSmsMessage, SMSMessage, SQSRecord } from '@types'

export const smsMessage: SMSMessage = {
  contents: 'Hello, world!',
  to: '+15551234567',
}

export const record: SQSRecord = {
  attributes: {
    ApproximateFirstReceiveTimestamp: '1523232000001',
    ApproximateReceiveCount: '1',
    SenderId: '123456789012',
    SentTimestamp: '1523232000000',
  },
  awsRegion: 'us-east-1',
  body: JSON.stringify(smsMessage),
  eventSource: 'aws:sqs',
  eventSourceARN: 'arn:aws:sqs:us-east-1:123456789012:MyQueue',
  md5OfBody: '{{{md5_of_body}}}',
  messageAttributes: {},
  messageId: '19dd0b57-b21e-4ac1-bd88-01bbb068cb78',
  receiptHandle: 'MessageReceiptHandle',
}

export const event = { Records: [record] }

export const uuid = 'aaaaa-uuuuu-uuuuu-iiiii-ddddd'

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
