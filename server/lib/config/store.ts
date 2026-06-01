import type { AppConfig, ConfigSection } from './types'
import { DEFAULT_CONFIG } from './defaults'
import { readConfigFromDb, writeConfigToDb } from '../db'

let dataDir = './data'

export function setDataDir(dir: string) {
  dataDir = dir
}

export function getDataDir(): string {
  return dataDir
}

/**
 * Returns true when `v` is a plain object whose every value is a primitive,
 * null, or array — i.e. it contains no nested plain objects. Such "flat map"
 * objects are treated as leaf values and replaced entirely, so that deleting
 * a key from the partial actually removes it from the result.
 */
function isFlatRecord(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  return Object.values(v as Record<string, unknown>).every(
    (val) => typeof val !== 'object' || val === null || Array.isArray(val),
  )
}

function deepMerge<T extends Record<string, any>>(base: T, partial: Partial<T>): T {
  const result = { ...base }
  for (const key of Object.keys(partial) as (keyof T)[]) {
    const v = partial[key]
    if (v !== undefined && v !== null && typeof v === 'object' && !Array.isArray(v)) {
      if (isFlatRecord(v)) {
        // Flat maps (e.g. artistAliases: Record<string, string>):
        // replace the whole object so deletions are persisted.
        ;(result as Record<string, unknown>)[key as string] = v
      } else {
        ;(result as Record<string, unknown>)[key as string] = deepMerge(
          (base[key] as Record<string, unknown>) || {},
          v as Record<string, unknown>,
        )
      }
    } else if (v !== undefined) {
      ;(result as Record<string, unknown>)[key as string] = v
    }
  }
  return result
}

export function readConfig(): AppConfig {
  return readConfigFromDb()
}

export function writeConfig(partial: Partial<AppConfig>): AppConfig {
  const current = readConfig()
  const merged = deepMerge(current, partial)
  writeConfigToDb(merged)
  return merged
}

export function resetConfig(): AppConfig {
  writeConfigToDb({ ...DEFAULT_CONFIG })
  return { ...DEFAULT_CONFIG }
}

export function updateConfigSection<K extends ConfigSection>(
  section: K,
  partial: Partial<AppConfig[K]>,
): AppConfig {
  const sectionUpdate: Partial<AppConfig> = {
    [section]: partial,
  }
  return writeConfig(sectionUpdate as Partial<AppConfig>)
}

export function configPath(): string {
  return `sqlite://${dataDir}/data.db#config`
}