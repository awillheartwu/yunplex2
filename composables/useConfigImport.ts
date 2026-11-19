import type { AppConfig } from '~~/server/lib/config/types'

export function useConfigImport(loadConfig: () => Promise<void>) {
  const api = useApi()
  const feedback = useFeedback()

  const showImportTextarea = ref(false)
  const importJson = ref('')
  const importing = ref(false)
  const importResult = ref<{ ok: boolean; msg: string } | null>(null)

  async function handleFileImport(e: Event) {
    const input = e.target as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return

    try {
      const text = await file.text()
      const parsed = JSON.parse(text)
      await doImport(parsed, { toastFailure: true })
    } catch (err) {
      const message = '文件解析失败: ' + (err instanceof Error ? err.message : 'JSON 格式错误')
      importResult.value = { ok: false, msg: message }
      feedback.error('配置导入失败', message)
    } finally {
      input.value = ''
    }
  }

  async function handleImportJson() {
    if (!importJson.value) return
    try {
      const parsed = JSON.parse(importJson.value)
      await doImport(parsed, { toastFailure: false })
    } catch (err) {
      const message = 'JSON 解析失败: ' + (err instanceof Error ? err.message : '格式错误')
      importResult.value = { ok: false, msg: message }
    }
  }

  async function doImport(data: unknown, options: { toastFailure: boolean }) {
    importing.value = true
    importResult.value = null
    try {
      await api.post('/config/import', data)
      importResult.value = { ok: true, msg: '配置导入成功' }
      importJson.value = ''
      showImportTextarea.value = false
      await loadConfig()
      feedback.success('配置导入成功')
    } catch (err) {
      const message = '导入失败: ' + (err instanceof Error ? err.message : '未知错误')
      importResult.value = { ok: false, msg: message }
      if (options.toastFailure) feedback.error('配置导入失败', message)
    } finally {
      importing.value = false
    }
  }

  function handleExport(form: AppConfig | null) {
    if (!form) return
    const blob = new Blob([JSON.stringify(form, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'yunplex2-config.json'
    a.click()
    URL.revokeObjectURL(url)
    feedback.success('配置已导出')
  }

  return {
    showImportTextarea,
    importJson,
    importing,
    importResult,
    handleFileImport,
    handleImportJson,
    handleExport,
  }
}
