<template>
  <form class="source-settings" @submit.prevent="save">
    <footer class="section-card source-settings__save">
      <p role="status">
        <AppIcon :name="hasChanges ? 'edit' : 'checkCircle'" :size="16" />{{
          hasChanges ? '有未保存的修改' : '所有设置已同步'
        }}
      </p>
      <div>
        <button v-if="hasChanges" class="btn btn-secondary" type="button" :disabled="saving" @click="discard">
          <AppIcon name="rotateCcw" :size="16" />取消修改</button
        ><button class="btn btn-primary" type="submit" :disabled="saving || !hasChanges">
          <AppIcon :name="saving ? 'loader' : 'save'" :size="16" :class="{ 'animate-spin': saving }" />{{
            saving ? '保存中…' : '保存设置'
          }}
        </button>
      </div>
    </footer>
    <div v-if="defaultsError" class="source-settings__warning" role="alert">
      <span>{{ defaultsError }}</span
      ><button class="btn btn-secondary btn-sm" type="button" :disabled="defaultsLoading" @click="loadDefaults">
        重试全局设置
      </button>
    </div>
    <section class="section-card source-settings__section">
      <header>
        <AppIcon name="music" :size="20" />
        <div>
          <h2>收藏与目标</h2>
        </div>
      </header>
      <div class="source-settings__grid">
        <FormField label="任务名称"><input v-model="form.name" class="form-input" /></FormField>
        <FormField label="Plex 目标歌单"><input v-model="form.plexPlaylistName" class="form-input" /></FormField>
      </div>
      <div v-if="source.type === 'playlist'" class="source-settings__toggles">
        <ToggleField v-model="form.autoCreatePlexPlaylist" label="自动创建 Plex 歌单" hint="目标不存在时创建" />
      </div>
    </section>
    <section class="section-card source-settings__section">
      <header>
        <AppIcon name="download" :size="20" />
        <div><h2>下载设置</h2></div>
      </header>
      <FormField label="下载音质" hint="仅影响这份收藏之后的下载；更改后不会自动重新下载已有音乐。">
        <select v-model="form.quality" class="form-input" aria-label="收藏下载音质">
          <option :value="null">使用全局设置{{ globalQualityLabel ? `（${globalQualityLabel}）` : '' }}</option>
          <option v-for="option in AUDIO_QUALITY_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option>
        </select>
      </FormField>
    </section>
    <section class="section-card source-settings__section">
      <header>
        <AppIcon name="calendar" :size="20" />
        <div>
          <h2>同步安排</h2>
        </div>
      </header>
      <div class="source-settings__grid">
        <FormField v-if="source.type === 'playlist'" label="同步数量上限" hint="留空使用全局设置"
          ><input v-model.number="form.syncLimit" type="number" min="0" class="form-input" placeholder="使用全局设置"
        /></FormField>
        <FormField label="自动同步间隔（分钟）" hint="留空使用全局设置"
          ><input
            v-model.number="form.syncIntervalMinutes"
            type="number"
            min="1"
            max="1440"
            class="form-input"
            placeholder="使用全局设置"
        /></FormField>
      </div>
      <div class="source-settings__toggles">
        <ToggleField v-model="form.enabled" label="自动同步" />
      </div>
    </section>
    <section v-if="source.type === 'playlist'" class="section-card source-settings__section">
      <header>
        <AppIcon name="shield" :size="20" />
        <div>
          <h2>首次媒体接管</h2>
        </div>
      </header>
      <SourceBooleanOverride
        v-model="form.initializeMediaOnFirstSync"
        label="首次同步前确认已有音乐"
        :global-value="globalInitialize"
        hint="启用时首次同步先推荐已有文件，确认后再开始同步"
      />
      <p v-if="form.initializeMediaOnFirstSync === false" class="source-settings__warning">
        <AppIcon name="warn" :size="14" />关闭后，没有确认使用的歌曲可能需要重新下载。
      </p>
    </section>
    <section class="section-card source-settings__section">
      <header>
        <AppIcon name="settings" :size="20" />
        <div>
          <h2>同步策略</h2>
        </div>
      </header>
      <div class="source-settings__toggles">
        <SourceBooleanOverride
          v-model="form.forceFullCompare"
          label="每次检查完整歌单"
          :global-value="globalForceFull"
        />
        <PlexExtraTracksPolicy
          v-model="form.skipRemoveExtraTracks"
          :policy="globalRemovalPolicy"
          :global-skip="globalSkipRemove"
          inherit
        />
        <SourceBooleanOverride
          v-if="source.type === 'album'"
          v-model="form.skipPlexPlaylist"
          label="仅下载不入歌单"
          :global-value="globalSkipPlaylist"
        />
      </div>
    </section>
    <p v-if="error" class="text-danger text-xs" role="alert">{{ error }}</p>

    <UnsavedChangesGuard :dirty="hasChanges" :saving="saving" />
  </form>
