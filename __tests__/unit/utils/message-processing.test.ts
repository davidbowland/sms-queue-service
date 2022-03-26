import { getDataFromRecord, obscurePhoneNumber } from '@utils/message-processing'
import { record } from '../__mocks__'

describe('message-processing', () => {
  describe('getDataFromRecord', () => {
    test('expect correct output', async () => {
      const result = await getDataFromRecord(record)
      expect(result).toEqual({ contents: 'Hello, world!', to: '+15551234567' })
    })
  })

  describe('obscurePhoneNumber', () => {
    test('expect phone number obscured', async () => {
      const result = obscurePhoneNumber('+18005551234')
      expect(result).toEqual('+1800XXX1234')
    })
  })
})
