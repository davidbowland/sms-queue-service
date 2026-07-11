import { defaultRegistration, keywordRegistration, pinpointInboundMessage } from '../__mocks__'
import { buildRoutedMessage, extractCandidateKeyword, matchRegistration } from '@utils/message-routing'

describe('message-routing', () => {
  describe('extractCandidateKeyword', () => {
    it('should return the first word uppercased', () => {
      const result = extractCandidateKeyword('garage open the gate')

      expect(result).toEqual('GARAGE')
    })

    it('should uppercase a mixed-case keyword', () => {
      const result = extractCandidateKeyword('GaRaGe open the gate')

      expect(result).toEqual('GARAGE')
    })

    it('should return undefined for an empty message', () => {
      const result = extractCandidateKeyword('   ')

      expect(result).toBeUndefined()
    })
  })

  describe('matchRegistration', () => {
    it('should match a registered keyword and strip it from the body', () => {
      const result = matchRegistration([keywordRegistration], 'GARAGE open the gate')

      expect(result).toEqual({
        body: 'open the gate',
        consumerId: 'garage-app',
        keyword: 'GARAGE',
        matchType: 'KEYWORD',
      })
    })

    it('should match a keyword regardless of message casing', () => {
      const result = matchRegistration([keywordRegistration], 'garage open the gate')

      expect(result).toEqual({
        body: 'open the gate',
        consumerId: 'garage-app',
        keyword: 'GARAGE',
        matchType: 'KEYWORD',
      })
    })

    it('should fall back to the default registration when no keyword matches', () => {
      const result = matchRegistration([defaultRegistration], 'hello there')

      expect(result).toEqual({
        body: 'hello there',
        consumerId: 'garage-app',
        matchType: 'DEFAULT',
      })
    })

    it('should prefer a keyword match over a default registration', () => {
      const result = matchRegistration([defaultRegistration, keywordRegistration], 'GARAGE open the gate')

      expect(result).toEqual({
        body: 'open the gate',
        consumerId: 'garage-app',
        keyword: 'GARAGE',
        matchType: 'KEYWORD',
      })
    })

    it('should return undefined when nothing matches', () => {
      const result = matchRegistration([], 'hello there')

      expect(result).toBeUndefined()
    })

    it('should return undefined when only an unrelated keyword is registered', () => {
      const result = matchRegistration([keywordRegistration], 'PARKING open the gate')

      expect(result).toBeUndefined()
    })
  })

  describe('buildRoutedMessage', () => {
    const match = {
      body: 'open the gate',
      consumerId: 'garage-app',
      keyword: 'GARAGE',
      matchType: 'KEYWORD' as const,
    }

    it('should build a routed message using the injected clock', () => {
      const result = buildRoutedMessage(pinpointInboundMessage, match, () => '2026-07-11T12:00:00.000Z')

      expect(result).toEqual({
        body: 'open the gate',
        destinationNumber: '+18449163034',
        inboundMessageId: 'aaaa-bbbb-cccc-dddd',
        keyword: 'GARAGE',
        matchType: 'KEYWORD',
        phoneNumber: '+15551234567',
        receivedAt: '2026-07-11T12:00:00.000Z',
      })
    })

    it('should default matchType DEFAULT matches to no keyword', () => {
      const result = buildRoutedMessage(
        pinpointInboundMessage,
        { body: 'hello', consumerId: 'garage-app', matchType: 'DEFAULT' },
        () => '2026-07-11T12:00:00.000Z',
      )

      expect(result.keyword).toBeUndefined()
    })

    it('should default the clock to the current time when now is not injected', () => {
      const result = buildRoutedMessage(pinpointInboundMessage, match)

      expect(result.receivedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    })
  })
})
