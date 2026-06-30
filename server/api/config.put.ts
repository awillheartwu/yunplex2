import { success, fail } from '../lib/response'
import { applyConfigUpdate } from '../lib/config/apply'

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event)
    if (!body || typeof body !== 'object') {
      return fail('请求体格式错误')
    }
    const { updated } = applyConfigUpdate(body, {
      title: '更新系统配置',
      type: 'config_updated',
      summaryWhenChanged: (changedKeys) => `本次保存涉及 ${changedKeys.join('、')}`,
      summaryWhenUnchanged: '配置已重新保存，运行中的调度器会自动热更新。',
      groupKey: 'config:update',
    })
    return success(updated, '配置保存成功')
  } catch (err) {
    const message = err instanceof Error ? err.message : '保存配置失败'
    return fail(message)
  }
})
