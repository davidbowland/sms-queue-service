import { sendSms } from '../services/pinpoint'
import { SQSEvent, SQSHandler, SQSRecord } from '../types'
import { log, logError } from '../utils/logging'
import { getDataFromRecord, obscurePhoneNumber } from '../utils/message-processing'

/* Queue processing */

const processSingleMessage = async (record: SQSRecord): Promise<void> => {
  const data = getDataFromRecord(record)
  log('Sending SMS', { ...data, to: obscurePhoneNumber(data.to) })
  // Pinpoint restricts SMS to 600 non-GSM characters.
  // We have to assume that the message may contain non-GSM characters.
  const contents = data.contents.match(/.{1,600}/gs) || []
  for (const content of contents) {
    await sendSms(data.to, content, data.messageType)
  }
}

export const sqsPayloadProcessorHandler: SQSHandler = async (event: SQSEvent): Promise<void> => {
  log('Received payload', { ...event, body: undefined })
  for (const record of event.Records) {
    try {
      await processSingleMessage(record)
    } catch (error) {
      logError(error)
    }
  }
}
