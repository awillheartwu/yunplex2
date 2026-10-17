export const AUDIO_QUALITY_OPTIONS = [
  { value: 'standard', label: '标准 (128kbps)' },
  { value: 'higher', label: '较高 (192kbps)' },
  { value: 'exhigh', label: '极高 (320kbps)' },
  { value: 'lossless', label: '无损 (FLAC)' },
  { value: 'hires', label: 'Hi-Res' },
  { value: 'jyeffect', label: '高清环绕声' },
  { value: 'jymaster', label: '超清母带' },
] as const

export type AudioQuality = typeof AUDIO_QUALITY_OPTIONS[number]['value']

export function isAudioQuality(value: unknown): value is AudioQuality {
  return AUDIO_QUALITY_OPTIONS.some(option => option.value === value)
}
