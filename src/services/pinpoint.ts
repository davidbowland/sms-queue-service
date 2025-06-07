import { PinpointClient, SendMessagesCommand, SendMessagesCommandOutput } from '@aws-sdk/client-pinpoint'

import { projectId, smsFrom, smsRegion } from '../config'
import { MessageType } from '../types'
import { xrayCapture } from '../utils/logging'

const pinpoint = xrayCapture(new PinpointClient({ apiVersion: '2016-12-01', region: smsRegion }))

export const sendSms = async (
  to: string,
  message: string,
  messageType?: MessageType,
): Promise<SendMessagesCommandOutput> => {
  const command = new SendMessagesCommand({
    ApplicationId: projectId,
    MessageRequest: {
      Addresses: {
        [to]: {
          ChannelType: 'SMS',
        },
      },
      MessageConfiguration: {
        SMSMessage: {
          Body: `${message}\n\nReply STOP to opt out.`,
          MessageType: messageType ?? 'TRANSACTIONAL',
          OriginationNumber: smsFrom,
        },
      },
    },
  })
  return pinpoint.send(command)
}
