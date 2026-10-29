import type { PlaylistWriteProgress } from '../shared/playlist-write'

const phases: Record<PlaylistWriteProgress['phase'], string> = {
  creating: '创建 Plex 歌单', adding: '加入歌单', moving: '校准顺序', removing: '移除歌单条目',
  verifying: '核对歌单成员、顺序与媒体身份', uncertain: '写入结果待确认，已停止后续写入',
}
export function playlistProgressLabel(progress: PlaylistWriteProgress): string {
  const label = phases[progress.phase]
  if (progress.total <= 0) return label
  return `${label} · 已提交 ${progress.submitted} / ${progress.total}，已确认 ${progress.confirmed} / ${progress.total}${progress.batches > 0 ? ` · 第 ${progress.batch} / ${progress.batches} 批` : ''}`
}
