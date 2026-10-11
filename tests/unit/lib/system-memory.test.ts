import { describe, expect, it } from 'vitest'
import { buildMemoryDetails, exactMemoryBytes, formatMemoryBytes, formatMemoryMiB, memoryBytes } from '~~/lib/system-memory'
import { MEBIBYTE } from '~~/shared/system-memory'

describe('memory display semantics', () => {
  it('uses raw bytes before the rounded legacy value, including an actual zero', () => {
    const input = { memory: { rss: 937.75 * MEBIBYTE, arrayBuffers: 0 }, mem: { rss: 938, arrayBuffers: 1 } }
    expect(memoryBytes(input, 'rss')).toBe(937.75 * MEBIBYTE)
    expect(formatMemoryMiB(memoryBytes(input, 'rss')! / MEBIBYTE)).toBe('937.8 MiB')
    expect(memoryBytes(input, 'arrayBuffers')).toBe(0)
    expect(exactMemoryBytes(input, 'rss')).toBe('983,302,144 B')
  })

  it('keeps older responses readable without inventing missing counters or byte precision', () => {
    const input = { mem: { rss: 938, heapUsed: 40, heapTotal: 45, external: 3 } }
    expect(memoryBytes(input, 'rss')).toBe(938 * MEBIBYTE)
    expect(memoryBytes(input, 'arrayBuffers')).toBeNull()
    expect(exactMemoryBytes(input, 'rss')).toBeUndefined()
    expect(buildMemoryDetails(input)).toMatchObject({
      modeLabel: '运行模式未知', threadLabel: '采样线程未知',
      metrics: [{ value: '938.0 MiB' }, { value: '40.0 MiB' }, { value: '3.0 MiB' }, { value: '--' }],
    })
  })

  it('shows small buffers in binary units and distinguishes unknown from zero', () => {
    expect(formatMemoryBytes(1536)).toBe('1.5 KiB')
    expect(formatMemoryBytes(MEBIBYTE)).toBe('1.0 MiB')
    expect(formatMemoryBytes(0)).toBe('0 B')
    expect(formatMemoryBytes(null)).toBe('--')
    expect(formatMemoryMiB(undefined)).toBe('--')
    expect(memoryBytes({ memory: { rss: NaN, external: -1 } }, 'rss')).toBeNull()
    expect(memoryBytes({ memory: { external: -1 } }, 'external')).toBeNull()
    expect(buildMemoryDetails(null)).toBeNull()
  })

  it('keeps worker heap and overlapping buffer counters separate from process RSS', () => {
    const input = {
      memory: { rss: 938 * MEBIBYTE, heapUsed: 40 * MEBIBYTE, heapTotal: 45 * MEBIBYTE, external: 3 * MEBIBYTE, arrayBuffers: 1536 },
      memoryContext: { mode: 'development', rssScope: 'process', detailsScope: 'thread', isMainThread: false, threadId: 2 } as const,
    }
    const details = buildMemoryDetails(input)!
    expect(details).toMatchObject({ modeLabel: '开发模式', threadLabel: '工作线程 #2' })
    expect(details.metrics.map(metric => metric.value)).toEqual(['938.0 MiB', '40.0 MiB', '3.0 MiB', '1.5 KiB'])
    expect(details.metrics[1]?.description).toContain('已分配 45.0 MiB')
    expect(details.metrics[3]?.description).toContain('已包含在外部内存中')
    expect(details.metrics[3]?.exactValue).toBe('1,536 B')
    expect(buildMemoryDetails({ ...input, memoryContext: { ...input.memoryContext, mode: 'production', isMainThread: true, threadId: 0 } })).toMatchObject({
      modeLabel: '生产模式', threadLabel: '主线程 #0',
    })
  })
})
