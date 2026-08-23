import { URL_PATTERNS } from '~~/composables/useManualDownload'
import {
  MANUAL_DOWNLOAD_QUALITY_LABELS,
  formatManualDuration,
  formatManualRelativeTime,
  formatManualTotalDuration,
  manualQualityLabel,
  manualResourceTypeLabel,
} from '~~/composables/useManualDownloadPresentation'
import { useFeedback } from '~~/composables/useFeedback'

export function useManualDownloadPage() {
  const feedback = useFeedback()

  interface ParseHistoryItem {
    id: string
    input: string
    type: 'playlist' | 'album' | 'songs' | null
    title: string
    artist: string
    coverUrl: string
    trackCount: number
    parsedAt: string
  }

  const {
    parseState,
    inputValue,
    resourceType,
    detectHint,
    title,
    artist,
    coverUrl,
    tracks,
    neteaseId,
    trackCount,
    albumInfo,
    resourceDescription,
    resourceUpdatedAt,
    quality,
    downloadLyrics,
    downloadImages,
    embedMetadata,
    error,
    saveError,
    downloadResult,
    downloading,
    allSelected,
    selectedCount,
    parse,
    download,
    downloadAndSave,
    toggleAll,
    toggleTrack,
  } = useManualDownload()

  const parseHistory = ref<ParseHistoryItem[]>([])
  const PARSE_HISTORY_KEY = 'yunplex-manual-parse-history'
  const PARSE_HISTORY_LIMIT = 10

  const placeholderText = '粘贴网易云链接、歌单 ID、专辑 ID 或歌曲 ID\n例如：https://music.163.com/#/playlist?id=123456\n也支持多首歌曲 ID 换行输入'

  const qualityOptions = Object.entries(MANUAL_DOWNLOAD_QUALITY_LABELS).map(([value, label]) => ({ value, label }))
  const qualityLabel = computed(() => manualQualityLabel(quality.value))
  const qualityShortLabel = computed(() => {
    if (quality.value === 'jymaster') return 'SQ'
    if (quality.value === 'hires') return 'Hi-Res'
    if (quality.value === 'lossless') return '无损'
    return qualityLabel.value
  })
  const qualityBadgeTone = computed(() => quality.value === 'jymaster' || quality.value === 'hires' || quality.value === 'lossless' ? 'gold' : 'green')
  const totalDurationLabel = computed(() => formatManualTotalDuration(
    tracks.value.reduce((total, track) => total + (track.dt || 0), 0),
  ))
  const canSaveAsSource = computed(() => parseState.value === 'preview' && resourceType.value && resourceType.value !== 'songs' && neteaseId.value)

  const parsedTargetLine = computed(() => {
    if (neteaseId.value) return `当前目标 ID ${neteaseId.value}，已生成可选择下载列表。`
    return `当前目标为 ${trackCount.value} 首单曲集合，已生成可选择下载列表。`
  })

  const resultEmptyTitle = computed(() => {
    if (parseState.value === 'parsing') return '正在解析资源'
    return '尚未解析资源'
  })

  const resultMetaLine = computed(() => {
    if (parseState.value === 'idle') return '解析后会显示资源类型、艺人、专辑和曲目数。'
    if (parseState.value === 'parsing') return '正在拉取网易云元数据。'
    const parts = [manualResourceTypeLabel(resourceType.value)]
    if (artist.value) parts.push(artist.value)
    if (albumInfo.value?.company) parts.push(albumInfo.value.company)
    if (albumInfo.value?.publishTime) parts.push(String(new Date(albumInfo.value.publishTime).getFullYear()))
    return parts.join(' · ')
  })

  const primaryActionLabel = computed(() => {
    if (parseState.value === 'parsing') return '解析中...'
    if (parseState.value === 'preview') return downloading.value ? '启动中...' : `下载选中 (${selectedCount.value})`
    return '解析并预览'
  })
  const primaryActionIcon = computed(() => {
    if (parseState.value === 'parsing' || downloading.value) return 'loader'
    if (parseState.value === 'preview') return 'download'
    return 'search'
  })
  const primaryActionDisabled = computed(() => {
    if (parseState.value === 'parsing' || downloading.value) return true
    if (parseState.value === 'preview') return selectedCount.value === 0
    return !inputValue.value.trim()
  })

  function onPaste(e: ClipboardEvent) {
    const text = e.clipboardData?.getData('text') || ''
    if (URL_PATTERNS.some((p) => p.pattern.test(text))) {
      nextTick(() => {
        if (inputValue.value.trim()) void handleParse()
      })
    }
  }

  async function handlePrimaryAction() {
    if (parseState.value === 'preview') {
      await handleDownload()
      return
    }
    await handleParse()
  }

  async function handleParse() {
    await parse()
    rememberParsedResource()
  }

  async function handleDownload() {
    const result = await download()
    if (result) {
      feedback.success('下载任务已创建', `已加入 ${result.total} 首歌曲`)
    } else if (error.value) {
      feedback.error('下载任务创建失败', error.value)
    }
  }

  async function handleDownloadAndSave() {
    const result = await downloadAndSave()
    if (result?.saveError) {
      feedback.warning('下载已创建，同步源保存失败', result.saveError)
    } else if (result?.savedAsSource) {
      feedback.success('下载任务已创建', `已加入 ${result.total} 首歌曲，并保存为同步源`)
    } else if (result) {
      feedback.success('下载任务已创建', `已加入 ${result.total} 首歌曲`)
    } else if (error.value) {
      feedback.error('下载任务创建失败', error.value)
    }
  }

  function resetOptions() {
    quality.value = 'jymaster'
    downloadLyrics.value = true
    downloadImages.value = true
    embedMetadata.value = true
  }

  function invertSelection() {
    for (const track of tracks.value) {
      track.selected = !track.selected
    }
  }

  function artistsLine(track: { artists?: { name: string }[] }) {
    return track.artists?.map((item) => item.name).join(' / ') || '-'
  }

  function formatResourceDate(timestamp: number) {
    return new Date(timestamp).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
  }

  function hideBrokenImage(event: Event) {
    const img = event.target as HTMLImageElement
    img.style.display = 'none'
  }

  function loadParseHistory() {
    try {
      const raw = localStorage.getItem(PARSE_HISTORY_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as ParseHistoryItem[]
      parseHistory.value = parsed.filter((item) => item && item.id && item.title).slice(0, PARSE_HISTORY_LIMIT)
    } catch {
      parseHistory.value = []
    }
  }

  function saveParseHistory() {
    try {
      localStorage.setItem(PARSE_HISTORY_KEY, JSON.stringify(parseHistory.value.slice(0, PARSE_HISTORY_LIMIT)))
    } catch {
      // localStorage can be unavailable in private contexts.
    }
  }

  function rememberParsedResource() {
    if (parseState.value !== 'preview' || tracks.value.length === 0) return
    const item: ParseHistoryItem = {
      id: `${resourceType.value || 'resource'}:${neteaseId.value || tracks.value.map((track) => track.id).join(',')}`,
      input: inputValue.value.trim(),
      type: resourceType.value,
      title: title.value || '未命名资源',
      artist: artist.value,
      coverUrl: coverUrl.value,
      trackCount: trackCount.value,
      parsedAt: new Date().toISOString(),
    }
    parseHistory.value = [item, ...parseHistory.value.filter((historyItem) => historyItem.id !== item.id)].slice(0, PARSE_HISTORY_LIMIT)
    saveParseHistory()
  }

  async function restoreParseHistory(item: ParseHistoryItem) {
    inputValue.value = item.input
    await handleParse()
  }

  function clearParseHistory() {
    parseHistory.value = []
    saveParseHistory()
    feedback.success('解析历史已清空')
  }

  onMounted(() => {
    loadParseHistory()
  })

  return {
    albumInfo, allSelected, artist, artistsLine, canSaveAsSource, clearParseHistory, coverUrl, detectHint,
    download, downloadAndSave, downloadImages, downloading, downloadLyrics, downloadResult, embedMetadata, error,
    formatManualDuration, formatManualRelativeTime, formatResourceDate, handleDownload, handleDownloadAndSave, handleParse, handlePrimaryAction,
    hideBrokenImage, inputValue, invertSelection, loadParseHistory, manualResourceTypeLabel, neteaseId, onPaste, parse, PARSE_HISTORY_KEY, PARSE_HISTORY_LIMIT,
    parsedTargetLine, parseHistory, parseState, placeholderText, primaryActionDisabled, primaryActionIcon, primaryActionLabel,
    quality, qualityBadgeTone, qualityLabel, qualityOptions, qualityShortLabel,
    rememberParsedResource, resetOptions, resourceDescription, resourceType, resourceUpdatedAt, restoreParseHistory, resultEmptyTitle, resultMetaLine,
    saveError,
    saveParseHistory, selectedCount, title, toggleAll, toggleTrack, totalDurationLabel, trackCount,
    tracks,
  }
}
