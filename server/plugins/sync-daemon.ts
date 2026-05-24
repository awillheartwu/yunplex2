import { readConfig, setDataDir } from '../lib/config/store'
import { initDb } from '../lib/db'
import { getSyncService } from '../lib/sync/service'
import { startWorker } from '../lib/sync/worker'
import { setSyncService, setSyncWorker } from '../lib/sync/instance'

export default defineNitroPlugin(() => {
  const config = useRuntimeConfig()
  const dataDir = config.dataDir as string
  setDataDir(dataDir)

  initDb(dataDir)

  const svc = getSyncService(dataDir, () => readConfig())
  setSyncService(svc)

  const worker = startWorker(
    () => readConfig(),
    svc,
    dataDir,
  )
  setSyncWorker(worker)
})
