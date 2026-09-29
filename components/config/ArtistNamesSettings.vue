<template>
  <section class="artist-names" aria-label="艺人名称规则">
    <div class="artist-names__toolbar">
      <label class="artist-names__album"><input type="checkbox" :checked="applyToAlbum" :disabled="disabled || jsonOpen" @change="$emit('update:applyToAlbum', ($event.target as HTMLInputElement).checked)" />写入替换应用到专辑艺人</label>
      <div class="artist-names__actions">
        <button class="btn btn-ghost btn-sm" :disabled="disabled || !!error" :aria-expanded="jsonOpen" @click="openJson">批量编辑写入映射（JSON）</button>
        <button class="btn btn-secondary btn-sm" :disabled="disabled || jsonOpen" @click="addGroup"><AppIcon name="plus" :size="14" />添加艺人</button>
      </div>
    </div>
    <div v-if="error" class="artist-names__error" role="alert">{{ error }}。请修正后再保存。</div>
    <div v-if="jsonOpen" class="artist-names__json">
      <p>粘贴或复制写入映射；应用不会改变匹配别名。</p>
      <textarea v-model="jsonText" rows="6" class="form-input" aria-label="写入映射 JSON" :disabled="disabled" />
      <button class="btn btn-secondary" :disabled="disabled" @click="applyJson">应用到草稿</button>
      <button class="btn btn-ghost" :disabled="disabled" @click="cancelJson">取消批量编辑</button>
    </div>
    <div class="artist-names__sheet">
      <div class="artist-names__columns" aria-hidden="true"><span>艺人名称</span><span>别名 <small>每行一个</small></span><span>匹配</span><span>写入替换 <small>原名称 → 写入名称</small></span><span /></div>
      <EmptyState v-if="!groups.length" title="暂无艺人名称规则" description="添加艺人后可直接编辑名称与用途。" />
      <fieldset v-for="(group, index) in groups" :key="group.id" :disabled="disabled || jsonOpen" class="artist-row" :aria-label="`第 ${index + 1} 组艺人名称`">
        <label class="artist-row__name"><span class="artist-row__mobile-label">艺人名称</span><input :value="group.name" class="form-input" :aria-label="`第 ${index + 1} 组艺人名称`" placeholder="艺人名称" @input="updateNames(index, { name: ($event.target as HTMLInputElement).value })" /></label>
        <label class="artist-row__aliases"><span class="artist-row__mobile-label">别名 · 每行一个</span><textarea :value="group.aliases.join('\n')" :rows="Math.min(4, Math.max(1, group.aliases.length))" class="form-input" :aria-label="`第 ${index + 1} 组艺人别名`" placeholder="添加别名" @change="updateNames(index, { aliases: parseNames(($event.target as HTMLTextAreaElement).value) })" /></label>
        <label class="artist-row__matching"><input type="checkbox" :checked="group.matchingEnabled" :aria-label="`第 ${index + 1} 组用于匹配`" @change="setMatching(index, ($event.target as HTMLInputElement).checked)" /><span class="artist-row__mobile-label">用于匹配</span></label>
        <div class="artist-row__writes">
          <span class="artist-row__mobile-label">写入替换</span>
          <div v-for="(rule, row) in group.writes" :key="rule.order" class="artist-row__mapping">
            <select :value="rule.source" class="form-input" :aria-label="`第 ${index + 1} 组第 ${row + 1} 条原名称`" @change="updateWrite(index, row, { source: ($event.target as HTMLSelectElement).value })"><option v-for="name in writeSourceOptions(group, rule.source)" :key="name" :value="name">{{ name || '原名称' }}</option></select>
            <AppIcon name="arrowRight" :size="14" aria-hidden="true" />
            <input :value="rule.target" class="form-input" :aria-label="`第 ${index + 1} 组第 ${row + 1} 条写入名称`" placeholder="写入名称" @input="updateWrite(index, row, { target: ($event.target as HTMLInputElement).value })" />
            <button class="icon-button artist-row__remove" :aria-label="`删除第 ${index + 1} 组第 ${row + 1} 条写入规则`" title="删除写入替换" @click="removeWrite(index, row)"><AppIcon name="close" :size="14" /></button>
          </div>
          <button class="btn btn-ghost btn-sm artist-row__add" aria-label="添加写入规则" @click="addWrite(index)"><AppIcon name="plus" :size="13" />{{ group.writes.length ? '添加替换' : '设置替换' }}</button>
        </div>
        <button class="icon-button artist-row__delete" :aria-label="`删除第 ${index + 1} 组艺人规则`" title="删除此艺人规则" @click="removeGroup(index)"><AppIcon name="trash" :size="15" /></button>
      </fieldset>
    </div>
    <div class="artist-names__notes"><p v-if="!matchingActive">增强匹配尚未启用，勾选的名称规则会保留。</p><p>匹配别名不会自动用于文件改写；写入替换不重命名已有文件。</p></div>
  </section>
