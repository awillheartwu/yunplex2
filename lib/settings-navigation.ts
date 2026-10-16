export const tabs = [
  { key: 'general', label: '服务连接' },
  { key: 'media', label: '下载与文件' },
  { key: 'sync', label: '同步策略' },
  { key: 'matching', label: '初始化匹配', badge: 'Beta' },
  { key: 'artists', label: '艺人名称' },
  { key: 'display', label: '外观' },
  { key: 'advanced', label: '安全与维护' },
]

export const categoryDescriptions: Record<string,string> = { general: '网易云音乐与 Plex 的连接设置。', media: '音乐保存位置、歌词、封面与标签。', sync: '同步频率、首次接管与缺失歌曲处理。', matching: '首次接管的候选规则与匹配预览。', artists: '匹配别名与文件标签的名称替换。', display: '调整文字与控件大小。', advanced: '管理员账户、数据保留、导入导出与维护。' }
