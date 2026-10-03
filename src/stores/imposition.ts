import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { exportApi } from '../api/exportApi'

export type Page = { pageNo: number; name: string; width: number; height: number; bleed: number; content: string }
export type Position = { id: string; pageNo: number; x: number; y: number; rotation: number; front: boolean }
export type Validation = { id: string; severity: '错误' | '警告'; pageNo?: number; title: string; detail: string }
export type Proof = { id: string; round: number; date: string; sample: string; deltaE: number; feedback: string; correction: string; owner: string; decision: '待决定' | '通过' | '退回' }
export type SheetSpec = { width: number; height: number; bleed: number; safe: number; gutter: number; binding: string; grain: string; folding: string }
export type Baseline = {
  status: '未锁定' | '有效' | '已失效'
  version?: number
  revision?: string
  lockedAt?: string
  lockedBy?: string
  invalidatedAt?: string
  reason?: string
}
export type PreflightRun = { id: string; at: string; version: number; revision: string; trigger: '手动' | '变更重检' | '锁定前' | '导出前'; errors: number; warnings: number; result: '通过' | '未通过' }
export type VersionRecord = { version: number; revision: string; at: string; kind: '首版' | '草稿' | '基线'; note: string; snapshot: { positions: Position[]; pages: Page[]; spec: SheetSpec } }
export type ConflictCopy = { id: string; at: string; windowId: string; baseVersion: number; againstVersion: number; description: string; snapshot: { positions: Position[]; pages: Page[]; spec: SheetSpec }; status: '待处理' | '已采用' | '已放弃' }
export type ExportFragmentState = { total: number; completed: number[] }
export type ExportTask = {
  id: string
  name: string
  progress: number
  status: '排队中' | '生成中' | '已完成' | '已中断'
  updatedAt: string
  resumable: boolean
  revision: string
  baselineVersion: number
  idempotencyKey: string
  fragments: ExportFragmentState
}

export const defaultSpec: SheetSpec = { width: 720, height: 1020, bleed: 3, safe: 5, gutter: 6, binding: '骑马订', grain: '纵向', folding: '左起折手' }
export const foldingOptions = ['左起折手', '右起折手']

const seedPages: Page[] = [
  { pageNo: 1, name: '封面', width: 210, height: 297, bleed: 3, content: '潮汐来信 / 节目册' },
  { pageNo: 2, name: '版权页', width: 210, height: 297, bleed: 2, content: '版权与演职人员' },
  { pageNo: 3, name: '序言', width: 210, height: 297, bleed: 3, content: '导演手记' },
  { pageNo: 4, name: '剧照跨页左', width: 210, height: 297, bleed: 3, content: '第一幕剧照' },
  { pageNo: 5, name: '剧照跨页右', width: 210, height: 297, bleed: 3, content: '第一幕剧照延伸' },
  { pageNo: 6, name: '曲目表', width: 210, height: 297, bleed: 3, content: '曲目与时长' },
  { pageNo: 7, name: '创作团队', width: 210, height: 297, bleed: 1, content: '主创与制作团队' },
  { pageNo: 8, name: '封底', width: 210, height: 297, bleed: 3, content: '巡演信息' },
]

const seedPositions: Position[] = [
  { id: 'P-01', pageNo: 8, x: 34, y: 44, rotation: 0, front: true },
  { id: 'P-02', pageNo: 1, x: 372, y: 44, rotation: 180, front: true },
  { id: 'P-03', pageNo: 6, x: 34, y: 548, rotation: 180, front: true },
  { id: 'P-04', pageNo: 3, x: 372, y: 548, rotation: 0, front: true },
  { id: 'P-05', pageNo: 2, x: 34, y: 44, rotation: 0, front: false },
  { id: 'P-06', pageNo: 7, x: 372, y: 44, rotation: 180, front: false },
  { id: 'P-07', pageNo: 4, x: 34, y: 548, rotation: 0, front: false },
  { id: 'P-08', pageNo: 5, x: 372, y: 548, rotation: 180, front: false },
]

