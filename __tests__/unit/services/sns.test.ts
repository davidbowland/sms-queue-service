import { routedSmsMessage } from '../__mocks__'
import { publishRoutedMessage } from '@services/sns'

const mockSend = jest.fn()
jest.mock('@aws-sdk/client-sns', () => ({
  PublishCommand: jest.fn().mockImplementation((x) => x),
  SNSClient: jest.fn(() => ({
    send: (...args: unknown[]) => mockSend(...args),
  })),
}))
jest.mock('@utils/logging', () => ({
  xrayCapture: jest.fn().mockImplementation((x) => x),
}))

describe('sns', () => {
  describe('publishRoutedMessage', () => {
    beforeAll(() => {
      mockSend.mockResolvedValue(undefined)
    })

    it('should publish the message with a consumerId attribute', async () => {
      await publishRoutedMessage('garage-app', routedSmsMessage)

      expect(mockSend).toHaveBeenCalledWith({
        Message: JSON.stringify(routedSmsMessage),
        MessageAttributes: {
          consumerId: {
            DataType: 'String',
            StringValue: 'garage-app',
          },
        },
        TopicArn: 'arn:aws:sns:us-east-1:123456789012:sms-inbound-routed',
      })
    })
  })
})
