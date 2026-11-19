import { success } from '../../lib/response'
import { getActivitySnapshot } from '../../lib/run/activity'
import { getSyncServiceInstance } from '../../lib/sync/instance'

export default defineEventHandler(() => success(getActivitySnapshot(getSyncServiceInstance().getState())))
