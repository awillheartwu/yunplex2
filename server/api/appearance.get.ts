import { readConfig } from '../lib/config/store'
import { success } from '../lib/response'

// Protected by the normal API middleware; expose only display preferences.
export default defineEventHandler(() => success({ fontScale: readConfig().other.fontScale }))
