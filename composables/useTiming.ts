type VoidCallback<Args extends unknown[]> = (...args: Args) => void

export function createDebouncedFunction<Args extends unknown[]>(fn: VoidCallback<Args>, waitMs = 300) {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pendingArgs: Args | null = null

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

  const run = (...args: Args) => {
    if (timer) clearTimeout(timer)
    pendingArgs = args
    timer = setTimeout(() => {
      flush()
    }, waitMs)
  }

  return { run, cancel, flush }
}

export function useDebounceFn<Args extends unknown[]>(fn: VoidCallback<Args>, waitMs = 300) {
  const debounced = createDebouncedFunction(fn, waitMs)
  onUnmounted(debounced.cancel)
  return debounced
}

export function createThrottledFunction<Args extends unknown[]>(fn: VoidCallback<Args>, waitMs = 300) {
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastRun = Number.NEGATIVE_INFINITY
  let pendingArgs: Args | null = null

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

  const run = (...args: Args) => {
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

export function useThrottleFn<Args extends unknown[]>(fn: VoidCallback<Args>, waitMs = 300) {
  const throttled = createThrottledFunction(fn, waitMs)
  onUnmounted(throttled.cancel)
  return throttled
}

export function createRafThrottledFunction<Args extends unknown[]>(fn: VoidCallback<Args>) {
  let frame: ReturnType<typeof setTimeout> | number | null = null
  let frameMode: 'raf' | 'timeout' | null = null
  let pendingArgs: Args | null = null

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

  const run = (...args: Args) => {
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

export function useRafThrottleFn<Args extends unknown[]>(fn: VoidCallback<Args>) {
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

export function createTimeoutFunction<Args extends unknown[]>(fn: VoidCallback<Args>, waitMs = 300) {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pendingArgs: Args | null = null

  const cancel = () => {
    if (timer) clearTimeout(timer)
    timer = null
    pendingArgs = null
  }

  const schedule = (...args: Args) => {
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

export function useTimeoutFn<Args extends unknown[]>(fn: VoidCallback<Args>, waitMs = 300) {
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
