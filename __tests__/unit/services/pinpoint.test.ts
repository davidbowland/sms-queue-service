import { sendSms } from '@services/pinpoint'
import { smsMessage } from '../__mocks__'

const mockSendMessages = jest.fn()
jest.mock('aws-sdk', () => ({
  Pinpoint: jest.fn(() => ({
    sendMessages: (...args) => ({ promise: () => mockSendMessages(...args) }),
  })),
}))

describe('Pinpoint', () => {
  describe('sendSms', () => {
    test('expect data passed to sendMessages', async () => {
      await sendSms(smsMessage.to, smsMessage.contents)
      expect(mockSendMessages).toHaveBeenCalledWith({
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
      expect(mockSendMessages).toHaveBeenCalledWith({
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
