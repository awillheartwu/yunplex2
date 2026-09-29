export const tabs = [
  { key: 'general', label: '服务连接' },
  { key: 'media', label: '下载与文件' },
  { key: 'sync', label: '同步策略' },
  { key: 'matching', label: '初始化匹配' },
  { key: 'artists', label: '艺人名称' },
  { key: 'display', label: '外观' },
  { key: 'advanced', label: '安全与维护' },
]

export const categoryDescriptions: Record<string,string> = { general: '音乐从哪里来，又到哪里去。管理网易云与 Plex 的连接。', media: '决定音乐文件如何保存，以及歌词、封面和标签的处理方式。', sync: '控制更新节奏、首次接管与媒体处理的默认规则。', matching: '为首次媒体接管调整候选规划，并用只读快照比较设置变化。', artists: '统一维护艺人名称，分别控制增强匹配与文件写入替换。', display: '调整文字大小，让工作台适合你的屏幕。', advanced: '管理员账户、数据保留、导入导出与维护操作。' }
