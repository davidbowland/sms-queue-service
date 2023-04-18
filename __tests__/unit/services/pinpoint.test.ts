import { sendSms } from '@services/pinpoint'
import { smsMessage } from '../__mocks__'

const mockSend = jest.fn()
jest.mock('@aws-sdk/client-pinpoint', () => ({
  PinpointClient: jest.fn(() => ({
    send: (...args) => mockSend(...args),
  })),
  SendMessagesCommand: jest.fn().mockImplementation((x) => x),
}))
jest.mock('@utils/logging', () => ({
  xrayCapture: jest.fn().mockImplementation((x) => x),
}))

describe('Pinpoint', () => {
  describe('sendSms', () => {
    test('expect data passed to sendMessages', async () => {
      await sendSms(smsMessage.to, smsMessage.contents)

      expect(mockSend).toHaveBeenCalledWith({
        ApplicationId: '76rfghjure34567uhg876ug',
        MessageRequest: {
          Addresses: {
            '+15551234567': {
              ChannelType: 'SMS',
            },
          },
          MessageConfiguration: {
            SMSMessage: {
              Body: 'Hello, world!\n\nReply STOP to opt out.',
              MessageType: 'TRANSACTIONAL',
              OriginationNumber: '+12345678901',
            },
          },
        },
      })
    })

    test('expect messageType passed to sendMessages', async () => {
      await sendSms(smsMessage.to, smsMessage.contents, 'PROMOTIONAL')

      expect(mockSend).toHaveBeenCalledWith({
        ApplicationId: '76rfghjure34567uhg876ug',
        MessageRequest: {
          Addresses: {
            '+15551234567': {
              ChannelType: 'SMS',
            },
          },
          MessageConfiguration: {
            SMSMessage: {
              Body: 'Hello, world!\n\nReply STOP to opt out.',
              MessageType: 'PROMOTIONAL',
              OriginationNumber: '+12345678901',
            },
          },
        },
      })
    })
  })
})
