import { readFileSync } from 'node:fs'
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
    const queueCss = readProjectFile('assets/css/pages/manual-download-queue.css')
    const workspaceCss = readProjectFile('assets/css/pages/manual-download-workspace.css')

    expect(queueCss).toContain('block-size: 100%')
    expect(queueCss).toContain('max-block-size: var(--panel-scroll-max-block-size)')
    expect(queueCss).not.toContain('height: clamp(360px, 52vh, 600px)')
    expect(queueCss).not.toContain('max-height: 600px')
    expect(queueCss).not.toContain('height: min(56vh, 32rem)')
    expect(workspaceCss).toContain('display: flex')
    expect(workspaceCss).toContain('flex-direction: column')
    expect(workspaceCss).toContain('aspect-ratio: 1')
    expect(workspaceCss).not.toContain('min-height: 192px')
    expect(workspaceCss).not.toContain('height: 160px')
  })

  it('sizes charts through reusable chart tokens instead of inline heights', () => {
    const globals = readProjectFile('assets/css/main.css')
    const systemLineChart = readProjectFile('components/charts/SystemLineChart.vue')
    const downloadChart = readProjectFile('components/charts/DownloadChart.vue')
    const systemCharts = readProjectFile('components/system/SystemCharts.vue')

    expect(globals).toContain('--chart-card-min-block-size')
    expect(globals).toContain('--chart-plot-min-block-size')
    expect(systemLineChart).not.toContain('style="height:160px"')
    expect(systemLineChart).toContain('system-line-chart')
    expect(systemLineChart).toContain('min-block-size: var(--chart-plot-min-block-size)')
    expect(downloadChart).toContain('min-block-size: var(--chart-card-min-block-size)')
    expect(systemCharts).toContain('system-chart-card')
  })

  it('keeps text sizing stable and avoids compressed tracking in UI chrome', () => {
    const files = [
      'assets/css/global/components.css',
      'assets/css/pages/task-center.css',
      'components/dashboard/DashboardKpiCard.vue',
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

  it('keeps shared empty and form controls accessible without fixed padding hacks', () => {
    const emptyState = readProjectFile('components/common/EmptyState.vue')
    const dateRange = readProjectFile('components/common/DateRange.vue')
    const downloadChart = readProjectFile('components/charts/DownloadChart.vue')
    const toggleField = readProjectFile('components/config/ToggleField.vue')
    const aliasEditor = readProjectFile('components/config/AliasEditor.vue')
    const timeline = readProjectFile('components/common/ProcessTimeline.vue')

    expect(emptyState).toContain('class="empty-state"')
    expect(emptyState).toContain('role="status"')
    expect(emptyState).not.toContain('py-24')
    expect(dateRange).toContain('date-range-nav-button')
    expect(dateRange).toContain('date-range-day')
    expect(dateRange).not.toContain('w-5 h-5')
    expect(downloadChart).toContain('download-chart__mode-button')
    expect(downloadChart).toContain(':aria-pressed="chartMode === mode.key"')
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
    const syncPage = readProjectFile('components/sources/SyncSourcesPage.vue')
    const syncComposable = readProjectFile('composables/useSyncSourcesPage.ts')
    const syncTableCss = readProjectFile('assets/css/pages/sync-sources-table.css')
    const manualQueueCss = readProjectFile('assets/css/pages/manual-download-queue.css')
    const dateRange = readProjectFile('components/common/DateRange.vue')
    const globals = readProjectFile('assets/css/global/components.css')
    const mobileSourceListStart = syncPage.indexOf('<div class="md:hidden sync-mobile-list">')
    const mobileSourceListEnd = syncPage.indexOf('<Teleport to="body">', mobileSourceListStart)
    const mobileSourceList = syncPage.slice(mobileSourceListStart, mobileSourceListEnd)

    expect(mobileSourceListStart).toBeGreaterThan(-1)
    expect(mobileSourceListEnd).toBeGreaterThan(mobileSourceListStart)
    expect(configPage).toContain('config-header-actions')
    expect(configPage).toContain('.config-header-actions__primary > .btn')
    expect(configPage).toContain('justify-content: center')
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
    expect(manualQueueCss).toContain('.manual-parse-history-list {\n    display: grid;')
    expect(manualQueueCss).toContain('overflow-x: visible')
    expect(manualQueueCss).toContain('scroll-snap-type: none')
    expect(globals).toContain('.icon-button {\n    min-width: 2.75rem;')
    expect(globals).toContain('max-height: min(82dvh, 42rem) !important')
    expect(globals).toContain('.date-range-presets')
    expect(globals).toContain('position: sticky')
    expect(dateRange).toContain('v-for="(cal, ci) in visibleMonths"')
    expect(dateRange).toContain('isMobileViewport.value ? [leftMonth.value] : [leftMonth.value, rightMonth.value]')
  })

  it('uses mobile-specific layouts for dense system and job detail rows', () => {
    const stats = readProjectFile('components/system/SystemDataStats.vue')
    const jobDetail = readProjectFile('components/jobs/JobDetail.vue')

    expect(stats).toContain('system-table-row__identity')
    expect(stats).toContain('.system-table-row__meta {\n    display: flex;')
    expect(jobDetail).toContain('run-detail__song-group-name')
    expect(jobDetail).toContain('flex:1 1 calc(100% - 7rem)')
    expect(jobDetail).toContain('padding-left:3.05rem')
  })
})