const seedProofs: Proof[] = [
  { id: 'PRF-01', round: 1, date: '2026-09-18', sample: '数字样张 v1', deltaE: 3.8, feedback: '封面夜空蓝偏紫，剧照暗部层次压缩。', correction: '调整 CMYK 曲线，黑色通道减少 4%。', owner: '周默 / 色彩管理', decision: '退回' },
  { id: 'PRF-02', round: 2, date: '2026-09-25', sample: '数字样张 v2', deltaE: 1.9, feedback: '整体色差改善，P7 出血仍不足。', correction: '重排 P7 版位并增加 2mm 出血。', owner: '林青 / 拼版', decision: '待决定' },
]

const DOC_KEY = 'print-imposition-v2'
const LEGACY_KEY = 'print-imposition-v1'

type DocData = {
  pages: Page[]
  positions: Position[]
  proofs: Proof[]
  spec: SheetSpec
  baseline: Baseline
  preflightRuns: PreflightRun[]
  versions: VersionRecord[]
  conflicts: ConflictCopy[]
}
type DocEnvelope = { version: number; writerId: string; savedAt: string; data: DocData }

function now() {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readEnvelope(): DocEnvelope | null {
  try {
    const raw = localStorage.getItem(DOC_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as DocEnvelope
    return typeof parsed?.version === 'number' && parsed.data ? parsed : null
  } catch {
    return null
  }
}

function writeEnvelope(envelope: DocEnvelope) {
  localStorage.setItem(DOC_KEY, JSON.stringify(envelope))
}

function snapshotOf(source: { positions: Position[]; pages: Page[]; spec: SheetSpec }) {
  return { positions: clone(source.positions), pages: clone(source.pages), spec: clone(source.spec) }
}

function seedEnvelope(writerId: string): DocEnvelope {
  const data: DocData = {
    pages: clone(seedPages),
    positions: clone(seedPositions),
    proofs: clone(seedProofs),
    spec: clone(defaultSpec),
    baseline: { status: '未锁定' },
    preflightRuns: [],
    versions: [],
    conflicts: [],
  }
  data.versions = [{ version: 1, revision: 'V1', at: now(), kind: '首版', note: '初始版本', snapshot: snapshotOf(data) }]
  return { version: 1, writerId, savedAt: now(), data }
}

// 旧本地草稿（无版本号、无版本历史）升级为首版 V1，旧数据原样保留在 LEGACY_KEY 中可查
function migrateLegacyDraft(legacy: Record<string, unknown>, writerId: string): DocEnvelope {
  const data: DocData = {
    pages: Array.isArray(legacy.pages) ? (legacy.pages as Page[]) : clone(seedPages),
    positions: Array.isArray(legacy.positions) ? (legacy.positions as Position[]) : clone(seedPositions),
    proofs: Array.isArray(legacy.proofs) ? (legacy.proofs as Proof[]) : clone(seedProofs),
    spec: { ...clone(defaultSpec) },
    baseline: legacy.locked
      ? { status: '有效', version: 1, revision: 'V1', lockedAt: now(), lockedBy: '旧本地草稿' }
      : { status: '未锁定' },
    preflightRuns: [],
    versions: [],
    conflicts: [],
  }
  const oldRevision = typeof legacy.revision === 'string' ? legacy.revision : '无版本号'
  data.versions = [{ version: 1, revision: 'V1', at: now(), kind: '首版', note: `旧本地草稿无版本依据，升级为首版（原草稿标识 ${oldRevision}）`, snapshot: snapshotOf(data) }]
  return { version: 1, writerId, savedAt: now(), data }
}

export const useImpositionStore = defineStore('imposition', () => {
  const windowId = `W-${Math.random().toString(36).slice(2, 8).toUpperCase()}`
  const migrationNotice = ref<string | null>(null)

  let initial = readEnvelope()
  if (!initial) {
    const legacyRaw = localStorage.getItem(LEGACY_KEY)
    if (legacyRaw) {
      try {
        initial = migrateLegacyDraft(JSON.parse(legacyRaw) as Record<string, unknown>, windowId)
        migrationNotice.value = '旧本地草稿没有版本依据，已升级为首版 V1；旧草稿仍保留在本地存储中可查。'
      } catch {
        initial = seedEnvelope(windowId)
      }
    } else {
      initial = seedEnvelope(windowId)
    }
    writeEnvelope(initial)
  }

  const pages = ref<Page[]>(initial.data.pages)
  const positions = ref<Position[]>(initial.data.positions)
  const proofs = ref<Proof[]>(initial.data.proofs)
  const spec = ref<SheetSpec>(initial.data.spec)
  const baseline = ref<Baseline>(initial.data.baseline)
  const preflightRuns = ref<PreflightRun[]>(initial.data.preflightRuns)
  const versions = ref<VersionRecord[]>(initial.data.versions)
  const conflicts = ref<ConflictCopy[]>(initial.data.conflicts)
  const tasks = ref<ExportTask[]>([])
  const baseVersion = ref(initial.version)
  const lastWrittenVersion = ref(0)
  const dirty = ref(false)
  const side = ref<'front' | 'back'>('front')
  const zoom = ref(72)
  const selectedPosition = ref<string | null>(null)
  const selectedProof = ref(initial.data.proofs.at(-1)?.id ?? '')

  const locked = computed(() => baseline.value.status === '有效')
  const revision = computed(() => `V${baseVersion.value}`)
  const pendingConflicts = computed(() => conflicts.value.filter((item) => item.status === '待处理'))
  const blockingErrors = computed(() => validations.value.filter((item) => item.severity === '错误').length)
  const canExport = computed(() => locked.value && blockingErrors.value === 0)

  const validations = computed<Validation[]>(() => {
    const issues: Validation[] = []
    const placedPages = positions.value.map((position) => position.pageNo)
    pages.value.forEach((page) => {
      if (!placedPages.includes(page.pageNo)) issues.push({ id: `missing-${page.pageNo}`, severity: '错误', pageNo: page.pageNo, title: `P${page.pageNo} 尚未拼版`, detail: `${page.name} 未出现在正反版位中。` })
      if (page.bleed < spec.value.bleed) issues.push({ id: `bleed-${page.pageNo}`, severity: '错误', pageNo: page.pageNo, title: `P${page.pageNo} 出血不足`, detail: `页面出血 ${page.bleed}mm，低于印刷要求 ${spec.value.bleed}mm。` })
    })
    for (let index = 0; index < positions.value.length; index += 1) {
      for (let next = index + 1; next < positions.value.length; next += 1) {
        const a = positions.value[index]
        const b = positions.value[next]
        if (a.front === b.front && Math.abs(a.x - b.x) < 320 && Math.abs(a.y - b.y) < 430) {
          issues.push({ id: `overlap-${a.id}-${b.id}`, severity: '错误', pageNo: a.pageNo, title: `${a.id} 与 ${b.id} 版位重叠`, detail: '当前纸张尺寸下页面之间不足安全间隙。' })
        }
      }
    }
    const frontOrder = positions.value.filter((item) => item.front).sort((a, b) => a.x - b.x || a.y - b.y).map((item) => item.pageNo)
    if (spec.value.folding === '右起折手') {
      if (frontOrder.at(-1) !== 1) issues.push({ id: 'folding-order', severity: '警告', pageNo: 1, title: '右起折手页序需要复核', detail: `右起折手期望封面 P1 位于最右版位，当前最右为 P${frontOrder.at(-1)}。` })
    } else if (frontOrder[0] !== 1) {
      issues.push({ id: 'binding-order', severity: '警告', pageNo: 1, title: '骑马订正版页序需要复核', detail: `当前首位为 P${frontOrder[0]}，装订方向规则期望封面位于首版位。` })
    }
    return issues
  })

  function snapshotData(): DocData {
    return clone({ pages: pages.value, positions: positions.value, proofs: proofs.value, spec: spec.value, baseline: baseline.value, preflightRuns: preflightRuns.value, versions: versions.value, conflicts: conflicts.value })
  }

  function adopt(data: DocData, version: number) {
    pages.value = data.pages
    positions.value = data.positions
    proofs.value = data.proofs
    spec.value = data.spec
    baseline.value = data.baseline
    preflightRuns.value = data.preflightRuns
    versions.value = data.versions
    conflicts.value = data.conflicts
    baseVersion.value = version
    dirty.value = false
  }

  function makeConflict(description: string, againstVersion: number): ConflictCopy {
    return {
      id: `CF-${Date.now().toString(36).toUpperCase()}${windowId.slice(-2)}`,
      at: now(),
      windowId,
      baseVersion: baseVersion.value,
      againstVersion,
      description,
      snapshot: { positions: clone(positions.value), pages: clone(pages.value), spec: clone(spec.value) },
      status: '待处理',
    }
  }

  // 后到改动不覆盖先到基线：把本地状态留作冲突副本追加到对方数据上，再采纳对方版本
  function preserveConflictAndAdopt(stored: DocEnvelope, description: string): ConflictCopy {
    const conflict = makeConflict(description, stored.version)
    const merged: DocEnvelope = { version: stored.version + 1, writerId: windowId, savedAt: now(), data: { ...stored.data, conflicts: [...stored.data.conflicts, conflict] } }
    writeEnvelope(merged)
    lastWrittenVersion.value = merged.version
    adopt(merged.data, merged.version)
    return conflict
  }

  function commit(description: string, kind: VersionRecord['kind'] = '草稿'): { ok: boolean; conflict?: ConflictCopy } {
    const stored = readEnvelope()
    if (stored && stored.version > baseVersion.value) {
      return { ok: false, conflict: preserveConflictAndAdopt(stored, description) }
    }
    const nextVersion = (stored?.version ?? baseVersion.value) + 1
    versions.value = [...versions.value, { version: nextVersion, revision: `V${nextVersion}`, at: now(), kind, note: description, snapshot: snapshotOf({ positions: positions.value, pages: pages.value, spec: spec.value }) }].slice(-30)
    writeEnvelope({ version: nextVersion, writerId: windowId, savedAt: now(), data: snapshotData() })
    lastWrittenVersion.value = nextVersion
    baseVersion.value = nextVersion
    dirty.value = false
    return { ok: true }
  }

  function onStorage(event: StorageEvent) {
    if (event.key !== DOC_KEY || !event.newValue) return
    let incoming: DocEnvelope
    try {
      incoming = JSON.parse(event.newValue) as DocEnvelope
    } catch {
      return
    }
    if (!incoming || incoming.writerId === windowId || typeof incoming.version !== 'number') return
    if (incoming.version < baseVersion.value) return
    if (incoming.version === baseVersion.value) {
      if (lastWrittenVersion.value === incoming.version) {
        // 同号异源：本窗口刚写入的版本被另一窗口的同号写入覆盖。
        // 本地改动留作冲突副本，随机退避后再合并写回，避免两个窗口互相触发写回而乒乓。
        const conflict = makeConflict('本窗口提交与另一窗口同时到达，先到改动已成为新基线', incoming.version)
        adopt({ ...incoming.data, conflicts: [...incoming.data.conflicts, conflict] }, incoming.version)
        lastWrittenVersion.value = 0
        setTimeout(() => {
          const stored = readEnvelope()
          if (!stored || stored.data.conflicts.some((item) => item.id === conflict.id)) return
          writeEnvelope({ version: stored.version + 1, writerId: windowId, savedAt: now(), data: { ...stored.data, conflicts: [...stored.data.conflicts, conflict] } })
        }, 60 + Math.random() * 120)
        return
      }
      // 其他窗口之间的同号竞态：直接采纳（本地有未保存改动则留冲突副本）
      if (dirty.value) preserveConflictAndAdopt(incoming, '另一窗口先保存，本地未保存改动')
      else adopt(incoming.data, incoming.version)
      return
    }
    if (dirty.value) {
      preserveConflictAndAdopt(incoming, '另一窗口先保存，本地未保存改动')
      return
    }
    adopt(incoming.data, incoming.version)
  }
  window.addEventListener('storage', onStorage)

  function runPreflight(trigger: PreflightRun['trigger']) {
    const errors = blockingErrors.value
    const warnings = validations.value.length - errors
    const run: PreflightRun = { id: `PF-${Date.now().toString(36).toUpperCase()}`, at: now(), version: baseVersion.value, revision: revision.value, trigger, errors, warnings, result: errors === 0 ? '通过' : '未通过' }
    preflightRuns.value = [run, ...preflightRuns.value].slice(0, 20)
    return run
  }

  // 版位、出血或折手方向变更 → 已锁定的审批基线立即失效并重新预检
  function invalidateBaseline(reason: string) {
    if (baseline.value.status !== '有效') return
    baseline.value = { ...baseline.value, status: '已失效', reason, invalidatedAt: now() }
    runPreflight('变更重检')
  }

  function updatePosition(id: string, patch: Partial<Position>) {
    const position = positions.value.find((item) => item.id === id)
    if (!position) return
    Object.assign(position, patch)
    dirty.value = true
    invalidateBaseline(`版位 ${id} 被修改`)
  }

  function addPosition(pageNo: number) {
    if (positions.value.some((item) => item.pageNo === pageNo && item.front === (side.value === 'front'))) return
    positions.value.push({ id: `P-${Date.now().toString().slice(-3)}`, pageNo, x: 34, y: 44, rotation: 0, front: side.value === 'front' })
    dirty.value = true
    invalidateBaseline(`新增版位 P${pageNo}`)
  }

  function removePosition(id: string) {
    const index = positions.value.findIndex((item) => item.id === id)
    if (index === -1) return
    positions.value.splice(index, 1)
    dirty.value = true
    invalidateBaseline(`移除版位 ${id}`)
  }

  function updatePageBleed(pageNo: number, bleed: number) {
    const page = pages.value.find((item) => item.pageNo === pageNo)
    if (!page || page.bleed === bleed) return
    page.bleed = bleed
    dirty.value = true
    invalidateBaseline(`P${pageNo} 出血调整为 ${bleed}mm`)
  }

  function updateSpec(patch: Partial<SheetSpec>) {
    Object.assign(spec.value, patch)
    dirty.value = true
    invalidateBaseline('纸张规格或折手方向变更')
  }

  function updateProof(id: string, patch: Partial<Proof>) {
    const proof = proofs.value.find((item) => item.id === id)
    if (!proof) return
    Object.assign(proof, patch)
    dirty.value = true
  }

  function createProof() {
    proofs.value.push({ id: `PRF-${String(proofs.value.length + 1).padStart(2, '0')}`, round: proofs.value.length + 1, date: new Date().toISOString().slice(0, 10), sample: `数字样张 v${proofs.value.length + 1}`, deltaE: 0, feedback: '', correction: '', owner: '当前用户', decision: '待决定' })
    dirty.value = true
  }

  function lockBaseline(): { ok: boolean; reason?: string } {
    const run = runPreflight('锁定前')
    if (run.errors > 0) return { ok: false, reason: `存在 ${run.errors} 个阻断错误，无法锁定基线` }
    baseline.value = { status: '有效', version: baseVersion.value + 1, revision: `V${baseVersion.value + 1}`, lockedAt: now(), lockedBy: windowId }
    const result = commit('审批锁定基线', '基线')
    return result.ok ? { ok: true } : { ok: false, reason: `另一窗口已先保存为 V${result.conflict?.againstVersion}，本次锁定改动已保留为冲突副本 ${result.conflict?.id}` }
  }

  function releaseBaseline() {
    invalidateBaseline('手动解除锁定')
  }

  function applyConflict(id: string) {
    const conflict = conflicts.value.find((item) => item.id === id)
    if (!conflict || conflict.status !== '待处理') return
    positions.value = clone(conflict.snapshot.positions)
    pages.value = clone(conflict.snapshot.pages)
    spec.value = clone(conflict.snapshot.spec)
    dirty.value = true
    invalidateBaseline(`采用冲突副本 ${conflict.id}`)
    conflict.status = '已采用'
    commit(`采用冲突副本 ${conflict.id}`)
  }

  function discardConflict(id: string) {
    const conflict = conflicts.value.find((item) => item.id === id)
    if (!conflict || conflict.status !== '待处理') return
    conflict.status = '已放弃'
    commit(`放弃冲突副本 ${id}`)
  }

  function isTaskStale(task: ExportTask) {
    return !locked.value || task.baselineVersion !== baseline.value.version
  }

  function syncTasks(list: ExportTask[]) {
    tasks.value = clone(list)
  }

  function dismissMigration() {
    migrationNotice.value = null
  }

  exportApi.list().then((response) => syncTasks(response.data)).catch(() => {})

  return {
    pages, positions, proofs, tasks, spec, baseline, preflightRuns, versions, conflicts,
    side, zoom, revision, locked, dirty, baseVersion, selectedPosition, selectedProof,
    validations, blockingErrors, canExport, pendingConflicts, migrationNotice, windowId,
    updatePosition, addPosition, removePosition, updatePageBleed, updateSpec,
    updateProof, createProof, commit, lockBaseline, releaseBaseline, runPreflight,
    applyConflict, discardConflict, isTaskStale, syncTasks, dismissMigration,
  }
})
