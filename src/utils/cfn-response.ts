import { logError } from './logging'

export type CfnResponseStatus = 'FAILED' | 'SUCCESS'

interface CfnCustomResourceEventLike {
  LogicalResourceId: string
  PhysicalResourceId?: string
  RequestId: string
  ResponseURL: string
  StackId: string
}

export const sendCfnResponse = async (
  event: CfnCustomResourceEventLike,
  status: CfnResponseStatus,
  reason?: string,
  physicalResourceId?: string,
): Promise<void> => {
  const body = JSON.stringify({
    LogicalResourceId: event.LogicalResourceId,
    PhysicalResourceId: physicalResourceId ?? event.PhysicalResourceId ?? event.LogicalResourceId,
    Reason: reason ?? status,
    RequestId: event.RequestId,
    StackId: event.StackId,
    Status: status,
  })
  const response = await fetch(event.ResponseURL, { body, headers: { 'Content-Type': '' }, method: 'PUT' })
  if (!response.ok) {
    logError('Failed to send CloudFormation custom resource response', { status: response.status })
  }
}
