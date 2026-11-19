import { cancelQuickPlan } from '../../../../lib/source-initialization/quick-plan'
import { initializationFailure } from '../../../../lib/source-initialization/errors'
import { success } from '../../../../lib/response'
export default defineEventHandler(async event=>{
  try {const body=await readBody<{initializationId:string}>(event);return success(cancelQuickPlan(getRouterParam(event,'id')||'',body.initializationId))}
  catch(error){return initializationFailure(error)}
})
