import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb'

import { registrationsTableName } from '../config'
import { Registration } from '../types'
import { xrayCapture } from '../utils/logging'

const dynamoDb = xrayCapture(DynamoDBDocumentClient.from(new DynamoDBClient({})))

export const getRegistrationsForNumber = async (phoneNumber: string): Promise<Registration[]> => {
  const command = new QueryCommand({
    ExpressionAttributeValues: { ':phoneNumber': phoneNumber },
    KeyConditionExpression: 'phoneNumber = :phoneNumber',
    TableName: registrationsTableName,
  })
  const result = await dynamoDb.send(command)
  return (result.Items ?? []) as Registration[]
}
