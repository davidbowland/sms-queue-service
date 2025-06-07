import { record } from '../__mocks__'
import { getDataFromRecord, obscurePhoneNumber } from '@utils/message-processing'

describe('message-processing', () => {
  describe('getDataFromRecord', () => {
    it('should return correct output', async () => {
      const result = await getDataFromRecord(record)

      expect(result).toEqual({ contents: 'Hello, world!', to: '+15551234567' })
    })
  })

  describe('obscurePhoneNumber', () => {
    it('should obscure phone number', async () => {
      const result = obscurePhoneNumber('+18005551234')

      expect(result).toEqual('+1800XXX1234')
    })
  })
})
