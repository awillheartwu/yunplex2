<template>
  <section class="auth-panel section-card" aria-labelledby="login-title">
    <div class="auth-panel__header">
      <span class="auth-panel__icon">
        <AppIcon name="shield" :size="22" />
      </span>
      <div>
        <h1 id="login-title" class="auth-panel__title">欢迎回来</h1>
        <p class="auth-panel__copy">输入管理员密码后继续管理同步、下载与系统配置。</p>
      </div>
    </div>

    <form class="auth-form" @submit.prevent="handleLogin">
      <div>
        <label class="auth-label" for="admin-password">管理员密码</label>
        <input
          id="admin-password"
          v-model="password"
          class="form-input"
          type="password"
          autocomplete="current-password"
          required
          :disabled="submitting"
        >
      </div>

      <p v-if="error" class="auth-error" role="alert">{{ error }}</p>
      <p v-if="message" class="auth-message">{{ message }}</p>

      <button class="btn btn-primary auth-submit" type="submit" :disabled="submitting || !password">
        <AppIcon v-if="submitting" name="loader" class="animate-spin" :size="16" />
        <AppIcon v-else name="user" :size="16" />
        {{ submitting ? '登录中...' : '登录' }}
      </button>
    </form>

    <div v-if="authState?.resetAvailable" class="auth-reset">
      <button class="btn btn-ghost btn-sm" type="button" @click="resetOpen = !resetOpen">
        <AppIcon name="rotateCcw" :size="15" />
        重置管理员密码
      </button>

      <form v-if="resetOpen" class="auth-form auth-form--reset" @submit.prevent="handleReset">
        <div>
          <label class="auth-label" for="reset-token">一次性重置令牌</label>
          <input
            id="reset-token"
            v-model="resetToken"
            class="form-input font-mono"
            type="password"
            autocomplete="one-time-code"
            required
            :disabled="resetting"
          >
        </div>
        <div>
          <label class="auth-label" for="new-password">新管理员密码</label>
          <input
            id="new-password"
            v-model="newPassword"
            class="form-input"
            type="password"
            autocomplete="new-password"
            required
            minlength="8"
            :disabled="resetting"
          >
        </div>
        <div>
          <label class="auth-label" for="new-password-confirm">确认新密码</label>
          <input
            id="new-password-confirm"
            v-model="newPasswordConfirm"
            class="form-input"
            type="password"
            autocomplete="new-password"
            required
            minlength="8"
            :disabled="resetting"
          >
        </div>
        <button class="btn btn-secondary auth-submit" type="submit" :disabled="resetting">
          <AppIcon v-if="resetting" name="loader" class="animate-spin" :size="16" />
          <AppIcon v-else name="save" :size="16" />
          {{ resetting ? '重置中...' : '重置密码' }}
        </button>
      </form>
    </div>
  </section>
</template>

<script setup lang="ts">
definePageMeta({ layout: 'auth' })

const route = useRoute()
const auth = useAuth()
const password = ref('')
const error = ref('')
const message = ref('')
const submitting = ref(false)
const resetOpen = ref(false)
const resetToken = ref('')
const newPassword = ref('')
const newPasswordConfirm = ref('')
const resetting = ref(false)
const authState = computed(() => auth.state.value)

onMounted(async () => {
  try {
    const state = await auth.refreshState()
    if (state.setupRequired) await navigateTo('/setup')
    else if (state.authenticated || !state.authEnabled) await navigateTo(typeof route.query.redirect === 'string' ? route.query.redirect : '/')
  } catch { error.value = '暂时无法读取服务状态，可稍后重试登录。' }
})

async function handleLogin() {
  error.value = ''
  message.value = ''
  submitting.value = true
  try {
    await auth.login(password.value)
    await navigateTo(typeof route.query.redirect === 'string' ? route.query.redirect : '/')
  } catch (err) {
    error.value = err instanceof Error ? err.message : '登录失败'
  } finally {
    submitting.value = false
  }
}

async function handleReset() {
  error.value = ''
  message.value = ''
  if (newPassword.value !== newPasswordConfirm.value) {
    error.value = '两次输入的新密码不一致'
    return
  }

  resetting.value = true
  try {
    await auth.resetPassword(resetToken.value, newPassword.value)
    resetToken.value = ''
    newPassword.value = ''
    newPasswordConfirm.value = ''
    password.value = ''
    resetOpen.value = false
    message.value = '管理员密码已重置，请使用新密码登录。'
  } catch (err) {
    error.value = err instanceof Error ? err.message : '重置失败'
  } finally {
    resetting.value = false
  }
}
</script>

<style scoped>
.auth-panel {
  width: min(100%, 28rem);
  padding: clamp(1.5rem, 4vw, 2.25rem);
  box-shadow: var(--shadow-md);
}

.auth-panel__header {
  display: flex;
  gap: var(--space-3_5);
  align-items: flex-start;
  margin-bottom: var(--space-5);
}

.auth-panel__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.75rem;
  height: 2.75rem;
  border-radius: var(--radius-lg);
  color: var(--accent);
  background: var(--accent-muted);
  border: 1px solid var(--border-primary);
  flex-shrink: 0;
}

.auth-panel__title {
  margin: 0;
  font-size: var(--text-2xl);
  line-height: 1.2;
  font-weight: var(--font-weight-bold);
  letter-spacing: 0;
}

.auth-panel__copy {
  margin: var(--space-1_5) 0 0;
  color: var(--text-secondary);
  font-size: var(--text-base);
  line-height: 1.6;
}

.auth-form {
  display: grid;
  gap: var(--space-3_5);
}

.auth-form--reset {
  margin-top: var(--space-3_5);
  padding-top: var(--space-3_5);
  border-top: 1px solid var(--border-primary);
}

.auth-label {
  display: inline-flex;
  margin-bottom: var(--space-2);
  font-size: var(--text-base);
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
}

.auth-error,
.auth-message {
  margin: 0;
  padding: var(--space-3) var(--space-3);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  line-height: 1.5;
}

.auth-error {
  color: var(--danger);
  background: var(--danger-soft);
  border: 1px solid var(--danger-border);
}

.auth-message {
  color: var(--success);
  background: var(--success-soft);
  border: 1px solid var(--success-border);
}

.auth-submit {
  width: 100%;
}

.auth-reset {
  display: grid;
  gap: var(--space-1_5);
  margin-top: var(--space-4);
}
</style>
