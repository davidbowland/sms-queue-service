import {
  DescribePhoneNumbersCommand,
  PinpointSMSVoiceV2Client,
  UpdatePhoneNumberCommand,
} from '@aws-sdk/client-pinpoint-sms-voice-v2'

import { xrayCapture } from '../utils/logging'

const smsVoice = xrayCapture(new PinpointSMSVoiceV2Client({}))

export const findPhoneNumberId = async (phoneNumber: string): Promise<string> => {
  const phoneNumbers: { PhoneNumber?: string; PhoneNumberId?: string }[] = []
  let nextToken: string | undefined
  do {
    const result = await smsVoice.send(new DescribePhoneNumbersCommand({ NextToken: nextToken }))
    phoneNumbers.push(...(result.PhoneNumbers ?? []))
    nextToken = result.NextToken
  } while (nextToken)

  const match = phoneNumbers.find((entry) => entry.PhoneNumber === phoneNumber)
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
