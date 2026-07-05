interface ApiResponse<T> {
  code: number
  msg: string
  data: T
}

export interface AuthState {
  authEnabled: boolean
  devAuthDisabled: boolean
  authenticated: boolean
  adminConfigured: boolean
  setupRequired: boolean
  setupCompleted: boolean
  setupVersion: number
  requiredSetupVersion: number
  csrfToken: string | null
  resetAvailable: boolean
}

interface LoginResult {
  authenticated: boolean
  csrfToken: string
  expiresAt: string
}

async function parseAuthResponse<T>(response: Response): Promise<T> {
  const json = (await response.json().catch(() => null)) as ApiResponse<T> | null
  if (!response.ok || !json || json.code !== 0) {
    throw new Error(json?.msg || `HTTP ${response.status}`)
  }
  return json.data
}

export function useAuth() {
  const state = useState<AuthState | null>('yunplex-auth-state', () => null)
  const loading = useState<boolean>('yunplex-auth-loading', () => false)

  async function refreshState(): Promise<AuthState> {
    loading.value = true
    try {
      const response = await fetch('/api/auth/state', { credentials: 'same-origin' })
      const next = await parseAuthResponse<AuthState>(response)
      state.value = next
      return next
    } finally {
      loading.value = false
    }
  }

  async function ensureState(): Promise<AuthState> {
    return state.value ?? refreshState()
  }

  async function authPost<T>(path: string, body: unknown, csrfToken?: string | null): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken
    const response = await fetch(`/api${path}`, {
      method: 'POST',
      headers,
      credentials: 'same-origin',
      body: JSON.stringify(body ?? {}),
    })
    return parseAuthResponse<T>(response)
  }

  async function login(password: string): Promise<LoginResult> {
    const result = await authPost<LoginResult>('/auth/login', { password })
    await refreshState()
    return result
  }

  async function logout(): Promise<void> {
    const current = await ensureState()
    if (current.authEnabled && current.authenticated) {
      await authPost('/auth/logout', {}, current.csrfToken)
    }
    state.value = {
      ...current,
      authenticated: false,
      csrfToken: null,
    }
  }

  async function createAdmin(password: string): Promise<LoginResult> {
    const result = await authPost<LoginResult>('/setup/admin', { password })
    await refreshState()
    return result
  }

  async function resetPassword(resetToken: string, password: string): Promise<void> {
    await authPost('/auth/reset', { resetToken, password })
    await refreshState()
  }

  async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
    const current = await ensureState()
    await authPost('/auth/password', { currentPassword, newPassword }, current.csrfToken)
    state.value = {
      ...current,
      authenticated: false,
      csrfToken: null,
    }
  }

  async function reinitializeSetup(reason = 'manual'): Promise<void> {
    const current = await ensureState()
    await authPost('/setup/reinitialize', { reason }, current.csrfToken)
    await refreshState()
  }

  return {
    state,
    loading,
    ensureState,
    refreshState,
    login,
    logout,
    createAdmin,
    resetPassword,
    changePassword,
    reinitializeSetup,
  }
}
