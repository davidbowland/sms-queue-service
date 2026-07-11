// Pinpoint

export const projectId = process.env.PROJECT_ID as string
export const smsFrom = process.env.SMS_FROM as string
export const smsRegion = process.env.SMS_REGION as string

// Inbound routing

export const routedTopicArn = process.env.ROUTED_TOPIC_ARN as string

// Registrations

export const registrationsTableName = process.env.REGISTRATIONS_TABLE_NAME as string
