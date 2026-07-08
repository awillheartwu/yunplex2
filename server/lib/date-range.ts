import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc.js'
import timezone from 'dayjs/plugin/timezone.js'

dayjs.extend(utc)
dayjs.extend(timezone)

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

export interface DateBoundary {
  value: string
  exclusive: boolean
}

export function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format()
    return true
  } catch {
    return false
  }
}

export function isValidDateFilter(value: string): boolean {
  if (!DATE_ONLY.test(value)) return Number.isFinite(Date.parse(value))
  const [year, month, day] = value.split('-').map(Number)
  const parsed = new Date(Date.UTC(year!, month! - 1, day!))
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month! - 1
    && parsed.getUTCDate() === day
}

export function dateStartBoundary(value: string, timeZone = 'UTC'): DateBoundary {
  if (!DATE_ONLY.test(value)) return { value, exclusive: false }
  return {
    value: dayjs.tz(value, timeZone).startOf('day').toISOString(),
    exclusive: false,
  }
}

export function dateEndBoundary(value: string, timeZone = 'UTC'): DateBoundary {
  if (!DATE_ONLY.test(value)) return { value, exclusive: false }
  return {
    value: dayjs.tz(value, timeZone).startOf('day').add(1, 'day').toISOString(),
    exclusive: true,
  }
}

export function dateKeyInTimeZone(value: string, timeZone = 'UTC'): string {
  return dayjs(value).tz(timeZone).format('YYYY-MM-DD')
}
