import { AsyncLocalStorage } from 'node:async_hooks'

const context = new AsyncLocalStorage<AbortSignal>()

/** External calls follow their source or independent file task's own signal. */
export function withExternalRequestSignal<T>(signal: AbortSignal, action: () => Promise<T>): Promise<T> {
  return context.run(signal, action)
}

export function getExternalRequestSignal(): AbortSignal | undefined {
  return context.getStore()
}
