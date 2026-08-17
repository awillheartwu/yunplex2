<template>
  <div class="sync-row-actions__menu">
    <button class="icon-button sync-row-actions__icon" type="button" aria-label="更多操作" @click.stop="$emit('toggle')">
      <AppIcon name="more" :size="14" />
    </button>
    <div v-if="open" class="sync-row-menu" :class="placement === 'top' ? 'sync-row-menu--top' : 'sync-row-menu--bottom'" @click.stop>
      <button v-if="includeEdit" class="sync-row-menu__item" type="button" @click="$emit('edit')">
        <AppIcon name="edit" :size="12" />
        <span>编辑同步源</span>
      </button>
      <button v-if="includeFullSync && source.type === 'playlist'" class="sync-row-menu__item" :disabled="busy" @click="$emit('full-sync')">
        <AppIcon name="refresh" :size="12" />
        <span>全量同步</span>
      </button>
      <button class="sync-row-menu__item" :disabled="busy" @click="$emit('rebuild')">
        <AppIcon name="repair" :size="12" />
        <span>{{ source.type === 'album' ? '重新评估自动匹配并下载' : '重新评估自动匹配并同步' }}</span>
      </button>
      <button v-if="source.type === 'playlist'" class="sync-row-menu__item sync-row-menu__item--warning" :disabled="busy" @click="$emit('redownload')">
        <AppIcon name="download" :size="12" />
        <span>重新下载托管音频并同步</span>
      </button>
      <button v-if="includeSongDetails" class="sync-row-menu__item" type="button" @click="$emit('toggle-songs')">
        <AppIcon name="chevronRight" :size="12" />
        <span>{{ expanded ? '收起歌曲明细' : '展开歌曲明细' }}</span>
      </button>
      <button v-if="includeRepair" class="sync-row-menu__item" :class="repairing ? 'sync-row-menu__item--active' : ''" :disabled="busy" @click="$emit('repair')">
        <span v-if="repairing && repairProgress">{{ repairProgress.processed }}/{{ repairProgress.total }}</span>
        <AppIcon v-else name="music" :size="12" />
        <span>修复标签、词图</span>
      </button>
      <button class="sync-row-menu__item sync-row-menu__item--danger" type="button" @click="$emit('delete')">
        <AppIcon name="trash" :size="12" />
        <span>删除</span>
      </button>
    </div>
    <div v-if="open" class="fixed inset-0 z-10" @click="$emit('close')" />
  </div>
</template>

<script setup lang="ts">
import type { PlaylistSource } from '~~/server/lib/playlist/types'

withDefaults(defineProps<{
  source: PlaylistSource
  open: boolean
  placement?: 'top' | 'bottom'
  busy: boolean
  expanded?: boolean
  repairing?: boolean
  repairProgress?: { processed: number; total: number }
  includeEdit?: boolean
  includeFullSync?: boolean
  includeSongDetails?: boolean
  includeRepair?: boolean
}>(), {
  placement: 'top',
  expanded: false,
  repairing: false,
  repairProgress: undefined,
  includeEdit: false,
  includeFullSync: true,
  includeSongDetails: false,
  includeRepair: true,
})

defineEmits<{
  toggle: []
  close: []
  edit: []
  'full-sync': []
  rebuild: []
  redownload: []
  'toggle-songs': []
  repair: []
  delete: []
}>()
</script>
