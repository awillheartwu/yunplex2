import { stat } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import type { AppConfig } from '../config/types'
import { getDataDir, readConfig } from '../config/store'
import { assertDownloadDirWritable, extractPlexMusicSection } from '../config/connection-test'
import { checkCookie } from '../netease'
import { createPlexHttpClient } from '../plex-http'
import { getDb } from '../db'
import { getDownloadQueueControl, pauseDownloadQueue, resumeDownloadQueue } from './queue-control'
import { getFilesystemRecoveryTasks, recoverDueFileTasks, wakeEnvironmentFileTasks } from './recovery'
import { requestDownloadProcessing, resolveDownloadTaskConfig } from './worker'
import { recoverSourceAfterEnvironmentRepair } from '../sync/recovery'
import { rearmEnvironmentFailures } from '../tasks/failure-records'
import { confirmNeteaseAuthentication } from '../tasks/completion'
import { getEnvironmentProblems, type EnvironmentProblem } from '../tasks/recovery-targets'

const ENVIRONMENT_CODES = {
  authentication: 'authentication_failed',
  plex_authentication: 'plex_authentication_failed',
  filesystem: 'filesystem_failed',
} as const
type RecoveryEnvironment = keyof typeof ENVIRONMENT_CODES
interface DirectoryTarget { directory: string; root: string }
interface EnvironmentScope {
  reason: RecoveryEnvironment
  key: string
  problems: EnvironmentProblem[]
  directories: DirectoryTarget[]
}

/** Pending writes keep their saved destinations when the global default changes. */
function fileDestinations(config: AppConfig): DirectoryTarget[] {
  const directories = new Map<string, string>()
  for (const task of getFilesystemRecoveryTasks(config)) {
    const execution = resolveDownloadTaskConfig(task, config)
    const root = resolve(execution.downloadDir)
    const target = execution.target?.kind === 'existing' ? resolve(execution.target.path) : null
    const directory = target && !relative(root, target).startsWith('..') ? dirname(target) : root
    directories.set(directory, root)
    if (task.operation !== 'repair_existing') {
      directories.set(resolve(getDataDir(), 'download-cache'), resolve(getDataDir()))
    }
  }
  return [...directories].sort(([left], [right]) => left.localeCompare(right)).map(([directory, root]) => ({ directory, root }))
}

function captureEnvironment(reason: RecoveryEnvironment, config: AppConfig): EnvironmentScope {
  const directories = reason === 'filesystem' ? fileDestinations(config) : []
  const key = reason === 'authentication' ? config.netease.cookie
    : reason === 'plex_authentication' ? JSON.stringify(config.plex) : JSON.stringify(directories)
  return { reason, key, directories, problems: getEnvironmentProblems(ENVIRONMENT_CODES[reason], config) }
}

async function environmentReady(scope: EnvironmentScope, config: AppConfig): Promise<boolean> {
  try {
    if (scope.reason === 'authentication') return Boolean(config.netease.cookie) && (await checkCookie(config.netease.cookie)).valid
    if (scope.reason === 'plex_authentication') {
      if (!config.plex.server || !config.plex.token) return false
      const payload = await createPlexHttpClient(config.plex).query('/library/sections')
      return Boolean(extractPlexMusicSection(payload, config.plex.section))
    }
    for (const { directory, root } of scope.directories) {
      let existing = directory
      while (true) {
        try { await stat(existing); break } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || existing === root) return false
          existing = dirname(existing)
        }
      }
      assertDownloadDirWritable(existing)
    }
    return true
  } catch { return false }
}

/** The displayed pause reason is not the list of unresolved environmental failures. */
function recoveryEnvironments(config: AppConfig, requested: RecoveryEnvironment[] = []): Set<RecoveryEnvironment> {
  const reasons = new Set(requested)
  const control = getDownloadQueueControl()
  if (control.reason === 'authentication' || control.reason === 'filesystem') reasons.add(control.reason)
  for (const reason of Object.keys(ENVIRONMENT_CODES) as RecoveryEnvironment[]) {
    if (getEnvironmentProblems(ENVIRONMENT_CODES[reason], config).length) reasons.add(reason)
  }
  return reasons
}

