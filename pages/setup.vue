<template>
  <section class="setup-page" aria-labelledby="setup-title">
    <div class="setup-hero">
      <div>
        <p class="setup-eyebrow">首次初始化</p>
        <h1 id="setup-title" class="setup-title">连接你的音乐世界</h1>
        <p class="setup-copy">创建管理员密码，并确认网易云、Plex、下载目录都可用后再进入控制台。</p>
      </div>
      <div class="setup-progress" aria-label="初始化进度">
        <button
          v-for="(step, index) in steps"
          :key="step.key"
          class="setup-step"
          :class="[
            activeStep === step.key ? 'setup-step--active' : '',
            isStepComplete(step.key) ? 'setup-step--done' : '',
          ]"
          type="button"
          :aria-current="activeStep === step.key ? 'step' : undefined"
          :disabled="!canOpenStep(step.key)"
          @click="activeStep = step.key"
        >
          <span class="setup-step__index">{{ index + 1 }}</span>
          <span>{{ step.label }}</span>
        </button>
      </div>
    </div>

    <section v-if="loading" class="setup-panel section-card">
      <p class="setup-copy">正在读取初始化状态...</p>
    </section>

    <section v-else-if="authState?.adminConfigured && !authState.authenticated" class="setup-panel section-card">
      <div class="setup-panel__header">
        <span class="setup-panel__icon"><AppIcon name="shield" :size="20" /></span>
        <div>
          <h2 class="setup-panel__title">需要管理员登录</h2>
          <p class="setup-copy">管理员密码已经创建。登录后可以继续未完成的初始化流程。</p>
        </div>
      </div>
      <NuxtLink class="btn btn-primary setup-action" to="/login?redirect=/setup">
        <AppIcon name="user" :size="16" />
        去登录
      </NuxtLink>
    </section>

    <section v-else class="setup-panel section-card">
      <form v-if="activeStep === 'admin'" class="setup-form" @submit.prevent="createAdmin">
        <div class="setup-panel__header">
          <span class="setup-panel__icon"><AppIcon name="shield" :size="20" /></span>
          <div>
            <h2 class="setup-panel__title">创建管理员密码</h2>
            <p class="setup-copy">之后所有配置、同步和下载操作都需要先登录。</p>
          </div>
        </div>
        <div>
          <label class="setup-label" for="setup-password">管理员密码</label>
          <input
            id="setup-password"
            v-model="adminPassword"
            class="form-input"
            type="password"
            autocomplete="new-password"
            minlength="8"
            required
            :disabled="submitting"
          >
        </div>
        <div>
          <label class="setup-label" for="setup-password-confirm">确认密码</label>
          <input
            id="setup-password-confirm"
            v-model="adminPasswordConfirm"
            class="form-input"
            type="password"
            autocomplete="new-password"
            minlength="8"
            required
            :disabled="submitting"
          >
        </div>
        <div>
          <p v-if="error" class="setup-error" role="alert">{{ error }}</p>
          <p v-else-if="message" class="setup-message">{{ message }}</p>
        </div>
        <button class="btn btn-primary setup-action" type="submit" :disabled="submitting">
          <AppIcon v-if="submitting" name="loader" class="animate-spin" :size="16" />
          <AppIcon v-else name="save" :size="16" />
          {{ submitting ? '创建中...' : '创建并继续' }}
        </button>
      </form>

      <form v-else-if="activeStep === 'netease' && config" class="setup-form" @submit.prevent="checkStep('netease')">
        <div class="setup-panel__header">
          <span class="setup-panel__icon"><AppIcon name="music" :size="20" /></span>
          <div>
            <h2 class="setup-panel__title">连接网易云音乐</h2>
            <p class="setup-copy">用于读取收藏、歌单和歌曲下载地址。</p>
          </div>
        </div>
        <div>
          <label class="setup-label" for="netease-cookie">网易云 Cookie</label>
          <textarea
            id="netease-cookie"
            v-model="config.netease.cookie"
            class="form-input setup-textarea font-mono"
            autocomplete="off"
            required
            :disabled="isChecking('netease')"
            placeholder="MUSIC_U=...; __csrf=..."
          />
        </div>
        <p v-if="checks.netease.message" class="setup-check" :class="'setup-check--' + checks.netease.status" role="status">
          {{ checks.netease.message }}
        </p>
        <div class="setup-actions">
          <button class="btn btn-primary" type="submit" :disabled="isChecking('netease') || !config.netease.cookie">
            <AppIcon v-if="isChecking('netease')" name="loader" class="animate-spin" :size="16" />
            <AppIcon v-else name="check" :size="16" />
            {{ isChecking('netease') ? '测试中...' : '测试连接' }}
          </button>
          <button class="btn btn-secondary" type="button" :disabled="!isStepComplete('netease')" @click="activeStep = 'plex'">下一步</button>
        </div>
      </form>

      <form v-else-if="activeStep === 'plex' && config" class="setup-form" @submit.prevent="checkStep('plex')">
        <div class="setup-panel__header">
          <span class="setup-panel__icon"><AppIcon name="source" :size="20" /></span>
          <div>
            <h2 class="setup-panel__title">连接 Plex</h2>
            <p class="setup-copy">用于确认音乐库、触发扫描和同步歌单。Plex API 不负责上传音频文件，下载目录必须对 Plex 可见。</p>
          </div>
        </div>
        <div class="setup-grid">
          <div>
            <label class="setup-label" for="plex-server">服务器地址</label>
            <input id="plex-server" v-model="config.plex.server" class="form-input" required :disabled="isChecking('plex')" placeholder="192.168.1.100">
          </div>
          <div>
            <label class="setup-label" for="plex-port">端口</label>
            <input id="plex-port" v-model.number="config.plex.port" class="form-input" type="number" min="1" max="65535" required :disabled="isChecking('plex')">
          </div>
        </div>
        <div>
          <label class="setup-label" for="plex-token">Plex Token</label>
          <input id="plex-token" v-model="config.plex.token" class="form-input font-mono" type="password" autocomplete="off" required :disabled="isChecking('plex')">
        </div>
        <div>
          <label class="setup-label" for="plex-section">音乐库名称</label>
          <input id="plex-section" v-model="config.plex.section" class="form-input" required :disabled="isChecking('plex')">
        </div>
        <p v-if="checks.plex.message" class="setup-check" :class="'setup-check--' + checks.plex.status" role="status">
          {{ checks.plex.message }}
        </p>
        <div class="setup-actions">
          <button class="btn btn-secondary" type="button" @click="activeStep = 'netease'">上一步</button>
          <button class="btn btn-primary" type="submit" :disabled="isChecking('plex') || !config.plex.server || !config.plex.token">
            <AppIcon v-if="isChecking('plex')" name="loader" class="animate-spin" :size="16" />
            <AppIcon v-else name="check" :size="16" />
            {{ isChecking('plex') ? '测试中...' : '测试连接' }}
          </button>
          <button class="btn btn-secondary" type="button" :disabled="!isStepComplete('plex')" @click="activeStep = 'download'">下一步</button>
        </div>
      </form>

      <form v-else-if="activeStep === 'download' && config" class="setup-form" @submit.prevent="checkStep('download')">
        <div class="setup-panel__header">
          <span class="setup-panel__icon"><AppIcon name="folder" :size="20" /></span>
          <div>
            <h2 class="setup-panel__title">确认下载目录</h2>
            <p class="setup-copy">YunPlex 会把歌曲、歌词和元数据写入这个目录。</p>
          </div>
        </div>
        <div>
          <label class="setup-label" for="download-dir">下载目录</label>
          <input id="download-dir" v-model="config.download.dir" class="form-input font-mono" required :disabled="isChecking('download')">
        </div>
        <div>
          <label class="setup-label" for="plex-prefix">Plex 音乐库路径前缀</label>
          <input id="plex-prefix" v-model="config.download.plexLibraryPathPrefix" class="form-input font-mono" :disabled="isChecking('download')" placeholder="可选，例如 /music">
          <p class="setup-path-note"><strong>这里只换算路径，不会传输文件。</strong>如果 Plex 在另一台主机，下载目录必须是 Plex 扫描目录的共享挂载，或另有复制流程。</p>
        </div>
        <p class="setup-path-note">
          无法验证托管路径或明确接管时，首次手动或定时同步会自动下载独立副本。
        </p>
        <p v-if="checks.download.message" class="setup-check" :class="'setup-check--' + checks.download.status" role="status">
          {{ checks.download.message }}
        </p>
        <div class="setup-actions">
          <button class="btn btn-secondary" type="button" @click="activeStep = 'plex'">上一步</button>
          <button class="btn btn-primary" type="submit" :disabled="isChecking('download') || !config.download.dir">
            <AppIcon v-if="isChecking('download')" name="loader" class="animate-spin" :size="16" />
            <AppIcon v-else name="check" :size="16" />
            {{ isChecking('download') ? '检查中...' : '检查目录' }}
          </button>
          <button class="btn btn-secondary" type="button" :disabled="!isStepComplete('download')" @click="activeStep = 'complete'">下一步</button>
        </div>
      </form>

      <div v-else-if="activeStep === 'complete'" class="setup-form">
        <div class="setup-panel__header">
          <span class="setup-panel__icon"><AppIcon name="checkCircle" :size="20" /></span>
          <div>
            <h2 class="setup-panel__title">完成初始化</h2>
            <p class="setup-copy">最后会由后端再次验证三项必需条件，通过后进入控制台。</p>
          </div>
        </div>
        <div class="setup-summary">
          <div v-for="item in requiredChecks" :key="item" class="setup-summary__item">
            <AppIcon :name="isStepComplete(item) ? 'checkCircle' : 'alert'" :size="17" />
            <span>{{ checkLabels[item] }}</span>
            <strong>{{ checks[item].status === 'ok' ? '已通过' : '待验证' }}</strong>
          </div>
          <div class="setup-summary__item">
            <AppIcon name="download" :size="17" />
            <span>无法验证媒体</span>
            <strong>自动下载</strong>
          </div>
        </div>
        <div>
          <p v-if="error" class="setup-error" role="alert">{{ error }}</p>
          <p v-else-if="message" class="setup-message">{{ message }}</p>
        </div>
        <div class="setup-actions">
          <button class="btn btn-secondary" type="button" @click="activeStep = 'download'">上一步</button>
          <button class="btn btn-primary" type="button" :disabled="submitting" @click="completeSetup">
            <AppIcon v-if="submitting" name="loader" class="animate-spin" :size="16" />
            <AppIcon v-else name="play" :size="16" />
            {{ submitting ? '完成中...' : '进入控制台' }}
          </button>
        </div>
      </div>
    </section>
  </section>
