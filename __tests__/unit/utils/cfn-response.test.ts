import { sendCfnResponse } from '@utils/cfn-response'

describe('cfn-response', () => {
  const event = {
    LogicalResourceId: 'TwoWaySmsCustomResource',
    PhysicalResourceId: 'phone-abc123',
    RequestId: 'request-1',
    ResponseURL: 'https://example.com/cfn-response',
    StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/my-stack/abc',
  }

  beforeAll(() => {
    global.fetch = jest.fn().mockResolvedValue(undefined)
  })

  it('should PUT a response to the response URL', async () => {
    await sendCfnResponse(event, 'SUCCESS', undefined, 'phone-abc123')

    expect(fetch).toHaveBeenCalledWith('https://example.com/cfn-response', expect.objectContaining({ method: 'PUT' }))
  })

  it('should include the status and reason in the body', async () => {
    await sendCfnResponse(event, 'FAILED', 'boom')

    const [, options] = jest.mocked(fetch).mock.calls[0]
    const body = JSON.parse(options?.body as string)
    expect(body).toMatchObject({ Reason: 'boom', Status: 'FAILED' })
  })

  it('should default the physical resource id to the event value when not provided', async () => {
    await sendCfnResponse(event, 'SUCCESS')

    const [, options] = jest.mocked(fetch).mock.calls[0]
    const body = JSON.parse(options?.body as string)
    expect(body).toMatchObject({ PhysicalResourceId: 'phone-abc123' })
  })
})
