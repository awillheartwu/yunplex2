<template>
  <section class="artist-names" aria-label="艺人名称规则">
    <PageTabs v-model="tab" aria-label="艺人名称编辑模式" :tabs="[{ key: 'matching', label: settingSections['artists.matching'].title, count: matchingGroups.length }, { key: 'writes', label: settingSections['artists.writes'].title, count: writeCount }]" />
    <div v-if="error" class="artist-names__error" role="alert">{{ error }}。请修正后再保存。</div>
    <div v-if="jsonOpen" class="artist-names__json">
      <p>{{ jsonMode === 'matching' ? '批量编辑匹配别名：JSON 数组中的每条规则包含 name（艺人名称）、aliases（别名数组）和 enabled（是否启用）。写入替换保持不变。' : '批量编辑原名称与写入名称的对应关系，匹配别名保持不变。' }}应用到草稿后，请在页底保存。</p>
      <textarea v-model="jsonText" rows="10" class="form-input font-mono" :aria-label="jsonMode === 'matching' ? '匹配别名 JSON' : '写入映射 JSON'" :disabled="disabled" :spellcheck="false" />
      <div class="artist-names__actions">
        <button class="btn btn-soft btn-sm" :disabled="disabled" @click="applyJson">应用到草稿</button>
        <button class="btn btn-ghost btn-sm" :disabled="disabled" @click="cancelJson">取消批量编辑</button>
      </div>
    </div>
    <div v-if="tab === 'matching'" :id="settingTargetId('section:artists.matching')" data-setting-target="section:artists.matching" data-setting-title="匹配别名" data-setting-description="匹配别名用于识别同一艺人的不同名称。" data-setting-tab="artists" data-setting-keywords="艺人 别名" :aria-label="settingSections['artists.matching'].title" class="artist-names__panel">
      <div class="artist-names__toolbar">
        <p class="artist-names__lead">{{ settingSections['artists.matching'].description }}</p>
        <div class="artist-names__actions">
          <button class="btn btn-secondary btn-sm" :disabled="disabled || jsonOpen" @click="addGroup"><AppIcon name="plus" :size="14" />添加艺人</button>
          <button class="btn btn-ghost btn-sm" :disabled="disabled || jsonOpen || !!error" :aria-expanded="jsonMode === 'matching'" @click="openJson('matching')">批量编辑匹配别名（JSON）</button>
        </div>
      </div>
      <div class="artist-names__sheet">
        <div class="artist-names__columns" aria-hidden="true"><span>艺人名称</span><span>别名 <small>每行一个</small></span><span>匹配</span><span /></div>
        <EmptyState v-if="!matchingGroups.length" title="暂无艺人名称规则" description="添加艺人后可直接编辑名称、别名与匹配开关。" />
        <fieldset v-for="entry in matchingGroups" :key="entry.group.id" :disabled="disabled || jsonOpen" class="artist-row" :aria-label="`第 ${entry.ordinal} 组艺人名称`">
          <label class="artist-row__name"><span class="artist-row__mobile-label">艺人名称</span><input :value="entry.group.name" class="form-input" :aria-label="`第 ${entry.ordinal} 组艺人名称`" placeholder="艺人名称" @input="updateNames(entry.index, { name: ($event.target as HTMLInputElement).value })" /></label>
          <label class="artist-row__aliases"><span class="artist-row__mobile-label">别名 · 每行一个</span><textarea :value="entry.group.aliases.join('\n')" :rows="Math.min(4, Math.max(1, entry.group.aliases.length))" class="form-input" :aria-label="`第 ${entry.ordinal} 组艺人别名`" placeholder="添加别名" @change="updateNames(entry.index, { aliases: parseNames(($event.target as HTMLTextAreaElement).value) })" /></label>
          <label class="artist-row__matching"><input type="checkbox" :checked="entry.group.matchingEnabled" :aria-label="`第 ${entry.ordinal} 组用于匹配`" @change="setMatching(entry.index, ($event.target as HTMLInputElement).checked)" /><span class="artist-row__mobile-label">用于匹配</span></label>
          <button class="icon-button artist-row__delete" :aria-label="`删除第 ${entry.ordinal} 组艺人规则`" title="删除此艺人规则" @click="removeGroup(entry.index)"><AppIcon name="trash" :size="15" /></button>
        </fieldset>
      </div>
    </div>
    <div v-else :id="settingTargetId('section:artists.writes')" data-setting-target="section:artists.writes" data-setting-title="写入替换" data-setting-description="写入替换用于歌曲标签，已有文件名保留。" data-setting-tab="artists" data-setting-keywords="标签 专辑" :aria-label="settingSections['artists.writes'].title" class="artist-names__panel">
      <div class="artist-names__toolbar">
        <label :id="settingTargetId('other.applyAliasToAlbum')" data-setting-target="other.applyAliasToAlbum" data-setting-label="写入替换应用到专辑艺人" data-setting-keywords="专辑 标签" class="artist-names__album"><input type="checkbox" :checked="applyToAlbum" :disabled="disabled || jsonOpen" @change="$emit('update:applyToAlbum', ($event.target as HTMLInputElement).checked)" />{{ settingLabel('other.applyAliasToAlbum') }}</label>
        <div class="artist-names__actions">
          <button class="btn btn-secondary btn-sm" :disabled="disabled || jsonOpen" @click="addWrite">添加替换</button>
          <button class="btn btn-ghost btn-sm" :disabled="disabled || jsonOpen || !!error" :aria-expanded="jsonMode === 'writes'" @click="openJson('writes')">批量编辑写入映射（JSON）</button>
        </div>
      </div>
      <div class="artist-names__sheet">
        <EmptyState v-if="!writeRows.length" title="暂无写入替换" description="添加原名称到写入名称的替换规则。" />
        <fieldset v-for="(entry, index) in writeRows" :key="entry.rule.order" :disabled="disabled || jsonOpen" class="artist-write" :aria-label="`第 ${index + 1} 条写入替换`">
          <div class="artist-row__mapping">
            <input :value="entry.rule.source" class="form-input" :aria-label="`第 ${index + 1} 条原名称`" placeholder="原名称" @input="updateWrite(entry.groupIndex, entry.row, { source: ($event.target as HTMLInputElement).value })" />
            <AppIcon name="arrowRight" :size="14" aria-hidden="true" />
            <input :value="entry.rule.target" class="form-input" :aria-label="`第 ${index + 1} 条写入名称`" placeholder="写入名称" @input="updateWrite(entry.groupIndex, entry.row, { target: ($event.target as HTMLInputElement).value })" />
            <button class="icon-button artist-row__remove" :aria-label="`删除第 ${index + 1} 条写入规则`" title="删除写入替换" @click="removeWrite(entry.groupIndex, entry.row)"><AppIcon name="trash" :size="14" /></button>
          </div>
        </fieldset>
      </div>
    </div>
    <div class="artist-names__notes"><p v-if="!matchingActive">增强匹配尚未启用。</p><p>{{ settingSections['artists.writes'].description }}</p></div>
  </section>