</template>

<script setup lang="ts">
import type { AppConfig } from '~~/server/lib/config/types'
import { DEFAULT_CONFIG } from '~~/server/lib/config/defaults'

definePageMeta({ layout: 'auth' })

type StepKey = 'admin' | 'netease' | 'plex' | 'download' | 'complete'
type CheckKey = 'netease' | 'plex' | 'download'
type CheckStatus = 'idle' | 'checking' | 'ok' | 'error'

interface CheckState {
  status: CheckStatus
  message: string
}

const auth = useAuth()
const api = useApi()
const loading = ref(true)
const submitting = ref(false)
const error = ref('')
const message = ref('')
const activeStep = ref<StepKey>('admin')
const adminPassword = ref('')
const adminPasswordConfirm = ref('')
const config = ref<AppConfig | null>(null)
const authState = computed(() => auth.state.value)

const requiredChecks: CheckKey[] = ['netease', 'plex', 'download']
const checkLabels: Record<CheckKey, string> = {
  netease: '网易云 Cookie',
  plex: 'Plex 连接',
  download: '下载目录',
}

const checks = reactive<Record<CheckKey, CheckState>>({
  netease: { status: 'idle', message: '' },
  plex: { status: 'idle', message: '' },
  download: { status: 'idle', message: '' },
})

