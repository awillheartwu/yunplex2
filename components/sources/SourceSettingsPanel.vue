<template>
  <form class="source-settings" @submit.prevent="save">
    <div v-if="defaultsError" class="source-settings__warning" role="alert"><span>{{ defaultsError }}</span><button class="btn btn-secondary btn-sm" type="button" :disabled="defaultsLoading" @click="loadDefaults">重试全局设置</button></div>
    <section class="section-card source-settings__section">
      <header><div><h2>基本设置</h2><p>来源身份、目标歌单与独立排期。</p><p role="status">{{ hasChanges ? '有未保存的修改' : '所有设置已同步' }}</p></div><div class="flex flex-wrap gap-2"><button v-if="hasChanges" class="btn btn-ghost btn-sm" type="button" :disabled="saving" @click="discard">放弃修改</button><button class="btn btn-primary btn-sm" type="submit" :disabled="saving || !hasChanges">{{ saving ? '保存中…' : '保存设置' }}</button></div></header>
      <div class="source-settings__grid">
        <FormField label="任务名称"><input v-model="form.name" class="form-input" /></FormField>
        <FormField label="Plex 目标歌单"><input v-model="form.plexPlaylistName" class="form-input" /></FormField>
        <FormField label="同步数量上限" hint="留空继承全局"><input v-model.number="form.syncLimit" type="number" min="0" class="form-input" /></FormField>
        <FormField label="自动同步间隔（分钟）" hint="留空继承全局"><input v-model.number="form.syncIntervalMinutes" type="number" min="1" max="1440" class="form-input" /></FormField>
      </div>
      <div class="source-settings__toggles"><ToggleField v-model="form.enabled" label="启用来源" hint="关闭后不会自动排期" /><ToggleField v-if="source.type==='playlist'" v-model="form.autoCreatePlexPlaylist" label="自动创建 Plex 歌单" hint="目标不存在时创建" /></div>
    </section>
    <section v-if="source.type==='playlist'" class="section-card source-settings__section">
      <header><div><h2>首次媒体接管</h2><p>单来源覆盖全局策略；完成后切换不会自动重跑。</p></div></header>
      <SourceBooleanOverride v-model="form.initializeMediaOnFirstSync" label="首次同步前媒体接管" :global-value="globalInitialize" hint="启用时首次同步只分析候选并等待确认" />
      <p v-if="form.initializeMediaOnFirstSync===false" class="source-settings__warning"><AppIcon name="warn" :size="14" />关闭后首次同步可能按未验证媒体策略产生大量下载。</p>
    </section>
    <section class="section-card source-settings__section">
      <header><div><h2>同步覆盖</h2><p>留在“继承”时跟随全局设置。</p></div></header>
      <div class="source-settings__toggles"><SourceBooleanOverride v-model="form.forceFullCompare" label="始终全量对比" :global-value="globalForceFull" /><SourceBooleanOverride v-model="form.skipRemoveExtraTracks" label="不删除多余歌曲" :global-value="globalSkipRemove" /><SourceBooleanOverride v-if="source.type==='album'" v-model="form.skipPlexPlaylist" label="仅下载不入歌单" :global-value="globalSkipPlaylist" /></div>
    </section>
    <p v-if="error" class="text-danger text-xs" role="alert">{{ error }}</p>
    <UnsavedChangesGuard :dirty="hasChanges" :saving="saving" />
  </form>
</template>

<script setup lang="ts">
import type { PlaylistSource } from '~~/server/lib/playlist/types'; import type { AppConfig } from '~~/server/lib/config/types'
const props=defineProps<{source:PlaylistSource}>(); const emit=defineEmits<{saved:[source:PlaylistSource]}>(); const api=useApi(); const saving=ref(false); const error=ref(''); const globalInitialize=ref<boolean|null>(null); const globalForceFull=ref<boolean|null>(null); const globalSkipRemove=ref<boolean|null>(null); const globalSkipPlaylist=ref<boolean|null>(null)
function settings(source: PlaylistSource) {
  return { name: source.name, plexPlaylistName: source.plexPlaylistName, syncLimit: source.syncLimit, syncIntervalMinutes: source.syncIntervalMinutes, enabled: source.enabled, autoCreatePlexPlaylist: source.autoCreatePlexPlaylist, initializeMediaOnFirstSync: source.initializeMediaOnFirstSync ?? null, forceFullCompare: source.forceFullCompare, skipRemoveExtraTracks: source.skipRemoveExtraTracks, skipPlexPlaylist: source.skipPlexPlaylist }
}
const baseline = ref(settings(props.source))
const form = reactive({ ...baseline.value })
const hasChanges = computed(() => JSON.stringify(form) !== JSON.stringify(baseline.value))
function discard() {
  baseline.value = settings(props.source)
  Object.assign(form, baseline.value)
  error.value = ''
}
watch(() => props.source, () => { if (!hasChanges.value && !saving.value) discard() })
const defaultsError = ref(''), defaultsLoading = ref(false)
function nullableNumber(value: number | string | null) { return value === '' || value === null ? null : Number(value) }
async function save() {
  if (saving.value) return
  saving.value = true; error.value = ''
  const submitted = { ...form }
  try {
    const source = await api.put<PlaylistSource>(`/playlist-sources/${props.source.id}`, { ...submitted, syncLimit: nullableNumber(submitted.syncLimit), syncIntervalMinutes: nullableNumber(submitted.syncIntervalMinutes) })
    if (JSON.stringify(form) === JSON.stringify(submitted)) Object.assign(form, settings(source))
    baseline.value = settings(source)
    emit('saved', source)
  } catch (value) { error.value = value instanceof Error ? value.message : '保存失败' }
  finally { saving.value = false }
}
async function loadDefaults() {
  defaultsLoading.value = true; defaultsError.value = ''
  try {
    const config = await api.get<AppConfig>('/config')
    globalInitialize.value = config.sync.initializeMediaOnFirstSync ?? true
    globalForceFull.value = config.sync.forceFullCompare
    globalSkipRemove.value = config.sync.skipRemoveExtraTracks
    globalSkipPlaylist.value = config.sync.skipPlexPlaylist
  } catch { defaultsError.value = '无法读取全局设置，继承值暂时未知。' }
  finally { defaultsLoading.value = false }
}
onMounted(loadDefaults)
</script>

<style scoped>
.source-settings {
  display: grid;
  gap: var(--space-4);
}
.source-settings__section {
  padding: var(--space-4);
}
.source-settings__section > header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-4);
  margin-bottom: var(--space-4);
}
.source-settings h2 {
  color: var(--text-primary);
  font-size: var(--text-base);
}
.source-settings header p {
  margin-top: var(--space-1);
  color: var(--text-muted);
  font-size: var(--text-xs);
}
.source-settings__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-4);
}
.source-settings__toggles {
  display: grid;
  gap: var(--space-3);
}
.source-settings__warning {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin-top: var(--space-3);
  padding: var(--space-2_5);
  border: 1px solid var(--warning-border);
  border-radius: var(--radius-lg);
  color: var(--warning);
  background: var(--warning-soft);
  font-size: var(--text-xs);
}
@media (max-width: 680px) {
  .source-settings__grid {
    grid-template-columns: 1fr;
  }
  .source-settings__section > header {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
