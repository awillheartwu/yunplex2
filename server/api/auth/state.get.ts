import { getSessionToken } from '../../lib/auth/http'
import {
  getSessionByToken,
  getSetupState,
  hasAdminPassword,
  isDevAuthDisabled,
  isResetTokenAvailable,
} from '../../lib/auth/store'
import { success } from '../../lib/response'

export default defineEventHandler((event) => {
  const setup = getSetupState()

  if (isDevAuthDisabled()) {
    return success({
      authEnabled: false,
      devAuthDisabled: true,
      authenticated: true,
      adminConfigured: true,
      setupRequired: false,
      setupCompleted: true,
      setupVersion: setup.requiredVersion,
      csrfToken: 'dev-auth-disabled',
      resetAvailable: false,
    })
  }

  const session = getSessionByToken(getSessionToken(event))
  return success({
    authEnabled: true,
    devAuthDisabled: false,
    authenticated: Boolean(session),
    adminConfigured: hasAdminPassword(),
    setupRequired: !setup.completed,
    setupCompleted: setup.completed,
    setupVersion: setup.version,
    requiredSetupVersion: setup.requiredVersion,
    csrfToken: session?.csrfToken ?? null,
    resetAvailable: isResetTokenAvailable(),
  })
})