</template>
<script setup lang="ts">
import type { MatchingAlias } from '~~/shared/initialization-matching'
import { collectArtistNames, nextArtistWriteOrder, projectArtistNames, type ArtistNameGroup, type ArtistNameSettings, type ArtistWriteRule } from '~~/shared/artist-names'
import { getSettingsTarget, settingLabel, settingSections, settingTargetId } from '~~/lib/settings-catalog'
import { useSettingsFocusRequest } from '~~/composables/useSettingsFocusRequest'
const props = defineProps<{ matching: MatchingAlias[]; replacements: Record<string, string>; applyToAlbum: boolean; matchingActive: boolean; resetKey: object; disabled?: boolean }>()
const emit = defineEmits<{ update: [value: ArtistNameSettings]; 'update:applyToAlbum': [value: boolean]; invalid: [message: string] }>()
const groups = ref<ArtistNameGroup[]>([])
const tab = ref('matching')
const route = useRoute()
const settingsFocusRequest = useSettingsFocusRequest()
function syncTabFromSetting() {
  const target = getSettingsTarget(route.query.setting)
  if (target?.sectionKey === 'artists.matching') tab.value = 'matching'
  else if (target?.sectionKey === 'artists.writes') tab.value = 'writes'
}
watch([() => route.query.setting, settingsFocusRequest], syncTabFromSetting, { immediate: true })
const error = ref('')
const jsonMode = ref<'matching' | 'writes' | null>(null)
const jsonOpen = computed(() => jsonMode.value !== null)
const jsonText = ref('')
let lastEmitted = ''
let counter = 0
/** Matching rules lead the numbering so both tabs label the same group the same way. */
const orderedGroups = computed(() => {
  const entries = groups.value.map((group, index) => ({ group, index }))
  return [...entries.filter(entry => entry.group.matchingStored), ...entries.filter(entry => !entry.group.matchingStored)]
    .map((entry, ordinal) => ({ ...entry, ordinal: ordinal + 1 }))
})
const matchingGroups = computed(() => orderedGroups.value.filter(entry => entry.group.matchingStored))
const writeRows = computed(() => groups.value.flatMap((group, groupIndex) => group.writes.map((rule, row) => ({ rule, row, groupIndex }))).sort((a, b) => a.rule.order - b.rule.order))
const writeCount = computed(() => groups.value.reduce((total, group) => total + group.writes.length, 0))
function hydrate() { jsonMode.value = null; jsonText.value = ''; groups.value = collectArtistNames(props.matching, props.replacements); lastEmitted = JSON.stringify({ matching: props.matching, replacements: props.replacements }); error.value = ''; emit('invalid', '') }
watch(() => props.resetKey, hydrate, { immediate: true })
watch(() => [props.matching, props.replacements], () => {
  if (JSON.stringify({ matching: props.matching, replacements: props.replacements }) !== lastEmitted) hydrate()
}, { deep: true })
function commit() {
  try {
    const next = projectArtistNames(groups.value)
    error.value = ''
    lastEmitted = JSON.stringify(next)
    emit('update', next)
  } catch (err) { error.value = err instanceof Error ? err.message : '请检查名称规则' }
  emit('invalid', error.value)
}
function openJson(mode: 'matching' | 'writes') {
  const current = projectArtistNames(groups.value)
  jsonText.value = JSON.stringify(mode === 'matching' ? current.matching : current.replacements, null, 2)
  jsonMode.value = mode
  error.value = ''
  emit('invalid', '批量编辑尚未应用，请应用到草稿或取消')
}
function cancelJson() { jsonMode.value = null; jsonText.value = ''; error.value = ''; emit('invalid', '') }
function applyJson() {
  try {
    const parsed: unknown = JSON.parse(jsonText.value)
    const current = projectArtistNames(groups.value)
    let next: ArtistNameGroup[]
    if (jsonMode.value === 'matching') {
      next = collectArtistNames(readMatchingJson(parsed), current.replacements)
    } else {
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.values(parsed).some(value => typeof value !== 'string')) throw new Error('请输入值均为字符串的 JSON 对象')
      next = collectArtistNames(current.matching, parsed as Record<string, string>)
    }
    projectArtistNames(next)
    groups.value = next
    jsonMode.value = null
    jsonText.value = ''
    commit()
  } catch (err) { error.value = err instanceof Error ? err.message : 'JSON 格式错误'; emit('invalid', error.value) }
}
function readMatchingJson(value: unknown): MatchingAlias[] {
  if (!Array.isArray(value)) throw new Error('匹配别名需要 JSON 数组，每条规则包含 name、aliases 和 enabled')
  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
      || typeof entry.name !== 'string' || !entry.name.trim()
      || !Array.isArray(entry.aliases) || entry.aliases.some((alias: unknown) => typeof alias !== 'string' || !alias.trim())
      || typeof entry.enabled !== 'boolean') throw new Error(`第 ${index + 1} 条规则需要非空的 name、字符串数组 aliases 和布尔值 enabled`)
    return { name: entry.name.trim(), aliases: entry.aliases.map((alias: string) => alias.trim()), enabled: entry.enabled }
  })
}
function addGroup() { groups.value.push({ id: `new-${++counter}`, name: '', aliases: [], matchingEnabled: true, matchingStored: true, writes: [] }); commit() }
function removeGroup(index: number) {
  const group = groups.value[index]!
  if (group.writes.length) { group.matchingStored = false; group.matchingEnabled = false }
  else groups.value.splice(index, 1)
  commit()
}
function updateNames(index: number, patch: Partial<Pick<ArtistNameGroup, 'name' | 'aliases'>>) { Object.assign(groups.value[index]!, patch, { matchingStored: true }); commit() }
function setMatching(index: number, enabled: boolean) { Object.assign(groups.value[index]!, { matchingEnabled: enabled, matchingStored: true }); commit() }
function parseNames(value: string) { return [...new Set(value.split('\n').map(name => name.trim()).filter(Boolean))] }
function addWrite() {
  const order = nextArtistWriteOrder(groups.value)
  groups.value.push({ id: `write-${++counter}`, name: '', aliases: [], matchingEnabled: false, matchingStored: false, writes: [{ source: '', target: '', order }] })
  commit()
}
function updateWrite(index: number, row: number, patch: Partial<ArtistWriteRule>) { Object.assign(groups.value[index]!.writes[row]!, patch, { legacy: false }); commit() }
function removeWrite(index: number, row: number) {
  const group = groups.value[index]!
  group.writes.splice(row, 1)
  if (!group.matchingStored && !group.writes.length) groups.value.splice(index, 1)
  commit()
}
</script>
<style scoped>
.artist-names { display: flex; flex-direction: column; gap: var(--space-3); }
.artist-names__panel { display: flex; flex-direction: column; gap: var(--space-3); }
.artist-names__lead { margin: 0; font-size: var(--text-xs); color: var(--text-secondary); }
.artist-names__toolbar,.artist-names__actions { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); }
.artist-names__toolbar { justify-content: space-between; }
.artist-names__album { display: flex; align-items: center; gap: var(--space-2); font-size: var(--text-sm); color: var(--text-secondary); }
.artist-names__error { padding: var(--space-3); border: 1px solid var(--danger-border); border-radius: var(--radius-md); color: var(--danger); background: var(--danger-soft); font-size: var(--text-sm); }
.artist-names__json { display: grid; gap: var(--space-3); padding: var(--space-4); border: 1px solid var(--border-primary); border-radius: var(--radius-md); background: var(--bg-input); }
.artist-names__json textarea { min-height: 12rem; resize: vertical; font-size: var(--text-sm); }
.artist-names__sheet { border: 1px solid var(--border-primary); border-radius: var(--radius-md); overflow: hidden; background: var(--bg-surface); }
.artist-names__columns,.artist-row { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1.15fr) 3rem 2rem; gap: var(--space-3); padding: var(--space-3); }
.artist-names__columns { align-items: center; background: var(--bg-input); font-size: var(--text-xs); font-weight: var(--font-weight-medium); color: var(--text-secondary); }
.artist-names__columns small { margin-left: var(--space-1); font-size: inherit; color: var(--text-tertiary); font-weight: var(--font-weight-normal); }
.artist-row { min-width: 0; margin: 0; border: 0; border-top: 1px solid var(--border-primary); align-items: start; }
.artist-row:focus-within { background: var(--bg-hover); }
.artist-row label { min-width: 0; }
.artist-row .form-input { min-width: 0; width: 100%; font-size: var(--text-sm); }
.artist-row textarea { min-height: 2.5rem; resize: vertical; }
.artist-row__matching { min-height: 2.5rem; display: flex; justify-content: center; align-items: center; gap: var(--space-2); }
.artist-write { display: flex; flex-direction: column; gap: var(--space-2); min-width: 0; margin: 0; border: 0; padding: var(--space-3); }
.artist-write + .artist-write { border-top: 1px solid var(--border-primary); }
.artist-write:focus-within { background: var(--bg-hover); }
.artist-row__mapping { display: grid; grid-template-columns: minmax(0,1fr) auto minmax(0,1fr) 2rem; align-items: center; gap: var(--space-2); }
.artist-row__mapping > svg { color: var(--text-tertiary); }
.artist-row__mapping .form-input { min-width: 0; width: 100%; font-size: var(--text-sm); }
.artist-row__remove,.artist-row__delete { border-color: transparent; background: transparent; color: var(--text-tertiary); }
.artist-row__delete { margin-top: var(--space-1); }
.artist-row__mobile-label { display: none; }
.artist-names__notes p,.artist-names__json p { margin: 0; font-size: var(--text-xs); color: var(--text-secondary); }
@media(max-width:1000px) {
  .artist-names__columns { display: none; }
  .artist-row { grid-template-columns: minmax(0,1fr) minmax(0,1fr) 2rem; gap: var(--space-3); padding: var(--space-4); }
  .artist-row__mobile-label { display: block; font-size: var(--text-xs); color: var(--text-secondary); margin-bottom: var(--space-1); }
  .artist-row__matching { grid-column: 1 / 3; grid-row: 2; justify-content: flex-start; min-height: 0; }
  .artist-row__matching span { margin: 0; }
  .artist-row__delete { grid-column: 3; grid-row: 1; }
}
@media(max-width:480px) {
  .artist-row { grid-template-columns: minmax(0,1fr) 2rem; }
  .artist-row__name,.artist-row__aliases { grid-column: 1; }
  .artist-row__matching { grid-row: 3; }
  .artist-row__delete { grid-column: 2; }
  .artist-row__mapping { gap: var(--space-1); }
  .artist-names__actions { width: 100%; justify-content: space-between; }
}
</style>
