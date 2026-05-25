<template>
  <div class="max-w-[1440px] space-y-8">
    <div>
      <h2 class="text-sm font-semibold">系统</h2>
      <p class="text-2xs text-muted mt-0.5">系统信息、数据路径和健康状态</p>
    </div>

    <!-- Health -->
    <div class="section-card p-5">
      <div class="flex items-center gap-2 mb-4">
        <div class="w-2 h-2 rounded-full bg-success" />
        <h3 class="text-sm font-semibold">服务状态</h3>
      </div>
      <div v-if="health" class="grid grid-cols-3 gap-4 text-sm">
        <div>
          <span class="text-muted">运行状态</span>
          <p class="text-success font-medium mt-0.5">{{ health.status === 'ok' ? '正常' : health.status }}</p>
        </div>
        <div>
          <span class="text-muted">运行时间</span>
          <p class="text-[var(--text-primary)] mt-0.5">{{ formatUptime(health.uptime) }}</p>
        </div>
        <div>
          <span class="text-muted">Node.js 版本</span>
          <p class="text-[var(--text-primary)] mt-0.5 font-mono">{{ info?.nodeVersion ?? '-' }}</p>
        </div>
      </div>
    </div>

    <!-- System info -->
    <div class="section-card overflow-hidden">
      <div class="px-5 py-4 border-b border-[var(--border-primary)]">
        <h3 class="text-sm font-semibold">系统信息</h3>
      </div>
      <div class="p-5 space-y-3">
        <InfoRow label="版本" :value="`YunPlex2 v${info?.version ?? '-'}`" />
        <InfoRow label="平台" :value="info?.platform ?? '-'" />
        <InfoRow label="数据目录" :value="info?.dataDir ?? '-'" mono />
        <InfoRow label="配置文件" :value="info?.configFile ?? '-'" mono />
        <InfoRow label="日志文件" :value="info?.logFile ?? '-'" mono />
      </div>
    </div>

    <!-- Docker hint -->
    <div class="bg-[var(--bg-surface)] border border-[var(--border-secondary)] rounded-xl p-5">
      <h3 class="text-sm font-semibold mb-2">Docker 部署提示</h3>
      <p class="text-sm text-muted leading-relaxed">
        如果使用 Docker 部署，请确保 <code class="text-2xs bg-[var(--bg-app)] px-1 py-0.5 rounded font-mono">/app/data</code>
        目录已挂载到宿主机，以持久化配置和日志数据。例如：
      </p>
      <pre class="mt-3 p-3 bg-[var(--bg-app)] rounded-lg text-2xs text-muted font-mono whitespace-pre-wrap">docker run -v /your/host/path/data:/app/data ...</pre>
    </div>
  </div>
</template>

<script setup lang="ts">
const api = useApi()

const health = ref<{ status: string; uptime: number; timestamp: string } | null>(null)
const info = ref<Record<string, string> | null>(null)

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h} 小时 ${m} 分钟`
  if (m > 0) return `${m} 分钟`
  return `${Math.floor(seconds)} 秒`
}

onMounted(async () => {
  try {
    health.value = await api.get('/system/health')
  } catch { /* ignore */ }
  try {
    info.value = await api.get('/system/info')
  } catch { /* ignore */ }
})
</script>
