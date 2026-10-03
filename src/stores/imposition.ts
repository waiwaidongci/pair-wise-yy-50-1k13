import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import type { ConflictCopy, Page, Position, Proof, Spec, Validation, VersionEntry } from '../types'
import { baselineApi } from '../api/baselineApi'
import { exportApi } from '../api/exportApi'
import * as server from '../api/server'
import { defaultSpec, seedPages, seedPositions, seedProofs } from '../api/seed'

export type { Page, Position, Proof, Validation, Spec, ConflictCopy, VersionEntry, ExportTask, ExportShard, ServerBaseline } from '../types'

const DRAFT_KEY = 'print-draft-v1'
const LEGACY_KEY = 'print-imposition-v1'

function deepEqual(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b)
}

export const useImpositionStore = defineStore('imposition', () => {
  // ---- 窗口草稿（sessionStorage，每标签页独立，两窗口互不盖草稿）----
  const pages = ref<Page[]>(structuredClone(seedPages))
  const positions = ref<Position[]>(structuredClone(seedPositions))
  const spec = ref<Spec>({ ...defaultSpec })
  const baseRevision = ref(0)
  const side = ref<'front' | 'back'>('front')
  const zoom = ref(72)

  // ---- 服务端权威基线快照 ----
  const baselinePositions = ref<Position[]>(structuredClone(seedPositions))
  const baselinePages = ref<Page[]>(structuredClone(seedPages))
  const baselineSpec = ref<Spec>({ ...defaultSpec })
  const serverRevision = ref(0)

  // ---- 版本历史与冲突副本（服务端共享）----
  const versions = ref<VersionEntry[]>([])
  const conflicts = ref<ConflictCopy[]>([])

  // ---- 打样记录（共享 localStorage）----
  const proofs = ref<Proof[]>(structuredClone(seedProofs))

  // ---- 导出任务（服务端共享，按任务号续传）----
  const tasks = ref(server.listTasks())

  // ---- UI 状态 ----
  const selectedPosition = ref<string | null>(null)
  const selectedProof = ref('PRF-02')
  const preflightStale = ref(true)
  const lastPreflightAt = ref('')
  const saving = ref(false)
  const resumingTaskId = ref<string | null>(null)
  const message = ref<{ type: 'success' | 'conflict' | 'info' | 'error'; text: string } | null>(null)

  /** 草稿是否与权威基线一致 */
  const isDirty = computed(() => !deepEqual(
    { positions: positions.value, pages: pages.value, spec: spec.value },
    { positions: baselinePositions.value, pages: baselinePages.value, spec: baselineSpec.value },
  ))

  /** 审批基线是否处于锁定（与服务端同步且无未提交改动） */
  const locked = computed(() => baseRevision.value > 0 && !isDirty.value && baseRevision.value === serverRevision.value)

  /**
   * 基线状态机：
   * - none：尚未提交过基线
   * - locked：基线已锁定且与服务端同步
   * - invalid：版位/出血/折手已改，锁定基线失效，需重新预检
   * - stale：协作窗口已提交更新版本，当前草稿过期
   */
  const baselineState = computed<'none' | 'locked' | 'invalid' | 'stale'>(() => {
    if (serverRevision.value === 0 || baseRevision.value === 0) return 'none'
    if (baseRevision.value < serverRevision.value) return 'stale'
    if (isDirty.value) return 'invalid'
    return 'locked'
  })

  const revisionLabel = computed(() => (serverRevision.value > 0 ? `R${serverRevision.value}` : '未提交'))

  const validations = computed<Validation[]>(() => {
    const issues: Validation[] = []
    const placedPages = positions.value.map((position) => position.pageNo)
    pages.value.forEach((page) => {
      if (!placedPages.includes(page.pageNo)) {
        issues.push({ id: `missing-${page.pageNo}`, severity: '错误', pageNo: page.pageNo, title: `P${page.pageNo} 尚未拼版`, detail: `${page.name} 未出现在正反版位中。` })
      }
      if (page.bleed < spec.value.bleed) {
        issues.push({ id: `bleed-${page.pageNo}`, severity: '错误', pageNo: page.pageNo, title: `P${page.pageNo} 出血不足`, detail: `页面出血 ${page.bleed}mm，低于基准 ${spec.value.bleed}mm。` })
      }
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
    if (spec.value.binding === '骑马订') {
      const frontOrder = positions.value.filter((item) => item.front).sort((a, b) => a.x - b.x || a.y - b.y).map((item) => item.pageNo)
      if (frontOrder[0] !== 1) {
        issues.push({ id: 'binding-order', severity: '警告', pageNo: 1, title: '骑马订正版页序需要复核', detail: `当前首位为 P${frontOrder[0]}，折手方向规则期望封面位于首版位。` })
      }
    }
    return issues
  })

  function applyBaseline(b: { revision: number; positions: Position[]; pages: Page[]; spec: Spec }) {
    baselinePositions.value = structuredClone(b.positions)
    baselinePages.value = structuredClone(b.pages)
    baselineSpec.value = structuredClone(b.spec)
    serverRevision.value = b.revision
  }

  /** 旧本地草稿无版本依据时升级为首版 */
  function upgradeLegacyDraft() {
    const legacyRaw = localStorage.getItem(LEGACY_KEY)
    if (!legacyRaw || serverRevision.value !== 0) return
    try {
      const legacy = JSON.parse(legacyRaw)
      pages.value = legacy.pages ?? structuredClone(seedPages)
      positions.value = legacy.positions ?? structuredClone(seedPositions)
      spec.value = { ...defaultSpec }
      const result = server.upgradeToFirstVersion({ positions: positions.value, pages: pages.value, spec: spec.value, note: '旧本地草稿升级为首版' })
      baseRevision.value = result.revision
      applyBaseline(result.baseline)
      versions.value = server.listVersions()
      message.value = { type: 'success', text: '检测到旧版本地草稿且无版本依据，已升级为首版 R1；旧版本保留在版本历史中可查。' }
    } catch {
      /* 忽略损坏的旧草稿 */
    }
  }

  function init() {
    applyBaseline(server.getBaseline())
    versions.value = server.listVersions()
    conflicts.value = server.listConflicts()

    const draftRaw = sessionStorage.getItem(DRAFT_KEY)
    if (draftRaw) {
      try {
        const d = JSON.parse(draftRaw)
        pages.value = d.pages ?? structuredClone(seedPages)
        positions.value = d.positions ?? structuredClone(seedPositions)
        spec.value = d.spec ? { ...d.spec } : { ...defaultSpec }
        baseRevision.value = d.baseRevision ?? 0
        side.value = d.side ?? 'front'
        zoom.value = d.zoom ?? 72
      } catch {
        /* 草稿损坏则回退到种子 */
      }
    } else {
      upgradeLegacyDraft()
      if (baseRevision.value === 0) {
        pages.value = structuredClone(seedPages)
        positions.value = structuredClone(seedPositions)
        spec.value = { ...defaultSpec }
      }
    }

    // 打样记录沿用旧本地存储
    const legacyRaw = localStorage.getItem(LEGACY_KEY)
    if (legacyRaw) {
      try {
        const legacy = JSON.parse(legacyRaw)
        if (legacy.proofs) proofs.value = legacy.proofs
      } catch {
        /* 忽略 */
      }
    }
    preflightStale.value = !locked.value
  }

  // 草稿持久化到本窗口 sessionStorage
  watch([positions, pages, spec, baseRevision, side, zoom], () => {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({
      positions: positions.value,
      pages: pages.value,
      spec: spec.value,
      baseRevision: baseRevision.value,
      side: side.value,
      zoom: zoom.value,
    }))
  }, { deep: true })

  // 打样记录持久化到共享 localStorage
  watch(proofs, () => {
    let legacy: Record<string, unknown> = {}
    try { legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) ?? '{}') } catch { /* ignore */ }
    localStorage.setItem(LEGACY_KEY, JSON.stringify({ ...legacy, proofs: proofs.value }))
  }, { deep: true })

  /** 版位 / 出血 / 折手方向一改，锁定基线立即失效并标记重新预检 */
  function invalidateBaseline() {
    preflightStale.value = true
  }

  function updatePosition(id: string, patch: Partial<Position>) {
    const position = positions.value.find((item) => item.id === id)
    if (position) {
      Object.assign(position, patch)
      invalidateBaseline()
    }
  }

  function addPosition(pageNo: number) {
    if (positions.value.some((item) => item.pageNo === pageNo && item.front === (side.value === 'front'))) return
    positions.value.push({ id: `P-${Date.now().toString().slice(-3)}`, pageNo, x: 34, y: 44, rotation: 0, front: side.value === 'front' })
    invalidateBaseline()
  }

  function updatePageBleed(pageNo: number, bleed: number) {
    const page = pages.value.find((item) => item.pageNo === pageNo)
    if (page) {
      page.bleed = bleed
      invalidateBaseline()
    }
  }

  function updateSpec(patch: Partial<Spec>) {
    Object.assign(spec.value, patch)
    invalidateBaseline()
  }

  function updateProof(id: string, patch: Partial<Proof>) {
    const proof = proofs.value.find((item) => item.id === id)
    if (proof) Object.assign(proof, patch)
  }

  function createProof() {
    proofs.value.push({ id: `PRF-${String(proofs.value.length + 1).padStart(2, '0')}`, round: proofs.value.length + 1, date: new Date().toISOString().slice(0, 10), sample: `数字样张 v${proofs.value.length + 1}`, deltaE: 0, feedback: '', correction: '', owner: '当前用户', decision: '待决定' })
  }

  /** 重新预检：对当前草稿重跑全部检查 */
  async function runPreflight() {
    preflightStale.value = true
    await new Promise((resolve) => setTimeout(resolve, 480))
    preflightStale.value = false
    lastPreflightAt.value = new Date().toTimeString().slice(0, 5)
    const errors = validations.value.filter((item) => item.severity === '错误').length
    const warnings = validations.value.filter((item) => item.severity === '警告').length
    message.value = { type: 'info', text: `预检完成：${errors} 个阻断错误、${warnings} 个警告。${errors ? '请先处理错误再提交基线。' : '可以提交基线并锁定。'}` }
  }

  /**
   * 提交基线并锁定（乐观并发）：
   * - baseRevision 与服务端一致 → 提交成功，基线推进并锁定
   * - 协作窗口已先提交 → 本窗口改动存为冲突副本，不盖掉对方
   */
  async function commitBaseline(note = '保存拼版基线并锁定') {
    if (saving.value) return
    saving.value = true
    message.value = null
    try {
      const res = await baselineApi.commit({
        baseRevision: baseRevision.value,
        positions: structuredClone(positions.value),
        pages: structuredClone(pages.value),
        spec: structuredClone(spec.value),
        note,
      })
      if (res.data.ok) {
        baseRevision.value = res.data.revision
        applyBaseline(res.data.baseline)
        preflightStale.value = false
        versions.value = (await baselineApi.versions()).data
        message.value = { type: 'success', text: `基线已提交为 R${res.data.revision}，审批基线已锁定。` }
      } else {
        conflicts.value = (await baselineApi.conflicts()).data
        serverRevision.value = res.data.currentRevision
        message.value = { type: 'conflict', text: `协作窗口已先保存 R${res.data.currentRevision}，先到改动成为新基线；你的改动保留为冲突副本 ${res.data.conflict.id}，未覆盖对方。` }
      }
    } finally {
      saving.value = false
    }
  }

  /** 采用协作窗口的最新基线 */
  async function rebaseToServer() {
    const b = (await baselineApi.get()).data
    pages.value = structuredClone(b.pages)
    positions.value = structuredClone(b.positions)
    spec.value = structuredClone(b.spec)
    baseRevision.value = b.revision
    applyBaseline(b)
    preflightStale.value = false
    message.value = { type: 'success', text: `已采用协作窗口的最新基线 R${b.revision}。` }
  }

  /** 把冲突副本载入当前草稿（不覆盖服务端基线），可在预检后作为新版本提交 */
  function adoptConflict(conflict: ConflictCopy) {
    pages.value = structuredClone(conflict.pages)
    positions.value = structuredClone(conflict.positions)
    spec.value = structuredClone(conflict.spec)
    invalidateBaseline()
    message.value = { type: 'info', text: `已将冲突副本 ${conflict.id} 载入草稿，重新预检后可提交为新版本。` }
  }

  /** 演示：模拟另一窗口抢先保存 */
  async function simulateCollaborator() {
    const res = await baselineApi.simulateCollaborator()
    serverRevision.value = res.data.revision
    baselinePositions.value = structuredClone(res.data.baseline.positions)
    baselinePages.value = structuredClone(res.data.baseline.pages)
    baselineSpec.value = structuredClone(res.data.baseline.spec)
    versions.value = (await baselineApi.versions()).data
    message.value = { type: 'info', text: `协作窗口已抢先保存 R${res.data.revision}，你的草稿基于 R${baseRevision.value}。` }
  }

  // 跨标签页同步服务端基线 / 冲突 / 版本 / 导出任务
  function onStorage(event: StorageEvent) {
    if (event.key === 'print-server-baseline-v1') {
      baselineApi.get().then(({ data: b }) => {
        serverRevision.value = b.revision
        baselinePositions.value = structuredClone(b.positions)
        baselinePages.value = structuredClone(b.pages)
        baselineSpec.value = structuredClone(b.spec)
        if (b.revision > baseRevision.value) {
          message.value = { type: 'info', text: `协作窗口已提交 R${b.revision}，你的草稿基于 R${baseRevision.value}。可重新载入或保存为冲突副本。` }
        }
      })
    } else if (event.key === 'print-server-conflicts-v1') {
      baselineApi.conflicts().then(({ data }) => (conflicts.value = data))
    } else if (event.key === 'print-server-versions-v1') {
      baselineApi.versions().then(({ data }) => (versions.value = data))
    } else if (event.key === 'print-server-tasks-v1') {
      exportApi.list().then(({ data }) => (tasks.value = data))
    }
  }
  window.addEventListener('storage', onStorage)

  // ---- 导出任务 ----
  let exportTimer: ReturnType<typeof setInterval> | null = null

  function specKey() {
    return `${spec.value.binding}|${spec.value.foldDirection}|${spec.value.grain}|${spec.value.bleed}|R${baseRevision.value}`
  }

  async function refreshTasks() {
    tasks.value = (await exportApi.list()).data
  }

  function startExportLoop() {
    if (exportTimer) return
    exportTimer = setInterval(async () => {
      const active = tasks.value.filter((task) => task.status === '生成中')
      if (!active.length) {
        if (exportTimer) {
          clearInterval(exportTimer)
          exportTimer = null
        }
        return
      }
      for (const task of active) {
        const res = await exportApi.tick(task.id)
        if (res.data.task) {
          const index = tasks.value.findIndex((item) => item.id === task.id)
          if (index >= 0) tasks.value[index] = res.data.task
        }
      }
    }, 900)
  }

  /** 发起导出；同规格存在未完成任务时沿用原任务号，不重复创建 */
  async function createExportTask(name: string) {
    const res = await exportApi.create(name, specKey())
    await refreshTasks()
    if (res.data.reused) {
      message.value = { type: 'info', text: `已沿用未完成任务 ${res.data.task.id}，未重复创建。` }
    } else {
      message.value = { type: 'success', text: `已发起导出任务 ${res.data.task.id}，开始按分片生成。` }
    }
    startExportLoop()
  }

  /** 导出失败后按任务号恢复未完成分片，从断点继续而非重跑 */
  async function resumeTask(id: string) {
    resumingTaskId.value = id
    try {
      const res = await exportApi.resume(id)
      await refreshTasks()
      if (res.data.resumed) {
        message.value = { type: 'success', text: `任务 ${id} 已按任务号恢复，从未完成分片继续生成。` }
      }
      startExportLoop()
    } finally {
      resumingTaskId.value = null
    }
  }

  init()

  return {
    // 草稿
    pages, positions, spec, side, zoom, baseRevision,
    // 服务端基线
    baselinePositions, baselinePages, baselineSpec, serverRevision,
    // 历史 / 冲突
    versions, conflicts,
    // 打样 / 导出
    proofs, tasks,
    // UI
    selectedPosition, selectedProof, preflightStale, lastPreflightAt, saving, resumingTaskId, message,
    // 计算
    validations, locked, isDirty, baselineState, revisionLabel,
    // 版位 / 规格
    updatePosition, addPosition, updatePageBleed, updateSpec,
    // 打样
    updateProof, createProof,
    // 预检 / 基线
    runPreflight, commitBaseline, rebaseToServer, adoptConflict, simulateCollaborator,
    // 导出
    refreshTasks, createExportTask, resumeTask,
  }
})
