<template>
  <div class="initialization-matching-settings">
    <div class="initialization-matching-settings__notice initialization-matching-settings__notice--experimental" role="note" data-testid="experimental-matching-notice">
      <AppIcon name="info" :size="16" />
      <div>
        <strong>实验功能：增强初始化匹配。</strong>
        <p>保存后用于新发起的接管分析，候选由你确认。</p>
      </div>
    </div>

    <p v-if="hasUnsavedMatchingChanges" class="initialization-matching-settings__presets-hint">当前匹配设置有未保存的修改，请使用页面底部的保存条。</p>

    <ConfigSection section-key="matching.presets" title="匹配总开关与预设" description="先选择整体宽松程度，再按需要关闭单项规则" search-tab="matching" search-keywords="开关 预设" :collapsed="!!collapsed['匹配总开关与预设']" @toggle="collapsed['匹配总开关与预设'] = !collapsed['匹配总开关与预设']">
      <template #icon><SidebarIcon name="filter" :active="true" /></template>
      <ToggleField :model-value="modelValue.enabled" setting="initializationMatching.enabled" label="启用增强初始化匹配" search-keywords="增强匹配 开关" hint="默认关闭；启用后首次接管会使用这里的候选规则" @update:model-value="update('enabled', $event)" />
      <div class="initialization-matching-settings__presets" role="group" aria-label="匹配预设">
        <button v-for="preset in presetOptions" :key="preset.value" type="button" class="initialization-matching-settings__preset" :class="{ 'is-selected': selectedPreset === preset.value }" :aria-pressed="selectedPreset === preset.value" @click="applyPreset(preset.value)">
          <strong>{{ preset.label }}</strong><span>{{ preset.description }}</span>
        </button>
      </div>
      <p class="initialization-matching-settings__presets-hint">切换预设会保留当前的艺人别名、标题别名、候选优先目录和快速初始化分数线；继续手动调整即为「自定义」。</p>
    </ConfigSection>

    <ConfigSection section-key="matching.rules" title="标题与艺人规则" description="控制名称写法如何统一比较，以及候选使用哪些标题和艺人字段" search-tab="matching" search-keywords="标题 艺人 字段" :collapsed="!!collapsed['标题与艺人规则']" @toggle="collapsed['标题与艺人规则'] = !collapsed['标题与艺人规则']">
      <template #icon><SidebarIcon name="music" :active="true" /></template>
      <div class="initialization-matching-settings__toggle-grid">
        <ToggleField :model-value="modelValue.foldChinese" setting="initializationMatching.foldChinese" label="简繁中文视为相同" search-keywords="简体 繁体" hint="将简体和繁体写法视为同一比较输入" @update:model-value="update('foldChinese', $event)" />
        <ToggleField :model-value="modelValue.normalizeTypography" setting="initializationMatching.normalizeTypography" label="统一全半角与标点" search-keywords="全角 半角 宽度" hint="统一文字宽度和常见标点；名称比较始终忽略大小写" @update:model-value="update('normalizeTypography', $event)" />
        <ToggleField :model-value="modelValue.ignoreContextNotes" setting="initializationMatching.ignoreContextNotes" label="忽略标题说明备注" search-keywords="电影 出处" hint="仅忽略电影出处、宣传或制作人等备注；版本保护仍按下方规则生效" @update:model-value="update('ignoreContextNotes', $event)" />
        <ToggleField :model-value="modelValue.bilingualTitles" setting="initializationMatching.bilingualTitles" label="比较双语标题" search-keywords="翻译 原文" hint="允许原文标题与翻译标题共同参与候选比较" @update:model-value="update('bilingualTitles', $event)" />
        <ToggleField :model-value="modelValue.fuzzyTitles" setting="initializationMatching.fuzzyTitles" label="启用模糊标题" search-keywords="相似 模糊" hint="扩大标题相似候选，更多结果会进入人工复核" @update:model-value="update('fuzzyTitles', $event)" />
        <ToggleField :model-value="modelValue.supplementalTitleRecall" setting="initializationMatching.supplementalTitleRecall" label="补充更多标题候选" search-keywords="附注 数字 古典" hint="作品附注、双语标题、数字写法与古典作品编号等仅用于补充待审候选" @update:model-value="update('supplementalTitleRecall', $event)" />
        <ToggleField :model-value="modelValue.metadataFallback" setting="initializationMatching.metadataFallback" label="专辑曲序补充检索" search-keywords="曲序 时长" hint="标题未命中时，按艺人、专辑、曲序和时长补充待审候选" @update:model-value="update('metadataFallback', $event)" />
        <ToggleField :model-value="modelValue.preferExactAlbum" setting="initializationMatching.preferExactAlbum" label="目标专辑唯一优选" hint="艺人、专辑和曲序完全一致、时长差不超过 500 毫秒，且同专辑只有一个候选时优先推荐。" @update:model-value="update('preferExactAlbum', $event)" />
        <ToggleField :model-value="modelValue.corroboratedRecommendations" setting="initializationMatching.corroboratedRecommendations" label="多项信息印证时推荐" hint="标题、专辑、曲序、时长和路径相符时，可推荐艺人标签有差异的唯一候选。" @update:model-value="update('corroboratedRecommendations', $event)" />
        <ToggleField :model-value="modelValue.useTrackArtist" setting="initializationMatching.useTrackArtist" label="使用歌曲艺人" hint="将歌曲艺人加入候选比较字段" @update:model-value="update('useTrackArtist', $event)" />
        <ToggleField :model-value="modelValue.useArtistAliases" setting="initializationMatching.useArtistAliases" label="使用艺人别名" hint="使用艺人名称页中已开启的匹配规则" @update:model-value="update('useArtistAliases', $event)" />
        <ToggleField :model-value="modelValue.usePathHints" setting="initializationMatching.usePathHints" label="使用文件路径提示" search-keywords="目录 文件名" hint="以目录和文件名辅助候选比较" @update:model-value="update('usePathHints', $event)" />
      </div>
      <div class="initialization-matching-settings__field-grid">
        <FormField setting="initializationMatching.artistPolicy" label="歌曲艺人策略" search-keywords="合作艺人 主艺人" hint="完整艺人集合可进入推荐；主艺人命中时允许进入复核，不移除合作艺人"><select :value="modelValue.artistPolicy" class="form-input" @change="update('artistPolicy', ($event.target as HTMLSelectElement).value as InitializationMatchingConfig['artistPolicy'])"><option value="complete">完整艺人集合</option><option value="primary">主艺人可复核</option></select></FormField>
        <FormField setting="initializationMatching.albumPolicy" label="专辑字段策略" hint="决定专辑字段必须匹配、参与比较或不参与比较"><select :value="modelValue.albumPolicy" class="form-input" @change="update('albumPolicy', ($event.target as HTMLSelectElement).value as InitializationMatchingConfig['albumPolicy'])"><option value="require">必须匹配</option><option value="prefer">参与比较</option><option value="ignore">忽略</option></select></FormField>
        <FormField setting="initializationMatching.trackPolicy" label="曲序字段策略" hint="只比较曲序，不比较曲名；决定曲序必须匹配、参与比较或忽略"><select :value="modelValue.trackPolicy" class="form-input" @change="update('trackPolicy', ($event.target as HTMLSelectElement).value as InitializationMatchingConfig['trackPolicy'])"><option value="require">必须匹配</option><option value="prefer">参与比较</option><option value="ignore">忽略</option></select></FormField>
      </div>
    </ConfigSection>

    <ConfigSection section-key="matching.recommendations" title="批量推荐策略" description="控制多候选、双语标题与艺人差异的推荐方式" search-tab="matching" search-keywords="推荐 候选 MusicBrainz" :collapsed="!!collapsed['批量推荐策略']" @toggle="collapsed['批量推荐策略'] = !collapsed['批量推荐策略']">
      <template #icon><SidebarIcon name="checkCircle" :active="true" /></template>
      <div class="initialization-matching-settings__field-grid">
        <FormField setting="initializationMatching.duplicatePolicy" label="多个候选时" search-keywords="重复 最高质量" hint="按无损、位深、采样率和码率优选，或保留人工复核。"><select :value="modelValue.duplicatePolicy" class="form-input" @change="update('duplicatePolicy', ($event.target as HTMLSelectElement).value as InitializationMatchingConfig['duplicatePolicy'])"><option value="highest_quality">优选最高质量</option><option value="review">保留人工复核</option></select></FormField>
      </div>
      <ToggleField :model-value="modelValue.foldArtistDiacritics" setting="initializationMatching.foldArtistDiacritics" label="忽略艺人名重音符号" search-keywords="变音 重音" hint="比较 GIVĒON / Giveon 等艺人名写法" @update:model-value="update('foldArtistDiacritics', $event)" />
      <ToggleField :model-value="modelValue.corroboratedBilingualTitles" setting="initializationMatching.corroboratedBilingualTitles" label="双语标题印证时推荐" hint="需开启「比较双语标题」；完整艺人、专辑和曲序一致且时长差不超过 500 毫秒时推荐。" @update:model-value="update('corroboratedBilingualTitles', $event)" />
      <ToggleField :model-value="modelValue.ignoreMissingCollaborators" setting="initializationMatching.ignoreMissingCollaborators" label="忽略缺失合作歌手" search-keywords="合唱" hint="主艺人一致且仅缺少合作歌手时，按标题和时长推荐；新增艺人或版本差异需复核。" @update:model-value="update('ignoreMissingCollaborators', $event)" />
      <ToggleField :model-value="modelValue.musicBrainzAliases" setting="initializationMatching.musicBrainzAliases" label="MusicBrainz 艺人别名辅助" search-keywords="MB 别名" hint="将待确认的艺人名发送至 MusicBrainz 查询，仅采用同名且唯一的记录。需开启「使用艺人别名」。" @update:model-value="update('musicBrainzAliases', $event)" />
      <div class="initialization-matching-settings__field-grid">
        <FormField setting="initializationMatching.musicBrainzMinScore" label="MusicBrainz 最低搜索分" search-keywords="评分 阈值" hint="90–100，越高越严格。"><input :value="modelValue.musicBrainzMinScore" class="form-input" type="number" min="90" max="100" @input="updateNumber('musicBrainzMinScore', $event)" /></FormField>
        <FormField setting="initializationMatching.musicBrainzMaxArtists" label="MusicBrainz 每轮艺人上限" search-keywords="数量 限制" hint="1–200，优先查询出现次数多的艺人，约每秒一次。"><input :value="modelValue.musicBrainzMaxArtists" class="form-input" type="number" min="1" max="200" @input="updateNumber('musicBrainzMaxArtists', $event)" /></FormField>
      </div>
    </ConfigSection>

    <ConfigSection section-key="matching.quick" title="快速初始化" description="快速接管的分数线，只作为新预览的默认值" search-tab="matching" search-keywords="分数线 阈值" :collapsed="!!collapsed['快速初始化']" @toggle="collapsed['快速初始化'] = !collapsed['快速初始化']">
      <template #icon><SidebarIcon name="play" :active="true" /></template>
      <FormField setting="initializationMatching.quickMatchThreshold" label="快速初始化分数线" search-keywords="阈值 快速接管" hint="0–100，默认 85；用于新预览。"><input :value="modelValue.quickMatchThreshold" class="form-input" type="number" min="0" max="100" step="1" @input="updateNumber('quickMatchThreshold', $event)" /></FormField>
    </ConfigSection>

    <ConfigSection section-key="matching.versions" title="时长与版本规则" description="区分可直接推荐的候选和需要人工确认的候选" search-tab="matching" search-keywords="时长 Remaster Edition Explicit" :collapsed="!!collapsed['时长与版本规则']" @toggle="collapsed['时长与版本规则'] = !collapsed['时长与版本规则']">
      <template #icon><SidebarIcon name="clock" :active="true" /></template>
      <div class="initialization-matching-settings__field-grid">
        <FormField setting="initializationMatching.recommendDurationMs" label="推荐时长差（毫秒）" search-keywords="阈值" hint="低于此差值可进入推荐"><input :value="modelValue.recommendDurationMs" class="form-input" type="number" min="0" max="30000" step="100" @input="updateNumber('recommendDurationMs', $event)" /></FormField>
        <FormField setting="initializationMatching.reviewDurationMs" label="复核时长差（毫秒）" search-keywords="阈值" hint="低于此差值可进入人工复核"><input :value="modelValue.reviewDurationMs" class="form-input" type="number" min="0" max="30000" step="100" @input="updateNumber('reviewDurationMs', $event)" /></FormField>
        <FormField setting="initializationMatching.recommendDurationPercent" label="推荐时长差（百分比）" search-keywords="阈值" hint="与毫秒阈值取更严格的一项"><input :value="modelValue.recommendDurationPercent" class="form-input" type="number" min="0" max="10" step="0.5" @input="updateNumber('recommendDurationPercent', $event)" /></FormField>
        <FormField setting="initializationMatching.missingDuration" label="缺少时长时" hint="没有任一侧时长时的处理方式"><select :value="modelValue.missingDuration" class="form-input" @change="update('missingDuration', ($event.target as HTMLSelectElement).value as InitializationMatchingConfig['missingDuration'])"><option value="exclude">排除</option><option value="review">进入复核</option></select></FormField>
        <FormField setting="initializationMatching.remasterPolicy" label="Remaster 版本" search-keywords="重制版" hint="原版与重制版信息不一致时，严格模式禁止推荐"><select :value="modelValue.remasterPolicy" class="form-input" @change="update('remasterPolicy', ($event.target as HTMLSelectElement).value as InitializationMatchingConfig['remasterPolicy'])"><option value="strict">禁止推荐</option><option value="review">进入复核</option><option value="allow">允许推荐</option></select></FormField>
        <FormField setting="initializationMatching.editionPolicy" label="Edition 版本" search-keywords="单曲 Radio Edit" hint="比较单曲、专辑或 Radio Edit 版本；严格模式禁止推荐"><select :value="modelValue.editionPolicy" class="form-input" @change="update('editionPolicy', ($event.target as HTMLSelectElement).value as InitializationMatchingConfig['editionPolicy'])"><option value="strict">禁止推荐</option><option value="review">进入复核</option></select></FormField>
        <FormField setting="initializationMatching.explicitPolicy" label="Explicit 标记" search-keywords="Clean" hint="显式与 Clean 标记不一致时，严格模式禁止推荐"><select :value="modelValue.explicitPolicy" class="form-input" @change="update('explicitPolicy', ($event.target as HTMLSelectElement).value as InitializationMatchingConfig['explicitPolicy'])"><option value="strict">禁止推荐</option><option value="review">进入复核</option></select></FormField>
        <FormField setting="initializationMatching.unknownVersion" label="单侧版本信息" hint="只有一侧有版本信息时的处理"><select :value="modelValue.unknownVersion" class="form-input" @change="update('unknownVersion', ($event.target as HTMLSelectElement).value as InitializationMatchingConfig['unknownVersion'])"><option value="exclude">排除</option><option value="review">进入复核</option></select></FormField>
      </div>
      <div class="initialization-matching-settings__toggle-grid">
        <ToggleField :model-value="modelValue.showVersionConflicts" setting="initializationMatching.showVersionConflicts" label="显示版本冲突" hint="关闭后隐藏严格模式冲突候选；开启后在预览详情中保留冲突理由" @update:model-value="update('showVersionConflicts', $event)" />
        <ToggleField :model-value="modelValue.preferLossless" setting="initializationMatching.preferLossless" label="优先无损文件" search-keywords="FLAC 音质" hint="候选都有匹配时优先展示无损文件" @update:model-value="update('preferLossless', $event)" />
      </div>
    </ConfigSection>

    <ConfigSection section-key="matching.aliases" title="别名规则" description="艺人名称统一管理；标题别名单独配置" search-tab="matching" search-keywords="别名 目录" :collapsed="!!collapsed['别名规则']" @toggle="collapsed['别名规则'] = !collapsed['别名规则']">
      <template #icon><SidebarIcon name="link" :active="true" /></template>
      <button type="button" class="btn btn-ghost" @click="$emit('open-artist-names')">管理艺人名称<AppIcon name="arrowRight" :size="14" /></button>
      <FormField setting="initializationMatching.titleAliases" label="标题别名" search-keywords="旧标题" hint="标题别名与艺人别名相互独立，支持每条规则多个旧标题">
        <MatchingAliasEditor v-model="titleAliases" kind="title" />
      </FormField>
      <FormField setting="initializationMatching.preferredDirectory" label="候选优先目录" search-keywords="首选目录 Plex 路径 排序" hint="匹配评分等条件相同时，优先排列此目录及子目录中的候选。填写 Plex 看到的路径；不影响下载位置，留空则不设置目录偏好。"><input :value="modelValue.preferredDirectory" class="form-input" type="text" placeholder="可选，如 /music/main" @input="update('preferredDirectory', ($event.target as HTMLInputElement).value)" /></FormField>
    </ConfigSection>

    <MatchingPreview :config="modelValue" @use-alias-suggestion="applySuggestion" />
  </div>
