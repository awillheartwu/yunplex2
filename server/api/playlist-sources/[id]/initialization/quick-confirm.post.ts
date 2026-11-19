import { confirmQuickPlan } from '../../../../lib/source-initialization/quick-plan'
import { initializationFailure } from '../../../../lib/source-initialization/errors'
import { success } from '../../../../lib/response'
import { getSyncWorker } from '../../../../lib/sync/instance'
export default defineEventHandler(async event=>{
  try {const body=await readBody<{operationId:string;token:string;start:boolean}>(event);if(typeof body.start!=='boolean')throw new Error('请选择保存或启动');const result=confirmQuickPlan(getRouterParam(event,'id')||'',body.operationId,body.token,body.start);if(body.start)void getSyncWorker()?.runOnce();return success(result)}
  catch(error){return initializationFailure(error)}
})
