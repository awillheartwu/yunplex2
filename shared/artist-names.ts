import type { MatchingAlias } from './initialization-matching'

export interface ArtistWriteRule {
  source: string
  target: string
  /** Preserve legacy whitespace-fallback precedence across visual grouping. */
  order: number
  legacy?: boolean
}
export interface ArtistNameGroup {
  id: string
  name: string
  aliases: string[]
  matchingEnabled: boolean
  /** Write-only legacy groups must not silently become matching rules. */
  matchingStored: boolean
  writes: ArtistWriteRule[]
}
export interface ArtistNameSettings {
  matching: MatchingAlias[]
  replacements: Record<string, string>
}

/** Build a reversible editing view. Never infer equivalence from a write edge. */
export function collectArtistNames(matching: MatchingAlias[], replacements: Record<string, string>): ArtistNameGroup[] {
  const groups: ArtistNameGroup[] = matching.map((rule, index) => ({
    id: `matching-${index}`, name: rule.name, aliases: [...rule.aliases],
    matchingEnabled: rule.enabled, matchingStored: true, writes: [],
  }))
  const writeGroups = new Map<string, ArtistNameGroup>()
  Object.entries(replacements).forEach(([source, target], order) => {
    const candidates = groups.filter(group => group.matchingStored
      && [group.name, ...group.aliases].includes(source)
      && [group.name, ...group.aliases].includes(target))
    let group = candidates.length === 1 ? candidates[0] : writeGroups.get(target)
    if (!group) {
      group = { id: `writing-${order}`, name: target, aliases: [], matchingEnabled: false, matchingStored: false, writes: [] }
      groups.push(group)
      writeGroups.set(target, group)
    }
    if (!group.matchingStored && source !== group.name && !group.aliases.includes(source)) group.aliases.push(source)
    group.writes.push({ source, target, order, legacy: true })
  })
  return groups
}

/** Runtime contracts remain separate: matching equivalence and directed writes. */
export function projectArtistNames(groups: ArtistNameGroup[]): ArtistNameSettings {
  const matching: MatchingAlias[] = []
  for (const [index, group] of groups.entries()) {
    if (group.matchingStored || group.matchingEnabled) {
      if (!group.name.trim()) throw new Error(`第 ${index + 1} 组：请填写名称`)
      matching.push({ name: group.name, aliases: [...group.aliases], enabled: group.matchingEnabled })
    }
  }
  const writes = groups.flatMap(group => group.writes).sort((left, right) => left.order - right.order)
  const seen = new Set<string>()
  for (const rule of writes) {
    if (!rule.legacy && (!rule.source.trim() || !rule.target.trim())) throw new Error('写入规则需要填写原名称和写入名称')
    if (seen.has(rule.source)) throw new Error(`原名称「${rule.source}」有重复写入规则，请保留一条明确的替换方向`)
    seen.add(rule.source)
  }
  return { matching, replacements: Object.fromEntries(writes.map(rule => [rule.source, rule.target])) }
}

export function nextArtistWriteOrder(groups: ArtistNameGroup[]) {
  return Math.max(-1, ...groups.flatMap(group => group.writes.map(rule => rule.order))) + 1
}
