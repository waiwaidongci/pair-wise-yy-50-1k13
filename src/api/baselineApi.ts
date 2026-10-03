import axios, { type AxiosAdapter } from 'axios'
import type { BaselineCommit, BaselineCommitResult, ConflictCopy, ServerBaseline, VersionEntry } from '../types'
import * as server from './server'

const delay = (ms = 140) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 基线 REST 适配器。
 * compare-and-swap 在 await 之后同步进行：即便等待期间别的窗口已提交，
 * 这里也会以最新服务端状态为准做先到先得判定，不会盖掉对方。
 */
const adapter: AxiosAdapter = async (config) => {
  await delay()
  const url = config.url ?? ''
  const method = (config.method ?? 'get').toLowerCase()

  if (url === '/api/print/baseline' && method === 'get') {
    return { data: structuredClone(server.getBaseline()), status: 200, statusText: 'OK', headers: {}, config }
  }
  if (url === '/api/print/baseline/commit' && method === 'post') {
    const payload = JSON.parse(config.data ?? '{}') as BaselineCommit
    const result = server.commitBaseline(payload)
    const body: BaselineCommitResult = result.ok
      ? { ok: true, revision: result.revision, baseline: structuredClone(result.baseline) }
      : { ok: false, currentRevision: result.currentRevision, conflict: structuredClone(result.conflict) }
    return { data: body, status: 200, statusText: 'OK', headers: {}, config }
  }
  if (url === '/api/print/baseline/conflicts' && method === 'get') {
    return { data: structuredClone(server.listConflicts()), status: 200, statusText: 'OK', headers: {}, config }
  }
  if (url === '/api/print/baseline/versions' && method === 'get') {
    return { data: structuredClone(server.listVersions()), status: 200, statusText: 'OK', headers: {}, config }
  }
  if (url === '/api/print/baseline/simulate-collaborator' && method === 'post') {
    const result = server.simulateCollaboratorCommit()
    return { data: { ok: true, revision: result.revision, baseline: structuredClone(result.baseline) }, status: 200, statusText: 'OK', headers: {}, config }
  }
  return { data: null, status: 404, statusText: 'Not Found', headers: {}, config }
}

const client = axios.create({ adapter })

export const baselineApi = {
  get: () => client.get<ServerBaseline>('/api/print/baseline'),
  commit: (payload: BaselineCommit) => client.post<BaselineCommitResult>('/api/print/baseline/commit', payload),
  conflicts: () => client.get<ConflictCopy[]>('/api/print/baseline/conflicts'),
  versions: () => client.get<VersionEntry[]>('/api/print/baseline/versions'),
  simulateCollaborator: () => client.post<{ ok: true; revision: number; baseline: ServerBaseline }>('/api/print/baseline/simulate-collaborator'),
}