</template>
<script setup lang="ts">
import type { MatchingAlias } from '~~/shared/initialization-matching'
import { collectArtistNames, nextArtistWriteOrder, projectArtistNames, type ArtistNameGroup, type ArtistNameSettings, type ArtistWriteRule } from '~~/shared/artist-names'
const props = defineProps<{ matching: MatchingAlias[]; replacements: Record<string, string>; applyToAlbum: boolean; matchingActive: boolean; resetKey: object; disabled?: boolean }>()
const emit = defineEmits<{ update: [value: ArtistNameSettings]; 'update:applyToAlbum': [value: boolean]; invalid: [message: string] }>()
const groups = ref<ArtistNameGroup[]>([])
const error = ref('')
const jsonOpen = ref(false)
const jsonText = ref('')
let lastEmitted = ''
let counter = 0
function hydrate() { jsonOpen.value = false; groups.value = collectArtistNames(props.matching, props.replacements); lastEmitted = JSON.stringify({ matching: props.matching, replacements: props.replacements }); error.value = ''; emit('invalid', '') }
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
function openJson() {
  jsonText.value = JSON.stringify(projectArtistNames(groups.value).replacements, null, 2)
  jsonOpen.value = true
  error.value = '批量编辑尚未应用，请应用到草稿或取消'
  emit('invalid', error.value)
}
function cancelJson() { jsonOpen.value = false; error.value = ''; emit('invalid', '') }
function applyJson() {
  try {
    const parsed: unknown = JSON.parse(jsonText.value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.values(parsed).some(value => typeof value !== 'string')) throw new Error('请输入值均为字符串的 JSON 对象')
    groups.value = collectArtistNames(projectArtistNames(groups.value).matching, parsed as Record<string, string>)
    jsonOpen.value = false
    commit()
  } catch (err) { error.value = err instanceof Error ? err.message : 'JSON 格式错误'; emit('invalid', error.value) }
}
function addGroup() { groups.value.push({ id: `new-${++counter}`, name: '', aliases: [], matchingEnabled: true, matchingStored: true, writes: [] }); commit() }
function removeGroup(index: number) { groups.value.splice(index, 1); commit() }
function updateNames(index: number, patch: Partial<Pick<ArtistNameGroup, 'name' | 'aliases'>>) { Object.assign(groups.value[index]!, patch, { matchingStored: true }); commit() }
function setMatching(index: number, enabled: boolean) { Object.assign(groups.value[index]!, { matchingEnabled: enabled, matchingStored: true }); commit() }
function parseNames(value: string) { return [...new Set(value.split('\n').map(name => name.trim()).filter(Boolean))] }
function writeSourceOptions(group: ArtistNameGroup, source: string) { return [...new Set([source, group.name, ...group.aliases])] }
function addWrite(index: number) {
  const group = groups.value[index]!
  group.writes.push({ source: group.aliases[0] || group.name, target: '', order: nextArtistWriteOrder(groups.value) })
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
.artist-names__toolbar,.artist-names__actions { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); }
.artist-names__toolbar { justify-content: space-between; }
.artist-names__album { display: flex; align-items: center; gap: var(--space-2); font-size: var(--text-sm); color: var(--text-secondary); }
.artist-names__error { padding: var(--space-3); border: 1px solid var(--danger-border); border-radius: var(--radius-md); color: var(--danger); background: var(--danger-soft); font-size: var(--text-sm); }
.artist-names__sheet { border: 1px solid var(--border-primary); border-radius: var(--radius-md); overflow: hidden; background: var(--bg-surface); }
.artist-names__columns,.artist-row { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1.15fr) 3rem minmax(0,2.2fr) 2rem; gap: var(--space-3); padding: var(--space-3); }
.artist-names__columns { align-items: center; background: var(--bg-input); font-size: var(--text-xs); font-weight: var(--font-weight-medium); color: var(--text-secondary); }
.artist-names__columns small { margin-left: var(--space-1); font-size: inherit; color: var(--text-tertiary); font-weight: var(--font-weight-normal); }
.artist-row { min-width: 0; margin: 0; border: 0; border-top: 1px solid var(--border-primary); align-items: start; }
.artist-row:focus-within { background: var(--bg-hover); }
.artist-row label,.artist-row__writes { min-width: 0; }
.artist-row .form-input { min-width: 0; width: 100%; font-size: var(--text-sm); }
.artist-row textarea { min-height: 2.5rem; resize: vertical; }
.artist-row__matching { min-height: 2.5rem; display: flex; justify-content: center; align-items: center; gap: var(--space-2); }
.artist-row__writes { display: flex; flex-direction: column; gap: var(--space-1); }
.artist-row__mapping { display: grid; grid-template-columns: minmax(0,1fr) auto minmax(0,1fr) 2rem; align-items: center; gap: var(--space-2); }
.artist-row__mapping > svg { color: var(--text-tertiary); }
.artist-row__add { align-self: flex-start; color: var(--text-secondary); }
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
  .artist-row__writes { grid-column: 1 / -1; grid-row: 3; }
  .artist-row__delete { grid-column: 3; grid-row: 1; }
}
@media(max-width:480px) {
  .artist-row { grid-template-columns: minmax(0,1fr) 2rem; }
  .artist-row__name,.artist-row__aliases { grid-column: 1; }
  .artist-row__matching { grid-row: 3; }
  .artist-row__writes { grid-row: 4; }
  .artist-row__delete { grid-column: 2; }
  .artist-row__mapping { gap: var(--space-1); }
  .artist-names__actions { width: 100%; justify-content: space-between; }
}
</style>
