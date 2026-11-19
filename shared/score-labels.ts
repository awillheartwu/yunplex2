const labels:Record<string,string>={
  'version-excluded':'版本不符，已被排除','version-conflict':'版本存在差异，需确认','foreign-netease-id':'文件确认属于其他网易云歌曲',
  'paths-missing':'文件没有可用路径','paths-not-unique':'文件路径不唯一，无法确定','duration-window':'与目标的时长相差过大','artist-mismatch':'艺人不同',
  'album-required':'匹配设置要求同专辑，但当前不同','track-required':'匹配设置要求同曲序，但当前不同','missing-duration':'时长信息缺失',
  'missing-album':'专辑信息缺失','album-mismatch':'专辑不同','missing-track-number':'曲序缺失','track-mismatch':'曲序不同',
  'missing-artists':'艺人信息缺失','incomplete-artists':'合作艺人信息不完整','fuzzy-title-match':'标题只是大致相同',
}
export function scoreReason(value:string):string {
  if(value.startsWith('version-review:'))return value.slice('version-review:'.length)
  if(value.startsWith('extra-artists:'))return `候选多出 ${value.slice('extra-artists:'.length)} 位艺人`
  return labels[value]??value
}