const steps: Array<{ key: StepKey; label: string }> = [
  { key: 'admin', label: '账户' },
  { key: 'netease', label: '网易云' },
  { key: 'plex', label: 'Plex' },
  { key: 'download', label: '目录' },
  { key: 'complete', label: '完成' },
]

onMounted(async () => {
  loading.value = true
  try {
    const state = await auth.refreshState()
    if (!state.setupRequired) {
      await navigateTo('/')
      return
    }
    if (state.adminConfigured && state.authenticated) {
      await loadConfig()
      activeStep.value = 'netease'
    }
  } finally {
    loading.value = false
  }
})

async function loadConfig() {
  try {
    config.value = await api.get<AppConfig>('/setup/config')
  } catch {
    config.value = structuredClone(DEFAULT_CONFIG)
  }
}

async function createAdmin() {
  error.value = ''
  message.value = ''
  if (adminPassword.value !== adminPasswordConfirm.value) {
    error.value = '两次输入的密码不一致'
    return
  }

  submitting.value = true
  try {
    await auth.createAdmin(adminPassword.value)
    adminPassword.value = ''
    adminPasswordConfirm.value = ''
    await loadConfig()
    message.value = '管理员密码已创建。'
    activeStep.value = 'netease'
  } catch (err) {
    error.value = err instanceof Error ? err.message : '管理员密码创建失败'
  } finally {
    submitting.value = false
  }
}

