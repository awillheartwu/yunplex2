export function createDebouncedFunction<T extends (...args: any[]) => void>(fn: T, waitMs = 300) {
  let timer: ReturnType<typeof setTimeout> | null = null

  const cancel = () => {
    if (timer) clearTimeout(timer)
    timer = null
  }

  const run = (...args: Parameters<T>) => {
    cancel()
    timer = setTimeout(() => {
      timer = null
      fn(...args)
    }, waitMs)
  }

  return { run, cancel }
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