</template>

<script setup lang="ts">
import type { InitializationMatchingConfig, MatchingAlias, MatchingPreset, MatchingPresetSelection } from '~~/shared/initialization-matching'
import { matchingPreset, matchingPresetSelection } from '~~/shared/initialization-matching'

const props = defineProps<{
  modelValue: InitializationMatchingConfig
  savedConfig: InitializationMatchingConfig
}>()

const emit = defineEmits<{
  'open-artist-names': []
  'update:modelValue': [value: InitializationMatchingConfig]
}>()

const presets: Array<{ value: MatchingPreset; label: string; description: string }> = [
  { value: 'conservative', label: '保守', description: '严格版本与字段要求，更多条目进入复核。' },
  { value: 'balanced', label: '平衡', description: '在自动候选覆盖和人工复核之间取平衡。' },
  { value: 'discovery', label: '发现', description: '扩大标题和主艺人候选，适合整理探索。' },
]

const selectedPreset = computed(() => matchingPresetSelection(props.modelValue))
const presetOptions = computed<Array<{ value: MatchingPresetSelection; label: string; description: string }>>(() => [
  ...presets,
  {
    value: 'custom', label: '自定义',
    description: selectedPreset.value === 'custom'
      ? '当前参数与预设不同，使用自定义设置。'
      : '手动调整参数后使用自定义设置。',
  },
])

