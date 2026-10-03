// 服务端权威存储（localStorage 共享，模拟多窗口共调的服务端）
// - 基线：先到先得的乐观并发（OCC），后到改动存为冲突副本
// - 版本历史：每次提交追加一条，旧版本保留可查
// - 导出任务：分片状态持久化，跨窗口一致

import type { BaselineCommit, ConflictCopy, ExportTask, ServerBaseline, VersionEntry } from '../types'
import { defaultSpec, seedPages, seedPositions, seedTasks, TOTAL_SHARDS } from './seed'

const KEYS = {
  baseline: 'print-server-baseline-v1',
  conflicts: 'print-server-conflicts-v1',
  versions: 'print-server-versions-v1',
  tasks: 'print-server-tasks-v1',
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}
function write(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value))
}

const now = () => new Date().toISOString().slice(0, 16).replace('T', ' ')

/** 当前权威基线；服务端尚未提交过任何基线时 revision 为 0 */
export function getBaseline(): ServerBaseline {
  const stored = read<ServerBaseline | null>(KEYS.baseline, null)
  if (stored) return stored
  return { revision: 0, positions: seedPositions, pages: seedPages, spec: { ...defaultSpec }, savedAt: '' }
}

export function listConflicts(): ConflictCopy[] {
  return read<ConflictCopy[]>(KEYS.conflicts, [])
}

export function listVersions(): VersionEntry[] {
  return read<VersionEntry[]>(KEYS.versions, [])
}

function pushVersion(entry: VersionEntry) {
  const versions = listVersions()
  versions.push(entry)
  write(KEYS.versions, versions)
}

/**
 * 乐观并发提交：
 * - baseRevision 与服务端一致 → 提交，基线推进，追加版本历史（先到先得）
 * - 不一致 → 后到的改动原样存入冲突副本，绝不覆盖对方
 */
export function commitBaseline(commit: BaselineCommit): { ok: true; revision: number; baseline: ServerBaseline } | { ok: false; currentRevision: number; conflict: ConflictCopy } {
  const current = getBaseline()
  if (commit.baseRevision !== current.revision) {
    const conflict: ConflictCopy = {
      id: `CONF-${Date.now().toString().slice(-6)}`,
      basedOnRevision: commit.baseRevision,
      savedAt: now(),
      note: commit.note,
      positions: commit.positions,
      pages: commit.pages,
      spec: commit.spec,
    }
    const conflicts = listConflicts()
    conflicts.push(conflict)
    write(KEYS.conflicts, conflicts)
    return { ok: false, currentRevision: current.revision, conflict }
  }
  const revision = current.revision + 1
  const baseline: ServerBaseline = {
    revision,
    positions: commit.positions,
    pages: commit.pages,
    spec: commit.spec,
    savedAt: now(),
  }
  write(KEYS.baseline, baseline)
  pushVersion({
    id: `V-${String(revision).padStart(3, '0')}`,
    revision,
    label: `R${revision}`,
    savedAt: baseline.savedAt,
    note: commit.note,
    source: 'save',
  })
  return { ok: true, revision, baseline }
}

/** 旧本地草稿升级为首版：服务端无基线时，把无版本依据的草稿直接立为 R1 */
export function upgradeToFirstVersion(commit: Omit<BaselineCommit, 'baseRevision'>): { ok: true; revision: number; baseline: ServerBaseline } {
  const current = getBaseline()
  if (current.revision !== 0) {
    // 已有基线，按普通并发提交处理（baseRevision=0 会冲突）
    const result = commitBaseline({ ...commit, baseRevision: 0 })
    if (!result.ok) return { ok: true, revision: current.revision, baseline: current }
    return result
  }
  const revision = 1
  const baseline: ServerBaseline = { revision, positions: commit.positions, pages: commit.pages, spec: commit.spec, savedAt: now() }
  write(KEYS.baseline, baseline)
  pushVersion({ id: 'V-001', revision, label: 'R1（首版）', savedAt: baseline.savedAt, note: '旧本地草稿升级为首版', source: 'upgrade' })
  return { ok: true, revision, baseline }
}

/** 演示用：模拟协作窗口抢先保存，把服务端基线推进一个版本 */
export function simulateCollaboratorCommit(): { revision: number; baseline: ServerBaseline } {
  const current = getBaseline()
  const revision = current.revision + 1
  const baseline: ServerBaseline = { ...current, revision, savedAt: now() }
  write(KEYS.baseline, baseline)
  pushVersion({ id: `V-${String(revision).padStart(3, '0')}`, revision, label: `R${revision}`, savedAt: baseline.savedAt, note: '协作窗口保存', source: 'save' })
  return { revision, baseline }
}

export function listTasks(): ExportTask[] {
  return read<ExportTask[]>(KEYS.tasks, seedTasks)
}

function writeTasks(tasks: ExportTask[]) {
  write(KEYS.tasks, tasks)
}

export function upsertTask(task: ExportTask): ExportTask {
  const tasks = listTasks()
  const index = tasks.findIndex((item) => item.id === task.id)
  if (index >= 0) tasks[index] = task
  else tasks.push(task)
  writeTasks(tasks)
  return task
}

/** 按任务号查找未完成的同规格任务，供重复发起时沿用 */
export function findOpenTask(spec: string): ExportTask | undefined {
  return listTasks().find((task) => task.spec === spec && task.status !== '已完成')
}

/** 完成下一个未完成分片；返回更新后的任务 */
export function tickTask(id: string): ExportTask | undefined {
  const tasks = listTasks()
  const task = tasks.find((item) => item.id === id)
  if (!task || task.status !== '生成中') return task
  const next = Array.from({ length: TOTAL_SHARDS }, (_, index) => index).find((index) => !task.doneShards.includes(index))
  if (next === undefined) {
    task.status = '已完成'
    task.progress = 100
    task.updatedAt = '刚刚'
  } else {
    task.doneShards = [...task.doneShards, next].sort((a, b) => a - b)
    task.progress = Math.round((task.doneShards.length / TOTAL_SHARDS) * 100)
    if (task.doneShards.length >= TOTAL_SHARDS) {
      task.status = '已完成'
      task.progress = 100
    }
    task.updatedAt = '刚刚'
  }
  writeTasks(tasks)
  return task
}
