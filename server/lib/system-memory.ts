import { isMainThread, threadId } from 'node:worker_threads'
import type { ProcessMemorySample } from '../../shared/system-memory'

export function getProcessMemorySample(): ProcessMemorySample {
  const nodeEnv = process.env.NODE_ENV
  return {
    memory: process.memoryUsage(),
    memoryContext: {
      mode: nodeEnv === 'development' || nodeEnv === 'production' ? nodeEnv : 'unknown',
      rssScope: 'process',
      detailsScope: 'thread',
      isMainThread,
      threadId,
    },
  }
}