const titleAliases = computed<MatchingAlias[]>({
  get: () => props.modelValue.titleAliases,
  set: value => update('titleAliases', value),
})
const hasUnsavedMatchingChanges = computed(() => JSON.stringify(props.modelValue) !== JSON.stringify(props.savedConfig))

function update<K extends keyof InitializationMatchingConfig>(key: K, value: InitializationMatchingConfig[K]) {
  emit('update:modelValue', { ...props.modelValue, [key]: value })
}

function updateNumber(key: 'recommendDurationMs' | 'reviewDurationMs' | 'recommendDurationPercent' | 'musicBrainzMinScore' | 'musicBrainzMaxArtists' | 'quickMatchThreshold', event: Event) {
  const value = Number((event.target as HTMLInputElement).value)
  update(key, Number.isFinite(value) ? value : 0)
}

function applyPreset(preset: MatchingPresetSelection) {
  if (preset === 'custom') return
  const next = matchingPreset(preset)
  emit('update:modelValue', {
    ...next,
    artistAliases: props.modelValue.artistAliases.map(rule => ({ ...rule, aliases: [...rule.aliases] })),
    titleAliases: props.modelValue.titleAliases.map(rule => ({ ...rule, aliases: [...rule.aliases] })),
    preferredDirectory: props.modelValue.preferredDirectory,
    quickMatchThreshold: props.modelValue.quickMatchThreshold,
  })
}

