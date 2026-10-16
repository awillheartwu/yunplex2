import catalog from '#build/settings-search-index'
import { tabs } from './settings-navigation'
import type { SettingDefinition, SettingsSection } from './settings-types'

export const settingSections = catalog.sections
export const settings = catalog.settings satisfies Record<string, SettingDefinition & { section: keyof typeof settingSections }>
export type SettingKey = keyof typeof settings
export type SettingsSectionKey = keyof typeof settingSections

export function settingLabel(key: SettingKey): string {
  return settings[key].label
}

export function settingTargetId(key: string): string {
  return `setting-${key.replace(/[:.]/g, '-')}`
}

export interface SettingsTarget extends SettingDefinition {
  key: string
  tab: string
  sectionKey: string
  sectionTitle: string
  elementId: string
}

export function getSettingsTarget(value: unknown): SettingsTarget | null {
  if (typeof value !== 'string') return null
  const sectionKey = value.startsWith('section:') ? value.slice(8) : null
  const definition: SettingDefinition | undefined = sectionKey
    ? undefined
    : Object.hasOwn(settings, value) ? settings[value as SettingKey] : undefined
  const key = sectionKey ?? definition?.section
  const section: SettingsSection | undefined = key && Object.hasOwn(settingSections, key)
    ? settingSections[key as SettingsSectionKey]
    : undefined
  if (!section || !key) return null
  return {
    ...definition,
    key: value,
    label: definition?.label ?? section.title,
    section: key,
    sectionKey: key,
    sectionTitle: section.title,
    tab: section.tab,
    elementId: settingTargetId(value),
  }
}

export function searchSettings(query: string) {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return []
  const words = needle.split(/\s+/)
  return [...Object.keys(settings), ...Object.keys(settingSections).map(key => `section:${key}`)]
    .map(key => getSettingsTarget(key)!)
    .map(target => {
      const section: SettingsSection = settingSections[target.sectionKey as SettingsSectionKey]
      const category = tabs.find(tab => tab.key === target.tab)?.label ?? ''
      const label = target.label.toLocaleLowerCase()
      const sectionText = target.key.startsWith('section:') ? `${section.description} ${section.keywords ?? ''}` : ''
      const text = `${target.label} ${target.key} ${target.keywords ?? ''} ${section.title} ${category} ${sectionText}`.toLocaleLowerCase()
      const score = label === needle ? 0 : label.includes(needle) ? 1 : 2
      return { target, category, text, score }
    })
    .filter(item => words.every(word => item.text.includes(word)))
    .sort((left, right) => left.score - right.score)
    .map(({ target, category }) => ({
      label: target.label,
      description: target.key.startsWith('section:')
        ? `${category} · ${settingSections[target.sectionKey as SettingsSectionKey].description}`
        : category === target.sectionTitle ? category : `${category} · ${target.sectionTitle}`,
      path: `/config?tab=${target.tab}&setting=${encodeURIComponent(target.key)}`,
      icon: 'settings',
      group: '设置',
      settingKey: target.key,
    }))
}
