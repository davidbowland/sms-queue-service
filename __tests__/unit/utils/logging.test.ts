import { PinpointClient } from '@aws-sdk/client-pinpoint'
import * as AWSXRay from 'aws-xray-sdk-core'
import { mocked } from 'jest-mock'

import { log, logError, xrayCapture } from '@utils/logging'

jest.mock('aws-xray-sdk-core')

describe('logging', () => {
  beforeAll(() => {
    console.error = jest.fn()
    console.log = jest.fn()
  })

  describe('log', () => {
    it.each(['Hello', 0, null, undefined, { a: 1, b: 2 }])('should call logFunc with message', async (value) => {
      const message = `Log message for value ${JSON.stringify(value)}`
      await log(message)

      expect(console.log).toHaveBeenCalledWith(message)
    })
  })

  describe('logError', () => {
    it.each(['Hello', 0, null, undefined, { a: 1, b: 2 }])('should call logFunc with message', async (value) => {
      const message = `Error message for value ${JSON.stringify(value)}`
      const error = new Error(message)
      await logError(error)

      expect(console.error).toHaveBeenCalledWith(error)
    })
  })

  describe('xrayCapture', () => {
    const capturedPinpoint = 'captured-pinpoint' as unknown as PinpointClient
    const pinpoint = 'pinpoint'

    beforeAll(() => {
      mocked(AWSXRay).captureAWSv3Client.mockReturnValue(capturedPinpoint)
    })

    it('should use AWSXRay.captureAWSv3Client when x-ray is enabled (not running locally)', () => {
      process.env.AWS_SAM_LOCAL = 'false'
      const result = xrayCapture(pinpoint)

      expect(mocked(AWSXRay).captureAWSv3Client).toHaveBeenCalledWith(pinpoint)
      expect(result).toEqual(capturedPinpoint)
    })

    it('should return same object when x-ray is disabled (running locally)', () => {
      process.env.AWS_SAM_LOCAL = 'true'
      const result = xrayCapture(pinpoint)

      expect(mocked(AWSXRay).captureAWSv3Client).toHaveBeenCalledTimes(0)
      expect(result).toEqual(pinpoint)
    })
  })
})
