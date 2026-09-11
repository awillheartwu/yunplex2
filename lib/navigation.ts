export const workspaceNavigation = [
  { icon: 'dashboard', label: '工作台', path: '/', description: '音乐同步与待办' },
  { icon: 'source', label: '音乐库', path: '/sync-sources', description: '管理歌单与专辑' },
  { icon: 'download', label: '添加音乐', path: '/manual-download', description: '从链接获取音乐' },
  { icon: 'activity', label: '活动', path: '/task-center', description: '进度、记录与异常' },
]

export const managementNavigation = [
  { icon: 'settings', label: '偏好设置', path: '/config', description: '连接与运行策略' },
  { icon: 'activity', label: '系统状态', path: '/system', description: '连接、资源与诊断' },
]

export function pageContext(path: string) {
  if (path.startsWith('/sync-sources/')) return { title: '来源详情', section: '音乐工作区', parent: '/sync-sources', parentLabel: '音乐库' }
  if (path.startsWith('/task-center/runs/')) return { title: '运行详情', section: '音乐工作区', parent: '/task-center', parentLabel: '活动' }
  if (path === '/logs') return { title: '运行日志', section: '系统', parent: '/system', parentLabel: '系统状态' }
  if (path === '/match-reviews') return { title: '高级媒体关联', section: '系统管理', parent: '/config', parentLabel: '偏好设置' }
  const item = [...workspaceNavigation, ...managementNavigation].find(item => item.path === path)
  return { title: item?.label ?? 'reYunPlex', section: managementNavigation.some(item => item.path === path) ? '系统管理' : '音乐工作区', parent: '', parentLabel: '' }
}
