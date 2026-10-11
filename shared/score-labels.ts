const labels:Record<string,string>={
  'version-excluded':'版本被当前规则排除','version-conflict':'存在版本差异','foreign-netease-id':'文件明确属于其他网易云歌曲',
  'paths-missing':'没有媒体路径','paths-not-unique':'媒体文件路径不唯一','duration-window':'时长差超过容忍范围','artist-mismatch':'艺人明确不同',
  'album-required':'未满足必须同专辑的设置','track-required':'未满足必须同曲序的设置','missing-duration':'时长信息缺失',
  'missing-album':'专辑信息缺失','album-mismatch':'专辑不同','missing-track-number':'曲序缺失','track-mismatch':'曲序不同',
  'missing-artists':'艺人信息缺失','incomplete-artists':'合作艺人信息不完整','fuzzy-title-match':'使用模糊标题匹配',
}
export function scoreReason(value:string):string {
  if(value.startsWith('version-review:'))return value.slice('version-review:'.length)
  if(value.startsWith('extra-artists:'))return `候选多出 ${value.slice('extra-artists:'.length)} 位艺人`
  return labels[value]??value
}
