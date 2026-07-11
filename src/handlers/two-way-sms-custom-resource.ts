import { findPhoneNumberId, setTwoWaySms } from '../services/sms-voice'
import { CloudFormationCustomResourceEvent, CloudFormationCustomResourceHandler } from '../types'
import { sendCfnResponse } from '../utils/cfn-response'
import { log, logError } from '../utils/logging'

const applyTwoWaySms = async (event: CloudFormationCustomResourceEvent): Promise<string> => {
  const phoneNumber = event.ResourceProperties.PhoneNumber as string
  const channelArn = event.ResourceProperties.TwoWayChannelArn as string
  const phoneNumberId = await findPhoneNumberId(phoneNumber)

  if (event.RequestType === 'Delete') {
    await setTwoWaySms(phoneNumberId, false)
  } else {
    await setTwoWaySms(phoneNumberId, true, channelArn)
  }

  return phoneNumberId
}

export const twoWaySmsCustomResourceHandler: CloudFormationCustomResourceHandler = async (event) => {
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