function applySuggestion(suggestion: MatchingAlias & { count: number; examples: string[] }) {
  const current = props.modelValue.artistAliases.map(rule => ({ ...rule, aliases: [...rule.aliases] }))
  const existing = current.find(rule => rule.name === suggestion.name)
  if (existing) existing.aliases = [...new Set([...existing.aliases, ...suggestion.aliases])]
  else current.push({ name: suggestion.name, aliases: [...suggestion.aliases], enabled: true })
  update('artistAliases', current)
}

const collapsed = reactive<Record<string, boolean>>({})

</script>

<style scoped>
.initialization-matching-settings {
  display: grid;
  gap: var(--space-5);
}

.initialization-matching-settings__notice {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2_5);
  padding: var(--space-3_5);
  border: 1px solid var(--accent);
  border-radius: var(--radius-md);
  background: var(--accent-muted);
  color: var(--text-secondary);
  font-size: var(--text-sm);
  line-height: var(--body-leading);
}

.initialization-matching-settings__notice > .app-icon {
  flex: 0 0 auto;
  margin-top: 0.1rem;
  color: var(--accent);
}

.initialization-matching-settings__notice strong {
  color: var(--text-primary);
}

.initialization-matching-settings__notice--experimental {
  border-style: dashed;
  background: var(--bg-input);
}

