export interface ApiResponse<T = unknown> {
  code: number
  msg: string
  data: T
}

export function success<T>(data: T, msg = 'ok'): ApiResponse<T> {
  return { code: 0, msg, data }
}

export function fail(msg: string, code = 1): ApiResponse<null> {
  return { code, msg, data: null }
}
