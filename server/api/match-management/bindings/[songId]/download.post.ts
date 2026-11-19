import { requestMediaCorrection } from '../../../../lib/sync/media-corrections'
import { fail, success } from '../../../../lib/response'
import { getSyncWorker } from '../../../../lib/sync/instance'
import { acquireIdentityMutationLock } from '../../../../lib/sync/identity-coordinator'
export default defineEventHandler(async event=>{
  const id=Number(getRouterParam(event,'songId'))
  if(!Number.isSafeInteger(id)||id<=0)return fail('无效歌曲 ID')
  const body=await readBody<{expectedBindingUpdatedAt?:string|null}>(event)
  if(!Object.prototype.hasOwnProperty.call(body,'expectedBindingUpdatedAt'))return fail('缺少绑定版本，请刷新')
  const release=await acquireIdentityMutationLock()
  try{const result=requestMediaCorrection(id,body.expectedBindingUpdatedAt??null);void getSyncWorker()?.runOnce();return success(result,'独立副本处理已安排，完成前保留旧关联；禁用来源等待手动同步')}
  catch(error){return fail(error instanceof Error?error.message:'安排下载失败',409)}finally{release()}
})
