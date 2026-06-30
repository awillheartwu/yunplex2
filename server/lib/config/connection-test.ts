import type { AppConfig } from './types'
import { readConfig } from './store'
import { mergeAndValidateConfig } from './validation'

export function resolveConnectionTestConfig(candidate?: unknown): AppConfig {
  return candidate ? mergeAndValidateConfig(readConfig(), candidate) : readConfig()
}
