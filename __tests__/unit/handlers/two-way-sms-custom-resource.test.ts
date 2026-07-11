import { twoWaySmsCustomResourceHandler } from '@handlers/two-way-sms-custom-resource'
import * as smsVoice from '@services/sms-voice'
import * as cfnResponse from '@utils/cfn-response'
import * as logging from '@utils/logging'

jest.mock('@services/sms-voice')
jest.mock('@utils/cfn-response')
jest.mock('@utils/logging')

describe('two-way-sms-custom-resource', () => {
  const baseEvent = {
    LogicalResourceId: 'TwoWaySmsCustomResource',
    RequestId: 'request-1',
    ResourceProperties: {
      PhoneNumber: '+15551234567',
      ServiceToken: 'arn:aws:lambda:us-east-1:123456789012:function:fn',
      TwoWayChannelArn: 'arn:aws:sns:us-east-1:123456789012:sms-inbound-raw',
    },
    ResourceType: 'Custom::TwoWaySms',
    ResponseURL: 'https://example.com/cfn-response',
    StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/my-stack/abc',
  }

  beforeAll(() => {
    jest.mocked(logging).log.mockReturnValue(undefined)
    jest.mocked(logging).logError.mockReturnValue(undefined)
    jest.mocked(smsVoice).findPhoneNumberId.mockResolvedValue('phone-abc123')
    jest.mocked(smsVoice).setTwoWaySms.mockResolvedValue(undefined)
    jest.mocked(cfnResponse).sendCfnResponse.mockResolvedValue(undefined)
  })

  describe('twoWaySmsCustomResourceHandler', () => {
    it('should enable two-way SMS on create', async () => {
      const event = { ...baseEvent, RequestType: 'Create' } as any
      await twoWaySmsCustomResourceHandler(event, undefined as any, undefined as any)

      expect(smsVoice.setTwoWaySms).toHaveBeenCalledWith(
        'phone-abc123',
        true,
        'arn:aws:sns:us-east-1:123456789012:sms-inbound-raw',
      )
    })

    it('should enable two-way SMS on update', async () => {
      const event = { ...baseEvent, RequestType: 'Update' } as any
      await twoWaySmsCustomResourceHandler(event, undefined as any, undefined as any)

      expect(smsVoice.setTwoWaySms).toHaveBeenCalledWith(
        'phone-abc123',
        true,
        'arn:aws:sns:us-east-1:123456789012:sms-inbound-raw',
      )
    })

    it('should disable two-way SMS on delete', async () => {
      const event = { ...baseEvent, RequestType: 'Delete' } as any
      await twoWaySmsCustomResourceHandler(event, undefined as any, undefined as any)

      expect(smsVoice.setTwoWaySms).toHaveBeenCalledWith('phone-abc123', false)
    })

    it('should send a SUCCESS response with the resolved physical resource id', async () => {
      const event = { ...baseEvent, RequestType: 'Create' } as any
      await twoWaySmsCustomResourceHandler(event, undefined as any, undefined as any)

      expect(cfnResponse.sendCfnResponse).toHaveBeenCalledWith(event, 'SUCCESS', undefined, 'phone-abc123')
    })

    it('should send a FAILED response when the lookup fails, without throwing', async () => {
      jest.mocked(smsVoice).findPhoneNumberId.mockRejectedValueOnce(new Error('boom'))
      const event = { ...baseEvent, RequestType: 'Create' } as any

      await expect(twoWaySmsCustomResourceHandler(event, undefined as any, undefined as any)).resolves.toBeUndefined()
      expect(cfnResponse.sendCfnResponse).toHaveBeenCalledWith(event, 'FAILED', 'Error: boom')
    })

    it('should not throw when the failure-path sendCfnResponse call itself rejects', async () => {
      jest.mocked(smsVoice).findPhoneNumberId.mockRejectedValueOnce(new Error('boom'))
      jest.mocked(cfnResponse).sendCfnResponse.mockRejectedValueOnce(new Error('response boom'))
      const event = { ...baseEvent, RequestType: 'Create' } as any

      await expect(twoWaySmsCustomResourceHandler(event, undefined as any, undefined as any)).resolves.toBeUndefined()
      expect(logging.logError).toHaveBeenCalledWith(
        'Failed to send FAILED response to CloudFormation',
        expect.any(Error),
      )
    })
  })
})