async function checkStep(key: CheckKey) {
  if (!config.value) return
  error.value = ''
  message.value = ''
  checks[key] = { status: 'checking', message: '' }
  try {
    const result = await api.post<{ key: CheckKey; ok: boolean; message: string }>('/setup/check', {
      key,
      config: config.value,
    })
    checks[key] = { status: result.ok ? 'ok' : 'error', message: result.message }
    if (result.ok) {
      if (key === 'netease') activeStep.value = 'plex'
      else if (key === 'plex') activeStep.value = 'download'
      else activeStep.value = 'complete'
    }
  } catch (err) {
    checks[key] = { status: 'error', message: err instanceof Error ? err.message : '检查失败' }
  }
}

async function completeSetup() {
  if (!config.value) return
  error.value = ''
  message.value = ''
  submitting.value = true
  try {
    await api.post('/setup/complete', { config: config.value })
    await auth.refreshState()
    await navigateTo('/')
  } catch (err) {
    error.value = err instanceof Error ? err.message : '初始化完成失败'
    // 服务端复核未通过时，本地的三项结论已失效：回到待验证，修正对应步骤后重新检查。
    for (const key of requiredChecks) checks[key] = { status: 'idle', message: '' }
  } finally {
    submitting.value = false
  }
}

function isChecking(key: CheckKey): boolean {
  return checks[key].status === 'checking'
}

function isStepComplete(key: StepKey | CheckKey): boolean {
  if (key === 'admin') return Boolean(authState.value?.adminConfigured)
  if (key === 'complete') return requiredChecks.every(check => checks[check].status === 'ok')
  return checks[key as CheckKey].status === 'ok'
}

function canOpenStep(key: StepKey): boolean {
  if (key === 'admin') return true
  if (!authState.value?.adminConfigured || !authState.value.authenticated) return false
  if (key === 'complete') return true
  return true
}
</script>

<style scoped>
.setup-page {
  width: min(100%, 58rem);
  display: grid;
  gap: var(--space-4);
}

.setup-hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-4);
}

