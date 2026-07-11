import {
  DescribePhoneNumbersCommand,
  PinpointSMSVoiceV2Client,
  UpdatePhoneNumberCommand,
} from '@aws-sdk/client-pinpoint-sms-voice-v2'

import { xrayCapture } from '../utils/logging'

const smsVoice = xrayCapture(new PinpointSMSVoiceV2Client({}))

export const findPhoneNumberId = async (phoneNumber: string): Promise<string> => {
  const result = await smsVoice.send(new DescribePhoneNumbersCommand({}))
  const match = (result.PhoneNumbers ?? []).find((entry: { PhoneNumber?: string }) => entry.PhoneNumber === phoneNumber)
  if (!match?.PhoneNumberId) {
    throw new Error(`No phone number found matching ${phoneNumber}`)
  }
  return match.PhoneNumberId
}

export const setTwoWaySms = async (phoneNumberId: string, enabled: boolean, channelArn?: string): Promise<void> => {
  await smsVoice.send(
    new UpdatePhoneNumberCommand({
      PhoneNumberId: phoneNumberId,
      TwoWayChannelArn: channelArn,
      TwoWayEnabled: enabled,
    }),
  )
}
