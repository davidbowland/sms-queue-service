import { MatchResult, PinpointInboundSmsMessage, Registration, RoutedSmsMessage } from '../types'

/* Keyword matching */

export const extractCandidateKeyword = (messageBody: string): string | undefined => {
  const firstWord = messageBody.trim().split(/\s+/)[0]
  return firstWord ? firstWord.toUpperCase() : undefined
}

// Strip the leading non-whitespace token from the original string (not a length-based slice off
// the uppercased keyword) since some Unicode characters change length when uppercased (e.g. German
// "ß" -> "SS"), which would make a length-based slice off-by-one-or-more against the original body.
const stripKeyword = (messageBody: string): string => messageBody.trim().replace(/^\S+/, '').trim()

export const matchRegistration = (registrations: Registration[], messageBody: string): MatchResult | undefined => {
  const candidateKeyword = extractCandidateKeyword(messageBody)
  if (candidateKeyword) {
    const keywordMatch = registrations.find((registration) => registration.ruleKey === `KEYWORD#${candidateKeyword}`)
    if (keywordMatch) {
      return {
        body: stripKeyword(messageBody),
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
