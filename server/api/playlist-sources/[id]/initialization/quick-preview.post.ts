import { previewQuickPlan } from '../../../../lib/source-initialization/quick-plan'
import { initializationFailure } from '../../../../lib/source-initialization/errors'
import { success } from '../../../../lib/response'
export default defineEventHandler(async event=>{
  try { const body=await readBody<{initializationId:string;revision:number;threshold:number}>(event);return success(previewQuickPlan(getRouterParam(event,'id')||'',body.initializationId,body.revision,body.threshold)) }
  catch(error){return initializationFailure(error)}
})
