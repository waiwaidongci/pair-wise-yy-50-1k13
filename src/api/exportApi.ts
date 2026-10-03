import axios, { type AxiosAdapter } from 'axios'
import type { ExportTask } from '../types'
import { TOTAL_SHARDS } from './seed'
import * as server from './server'

const delay = (ms = 140) => new Promise((resolve) => setTimeout(resolve, ms))

function now() {
  return '刚刚'
}

function newTask(name: string, spec: string): ExportTask {
  return {
    id: `EXP-${Date.now().toString().slice(-6)}`,
    name,
    spec,
    progress: 0,
    status: '排队中',
    updatedAt: now(),
    resumable: true,
    totalShards: TOTAL_SHARDS,
    doneShards: [],
  }
}

type CreateBody = { name: string; spec: string }
type CreateResult = { task: ExportTask; reused: boolean }
type ResumeResult = { task: ExportTask; resumed: boolean }

const adapter: AxiosAdapter = async (config) => {
  await delay()
  const url = config.url ?? ''
  const method = (config.method ?? 'get').toLowerCase()

  if (url === '/api/print/export-tasks' && method === 'get') {
    return { data: structuredClone(server.listTasks()), status: 200, statusText: 'OK', headers: {}, config }
  }
  if (url === '/api/print/export-tasks' && method === 'post') {
    const body = JSON.parse(config.data ?? '{}') as CreateBody
    // 重复发起：同规格存在未完成任务时沿用原任务号，不重复建任务
    const existing = server.findOpenTask(body.spec)
    if (existing) {
      return { data: { task: structuredClone(existing), reused: true } as CreateResult, status: 200, statusText: 'OK', headers: {}, config }
    }
    const task = server.upsertTask(newTask(body.name, body.spec))
    return { data: { task: structuredClone(task), reused: false } as CreateResult, status: 200, statusText: 'OK', headers: {}, config }
  }
  if (url.match(/^\/api\/print\/export-tasks\/[^/]+\/resume$/) && method === 'post') {
    const id = url.split('/').at(-2) ?? ''
    const tasks = server.listTasks()
    const task = tasks.find((item) => item.id === id)
    if (task && task.status !== '已完成') {
      task.status = '生成中'
      task.resumable = true
      task.updatedAt = now()
      server.upsertTask(task)
      return { data: { task: structuredClone(task), resumed: true } as ResumeResult, status: 200, statusText: 'OK', headers: {}, config }
    }
    return { data: { task: task ? structuredClone(task) : null, resumed: false } as ResumeResult, status: 200, statusText: 'OK', headers: {}, config }
  }
  if (url.match(/^\/api\/print\/export-tasks\/[^/]+\/tick$/) && method === 'post') {
    const id = url.split('/').at(-2) ?? ''
    const task = server.tickTask(id)
    return { data: { task: task ? structuredClone(task) : null }, status: 200, statusText: 'OK', headers: {}, config }
  }
  return { data: null, status: 404, statusText: 'Not Found', headers: {}, config }
}

const client = axios.create({ adapter })

export const exportApi = {
  list: () => client.get<ExportTask[]>('/api/print/export-tasks'),
  create: (name: string, spec: string) => client.post<CreateResult>('/api/print/export-tasks', { name, spec }),
  resume: (id: string) => client.post<ResumeResult>(`/api/print/export-tasks/${id}/resume`),
  tick: (id: string) => client.post<{ task: ExportTask | null }>(`/api/print/export-tasks/${id}/tick`),
}
