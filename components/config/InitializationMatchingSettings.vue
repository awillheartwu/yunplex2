<template>
  <div class="initialization-matching-settings">
    <div class="initialization-matching-settings__notice initialization-matching-settings__notice--experimental" role="note" data-testid="experimental-matching-notice">
      <AppIcon name="info" :size="16" />
      <div>
        <strong>实验功能：增强初始化匹配。</strong>
        <p>默认关闭；标准首次接管流程仍然可用。保存后仅对新发起的接管分析生效，候选仍需人工确认，不会自动下载、建立媒体关联或修改 Plex。</p>
      </div>
    </div>

    <p v-if="hasUnsavedMatchingChanges" class="initialization-matching-settings__presets-hint">当前匹配设置有未保存的修改，请使用页面底部的保存条。</p>

    <ConfigSection title="匹配总开关与预设" description="先选择整体宽松程度，再按需要关闭单项规则" :collapsed="!!collapsed['匹配总开关与预设']" @toggle="collapsed['匹配总开关与预设'] = !collapsed['匹配总开关与预设']">
      <ToggleField :model-value="modelValue.enabled" label="启用增强初始化匹配" hint="默认关闭；启用后首次接管会使用这里的候选规则" @update:model-value="update('enabled', $event)" />
      <div class="initialization-matching-settings__presets" role="group" aria-label="匹配预设">
        <button v-for="preset in presetOptions" :key="preset.value" type="button" class="initialization-matching-settings__preset" :class="{ 'is-selected': selectedPreset === preset.value }" :aria-pressed="selectedPreset === preset.value" @click="applyPreset(preset.value)">
          <strong>{{ preset.label }}</strong><span>{{ preset.description }}</span>
        </button>
      </div>
      <p class="initialization-matching-settings__presets-hint">切换预设会保留当前的艺人别名、标题别名、首选目录和快速初始化分数线；继续手动调整即为「自定义」。</p>
    </ConfigSection>

    <ConfigSection title="标题与艺人规则" description="控制名称归一化和候选使用的标题、艺人字段" :collapsed="!!collapsed['标题与艺人规则']" @toggle="collapsed['标题与艺人规则'] = !collapsed['标题与艺人规则']">
      <div class="initialization-matching-settings__toggle-grid">
        <ToggleField :model-value="modelValue.foldChinese" label="简繁中文折叠" hint="将简体和繁体写法视为同一比较输入" @update:model-value="update('foldChinese', $event)" />
        <ToggleField :model-value="modelValue.normalizeTypography" label="统一全半角与标点" hint="统一文字宽度和常见标点；名称比较始终忽略大小写" @update:model-value="update('normalizeTypography', $event)" />
        <ToggleField :model-value="modelValue.ignoreContextNotes" label="忽略标题说明备注" hint="仅忽略电影出处、宣传或制作人等备注；版本保护仍按下方规则生效" @update:model-value="update('ignoreContextNotes', $event)" />
        <ToggleField :model-value="modelValue.bilingualTitles" label="比较双语标题" hint="允许原文标题与翻译标题共同参与候选比较" @update:model-value="update('bilingualTitles', $event)" />
        <ToggleField :model-value="modelValue.fuzzyTitles" label="启用模糊标题" hint="扩大标题相似候选，更多结果会进入人工复核" @update:model-value="update('fuzzyTitles', $event)" />
        <ToggleField :model-value="modelValue.supplementalTitleRecall" label="扩展标题召回" hint="作品附注、双语标题、数字写法与古典作品编号等仅用于补充待审候选" @update:model-value="update('supplementalTitleRecall', $event)" />
        <ToggleField :model-value="modelValue.metadataFallback" label="专辑曲序补充检索" hint="标题未命中时，以艺人、同专辑、同曲序和接近时长找回待审候选，不直接推荐" @update:model-value="update('metadataFallback', $event)" />
        <ToggleField :model-value="modelValue.preferExactAlbum" label="目标专辑唯一优选" hint="多个候选中，仅当一个完整艺人、专辑和曲序严格一致且时差不超过 500 毫秒，其余候选都来自不同专辑时推荐该项；多个候选策略设为人工复核时，同专辑重复文件仍需选择" @update:model-value="update('preferExactAlbum', $event)" />
        <ToggleField :model-value="modelValue.corroboratedRecommendations" label="交叉证据推荐" hint="仅在标题、专辑、曲序、时长及文件路径信息相互印证时，将艺人标签差异或缺失参与者的唯一候选列为推荐；仍需确认接管。" @update:model-value="update('corroboratedRecommendations', $event)" />
        <ToggleField :model-value="modelValue.useTrackArtist" label="使用歌曲艺人" hint="将歌曲艺人加入候选比较字段" @update:model-value="update('useTrackArtist', $event)" />
        <ToggleField :model-value="modelValue.useArtistAliases" label="使用艺人别名" hint="使用艺人名称页中已开启的匹配规则" @update:model-value="update('useArtistAliases', $event)" />
        <ToggleField :model-value="modelValue.usePathHints" label="使用文件路径提示" hint="路径只用于候选提示，不能单独建立身份绑定" @update:model-value="update('usePathHints', $event)" />
      </div>
      <div class="initialization-matching-settings__field-grid">
        <FormField label="歌曲艺人策略" hint="完整艺人集合可进入推荐；主艺人命中时允许进入复核，不移除合作艺人"><select :value="modelValue.artistPolicy" class="form-input" @change="update('artistPolicy', ($event.target as HTMLSelectElement).value as InitializationMatchingConfig['artistPolicy'])"><option value="complete">完整艺人集合</option><option value="primary">主艺人可复核</option></select></FormField>
        <FormField label="专辑字段策略" hint="决定专辑字段必须匹配、参与比较或不参与比较"><select :value="modelValue.albumPolicy" class="form-input" @change="update('albumPolicy', ($event.target as HTMLSelectElement).value as InitializationMatchingConfig['albumPolicy'])"><option value="require">必须匹配</option><option value="prefer">参与比较</option><option value="ignore">忽略</option></select></FormField>
        <FormField label="曲序字段策略" hint="只比较曲序，不比较曲名；决定曲序必须匹配、参与比较或忽略"><select :value="modelValue.trackPolicy" class="form-input" @change="update('trackPolicy', ($event.target as HTMLSelectElement).value as InitializationMatchingConfig['trackPolicy'])"><option value="require">必须匹配</option><option value="prefer">参与比较</option><option value="ignore">忽略</option></select></FormField>
      </div>
    </ConfigSection>

    <ConfigSection title="批量推荐策略" description="按你的偏好减少复核；版本和媒体身份冲突仍保留拦截" :collapsed="!!collapsed['批量推荐策略']" @toggle="collapsed['批量推荐策略'] = !collapsed['批量推荐策略']">
      <div class="initialization-matching-settings__field-grid">
        <FormField label="多个候选时" hint="默认选择合格候选中质量最高的一首：无损、位深、采样率、码率依次优先；同质量稳定选择。其他候选仍保留，质量不证明录音相同。"><select :value="modelValue.duplicatePolicy" class="form-input" @change="update('duplicatePolicy', ($event.target as HTMLSelectElement).value as InitializationMatchingConfig['duplicatePolicy'])"><option value="highest_quality">优选最高质量</option><option value="review">保留人工复核</option></select></FormField>
      </div>
      <ToggleField :model-value="modelValue.foldArtistDiacritics" label="折叠艺人拉丁重音" hint="默认关闭；开启后可比较 GIVĒON / Giveon 等写法，只影响艺人。不会去掉日文浊音或改变歌曲标题。" @update:model-value="update('foldArtistDiacritics', $event)" />
      <ToggleField :model-value="modelValue.corroboratedBilingualTitles" label="双语标题交叉推荐" hint="默认关闭；需开启双语标题比较。仅当完整艺人、专辑、曲序吻合且时差不超过 500 毫秒时，将中文与中英并列标题列为推荐；版本冲突仍拦截。" @update:model-value="update('corroboratedBilingualTitles', $event)" />
      <ToggleField :model-value="modelValue.ignoreMissingCollaborators" label="忽略缺失合作歌手" hint="默认关闭；开启后，主艺人一致且候选仅缺少目标中的合作歌手时，可按标题和时长进入高置信。多出的艺人、不同主艺人、版本冲突仍需复核。" @update:model-value="update('ignoreMissingCollaborators', $event)" />
      <ToggleField :model-value="modelValue.musicBrainzAliases" label="MusicBrainz 艺人异名辅助" hint="默认关闭；需要同时启用艺人别名。将待审艺人名发送到 MusicBrainz 查询，只采用名称精确命中且无同名歧义的艺人记录。不会改写手工别名或建立媒体绑定。" @update:model-value="update('musicBrainzAliases', $event)" />
      <div class="initialization-matching-settings__field-grid">
        <FormField label="MusicBrainz 最低搜索分" hint="90–100，默认 100；搜索分不是身份正确率，仍要求精确名称及唯一记录。"><input :value="modelValue.musicBrainzMinScore" class="form-input" type="number" min="90" max="100" @input="updateNumber('musicBrainzMinScore', $event)" /></FormField>
        <FormField label="MusicBrainz 每轮艺人上限" hint="1–200，默认 40；优先高频待审艺人，约每秒一次查询。未查询、歧义或失败项保留普通规则。"><input :value="modelValue.musicBrainzMaxArtists" class="form-input" type="number" min="1" max="200" @input="updateNumber('musicBrainzMaxArtists', $event)" /></FormField>
      </div>
    </ConfigSection>

    <ConfigSection title="快速初始化" description="快速接管分数线，仅作为新预览默认" :collapsed="!!collapsed['快速初始化']" @toggle="collapsed['快速初始化'] = !collapsed['快速初始化']">
      <FormField label="快速初始化分数线" hint="0–100，默认 85；仅影响新预览默认，不重写草案。"><input :value="modelValue.quickMatchThreshold" class="form-input" type="number" min="0" max="100" step="1" @input="updateNumber('quickMatchThreshold', $event)" /></FormField>
    </ConfigSection>

    <ConfigSection title="时长与版本规则" description="区分可直接推荐的候选和需要人工确认的候选" :collapsed="!!collapsed['时长与版本规则']" @toggle="collapsed['时长与版本规则'] = !collapsed['时长与版本规则']">
      <div class="initialization-matching-settings__field-grid">
        <FormField label="推荐时长差（毫秒）" hint="低于此差值可进入推荐"><input :value="modelValue.recommendDurationMs" class="form-input" type="number" min="0" max="30000" step="100" @input="updateNumber('recommendDurationMs', $event)" /></FormField>
        <FormField label="复核时长差（毫秒）" hint="低于此差值可进入人工复核"><input :value="modelValue.reviewDurationMs" class="form-input" type="number" min="0" max="30000" step="100" @input="updateNumber('reviewDurationMs', $event)" /></FormField>
        <FormField label="推荐时长差（百分比）" hint="与毫秒阈值取更严格的一项"><input :value="modelValue.recommendDurationPercent" class="form-input" type="number" min="0" max="10" step="0.5" @input="updateNumber('recommendDurationPercent', $event)" /></FormField>
        <FormField label="缺少时长时" hint="没有任一侧时长时的处理方式"><select :value="modelValue.missingDuration" class="form-input" @change="update('missingDuration', ($event.target as HTMLSelectElement).value as InitializationMatchingConfig['missingDuration'])"><option value="exclude">排除</option><option value="review">进入复核</option></select></FormField>
        <FormField label="Remaster 版本" hint="原版与重制版信息不一致时，严格模式禁止推荐"><select :value="modelValue.remasterPolicy" class="form-input" @change="update('remasterPolicy', ($event.target as HTMLSelectElement).value as InitializationMatchingConfig['remasterPolicy'])"><option value="strict">禁止推荐</option><option value="review">进入复核</option><option value="allow">允许推荐</option></select></FormField>
        <FormField label="Edition 版本" hint="比较单曲、专辑或 Radio Edit 版本；严格模式禁止推荐"><select :value="modelValue.editionPolicy" class="form-input" @change="update('editionPolicy', ($event.target as HTMLSelectElement).value as InitializationMatchingConfig['editionPolicy'])"><option value="strict">禁止推荐</option><option value="review">进入复核</option></select></FormField>
        <FormField label="Explicit 标记" hint="显式与 Clean 标记不一致时，严格模式禁止推荐"><select :value="modelValue.explicitPolicy" class="form-input" @change="update('explicitPolicy', ($event.target as HTMLSelectElement).value as InitializationMatchingConfig['explicitPolicy'])"><option value="strict">禁止推荐</option><option value="review">进入复核</option></select></FormField>
        <FormField label="单侧版本信息" hint="只有一侧有版本信息时的处理"><select :value="modelValue.unknownVersion" class="form-input" @change="update('unknownVersion', ($event.target as HTMLSelectElement).value as InitializationMatchingConfig['unknownVersion'])"><option value="exclude">排除</option><option value="review">进入复核</option></select></FormField>
      </div>
      <div class="initialization-matching-settings__toggle-grid">
        <ToggleField :model-value="modelValue.showVersionConflicts" label="显示版本冲突" hint="关闭后隐藏严格模式冲突候选；开启后在预览详情中保留冲突理由" @update:model-value="update('showVersionConflicts', $event)" />
        <ToggleField :model-value="modelValue.preferLossless" label="优先无损文件" hint="候选都有匹配时优先展示无损文件" @update:model-value="update('preferLossless', $event)" />
      </div>
    </ConfigSection>

    <ConfigSection title="别名规则" description="艺人名称统一管理；标题别名单独配置" :collapsed="!!collapsed['别名规则']" @toggle="collapsed['别名规则'] = !collapsed['别名规则']">
      <button type="button" class="btn btn-secondary" @click="$emit('open-artist-names')">管理艺人名称<AppIcon name="arrowRight" :size="14" /></button>
      <FormField label="标题别名" hint="标题别名与艺人别名相互独立，支持每条规则多个旧标题">
        <MatchingAliasEditor v-model="titleAliases" kind="title" />
      </FormField>
      <FormField label="首选目录" hint="仅作为候选路径提示，不会移动、复制或发布文件"><input :value="modelValue.preferredDirectory" class="form-input" type="text" placeholder="/music" @input="update('preferredDirectory', ($event.target as HTMLInputElement).value)" /></FormField>
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
      ? '当前参数与三个预设都不同，按自定义保留；不会重置任何字段。'
      : '手动调整任意参数后自动选中；选择自定义不会重置现有参数。',
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
