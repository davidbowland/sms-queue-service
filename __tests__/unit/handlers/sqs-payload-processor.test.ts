import { smsMessage } from '../__mocks__'
import eventJson from '@events/event-sqs.json'
import { sqsPayloadProcessorHandler } from '@handlers/sqs-payload-processor'
import * as pinpoint from '@services/pinpoint'
import { SQSEvent } from '@types'
import * as logging from '@utils/logging'
import * as messageProcessing from '@utils/message-processing'

jest.mock('@services/pinpoint')
jest.mock('@utils/logging')
jest.mock('@utils/message-processing')

describe('sqs-payload-processor', () => {
  beforeAll(() => {
    jest.mocked(logging).log.mockReturnValue(undefined)
    jest.mocked(messageProcessing).getDataFromRecord.mockReturnValue(smsMessage)
  })

  describe('sqsPayloadProcessorHandler', () => {
    const event = eventJson as undefined as SQSEvent
    beforeAll(() => {
      jest.mocked(pinpoint).sendSms.mockResolvedValue(undefined)
    })

    it('should call sendSms for each record', async () => {
      await sqsPayloadProcessorHandler(event, undefined, undefined)

      expect(pinpoint.sendSms).toHaveBeenCalledWith('+15551234567', 'Hello, world!', undefined)
    })

    it('should break long messages into chunks', async () => {
      const longMessage = 'a'.repeat(1200)
      jest.mocked(messageProcessing.getDataFromRecord).mockReturnValueOnce({
        ...smsMessage,
        contents: longMessage,
      })
      await sqsPayloadProcessorHandler(event, undefined, undefined)
      expect(pinpoint.sendSms).toHaveBeenCalledWith(
        '+15551234567',
        expect.stringContaining(longMessage.slice(0, 600)),
        undefined,
      )
      expect(pinpoint.sendSms).toHaveBeenCalledWith(
        '+15551234567',
        expect.stringContaining(longMessage.slice(600, 1200)),
        undefined,
      )
      expect(pinpoint.sendSms).toHaveBeenCalledTimes(2)
    })

    it('should not invoke sendSms if there are no contents', async () => {
      jest.mocked(messageProcessing.getDataFromRecord).mockReturnValueOnce({
        ...smsMessage,
        contents: '',
      })
      await sqsPayloadProcessorHandler(event, undefined, undefined)
      expect(pinpoint.sendSms).not.toHaveBeenCalled()
    })

    it('should not fail when sendSms fails', async () => {
      jest.mocked(pinpoint).sendSms.mockRejectedValueOnce('fnord')
      await sqsPayloadProcessorHandler(event, undefined, undefined)

      expect(logging.logError).toHaveBeenCalledWith('fnord')
    })
  })
})
