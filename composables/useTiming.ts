export function createDebouncedFunction<T extends (...args: any[]) => void>(fn: T, waitMs = 300) {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pendingArgs: Parameters<T> | null = null

  const cancel = () => {
    if (timer) clearTimeout(timer)
    timer = null
    pendingArgs = null
  }

  const flush = () => {
    if (!pendingArgs) return
    if (timer) clearTimeout(timer)
    timer = null
    const args = pendingArgs
    pendingArgs = null
    fn(...args)
  }

  const run = (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer)
    pendingArgs = args
    timer = setTimeout(() => {
      flush()
    }, waitMs)
  }

  return { run, cancel, flush }
}

export function useDebounceFn<T extends (...args: any[]) => void>(fn: T, waitMs = 300) {
  const debounced = createDebouncedFunction(fn, waitMs)
  onUnmounted(debounced.cancel)
  return debounced
}

export function createThrottledFunction<T extends (...args: any[]) => void>(fn: T, waitMs = 300) {
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastRun = Number.NEGATIVE_INFINITY
  let pendingArgs: Parameters<T> | null = null

  const cancel = () => {
    if (timer) clearTimeout(timer)
    timer = null
    pendingArgs = null
  }

  const flush = () => {
    if (!pendingArgs) return
    lastRun = Date.now()
    const args = pendingArgs
    pendingArgs = null
    fn(...args)
  }

  const run = (...args: Parameters<T>) => {
    const now = Date.now()
    const remaining = waitMs - (now - lastRun)
    pendingArgs = args

    if (remaining <= 0 || remaining > waitMs) {
      if (timer) clearTimeout(timer)
      timer = null
      flush()
      return
    }

    if (!timer) {
      timer = setTimeout(() => {
        timer = null
        flush()
      }, remaining)
    }
  }

  return { run, cancel, flush }
}

export function useThrottleFn<T extends (...args: any[]) => void>(fn: T, waitMs = 300) {
  const throttled = createThrottledFunction(fn, waitMs)
  onUnmounted(throttled.cancel)
  return throttled
}

export function createRafThrottledFunction<T extends (...args: any[]) => void>(fn: T) {
  let frame: ReturnType<typeof setTimeout> | number | null = null
  let frameMode: 'raf' | 'timeout' | null = null
  let pendingArgs: Parameters<T> | null = null

  const cancel = () => {
    if (frame !== null) {
      if (frameMode === 'raf' && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(frame as number)
      else clearTimeout(frame as ReturnType<typeof setTimeout>)
    }
    frame = null
    frameMode = null
    pendingArgs = null
  }

  const flush = () => {
    if (!pendingArgs) return
    if (frame !== null) {
      if (frameMode === 'raf' && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(frame as number)
      else clearTimeout(frame as ReturnType<typeof setTimeout>)
    }
    frame = null
    frameMode = null
    const args = pendingArgs
    pendingArgs = null
    fn(...args)
  }

  const run = (...args: Parameters<T>) => {
    pendingArgs = args
    if (frame !== null) return

    if (typeof requestAnimationFrame === 'undefined') {
      frame = setTimeout(() => {
        frame = null
        frameMode = null
        flush()
      }, 16)
      frameMode = 'timeout'
      return
    }

    frame = requestAnimationFrame(() => {
      frame = null
      frameMode = null
      flush()
    })
    frameMode = 'raf'
  }

  return { run, cancel, flush }
}

export function useRafThrottleFn<T extends (...args: any[]) => void>(fn: T) {
  const throttled = createRafThrottledFunction(fn)
  onUnmounted(throttled.cancel)
  return throttled
}

export function createLatestAsyncGuard() {
  let latestToken = 0

  const next = () => {
    latestToken += 1
    return latestToken
  }

  const isLatest = (token: number) => token === latestToken

  const cancel = () => {
    latestToken += 1
  }

  return { next, isLatest, cancel }
}

export function useLatestAsyncGuard() {
  const guard = createLatestAsyncGuard()
  onUnmounted(guard.cancel)
  return guard
}

export function createTimeoutFunction<T extends (...args: any[]) => void>(fn: T, waitMs = 300) {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pendingArgs: Parameters<T> | null = null

  const cancel = () => {
    if (timer) clearTimeout(timer)
    timer = null
    pendingArgs = null
  }

  const schedule = (...args: Parameters<T>) => {
    cancel()
    pendingArgs = args
    timer = setTimeout(() => {
      timer = null
      const nextArgs = pendingArgs
      pendingArgs = null
      if (nextArgs) fn(...nextArgs)
    }, waitMs)
  }

  return { schedule, cancel }
}

export function useTimeoutFn<T extends (...args: any[]) => void>(fn: T, waitMs = 300) {
  const timeout = createTimeoutFunction(fn, waitMs)
  onUnmounted(timeout.cancel)
  return timeout
}

export function createIntervalFunction(fn: () => void, waitMs = 3000) {
  let timer: ReturnType<typeof setInterval> | null = null

  const stop = () => {
    if (timer) clearInterval(timer)
    timer = null
  }

  const start = (nextWaitMs = waitMs) => {
    if (timer) return
    timer = setInterval(fn, nextWaitMs)
  }

  const restart = (nextWaitMs = waitMs) => {
    stop()
    start(nextWaitMs)
  }

  return { start, stop, restart }
}

export function useIntervalFn(fn: () => void, waitMs = 3000) {
  const interval = createIntervalFunction(fn, waitMs)
  onUnmounted(interval.stop)
  return interval
}
