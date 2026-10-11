import { restoreQuickPlan } from '../../../../lib/source-initialization/quick-plan'
import { initializationFailure } from '../../../../lib/source-initialization/errors'
import { success } from '../../../../lib/response'
export default defineEventHandler(async event=>{
  try {const body=await readBody<{operationId:string;token:string}>(event);return success(restoreQuickPlan(getRouterParam(event,'id')||'',body.operationId,body.token))}
  catch(error){return initializationFailure(error)}
})
