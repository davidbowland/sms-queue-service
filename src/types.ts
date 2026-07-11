export * from 'aws-lambda'

export type MessageType = 'PROMOTIONAL' | 'TRANSACTIONAL'

export interface SMSMessage {
  to: string
  contents: string
  messageType?: MessageType
}

export interface Registration {
  phoneNumber: string
  ruleKey: string
  consumerId: string
}

export interface PinpointInboundSmsMessage {
  originationNumber: string
  destinationNumber: string
  messageBody: string
  messageKeyword?: string
  inboundMessageId: string
  previousPublishedMessageId?: string
}

export type MatchType = 'KEYWORD' | 'DEFAULT'

export interface MatchResult {
  matchType: MatchType
  consumerId: string
  keyword?: string
  body: string
}

export interface RoutedSmsMessage {
  phoneNumber: string
  destinationNumber: string
  body: string
  matchType: MatchType
  keyword?: string
  inboundMessageId: string
  receivedAt: string
}
