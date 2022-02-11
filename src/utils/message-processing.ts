import { SQSRecord } from 'aws-lambda'

import { SMSMessage } from '../types'

/* Body */

export const getDataFromRecord = (record: SQSRecord): Promise<SMSMessage> =>
  new Promise((resolve) => resolve(JSON.parse(record.body)))