/** Called only after an actual successful login check. */
export async function confirmAuthenticationRestored(config: AppConfig): Promise<void> {
  const current = readConfig()
  if (current.netease.cookie !== config.netease.cookie) return
  const reasons = recoveryEnvironments(current)
  if (reasons.has('authentication')) await recoverEnvironments(current, reasons, false, true)
}

export async function recoverAfterConfigUpdate(previous: AppConfig, updated: AppConfig): Promise<void> {
  const reasons = [
    ...(previous.netease.cookie !== updated.netease.cookie ? ['authentication' as const] : []),
    ...(JSON.stringify(previous.plex) !== JSON.stringify(updated.plex) ? ['plex_authentication' as const] : []),
    ...(previous.download.dir !== updated.download.dir ? ['filesystem' as const] : []),
  ]
  await recoverEnvironments(updated, recoveryEnvironments(updated, reasons))
}

export async function resumeDownloadsAfterRepair(): Promise<void> {
  const config = readConfig()
  await recoverEnvironments(config, recoveryEnvironments(config), true)
}

function sameAttempt(checked: EnvironmentProblem, current: EnvironmentProblem): boolean {
  return checked.id === current.id && checked.lastSeenAt === current.lastSeenAt && checked.occurrenceCount === current.occurrenceCount
}

async function recoverEnvironments(
  config: AppConfig, reasons: Set<RecoveryEnvironment>, explicitlyResume = false, authenticationConfirmed = false,
): Promise<void> {
  if (!reasons.size && !explicitlyResume) return
  const checks = [...reasons].map(reason => captureEnvironment(reason, config))
  const results = await Promise.all(checks.map(async scope => ({ scope,
    ready: scope.reason === 'authentication' && authenticationConfirmed || await environmentReady(scope, config) })))
  const current = readConfig()
  const restored = new Map<RecoveryEnvironment, EnvironmentProblem[]>()
  const ready = new Set<RecoveryEnvironment>()
  for (const result of results) {
    if (!result.ready) continue
    const latest = captureEnvironment(result.scope.reason, current)
    if (latest.key !== result.scope.key) continue
    const verified = latest.problems.filter(problem => result.scope.problems.some(checked => sameAttempt(checked, problem)))
    restored.set(latest.reason, verified)
    // A new failure during a successful check still needs its own recovery check.
    if (verified.length === latest.problems.length) ready.add(latest.reason)
  }
  const pending = recoveryEnvironments(current)
  const blocked = (['authentication', 'filesystem'] as const).find(reason => pending.has(reason) && !ready.has(reason))
  const message = blocked === 'authentication' ? '网易云登录仍然失效，请先更新 Cookie'
    : '原文件任务的目标目录仍不可写或空间不足，请先修复对应挂载、权限和空间'
  getDb().transaction(() => {
    for (const [reason, problems] of restored) {
      const code = ENVIRONMENT_CODES[reason]
      const rearmed = new Set(rearmEnvironmentFailures(code, problems))
      const accepted = problems.filter(problem => rearmed.has(problem.id))
      const sources = new Set(wakeEnvironmentFileTasks(code, accepted, current))
      for (const problem of accepted) if (problem.sourceId && !problem.taskIds.length) sources.add(problem.sourceId)
      for (const sourceId of sources) recoverSourceAfterEnvironmentRepair(sourceId, current)
      if (reason === 'authentication') confirmNeteaseAuthentication(accepted)
    }
    if (explicitlyResume || getDownloadQueueControl().reason !== 'manual') {
      if (blocked) pauseDownloadQueue(blocked, message)
      else resumeDownloadQueue()
    }
  })()
  // Workers may only observe committed commands and attempt resets.
  recoverDueFileTasks(current)
  void requestDownloadProcessing().catch(() => undefined)
  if (explicitlyResume && blocked) throw new Error(message)
}
