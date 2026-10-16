import type { Ref } from 'vue'
import type { AppConfig, StorageVisibilityDiagnostic } from '~~/server/lib/config/types'

type ConnectionSection = 'netease' | 'plex' | 'download'
export interface ConfigConnectionResult { ok: boolean; message: string }

export function useConfigConnections(form: Ref<AppConfig | null>) {
  const api = useApi()
  const feedback = useFeedback()
  const testing = ref({ netease: false, plex: false, download: false })
  const testResult = ref<Partial<Record<ConnectionSection, ConfigConnectionResult>>>({})
  const storageDiagnostic = ref<StorageVisibilityDiagnostic | null>(null)
  const requests = { netease: 0, plex: 0, download: 0 }
  const labels = { netease: '网易云音乐', plex: 'Plex', download: '下载目录' }
  let disposed = false

  function fingerprint(section: ConnectionSection): string {
    const config = form.value
    if (!config) return ''
    if (section === 'netease') return config.netease.cookie
    if (section === 'plex') return JSON.stringify(config.plex)
    return JSON.stringify({
      plex: config.plex,
      dir: config.download.dir,
      prefix: config.download.plexLibraryPathPrefix,
    })
  }

  for (const section of ['netease', 'plex', 'download'] as const) {
    watch(() => fingerprint(section), () => {
      requests[section]++
      testing.value[section] = false
      delete testResult.value[section]
      if (section !== 'netease') storageDiagnostic.value = null
    }, { flush: 'sync' })
  }

  async function testConnection(section: ConnectionSection, notify = true) {
    if (!form.value || testing.value[section]) return
    const config = JSON.parse(JSON.stringify(form.value)) as AppConfig
    const current = ++requests[section]
    const currentFingerprint = fingerprint(section)
    const storageFingerprint = fingerprint('download')
    const isCurrent = () => !disposed && current === requests[section] && currentFingerprint === fingerprint(section)
    testing.value[section] = true
    delete testResult.value[section]
    try {
      const result = await api.post<{ storageVisibility?: StorageVisibilityDiagnostic }>('/config/test-connection', { section, config })
      if (!isCurrent()) return
      if (result.storageVisibility && storageFingerprint === fingerprint('download')) storageDiagnostic.value = result.storageVisibility
      const message = section === 'download' ? '下载目录可写' : `${labels[section]}连接正常`
      testResult.value[section] = { ok: true, message }
      if (notify) {
        if (section === 'download' && result.storageVisibility?.status === 'warning') {
          feedback.warning(message, result.storageVisibility.summary)
        } else feedback.success(message)
      }
    } catch (error) {
      if (!isCurrent()) return
      const message = error instanceof Error ? error.message : '请检查设置后重试'
      testResult.value[section] = { ok: false, message }
      feedback.error(`${labels[section]}检查失败`, message)
    } finally {
      if (isCurrent()) testing.value[section] = false
    }
  }

  onBeforeUnmount(() => { disposed = true })
  return { testing, testResult, storageDiagnostic, testConnection }
}