.setup-eyebrow {
  margin: 0 0 var(--space-1_5);
  color: var(--accent);
  font-size: var(--text-xs);
  font-weight: var(--font-weight-bold);
}

.setup-title {
  margin: 0;
}

.setup-copy {
  margin: var(--space-1_5) 0 0;
  color: var(--text-secondary);
  font-size: var(--text-base);
  line-height: var(--body-leading);
}

.setup-progress {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: var(--space-2);
}

.setup-step {
  min-height: 3rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  padding: 0 var(--space-2);
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-md);
  background: var(--bg-input);
  color: var(--text-secondary);
  font-size: var(--text-sm);
  font-weight: var(--font-weight-semibold);
  cursor: pointer;
  transition: border-color var(--duration-fast) ease, background var(--duration-fast) ease, color var(--duration-fast) ease;
}

.setup-step:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.setup-step--active {
  color: var(--accent);
  border-color: var(--accent);
  background: var(--accent-muted);
}

.setup-step--done {
  color: var(--success);
  border-color: var(--success-border);
  background: var(--success-soft);
}

.setup-step__index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.35rem;
  height: 1.35rem;
  border-radius: var(--radius-full);
  background: var(--bg-surface);
  font-size: var(--text-xs);
}

.setup-panel {
  padding: clamp(1.1rem, 4vw, 1.6rem);
}

.setup-panel__header {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3_5);
  margin-bottom: var(--space-4);
}

.setup-panel__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.6rem;
  height: 2.6rem;
  border-radius: var(--radius-lg);
  color: var(--accent);
  background: var(--accent-muted);
  border: 1px solid var(--border-primary);
  flex-shrink: 0;
}

.setup-panel__title {
  margin: 0;
}

.setup-form {
  display: grid;
  gap: var(--space-4);
}

.setup-label {
  display: inline-flex;
  margin-bottom: var(--space-2);
  font-size: var(--text-base);
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
}

.setup-path-note {
  margin: var(--space-2) 0 0;
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  line-height: var(--body-leading);
}

.setup-path-note strong {
  color: var(--text-secondary);
}

.setup-textarea {
  min-height: 7rem;
  resize: vertical;
}

.setup-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(7rem, 0.32fr);
  gap: var(--space-3);
}

.setup-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-2_5);
}

.setup-action {
  width: fit-content;
}

.setup-error,
.setup-message,
.setup-check {
  margin: 0;
  padding: var(--space-3) var(--space-3_5);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  line-height: var(--body-leading);
}

.setup-error,
.setup-check--error {
  color: var(--danger);
  background: var(--danger-soft);
  border: 1px solid var(--danger-border);
}

.setup-message,
.setup-check--ok {
  color: var(--success);
  background: var(--success-soft);
  border: 1px solid var(--success-border);
}

.setup-check--checking,
.setup-check--idle {
  color: var(--text-secondary);
  background: var(--bg-input);
  border: 1px solid var(--border-primary);
}

.setup-summary {
  display: grid;
  gap: var(--space-2_5);
}

.setup-summary__item {
  display: flex;
  align-items: center;
  gap: var(--space-2_5);
  min-height: 2.8rem;
  padding: 0 var(--space-3_5);
  border-radius: var(--radius-md);
  border: 1px solid var(--border-primary);
  background: var(--bg-input);
  color: var(--text-secondary);
}

.setup-summary__item strong {
  margin-left: auto;
  color: var(--text-primary);
  font-size: var(--text-sm);
}

@media (min-width: 780px) {
  .setup-hero {
    grid-template-columns: minmax(0, 0.85fr) minmax(22rem, 1fr);
    align-items: end;
  }
}

@media (max-width: 640px) {

  .setup-progress {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .setup-grid {
    grid-template-columns: 1fr;
  }

  .setup-actions,
  .setup-action,
  .setup-actions .btn {
    width: 100%;
  }
}
</style>
