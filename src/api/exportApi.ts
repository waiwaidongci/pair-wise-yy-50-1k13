import axios, { type AxiosAdapter } from 'axios'
import type { ExportTask } from '../stores/imposition'

export type CreateExportPayload = { name: string; revision: string; baselineVersion: number; idempotencyKey: string }
export type CreateExportResult = { task: ExportTask; reused: boolean }

const TASKS_KEY = 'print-imposition-v2-tasks'
const LEGACY_KEY = 'print-imposition-v1'
const FRAGMENT_TOTAL = 8

function now() {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// 旧任务没有分片/幂等字段：按进度折算已完成分片，补齐版本依据
function normalize(task: Partial<ExportTask> & { id: string; name: string }): ExportTask {
  const total = task.fragments?.total ?? FRAGMENT_TOTAL
  const completed = task.fragments?.completed ?? Array.from({ length: Math.round(((task.progress ?? 0) / 100) * total) }, (_, index) => index + 1)
  const revision = task.revision ?? 'V1'
  return {
    id: task.id,
    name: task.name,
    status: task.status ?? '排队中',
    updatedAt: task.updatedAt ?? now(),
    resumable: task.resumable ?? task.status !== '已完成',
    revision,
    baselineVersion: task.baselineVersion ?? 0,
    idempotencyKey: task.idempotencyKey ?? `${revision}:${task.name}`,
    fragments: { total, completed },
    progress: Math.round((completed.length / total) * 100),
  }
}

const seedTasks: ExportTask[] = [
  normalize({ id: 'EXP-0925-01', name: '印刷交付包 · PDF/X-4', progress: 72, status: '已中断', updatedAt: '09-25 16:42', resumable: true }),
  normalize({ id: 'EXP-0925-02', name: '数字样张低分辨率预览', progress: 100, status: '已完成', updatedAt: '09-25 15:18', resumable: false }),
]

function loadTasks(): ExportTask[] {
  try {
    const raw = localStorage.getItem(TASKS_KEY)
    if (raw) return (JSON.parse(raw) as Array<Partial<ExportTask> & { id: string; name: string }>).map(normalize)
  } catch {
    /* fall through to legacy / seeds */
  }
  try {
    const legacyRaw = localStorage.getItem(LEGACY_KEY)
    if (legacyRaw) {
      const legacy = JSON.parse(legacyRaw) as { tasks?: Array<Partial<ExportTask> & { id: string; name: string }> }
      if (Array.isArray(legacy.tasks) && legacy.tasks.length) return legacy.tasks.map(normalize)
    }
  } catch {
    /* fall through to seeds */
  }
  return structuredClone(seedTasks)
}

let tasks = loadTasks()
// 上次会话中断的生成任务：保留已完成分片，标记为可恢复
tasks.forEach((task) => {
  if (task.status === '生成中' || task.status === '排队中') {
    task.status = '已中断'
    task.resumable = true
  }
})

const timers = new Map<string, ReturnType<typeof setInterval>>()

function persist() {
  localStorage.setItem(TASKS_KEY, JSON.stringify(tasks))
}
persist()

function stop(id: string) {
  const timer = timers.get(id)
  if (timer) clearInterval(timer)
  timers.delete(id)
}

// 从下一个未完成分片继续生成，已完成分片直接复用
function run(task: ExportTask) {
  stop(task.id)
  task.status = '生成中'
  task.resumable = true
  task.updatedAt = now()
  persist()
  timers.set(task.id, setInterval(() => {
    const next = task.fragments.completed.length + 1
    task.fragments.completed.push(next)
    task.progress = Math.round((task.fragments.completed.length / task.fragments.total) * 100)
    task.updatedAt = now()
    if (task.fragments.completed.length >= task.fragments.total) {
      task.status = '已完成'
      task.progress = 100
      task.resumable = false
      stop(task.id)
    }
    persist()
  }, 450))
}

let taskSeq = tasks.length
function nextTaskId() {
  taskSeq += 1
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `EXP-${pad(d.getMonth() + 1)}${pad(d.getDate())}-${String(taskSeq).padStart(2, '0')}`
}

const adapter: AxiosAdapter = async (config) => {
  await new Promise((resolve) => setTimeout(resolve, 160))

  if (config.url === '/api/print/export-tasks' && config.method === 'get') {
    return { data: structuredClone(tasks), status: 200, statusText: 'OK', headers: {}, config }
  }

  // 重复发起沿用原任务：同一幂等键且未完成的任务直接复用，中断的顺带恢复
  if (config.url === '/api/print/export-tasks' && config.method === 'post') {
    const payload = JSON.parse(config.data ?? '{}') as CreateExportPayload
    const existing = tasks.find((task) => task.idempotencyKey === payload.idempotencyKey && task.status !== '已完成')
    if (existing) {
      if (existing.status === '已中断') run(existing)
      return { data: { task: structuredClone(existing), reused: true } satisfies CreateExportResult, status: 200, statusText: 'OK', headers: {}, config }
    }
    const task: ExportTask = {
      id: nextTaskId(),
      name: payload.name,
      progress: 0,
      status: '排队中',
      updatedAt: now(),
      resumable: true,
      revision: payload.revision,
      baselineVersion: payload.baselineVersion,
      idempotencyKey: payload.idempotencyKey,
      fragments: { total: FRAGMENT_TOTAL, completed: [] },
    }
    tasks.unshift(task)
    run(task)
    return { data: { task: structuredClone(task), reused: false } satisfies CreateExportResult, status: 200, statusText: 'OK', headers: {}, config }
  }

  // 按任务号恢复：只补未完成分片
  if (config.url?.match(/^\/api\/print\/export-tasks\/[^/]+\/resume$/) && config.method === 'post') {
    const id = config.url.split('/').at(-2)
    const task = tasks.find((item) => item.id === id)
    if (task && task.resumable && task.status !== '已完成') run(task)
    return { data: task ? structuredClone(task) : null, status: task ? 200 : 404, statusText: task ? 'OK' : 'Not Found', headers: {}, config }
  }

  // 模拟导出失败：中断并保留已完成分片
  if (config.url?.match(/^\/api\/print\/export-tasks\/[^/]+\/interrupt$/) && config.method === 'post') {
    const id = config.url.split('/').at(-2)
    const task = tasks.find((item) => item.id === id)
    if (task && (task.status === '生成中' || task.status === '排队中')) {
      stop(task.id)
      task.status = '已中断'
      task.resumable = true
      task.updatedAt = now()
      persist()
    }
    return { data: task ? structuredClone(task) : null, status: task ? 200 : 404, statusText: task ? 'OK' : 'Not Found', headers: {}, config }
  }

  if (config.url === '/api/print/export-tasks/completed' && config.method === 'delete') {
    tasks = tasks.filter((task) => task.status !== '已完成')
    persist()
    return { data: structuredClone(tasks), status: 200, statusText: 'OK', headers: {}, config }
  }

  return { data: null, status: 404, statusText: 'Not Found', headers: {}, config }
}

const client = axios.create({ adapter })

export const exportApi = {
  list: () => client.get<ExportTask[]>('/api/print/export-tasks'),
  create: (payload: CreateExportPayload) => client.post<CreateExportResult>('/api/print/export-tasks', payload),
  resume: (id: string) => client.post<ExportTask>(`/api/print/export-tasks/${id}/resume`),
  interrupt: (id: string) => client.post<ExportTask>(`/api/print/export-tasks/${id}/interrupt`),
  clearCompleted: () => client.delete<ExportTask[]>('/api/print/export-tasks/completed'),
}
