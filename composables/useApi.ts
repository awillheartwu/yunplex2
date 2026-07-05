interface ApiResponse<T> {
  code: number
  msg: string
  data: T
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  body?: unknown
  params?: Record<string, string>
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, params } = options

  let url = `/api${path}`
  if (params) {
    const search = new URLSearchParams(params)
    url += `?${search.toString()}`
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (import.meta.client && method !== 'GET') {
    const auth = useAuth()
    const state = await auth.ensureState().catch(() => null)
    if (state?.csrfToken) headers['X-CSRF-Token'] = state.csrfToken
  }

  const fetchOptions: RequestInit = {
    method,
    headers,
    credentials: 'same-origin',
  }

  if (body && method !== 'GET') {
    fetchOptions.body = JSON.stringify(body)
  }

  const res = await fetch(url, fetchOptions)
  if (!res.ok) {
    await handleAuthStatus(res)
    throw new Error(await readErrorMessage(res))
  }

  const json = (await res.json()) as ApiResponse<T>
  if (json.code !== 0) {
    throw new Error(json.msg || '请求失败')
  }

  return json.data
}

export function useApi() {
  const get = <T>(path: string, params?: Record<string, string>) =>
    request<T>(path, { method: 'GET', params })

  const post = <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body })

  const put = <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body })

  const del = <T>(path: string) =>
    request<T>(path, { method: 'DELETE' })

  const rawPost = async <T>(path: string, body?: unknown): Promise<ApiResponse<T>> => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (import.meta.client) {
      const auth = useAuth()
      const state = await auth.ensureState().catch(() => null)
      if (state?.csrfToken) headers['X-CSRF-Token'] = state.csrfToken
    }
    const fetchOptions: RequestInit = {
      method: 'POST',
      headers,
      credentials: 'same-origin',
      body: JSON.stringify(body),
    }
    const res = await fetch(`/api${path}`, fetchOptions)
    if (!res.ok) await handleAuthStatus(res)
    return (await res.json()) as ApiResponse<T>
  }

  return { get, post, put, del, rawPost }
}

async function handleAuthStatus(res: Response): Promise<void> {
  if (!import.meta.client) return
  if (res.status === 401) {
    const route = useRoute()
    await navigateTo({ path: '/login', query: { redirect: route.fullPath } })
  } else if (res.status === 428) {
    await navigateTo('/setup')
  }
}

async function readErrorMessage(res: Response): Promise<string> {
  const cloned = res.clone()
  const json = await cloned.json().catch(() => null) as Partial<ApiResponse<unknown>> | null
  return json?.msg || `HTTP ${res.status}`
}
