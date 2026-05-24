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

  const fetchOptions: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  }

  if (body && method !== 'GET') {
    fetchOptions.body = JSON.stringify(body)
  }

  const res = await fetch(url, fetchOptions)
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`)
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

  return { get, post, put, del }
}
