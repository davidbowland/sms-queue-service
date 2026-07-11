import { findPhoneNumberId, setTwoWaySms } from '../services/sms-voice'
import { CloudFormationCustomResourceEvent, CloudFormationCustomResourceHandler } from '../types'
import { sendCfnResponse } from '../utils/cfn-response'
import { log, logError } from '../utils/logging'

const applyTwoWaySms = async (event: CloudFormationCustomResourceEvent): Promise<string> => {
  const phoneNumber = event.ResourceProperties.PhoneNumber as string
  const channelArn = event.ResourceProperties.TwoWayChannelArn as string

  if (event.RequestType === 'Delete') {
    try {
      const phoneNumberId = await findPhoneNumberId(phoneNumber)
      await setTwoWaySms(phoneNumberId, false)
      return phoneNumberId
    } catch (error) {
      // A missing phone number on delete means there's nothing left to disable -- treat as
      // already cleaned up rather than failing, or CloudFormation would leave the stack stuck
      // in DELETE_FAILED forever.
      log('Phone number not found on delete; treating as already cleaned up', { error: String(error) })
      return event.PhysicalResourceId ?? phoneNumber
    }
  }

  const phoneNumberId = await findPhoneNumberId(phoneNumber)
  await setTwoWaySms(phoneNumberId, true, channelArn)
  return phoneNumberId
}

export const twoWaySmsCustomResourceHandler: CloudFormationCustomResourceHandler = async (event) => {
  // This handler always catches everything (rather than letting errors propagate, as
  // sms-inbound-router.ts deliberately does) because CloudFormation must receive a response or
  // the stack hangs for ~1hr waiting on the custom resource.
  try {
    log('Received two-way SMS custom resource event', { RequestType: event.RequestType })
    const physicalResourceId = await applyTwoWaySms(event)
    await sendCfnResponse(event, 'SUCCESS', undefined, physicalResourceId)
  } catch (error) {
    logError(error)
    try {
      await sendCfnResponse(event, 'FAILED', String(error))
    } catch (responseError) {
      logError('Failed to send FAILED response to CloudFormation', responseError)
    }
  }
}
