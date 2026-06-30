import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createDebouncedFunction,
  createIntervalFunction,
  createThrottledFunction,
  createTimeoutFunction,
} from '../../composables/useTiming'

describe('timing helpers', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('debounces repeated calls and keeps the latest arguments', () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const debounced = createDebouncedFunction(fn, 300)

    debounced.run('first')
    debounced.run('second')
    vi.advanceTimersByTime(299)
    expect(fn).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('second')
  })

  it('cancels a pending debounced call', () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const debounced = createDebouncedFunction(fn, 300)

    debounced.run('value')
    debounced.cancel()
    vi.advanceTimersByTime(300)

    expect(fn).not.toHaveBeenCalled()
  })

  it('throttles bursts and flushes the latest trailing call', () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const fn = vi.fn()
    const throttled = createThrottledFunction(fn, 100)

    throttled.run('a')
    expect(fn).toHaveBeenCalledWith('a')

    vi.advanceTimersByTime(10)
    throttled.run('b')
    vi.advanceTimersByTime(10)
    throttled.run('c')

    vi.advanceTimersByTime(79)
    expect(fn).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(1)
    expect(fn).toHaveBeenCalledTimes(2)
    expect(fn).toHaveBeenLastCalledWith('c')
  })

  it('schedules cancellable one-shot timeouts', () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const timeout = createTimeoutFunction(fn, 100)

    timeout.schedule('first')
    timeout.schedule('second')
    vi.advanceTimersByTime(99)
    expect(fn).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('second')

    timeout.schedule('third')
    timeout.cancel()
    vi.advanceTimersByTime(100)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('starts, stops, and restarts intervals', () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const interval = createIntervalFunction(fn, 100)

    interval.start()
    vi.advanceTimersByTime(250)
    expect(fn).toHaveBeenCalledTimes(2)

    interval.stop()
    vi.advanceTimersByTime(250)
    expect(fn).toHaveBeenCalledTimes(2)

    interval.restart(50)
    vi.advanceTimersByTime(120)
    expect(fn).toHaveBeenCalledTimes(4)
  })
})
