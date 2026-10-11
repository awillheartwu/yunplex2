/** Presentation groups only. They never authorize matching or media mutations. */
export const evidenceGroups = [
  { value: 'recommended', label: '推荐候选', members: ['strong_id', 'high_confidence'] },
  { value: 'needs_review', label: '需要核对', members: ['possible', 'ambiguous'] },
  { value: 'no_candidate', label: '无可用候选', members: ['unmatched', 'metadata_missing'] },
  { value: 'conflict', label: '存在冲突', members: ['conflict'] },
  { value: 'preserved', label: '已有绑定', members: ['preserved'] },
]
export const mediaGroups = [
  { value: 'matched', label: '已关联', members: ['matched'] },
  { value: 'pending_alignment', label: '待同步', members: ['pending_alignment'] },
  { value: 'needs_action', label: '需处理', members: ['awaiting_manual', 'unmatched', 'historical_unverified'] },
  { value: 'problem', label: '有异常', members: ['binding_stale', 'copyright_restricted', 'sync_failed'] },
  { value: 'retry_paused', label: '已暂停', members: ['retry_paused'] },
]
export function filterMembers(groups: typeof evidenceGroups, value: string): string[] {
  return groups.find(group => group.value === value)?.members ?? [value]
}
