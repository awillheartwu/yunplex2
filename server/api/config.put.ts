import { readConfig, writeConfig } from '../lib/config/store'
import { success, fail } from '../lib/response'
import { getSyncWorker } from '../lib/sync/instance'
import { recordActivityEvent } from '../lib/activity/store'

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event)
    if (!body || typeof body !== 'object') {
      return fail('请求体格式错误')
    }
    const previous = readConfig()
    const updated = writeConfig(body)
    const worker = getSyncWorker()
    if (worker) {
      worker.update()
    }
    const changedKeys = Object.keys(body as Record<string, unknown>)
      .filter((key) => JSON.stringify((updated as Record<string, unknown>)[key]) !== JSON.stringify((previous as Record<string, unknown>)[key]))
    recordActivityEvent({
      domain: 'user',
      type: 'config_updated',
      severity: 'info',
      actor: 'user',
      title: '更新系统配置',
      summary: changedKeys.length > 0 ? `本次保存涉及 ${changedKeys.join('、')}` : '配置已重新保存，运行中的调度器会自动热更新。',
      context: { changedKeys },
      link: '/config',
      groupKey: 'config:update',
    })
    return success(updated, '配置保存成功')
  } catch (err) {
    const message = err instanceof Error ? err.message : '保存配置失败'
    return fail(message)
  }
})
