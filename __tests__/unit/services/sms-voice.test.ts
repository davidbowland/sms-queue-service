import { findPhoneNumberId, setTwoWaySms } from '@services/sms-voice'

const mockSend = jest.fn()
jest.mock('@aws-sdk/client-pinpoint-sms-voice-v2', () => ({
  DescribePhoneNumbersCommand: jest.fn().mockImplementation((x) => x),
  PinpointSMSVoiceV2Client: jest.fn(() => ({
    send: (...args: unknown[]) => mockSend(...args),
  })),
  UpdatePhoneNumberCommand: jest.fn().mockImplementation((x) => x),
}))
jest.mock('@utils/logging', () => ({
  xrayCapture: jest.fn().mockImplementation((x) => x),
}))

describe('sms-voice', () => {
  describe('findPhoneNumberId', () => {
    beforeAll(() => {
      mockSend.mockResolvedValue({
        PhoneNumbers: [{ PhoneNumber: '+15551234567', PhoneNumberId: 'phone-abc123' }],
      })
    })

    it('should return the id of the matching phone number', async () => {
      const result = await findPhoneNumberId('+15551234567')

      expect(result).toEqual('phone-abc123')
    })

    it('should throw when no phone number matches', async () => {
      mockSend.mockResolvedValueOnce({ PhoneNumbers: [] })

      await expect(findPhoneNumberId('+15551234567')).rejects.toThrow('No phone number found matching +15551234567')
    })

    it('should throw when the response has no PhoneNumbers field', async () => {
      mockSend.mockResolvedValueOnce({})

      await expect(findPhoneNumberId('+15551234567')).rejects.toThrow('No phone number found matching +15551234567')
    })

    it('should paginate through all pages before searching for a match', async () => {
      mockSend
        .mockResolvedValueOnce({
          NextToken: 'next-page-token',
          PhoneNumbers: [{ PhoneNumber: '+19998887777', PhoneNumberId: 'phone-other' }],
        })
        .mockResolvedValueOnce({
          PhoneNumbers: [{ PhoneNumber: '+15551234567', PhoneNumberId: 'phone-abc123' }],
        })

      const result = await findPhoneNumberId('+15551234567')

      expect(result).toEqual('phone-abc123')
      expect(mockSend).toHaveBeenCalledTimes(2)
      expect(mockSend).toHaveBeenNthCalledWith(1, { NextToken: undefined })
      expect(mockSend).toHaveBeenNthCalledWith(2, { NextToken: 'next-page-token' })
    })
  })

  describe('setTwoWaySms', () => {
    beforeAll(() => {
      mockSend.mockResolvedValue(undefined)
    })

    it('should enable two-way SMS with a channel ARN', async () => {
      await setTwoWaySms('phone-abc123', true, 'arn:aws:sns:us-east-1:123456789012:sms-inbound-raw')

      expect(mockSend).toHaveBeenCalledWith({
        PhoneNumberId: 'phone-abc123',
        TwoWayChannelArn: 'arn:aws:sns:us-east-1:123456789012:sms-inbound-raw',
        TwoWayEnabled: true,
      })
    })

    it('should disable two-way SMS', async () => {
      await setTwoWaySms('phone-abc123', false)

      expect(mockSend).toHaveBeenCalledWith({
        PhoneNumberId: 'phone-abc123',
        TwoWayChannelArn: undefined,
        TwoWayEnabled: false,
      })
    })
  })
})
