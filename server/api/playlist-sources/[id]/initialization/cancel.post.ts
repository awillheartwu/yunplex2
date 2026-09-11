import { fail, success } from '../../../../lib/response'
import { cancelSourceInitialization } from '../../../../lib/source-initialization/service'
export default defineEventHandler((event) => cancelSourceInitialization(getRouterParam(event, 'id') || '') ? success(null, '已发送取消请求') : fail('当前没有正在分析的接管任务'))
