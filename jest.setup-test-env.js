// Pinpoint

process.env.PROJECT_ID = '76rfghjure34567uhg876ug'
process.env.SMS_FROM = '+12345678901'
process.env.SMS_REGION = 'us-east-1'

// Inbound routing

process.env.ROUTED_TOPIC_ARN = 'arn:aws:sns:us-east-1:123456789012:sms-inbound-routed'

// Registrations

process.env.REGISTRATIONS_TABLE_NAME = 'sms-queue-service-registrations'
