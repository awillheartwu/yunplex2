import { readQuickPreview } from '../../../../lib/source-initialization/quick-plan'
import { initializationFailure } from '../../../../lib/source-initialization/errors'
import { success } from '../../../../lib/response'
export default defineEventHandler(event=>{
  try {const query=getQuery(event);return success(readQuickPreview(getRouterParam(event,'id')||'',String(query.operationId||''),String(query.token||''),Number(query.page)||1))}
  catch(error){return initializationFailure(error)}
})
