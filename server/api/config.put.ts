import { writeConfig } from '../lib/config/store'
import { success, fail } from '../lib/response'
import { getSyncWorker } from '../lib/sync/instance'

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event)
    if (!body || typeof body !== 'object') {
      return fail('请求体格式错误')
    }
    const updated = writeConfig(body)
    const worker = getSyncWorker()
    if (worker) {
      worker.update()
    }
    return success(updated, '配置保存成功')
  } catch (err) {
    const message = err instanceof Error ? err.message : '保存配置失败'
    return fail(message)
  }
})
