import { mocked } from 'jest-mock'

import * as logging from '@utils/logging'
import * as messageProcessing from '@utils/message-processing'
import * as pinpoint from '@services/pinpoint'
import eventJson from '@events/event-sqs.json'
import { smsMessage } from '../__mocks__'
import { SQSEvent } from '@types'
import { sqsPayloadProcessorHandler } from '@handlers/sqs-payload-processor'

jest.mock('@services/pinpoint')
jest.mock('@utils/logging')
jest.mock('@utils/message-processing')

describe('sqs-payload-processor', () => {
  beforeAll(() => {
    mocked(logging).log.mockReturnValue(undefined)
    mocked(messageProcessing).getDataFromRecord.mockReturnValue(smsMessage)
  })

  describe('sqsPayloadProcessorHandler', () => {
    const event = eventJson as undefined as SQSEvent
    beforeAll(() => {
      mocked(pinpoint).sendSms.mockResolvedValue(undefined)
    })

    test('expect processSingleMessage to be called for each record', async () => {
      await sqsPayloadProcessorHandler(event, undefined, undefined)

      expect(mocked(pinpoint).sendSms).toHaveBeenCalledWith('+15551234567', 'Hello, world!', undefined)
    })

    test('expect processSingleMessage to not fail when sendSms fails', async () => {
      mocked(pinpoint).sendSms.mockRejectedValueOnce('fnord')
      await sqsPayloadProcessorHandler(event, undefined, undefined)

      expect(mocked(logging).logError).toHaveBeenCalledWith('fnord')
    })
  })
})
