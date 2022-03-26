import { SMSMessage, SQSRecord } from '@types'

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
