import { sendSms } from '../services/pinpoint'
import { SQSEvent, SQSHandler, SQSRecord } from '../types'
import { log, logError } from '../utils/logging'
import { getDataFromRecord } from '../utils/message-processing'

/* Queue processing */

export const processSingleMessage = async (record: SQSRecord): Promise<void> => {
  const data = await getDataFromRecord(record)
  await sendSms(data.to, data.contents, data.messageType)
}

export const sqsPayloadProcessorHandler: SQSHandler = async (event: SQSEvent): Promise<void> => {
  log('Received payload', event)
  for (const record of event.Records) {
    try {
      await exports.processSingleMessage(record)
    } catch (error) {
      logError(error)
    }
  }
}