.initialization-matching-settings__notice p {
  margin: var(--space-1) 0 0;
}

.initialization-matching-settings__presets {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--space-2);
}

.initialization-matching-settings__preset {
  display: grid;
  min-height: 6.5rem;
  gap: var(--space-1_5);
  padding: var(--space-3);
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-md);
  background: var(--bg-input);
  color: var(--text-primary);
  cursor: pointer;
  text-align: left;
  transition: border-color var(--duration-fast) ease, background-color var(--duration-fast) ease;
}

.initialization-matching-settings__preset:hover,
.initialization-matching-settings__preset:focus-visible {
  border-color: var(--accent);
}

.initialization-matching-settings__preset:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.initialization-matching-settings__preset.is-selected {
  border-color: var(--accent);
  background: var(--accent-muted);
}

.initialization-matching-settings__preset strong {
  font-size: var(--text-sm);
}

.initialization-matching-settings__preset span,
.initialization-matching-settings__presets-hint {
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  line-height: var(--body-leading);
}

.initialization-matching-settings__presets-hint {
  margin: calc(var(--space-2) * -1) 0 0;
}

.initialization-matching-settings__toggle-grid,
.initialization-matching-settings__field-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-3);
}

.initialization-matching-settings__field-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

@media (max-width: 900px) {
  .initialization-matching-settings__presets,
  .initialization-matching-settings__field-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 767px) {
  .initialization-matching-settings__presets,
  .initialization-matching-settings__toggle-grid,
  .initialization-matching-settings__field-grid {
    grid-template-columns: 1fr;
  }
}
</style>
