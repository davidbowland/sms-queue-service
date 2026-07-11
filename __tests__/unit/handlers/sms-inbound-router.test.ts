import { keywordRegistration, routedSmsMessage } from '../__mocks__'
import eventJson from '@events/event-sns-inbound.json'
import { smsInboundRouterHandler } from '@handlers/sms-inbound-router'
import * as dynamodb from '@services/dynamodb'
import * as sns from '@services/sns'
import { SNSEvent } from '@types'
import * as logging from '@utils/logging'
import * as messageRouting from '@utils/message-routing'

jest.mock('@services/dynamodb')
jest.mock('@services/sns')
jest.mock('@utils/logging')
jest.mock('@utils/message-routing')

describe('sms-inbound-router', () => {
  const event = eventJson as undefined as SNSEvent

  beforeAll(() => {
    jest.mocked(logging).log.mockReturnValue(undefined)
    jest.mocked(dynamodb).getRegistrationsForNumber.mockResolvedValue([keywordRegistration])
    jest.mocked(messageRouting).matchRegistration.mockReturnValue({
      body: 'open the gate',
      consumerId: 'garage-app',
      keyword: 'GARAGE',
      matchType: 'KEYWORD',
    })
    jest.mocked(messageRouting).buildRoutedMessage.mockReturnValue(routedSmsMessage)
    jest.mocked(sns).publishRoutedMessage.mockResolvedValue(undefined)
  })

  describe('smsInboundRouterHandler', () => {
    it('should look up registrations for the origination number', async () => {
      await smsInboundRouterHandler(event, undefined, undefined)

      expect(dynamodb.getRegistrationsForNumber).toHaveBeenCalledWith('+15551234567')
    })

    it('should match against the message body', async () => {
      await smsInboundRouterHandler(event, undefined, undefined)

      expect(messageRouting.matchRegistration).toHaveBeenCalledWith([keywordRegistration], 'GARAGE open the gate')
    })

    it('should publish the routed message to the matched consumer', async () => {
      await smsInboundRouterHandler(event, undefined, undefined)

      expect(sns.publishRoutedMessage).toHaveBeenCalledWith('garage-app', routedSmsMessage)
    })

    it('should not publish when there is no match', async () => {
      jest.mocked(messageRouting).matchRegistration.mockReturnValueOnce(undefined)
      await smsInboundRouterHandler(event, undefined, undefined)

      expect(sns.publishRoutedMessage).not.toHaveBeenCalled()
    })

    it('should throw when the registration lookup fails', async () => {
      jest.mocked(dynamodb).getRegistrationsForNumber.mockRejectedValueOnce(new Error('fnord'))

      await expect(smsInboundRouterHandler(event, undefined, undefined)).rejects.toThrow('fnord')
    })

    it('should throw when publishing fails', async () => {
      jest.mocked(sns).publishRoutedMessage.mockRejectedValueOnce(new Error('fnord'))

      await expect(smsInboundRouterHandler(event, undefined, undefined)).rejects.toThrow('fnord')
    })
  })
})
