import { registration } from '../__mocks__'
import { getRegistrationsForNumber } from '@services/dynamodb'

const mockSend = jest.fn()
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(),
}))
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn(() => ({
      send: (...args: unknown[]) => mockSend(...args),
    })),
  },
  QueryCommand: jest.fn().mockImplementation((x) => x),
}))
jest.mock('@utils/logging', () => ({
  xrayCapture: jest.fn().mockImplementation((x) => x),
}))

describe('dynamodb', () => {
  describe('getRegistrationsForNumber', () => {
    beforeAll(() => {
      mockSend.mockResolvedValue({ Items: [registration] })
    })

    it('should query the registrations table by phone number', async () => {
      await getRegistrationsForNumber('+15551234567')

      expect(mockSend).toHaveBeenCalledWith({
        ExpressionAttributeValues: { ':phoneNumber': '+15551234567' },
        KeyConditionExpression: 'phoneNumber = :phoneNumber',
        TableName: 'sms-queue-service-registrations',
      })
    })

    it('should return the items from the query result', async () => {
      const result = await getRegistrationsForNumber('+15551234567')

      expect(result).toEqual([registration])
    })

    it('should return an empty array when there are no items', async () => {
      mockSend.mockResolvedValueOnce({ Items: undefined })
      const result = await getRegistrationsForNumber('+15551234567')

      expect(result).toEqual([])
    })
  })
})
