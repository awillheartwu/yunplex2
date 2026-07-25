export type MatchManagementTab = 'reviews' | 'overview' | 'history'

const MATCH_MANAGEMENT_TABS = new Set<MatchManagementTab>(['reviews', 'overview', 'history'])

export function useMatchManagementRouteState() {
  const route = useRoute()
  const router = useRouter()
  const routeTab = typeof route.query.tab === 'string' ? route.query.tab : ''
  const tab = ref<MatchManagementTab>(
    MATCH_MANAGEMENT_TABS.has(routeTab as MatchManagementTab)
      ? routeTab as MatchManagementTab
      : 'reviews',
  )
  const sourceId = ref(typeof route.query.source === 'string' ? route.query.source : '')

  function replaceQuery(patch: Record<string, string | undefined>) {
    return router.replace({ query: { ...route.query, ...patch } })
  }

  function setTab(value: MatchManagementTab) {
    tab.value = value
    void replaceQuery({ tab: value })
  }

  function setSource(value: string) {
    sourceId.value = value
    void replaceQuery({ source: value || undefined })
  }

  return {
    tab,
    sourceId,
    setTab,
    setSource,
  }
}
