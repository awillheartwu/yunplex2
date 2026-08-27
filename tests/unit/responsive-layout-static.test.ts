import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '../..')

function readProjectFile(path: string) {
  return readFileSync(resolve(root, path), 'utf-8')
}

describe('responsive layout sizing', () => {
  it('keeps app shell and chrome sizing centralized through layout tokens', () => {
    const globals = readProjectFile('assets/css/main.css')
    const layout = readProjectFile('layouts/default.vue')
    const topBar = readProjectFile('components/layout/TopBar.vue')
    const sidebar = readProjectFile('components/layout/Sidebar.vue')

    expect(globals).toContain('--app-shell-min-block-size')
    expect(globals).toContain('--app-topbar-block-size')
    expect(layout).toContain('app-shell')
    expect(layout).toContain('--app-sidebar-inline-size')
    expect(layout).toContain('position: fixed')
    expect(layout).toContain('padding-inline-start: var(--app-sidebar-inline-size)')
    expect(layout).not.toContain('h-dvh overflow-hidden')
    expect(layout).not.toContain('max-h-dvh')
    expect(layout).not.toContain('md:sticky')
    expect(layout).toContain('min-block-size: var(--app-shell-min-block-size)')
    expect(topBar).toContain('app-topbar')
    expect(topBar).toContain('min-block-size: var(--app-topbar-block-size)')
    expect(sidebar).toContain('min-block-size: var(--app-topbar-block-size)')
    expect(sidebar).not.toContain('sidebar-brand h-20')
  })

  it('uses fluid sizing for the manual-download table viewport', () => {
    const resultsCss = readProjectFile('assets/css/pages/manual-download-results.css')
    const workspaceCss = readProjectFile('assets/css/pages/manual-download-workspace.css')

    expect(resultsCss).toContain('block-size: 100%')
    expect(resultsCss).toContain('max-block-size: var(--panel-scroll-max-block-size)')
    expect(resultsCss).not.toContain('height: clamp(360px, 52vh, 600px)')
    expect(resultsCss).not.toContain('max-height: 600px')
    expect(resultsCss).not.toContain('height: min(56vh, 32rem)')
    expect(workspaceCss).toContain('display: flex')
    expect(workspaceCss).toContain('flex-direction: column')
    expect(workspaceCss).toContain('aspect-ratio: 1')
    expect(workspaceCss).not.toContain('min-height: 192px')
    expect(workspaceCss).not.toContain('height: 160px')
  })

  it('does not keep decorative dashboard or system charts', () => {
    expect(existsSync(resolve(root, 'components/charts/SystemLineChart.vue'))).toBe(false)
    expect(existsSync(resolve(root, 'components/charts/DownloadChart.vue'))).toBe(false)
    expect(existsSync(resolve(root, 'components/system/SystemCharts.vue'))).toBe(false)
    expect(readProjectFile('pages/index.vue')).not.toContain('summary.trend')
  })

  it('keeps text sizing stable and avoids compressed tracking in UI chrome', () => {
    const files = [
      'assets/css/global/components.css',
      'assets/css/pages/task-center.css',
      'pages/index.vue',
      'components/layout/TopBar.vue',
      'pages/setup.vue',
    ]

    for (const file of files) {
      const source = readProjectFile(file)
      expect(source, file).not.toMatch(/letter-spacing:\s*-/)
      expect(source, file).not.toContain('tracking-[-')
      expect(source, file).not.toMatch(/font-size:\s*clamp\([^;]*vw/)
    }
  })

  it('keeps the simplified dashboard responsive', () => {
    const globals = readProjectFile('assets/css/main.css')
    const dashboard = readProjectFile('pages/index.vue')
    const layout = readProjectFile('layouts/default.vue')

    expect(globals).toContain('--font-scale: 1')
    expect(globals).toContain('--app-content-max-width: 160rem')
    expect(globals).toContain('--dashboard-content-max-width: 220rem')
    expect(layout).toContain('app-page-frame--dashboard')
    expect(dashboard).toContain('class="dashboard-workspace"')
    expect(dashboard).toContain('class="dashboard-monitor"')
    expect(dashboard).toContain('<SystemMonitorPanel')
    expect(dashboard).toContain('grid-template-columns: minmax(0, 1fr) minmax(0, 1fr)')
    expect(dashboard).toContain('@media (max-width: 900px)')
    expect(dashboard).toContain('grid-template-columns: 1fr')
  })

  it('keeps source media and run lists dense across wide and compact layouts', () => {
    const sourceMedia = readProjectFile('components/sources/SourceMediaDetails.vue')
    const runCard = readProjectFile('components/task-center/RunCard.vue')

    expect(sourceMedia).toContain('min-width: 0')
    expect(sourceMedia).toContain('@media (max-width: 760px)')
    expect(runCard).toContain('run-card__source-column')
    expect(runCard).toContain('run-card__column-label')
    expect(runCard).toContain('grid-template-columns:auto minmax(17rem,1.15fr) minmax(24rem,1.5fr)')
    expect(runCard).toContain('@media(max-width:1280px)')
    expect(runCard).toContain('@media(max-width:720px)')
  })

  it('keeps shared empty and form controls accessible without fixed padding hacks', () => {
    const emptyState = readProjectFile('components/common/EmptyState.vue')
    const dateRange = readProjectFile('components/common/DateRange.vue')
    const toggleField = readProjectFile('components/config/ToggleField.vue')
    const aliasEditor = readProjectFile('components/config/AliasEditor.vue')
    const timeline = readProjectFile('components/common/ProcessTimeline.vue')

    expect(emptyState).toContain('class="empty-state"')
    expect(emptyState).toContain('role="status"')
    expect(emptyState).not.toContain('py-24')
    expect(dateRange).toContain('date-range-nav-button')
    expect(dateRange).toContain('date-range-day')
    expect(dateRange).not.toContain('w-5 h-5')
    expect(toggleField).toContain('toggle-field__switch')
    expect(toggleField).toContain(':aria-label="label"')
    expect(toggleField).not.toContain('w-9 h-5')
    expect(aliasEditor).toContain(':aria-label="`第 ${i + 1} 行原艺人名`"')
    expect(aliasEditor).toContain(':aria-label="`删除第 ${i + 1} 行映射`"')
    expect(aliasEditor).not.toContain('max-h-48')
    expect(aliasEditor).not.toContain('h-28')
    expect(timeline).not.toContain('min-height:1.65rem')
  })

  it('protects mobile timeline layouts from compact and wide-time column squeeze', () => {
    const timeline = readProjectFile('components/common/ProcessTimeline.vue')

    expect(timeline).toContain('.process-timeline--compact .process-timeline__item{grid-template-columns:3.65rem 1.85rem minmax(0,1fr)')
    expect(timeline).toContain('.process-timeline--wide-time .process-timeline__item{grid-template-columns:8.9rem 2rem minmax(0,1fr)')
    expect(timeline).toContain('.process-timeline--compact .process-timeline__item,')
    expect(timeline).toContain('.process-timeline--wide-time .process-timeline__item{grid-template-columns:2rem minmax(0,1fr)')
    expect(timeline).toContain('overflow-wrap:anywhere')
  })

  it('keeps mobile filters and source cards production-friendly', () => {
    const configPage = readProjectFile('pages/config.vue')
    const configCss = readProjectFile('assets/css/pages/config.css')
    const syncPage = readProjectFile('components/sources/SyncSourcesPage.vue')
    const syncComposable = readProjectFile('composables/useSyncSourcesPage.ts')
    const syncTableCss = readProjectFile('assets/css/pages/sync-sources-table.css')
    const manualResultsCss = readProjectFile('assets/css/pages/manual-download-results.css')
    const dateRange = readProjectFile('components/common/DateRange.vue')
    const globals = readProjectFile('assets/css/global/components.css')
    const filterBar = readProjectFile('components/common/FilterBar.vue')
    const mobileSourceListStart = syncPage.indexOf('<div class="md:hidden sync-mobile-list">')
    const mobileSourceListEnd = syncPage.indexOf('<Teleport to="body">', mobileSourceListStart)
    const mobileSourceList = syncPage.slice(mobileSourceListStart, mobileSourceListEnd)

    expect(mobileSourceListStart).toBeGreaterThan(-1)
    expect(mobileSourceListEnd).toBeGreaterThan(mobileSourceListStart)
    expect(configPage).toContain('config-header-actions')
    expect(configPage).toContain('scoped src="~/assets/css/pages/config.css"')
    expect(configCss).toContain('.config-header-actions .btn')
    expect(configCss).toContain('justify-content: center')
    expect(syncPage).toContain('statusFilterOptions')
    expect(syncComposable).toMatch(/statusFilterOptions[,\s]+subscribedFilter/)
    expect(syncTableCss).toContain('width: 100%')
    expect(syncTableCss).toContain('.sync-mobile-card > *')
    expect(syncTableCss).toContain('flex-wrap: wrap')
    expect(syncTableCss).toContain('.sync-mobile-card:focus-within')
    expect(syncTableCss).toContain('.sync-mobile-card--expanded')
    expect(syncPage).toContain('sync-mobile-card__identity')
    expect(syncPage).toContain('sync-mobile-card__stat--target')
    expect(syncPage).toContain('sync-mobile-card__primary-action')
    expect(syncTableCss).toContain('.sync-mobile-card__identity')
    expect(syncTableCss).toContain('.sync-mobile-card__stat--target')
    expect(syncTableCss).toContain('.sync-mobile-card__primary-action')
    expect(syncTableCss).toContain('-webkit-line-clamp: 2')
    expect(syncTableCss).toContain('.sync-mobile-card__preview-icon {\n    display: none;')
    expect(syncTableCss).toContain('.sync-mobile-card__actions .sync-row-actions__menu {\n  position: static;')
    expect(syncTableCss).toContain('.sync-mobile-card__actions .sync-row-menu')
    expect(syncTableCss).toContain('width: min(100%, 21rem)')
    expect(syncPage).toContain('mobilePreviewSource')
    expect(syncPage).toContain('role="dialog"')
    expect(syncPage).toContain('@mouseenter="showSourceHover(s, $event)"')
    expect(mobileSourceList).toContain('@click="openMobileSourcePreview(s)"')
    expect(mobileSourceList).not.toContain('showSourceHover')
    expect(syncTableCss).toContain('.sync-mobile-source-backdrop')
    expect(syncTableCss).toContain('.sync-mobile-source-sheet')
    expect(syncTableCss).toContain('touch-action: manipulation')
    expect(manualResultsCss).toContain('.manual-parse-history-list {\n    display: grid;')
    expect(manualResultsCss).toContain('overflow-x: visible')
    expect(manualResultsCss).toContain('scroll-snap-type: none')
    expect(globals).toContain('.icon-button {\n    min-width: 2.75rem;')
    expect(globals).toContain('max-height: min(82dvh, 42rem) !important')
    expect(globals).toContain('.date-range-presets')
    expect(globals).toContain('position: sticky')
    expect(filterBar).toContain('class="btn btn-secondary btn-xs filter-mobile-trigger"')
    expect(filterBar).toContain("'filter-mobile-backdrop': !advanced")
    expect(filterBar).not.toContain('btn btn-secondary btn-xs md:hidden')
    expect(globals).toContain('.filter-mobile-trigger {\n  display: none;')
    expect(globals).toContain('.filter-mobile-trigger { display: inline-flex; }')
    expect(globals).toContain('.filter-mobile-backdrop { display: flex; }')
    expect(dateRange).toContain('v-for="(cal, ci) in visibleMonths"')
    expect(dateRange).toContain('isMobileViewport.value ? [leftMonth.value] : [leftMonth.value, rightMonth.value]')
  })

  it('keeps the simplified system monitor and dense job rows responsive', () => {
    const monitor = readProjectFile('components/system/SystemMonitorPanel.vue')
    const health = readProjectFile('components/system/SystemHealthOverview.vue')
    const kpis = readProjectFile('components/system/SystemKpiGrid.vue')
    const jobDetail = readProjectFile('components/jobs/JobDetail.vue')

    expect(monitor).toContain('<SystemHealthOverview')
    expect(monitor).toContain('<SystemKpiGrid')
    expect(monitor).not.toContain('<SystemCharts')
    expect(monitor).not.toContain('<SystemDataStats')
    expect(monitor).not.toContain('<SystemInfoPanel')
    expect(monitor).not.toContain('lg:grid-cols-[minmax(18rem')
    expect(health).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))')
    expect(kpis).toContain('grid-cols-2 gap-3 xl:grid-cols-4')
    expect(jobDetail).toContain('run-detail__song-group-name')
    expect(jobDetail).toContain('flex:1 1 calc(100% - 7rem)')
    expect(jobDetail).toContain('padding-left:3.05rem')
  })
})
