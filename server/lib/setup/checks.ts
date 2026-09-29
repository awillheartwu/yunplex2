import type { DomainErrorCode } from '../../../shared/domain-errors'
import { assertConnectionTestSection, runConnectionTest, type ConnectionTestSection } from '../config/connection-test-runner'
import { ConnectionTestError } from '../config/connection-test-error'

export type SetupCheckKey = ConnectionTestSection
export interface SetupCheckResult {
  key: SetupCheckKey
  ok: boolean
  message: string
  /** Present on failure so the API can keep the exact finding instead of the generic unknown copy. */
  code?: DomainErrorCode
  detail?: Record<string, unknown>
}
export const SETUP_CHECKS: SetupCheckKey[] = ['netease', 'plex', 'download']
export const SETUP_CHECK_LABELS: Record<SetupCheckKey, string> = {
  netease: '网易云 Cookie',
  plex: 'Plex 连接',
  download: '下载目录',
}

export async function runSetupCheck(key: SetupCheckKey, candidate?: unknown): Promise<SetupCheckResult> {
  try {
    const result = await runConnectionTest(key, candidate)
    return { key, ok: true, message: result.message, detail: result.data }
  } catch (error) {
    return {
      key,
      ok: false,
      message: error instanceof Error ? error.message : '连接测试失败',
      code: error instanceof ConnectionTestError ? error.code : 'unknown_error',
    }
  }
}

export async function runRequiredSetupChecks(candidate?: unknown): Promise<SetupCheckResult[]> {
  const results: SetupCheckResult[] = []
  for (const key of SETUP_CHECKS) results.push(await runSetupCheck(key, candidate))
  return results
}

export function assertSetupCheckKey(value: unknown): SetupCheckKey {
  return assertConnectionTestSection(value)
}
