const SIDEBAR_COLLAPSED_STORAGE_KEY = 'yunplex-sidebar-collapsed'

let sidebarStateLoaded = false

export function useSidebarState() {
  const sidebarCollapsed = useState<boolean>('sidebar-collapsed', () => false)

  function persistSidebarState() {
    if (import.meta.server) return
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(sidebarCollapsed.value))
    } catch {
      /* localStorage may be unavailable in restricted browser contexts */
    }
  }

  function loadSidebarState() {
    if (import.meta.server || sidebarStateLoaded) return
    sidebarStateLoaded = true
    try {
      sidebarCollapsed.value = localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === 'true'
    } catch {
      /* keep the default expanded state */
    }
  }

  function setSidebarCollapsed(next: boolean) {
    sidebarCollapsed.value = next
    persistSidebarState()
  }

  function toggleSidebarCollapsed() {
    setSidebarCollapsed(!sidebarCollapsed.value)
  }

  return {
    sidebarCollapsed,
    loadSidebarState,
    setSidebarCollapsed,
    toggleSidebarCollapsed,
  }
}
