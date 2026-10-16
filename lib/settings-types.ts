export interface SettingsSection {
  tab: string
  title: string
  description: string
  keywords?: string
}

export interface SettingDefinition {
  label: string
  section: string
  keywords?: string
  fallback?: string
  hiddenHint?: string
}
