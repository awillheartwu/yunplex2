import { MEBIBYTE, type MemorySamplingContext, type ProcessMemoryBytes, type RoundedMemoryMiB } from '../shared/system-memory'

export interface SystemMemoryInput {
  memory?: Partial<ProcessMemoryBytes>
  memoryContext?: MemorySamplingContext
  /** Compatibility with older stats responses, in rounded MiB. */
  mem?: Partial<RoundedMemoryMiB>
}

export interface SystemMemoryMetric {
  key: 'rss' | 'heapUsed' | 'external' | 'arrayBuffers'
  label: string
  value: string
  detail: string
  description: string
  exactValue: string | undefined
}

export interface SystemMemoryDetails {
  modeLabel: string
  threadLabel: string
  metrics: SystemMemoryMetric[]
}

function validSize(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

export function memoryBytes(input: SystemMemoryInput | null, key: keyof ProcessMemoryBytes): number | null {
  const bytes = input?.memory?.[key]
  if (validSize(bytes)) return bytes
  const mib = input?.mem?.[key]
  return validSize(mib) ? mib * MEBIBYTE : null
}

export function formatMemoryMiB(mib: number | null | undefined): string {
  return validSize(mib) ? `${mib.toFixed(1)} MiB` : '--'
}

export function formatMemoryBytes(bytes: number | null): string {
  if (!validSize(bytes)) return '--'
  if (bytes === 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < MEBIBYTE) return `${(bytes / 1024).toFixed(1)} KiB`
  return formatMemoryMiB(bytes / MEBIBYTE)
}

export function exactMemoryBytes(input: SystemMemoryInput | null, key: keyof ProcessMemoryBytes): string | undefined {
  const bytes = input?.memory?.[key]
  return validSize(bytes) ? `${bytes.toLocaleString('zh-CN')} B` : undefined
}

export function buildMemoryDetails(input: SystemMemoryInput | null): SystemMemoryDetails | null {
  if (!input) return null
  const context = input.memoryContext
  const modes = { development: '开发模式', production: '生产模式', unknown: '运行模式未知' }
  const heapUsed = memoryBytes(input, 'heapUsed')
  const heapTotal = memoryBytes(input, 'heapTotal')
  const exactUsed = exactMemoryBytes(input, 'heapUsed')
  const exactTotal = exactMemoryBytes(input, 'heapTotal')
  return {
    modeLabel: modes[context?.mode ?? 'unknown'],
    threadLabel: context
      ? context.isMainThread ? '主线程 #0' : `工作线程 #${context.threadId}`
      : '采样线程未知',
    metrics: [
      {
        key: 'rss', label: 'RSS',
        value: formatMemoryBytes(memoryBytes(input, 'rss')), detail: '全部线程',
        description: '当前进程的驻留内存，含全部线程，不含独立子进程。'
          + (context?.mode === 'development' ? '同一进程中的编译与热更新开销也计入 RSS。' : ''),
        exactValue: exactMemoryBytes(input, 'rss'),
      },
      {
        key: 'heapUsed', label: '堆',
        value: formatMemoryBytes(heapUsed), detail: '当前线程',
        description: `当前线程的 JavaScript 堆已用量；已分配 ${formatMemoryBytes(heapTotal)}。`,
        exactValue: exactUsed && exactTotal ? `已用 ${exactUsed} / 已分配 ${exactTotal}` : undefined,
      },
      {
        key: 'external', label: '外部', value: formatMemoryBytes(memoryBytes(input, 'external')),
        detail: '当前线程', description: '与当前线程 JavaScript 对象关联的原生分配，已包含缓冲区内存。',
        exactValue: exactMemoryBytes(input, 'external'),
      },
      {
        key: 'arrayBuffers', label: '缓冲', value: formatMemoryBytes(memoryBytes(input, 'arrayBuffers')),
        detail: '当前线程', description: '当前线程的 Buffer / ArrayBuffer 内存，已包含在外部内存中，不能重复相加。',
        exactValue: exactMemoryBytes(input, 'arrayBuffers'),
      },
    ],
  }
}
