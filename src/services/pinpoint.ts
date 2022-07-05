import { Pinpoint } from 'aws-sdk'

import { projectId, smsFrom, smsRegion } from '../config'
import { MessageType } from '../types'
import { xrayCapture } from '../utils/logging'

const pinpoint = xrayCapture(new Pinpoint({ apiVersion: '2016-12-01', region: smsRegion }))

export const sendSms = (to: string, message: string, messageType?: MessageType) =>
  pinpoint
    .sendMessages({
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
    .promise()
