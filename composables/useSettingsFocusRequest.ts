export function useSettingsFocusRequest() {
  return useState<number>('settings-search-focus-request', () => 0)
}
