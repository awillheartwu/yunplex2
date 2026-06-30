import type { AppConfig, ConfigSection } from './types'
import { DEFAULT_CONFIG } from './defaults'
import { readRawConfigFromDb, writeConfigToDb } from '../db'
import { cloneConfig, mergeAndValidateConfig, migrateConfig, validateFullConfig } from './validation'

let dataDir = './data'

export function setDataDir(dir: string) {
  dataDir = dir
}

export function getDataDir(): string {
  return dataDir
}

export function readConfig(): AppConfig {
  const raw = readRawConfigFromDb()
  if (!raw) return cloneConfig(DEFAULT_CONFIG)

  const migrated = migrateConfig(raw)
  if (migrated.changed) {
    writeConfigToDb(migrated.config)
  }

  return migrated.config
}

export function writeConfig(partial: unknown): AppConfig {
  const current = readConfig()
  const merged = mergeAndValidateConfig(current, partial)
  writeConfigToDb(merged)
  return merged
}

export function resetConfig(): AppConfig {
  const config = validateFullConfig(cloneConfig(DEFAULT_CONFIG))
  writeConfigToDb(config)
  return config
}

export function updateConfigSection<K extends ConfigSection>(
  section: K,
  partial: Partial<AppConfig[K]>,
): AppConfig {
  const sectionUpdate: Partial<AppConfig> = {
    [section]: partial,
  }
  return writeConfig(sectionUpdate)
}

export function configPath(): string {
  return `sqlite://${dataDir}/data.db#config`
}
