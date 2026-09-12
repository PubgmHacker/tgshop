export const REQUEST_TIMEOUT_MS = 15_000

/** Covers the response body as well as headers, including older WebViews without AbortSignal.timeout. */
export async function withRequestTimeout<T>(run: (signal: AbortSignal) => Promise<T>, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = new DOMException('Request timed out', 'TimeoutError')
      controller.abort(error)
      reject(error)
    }, timeoutMs)
  })
  try { return await Promise.race([run(controller.signal), timeout]) }
  finally { if (timer !== undefined) clearTimeout(timer) }
}

export async function fetchJsonWithTimeout(url: string, init: RequestInit = {}, timeoutMs = REQUEST_TIMEOUT_MS): Promise<{ response: Response; body: unknown }> {
  return withRequestTimeout(async signal => {
    const response = await fetch(url, { ...init, signal })
    let body: unknown
    try { body = await response.json() }
    catch (error) {
      if (signal.aborted || !(error instanceof SyntaxError)) throw error
      // Non-JSON error pages still expose their HTTP status to the caller.
      body = undefined
    }
    return { response, body }
  }, timeoutMs)
}
