import { MatchResult, PinpointInboundSmsMessage, Registration, RoutedSmsMessage } from '../types'

/* Keyword matching */

export const extractCandidateKeyword = (messageBody: string): string | undefined => {
  const firstWord = messageBody.trim().split(/\s+/)[0]
  return firstWord ? firstWord.toUpperCase() : undefined
}

const stripKeyword = (messageBody: string, keyword: string): string => messageBody.trim().slice(keyword.length).trim()

export const matchRegistration = (registrations: Registration[], messageBody: string): MatchResult | undefined => {
  const candidateKeyword = extractCandidateKeyword(messageBody)
  if (candidateKeyword) {
    const keywordMatch = registrations.find((registration) => registration.ruleKey === `KEYWORD#${candidateKeyword}`)
    if (keywordMatch) {
      return {
        body: stripKeyword(messageBody, candidateKeyword),
        consumerId: keywordMatch.consumerId,
        keyword: candidateKeyword,
        matchType: 'KEYWORD',
      }
    }
  }

  const defaultMatch = registrations.find((registration) => registration.ruleKey === 'DEFAULT')
  if (defaultMatch) {
    return {
      body: messageBody.trim(),
      consumerId: defaultMatch.consumerId,
      matchType: 'DEFAULT',
    }
  }

  return undefined
}

/* Routed message */

export const buildRoutedMessage = (
  message: PinpointInboundSmsMessage,
  match: MatchResult,
  now: () => string = () => new Date().toISOString(),
): RoutedSmsMessage => ({
  body: match.body,
  destinationNumber: message.destinationNumber,
  inboundMessageId: message.inboundMessageId,
  keyword: match.keyword,
  matchType: match.matchType,
  phoneNumber: message.originationNumber,
  receivedAt: now(),
})
