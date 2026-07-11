import { PublishCommand, SNSClient } from '@aws-sdk/client-sns'

import { routedTopicArn } from '../config'
import { RoutedSmsMessage } from '../types'
import { xrayCapture } from '../utils/logging'

const sns = xrayCapture(new SNSClient({}))

export const publishRoutedMessage = async (consumerId: string, message: RoutedSmsMessage): Promise<void> => {
  const command = new PublishCommand({
    Message: JSON.stringify(message),
    MessageAttributes: {
      consumerId: {
        DataType: 'String',
        StringValue: consumerId,
      },
    },
    TopicArn: routedTopicArn,
  })
  await sns.send(command)
}
