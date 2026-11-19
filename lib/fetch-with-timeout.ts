export async function fetchWithTimeout<T>(url: string, options: RequestInit, timeoutMs: number, consume: (response: Response) => Promise<T>): Promise<T> {
  const controller = new AbortController()
  const abort = () => controller.abort()
  if (options.signal?.aborted) controller.abort()
  else options.signal?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(abort, timeoutMs)
  try {
    const response = await fetch(url, { ...options, signal: controller.signal })
    // Keep the deadline active while reading the body, not only response headers.
    return await consume(response)
  } catch (error) {
    if (controller.signal.aborted) throw new Error('请求超时或已取消，请重试', { cause: error })
    throw error
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', abort)
  }
}
