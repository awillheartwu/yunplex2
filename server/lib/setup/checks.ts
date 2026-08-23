import { assertConnectionTestSection, runConnectionTest, type ConnectionTestSection } from '../config/connection-test-runner'

export type SetupCheckKey = ConnectionTestSection
export interface SetupCheckResult { key: SetupCheckKey; ok: boolean; message: string; detail?: Record<string, unknown> }
export const SETUP_CHECKS: SetupCheckKey[] = ['netease', 'plex', 'download']

export async function runSetupCheck(key: SetupCheckKey, candidate?: unknown): Promise<SetupCheckResult> {
  try {
    const result = await runConnectionTest(key, candidate)
    return { key, ok: true, message: result.message, detail: result.data }
  } catch (error) {
    return { key, ok: false, message: error instanceof Error ? error.message : '连接测试失败' }
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
