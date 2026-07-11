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
  await fetch(event.ResponseURL, { body, method: 'PUT' })
}
