<template>
  <div class="source-plex-target">
    <p v-if="source.pendingPlexWrite" class="source-plex-target__notice" role="status">
      <AppIcon name="warn" :size="14" />上次 Plex 写入结果尚未确认，已暂停继续写入。请先在 Plex 核对歌单，再选择并确认实际目标。
    </p>
    <p v-if="source.plexPlaylistRatingKey" class="source-plex-target__hint">当前关联歌单 ID：{{ source.plexPlaylistRatingKey }}。已关联时以此歌单为准。</p>
    <button v-if="!opened" type="button" class="btn btn-secondary btn-sm" @click="open">选择或重新确认实际歌单</button>
    <div v-else class="source-plex-target__picker">
      <FormField label="Plex 实际歌单" hint="同名歌单通过 ID 区分；即使目标不变，也可明确重新确认。">
        <select v-model="selected" class="form-input" :disabled="loading || saving">
          <option value="">{{ loading ? '正在读取歌单…' : '请选择已核对的歌单' }}</option>
          <option v-for="playlist in playlists" :key="playlist.ratingKey" :value="playlist.ratingKey">{{ playlist.title }}（ID {{ playlist.ratingKey }}）</option>
        </select>
      </FormField>
      <p class="source-plex-target__hint">确认会保存此目标，并结束上次写入的待确认状态。下一次同步会重新核对成员与顺序；已完成的变更会保留。</p>
      <div class="source-plex-target__actions">
        <button type="button" class="btn btn-secondary btn-sm" :disabled="loading || saving" @click="load">刷新列表</button>
        <button type="button" class="btn btn-primary btn-sm" :disabled="!selected || loading || saving" @click="confirm">{{ saving ? '正在核对…' : '确认此目标并重新核对' }}</button>
      </div>
    </div>
    <p v-if="error" class="text-danger text-xs" role="alert">{{ error }}</p>
    <p v-if="message" class="source-plex-target__hint" role="status">{{ message }}</p>
  </div>
</template>

<script setup lang="ts">
import type { PlaylistSource } from '~~/server/lib/playlist/types'
const props = defineProps<{ source: PlaylistSource }>()
const emit = defineEmits<{ saved: [source: PlaylistSource] }>()
const api = useApi()
const opened = ref(false), loading = ref(false), saving = ref(false)
const playlists = ref<Array<{ title: string; ratingKey: string }>>([])
const selected = ref(''), error = ref(''), message = ref('')
async function load() {
  loading.value = true
  error.value = ''
  try {
    playlists.value = await api.get('/plex/playlists')
    if (!playlists.value.some(item => item.ratingKey === selected.value)) selected.value = ''
  } catch (value) { error.value = value instanceof Error ? value.message : '读取歌单失败' }
  finally { loading.value = false }
}
async function open() {
  opened.value = true
  selected.value = props.source.plexPlaylistRatingKey
  await load()
}
async function confirm() {
  if (saving.value || !selected.value) return
  saving.value = true
  error.value = ''
  message.value = ''
  try {
    const source = await api.post<PlaylistSource>(`/playlist-sources/${props.source.id}/plex-target`, { ratingKey: selected.value })
    emit('saved', source)
    message.value = '目标已明确确认，下一次同步将重新核对歌单。'
    opened.value = false
  } catch (value) { error.value = value instanceof Error ? value.message : '确认目标失败' }
  finally { saving.value = false }
}
</script>

<style scoped>
.source-plex-target{display:grid;gap:var(--space-3);margin-top:var(--space-4)}
.source-plex-target__picker{display:grid;gap:var(--space-3)}
.source-plex-target__hint{color:var(--text-secondary);font-size:var(--text-xs);line-height:var(--body-leading)}
.source-plex-target__notice{display:flex;align-items:center;gap:var(--space-2);padding:var(--space-3);border-radius:var(--radius-md);background:var(--warning-soft);color:var(--warning);font-size:var(--text-sm)}
.source-plex-target__actions{display:flex;flex-wrap:wrap;gap:var(--space-2)}
</style>
