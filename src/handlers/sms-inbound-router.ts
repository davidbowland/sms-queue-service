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
  // Deliberately no per-record try/catch: errors must propagate so SNS's built-in Lambda retry
  // applies, and exhausted retries land in the configured DLQ instead of being silently dropped.
  for (const record of event.Records) {
    const message: PinpointInboundSmsMessage = JSON.parse(record.Sns.Message)
    await processSingleRecord(message)
  }
}
