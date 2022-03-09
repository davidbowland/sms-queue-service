import { SQSRecord } from 'aws-lambda'

import { SMSMessage } from '../types'

/* Body */

export const getDataFromRecord = (record: SQSRecord): SMSMessage => JSON.parse(record.body)

/* Phone number */

export const obscurePhoneNumber = (phoneNumber: string) => phoneNumber.replace(/\d{3}(\d{4})$/, 'XXX$1')
