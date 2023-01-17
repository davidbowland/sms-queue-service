import { getDataFromRecord, obscurePhoneNumber } from '../utils/message-processing'
import { log, logError } from '../utils/logging'
import { SQSEvent, SQSHandler, SQSRecord } from '../types'
import { sendSms } from '../services/pinpoint'

/* Queue processing */

export const processSingleMessage = async (record: SQSRecord): Promise<void> => {
  const data = getDataFromRecord(record)
  log('Sending SMS', { ...data, to: obscurePhoneNumber(data.to) })
  await sendSms(data.to, data.contents, data.messageType)
}

export const sqsPayloadProcessorHandler: SQSHandler = async (event: SQSEvent): Promise<void> => {
  log('Received payload', { ...event, body: undefined })
  for (const record of event.Records) {
    try {
      await exports.processSingleMessage(record)
    } catch (error) {
      logError(error)
    }
  }
}