</template>

<script setup lang="ts">
import type { PlaylistSource } from '~~/server/lib/playlist/types'
import type { AppConfig, ExtraTrackRemovalPolicy } from '~~/server/lib/config/types'
import { AUDIO_QUALITY_OPTIONS, type AudioQuality } from '~~/shared/audio-quality'
const props = defineProps<{ source: PlaylistSource }>()
const emit = defineEmits<{ saved: [source: PlaylistSource] }>()
const api = useApi()
const saving = ref(false)
const error = ref('')
const globalInitialize = ref<boolean | null>(null)
const globalForceFull = ref<boolean | null>(null)
const globalSkipRemove = ref<boolean | null>(null)
const globalRemovalPolicy = ref<ExtraTrackRemovalPolicy | null>(null)
const globalSkipPlaylist = ref<boolean | null>(null)
const globalQuality = ref<AudioQuality | null>(null)
const globalQualityLabel = computed(() => AUDIO_QUALITY_OPTIONS.find(option => option.value === globalQuality.value)?.label)
function settings(source: PlaylistSource) {
  return {
    name: source.name,
    quality: source.quality ?? null,
    plexPlaylistName: source.plexPlaylistName,
    syncLimit: source.syncLimit,
    syncIntervalMinutes: source.syncIntervalMinutes,
    enabled: source.enabled,
    autoCreatePlexPlaylist: source.autoCreatePlexPlaylist,
    initializeMediaOnFirstSync: source.initializeMediaOnFirstSync ?? null,
    forceFullCompare: source.forceFullCompare,
    skipRemoveExtraTracks: source.skipRemoveExtraTracks,
    skipPlexPlaylist: source.skipPlexPlaylist,
  }
}
const baseline = ref(settings(props.source))
const form = reactive({ ...baseline.value })
const hasChanges = computed(() => JSON.stringify(form) !== JSON.stringify(baseline.value))
function discard() {
  baseline.value = settings(props.source)
  Object.assign(form, baseline.value)
  error.value = ''
}
watch(
  () => props.source,
  () => {
    if (!hasChanges.value && !saving.value) discard()
  },
)
const defaultsError = ref(''),
  defaultsLoading = ref(false)
function nullableNumber(value: number | string | null) {
  return value === '' || value === null ? null : Number(value)
}
async function save() {
  if (saving.value) return
  saving.value = true
  error.value = ''
  const submitted = { ...form }
  try {
    const source = await api.put<PlaylistSource>(`/playlist-sources/${props.source.id}`, {
      ...submitted,
      syncLimit: nullableNumber(submitted.syncLimit),
      syncIntervalMinutes: nullableNumber(submitted.syncIntervalMinutes),
    })
    if (JSON.stringify(form) === JSON.stringify(submitted)) Object.assign(form, settings(source))
    baseline.value = settings(source)
    emit('saved', source)
  } catch (value) {
    error.value = value instanceof Error ? value.message : '保存失败'
  } finally {
    saving.value = false
  }
}
async function loadDefaults() {
  defaultsLoading.value = true
  defaultsError.value = ''
  try {
    const config = await api.get<AppConfig>('/config')
    globalQuality.value = config.netease.quality
    globalInitialize.value = config.sync.initializeMediaOnFirstSync ?? true
    globalForceFull.value = config.sync.forceFullCompare
    globalSkipRemove.value = config.sync.skipRemoveExtraTracks
    globalRemovalPolicy.value = config.sync.extraTrackRemovalPolicy
    globalSkipPlaylist.value = config.sync.skipPlexPlaylist
  } catch {
    defaultsError.value = '无法读取全局设置，继承值暂时未知。'
  } finally {
    defaultsLoading.value = false
  }
}
onMounted(loadDefaults)
</script>

<style scoped>
.source-settings {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
.source-settings__section {
  padding: var(--space-5);
}
.source-settings__section > header {
  display: flex;
  align-items: flex-start;
  gap: var(--space-4);
  margin-bottom: var(--space-4);
}
.source-settings h2 {
  color: var(--text-primary);
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
  margin-top: var(--space-4);
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
.source-settings__section > header > svg {
  color: var(--text-secondary);
  flex-shrink: 0;
  margin-top: var(--space-0_5);
}
.source-settings__save {
  position: sticky;
  top: calc(var(--app-topbar-block-size) + var(--space-3));
  z-index: var(--z-sticky);
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-3);
  padding: var(--space-4) var(--space-5);
  box-shadow: var(--shadow-md);
}
.source-settings__save p,
.source-settings__save > div {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.source-settings__save p {
  color: var(--text-secondary);
  font-size: var(--text-sm);
}
@media (max-width: 680px) {
  .source-settings__section > header {
    flex-direction: row;
  }
  .source-settings__save > div {
    flex: 1;
    justify-content: flex-end;
  }
}
</style>
