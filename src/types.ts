// 拼版领域模型：版位 / 页面 / 规格 / 审批基线 / 导出分片任务

export type Page = { pageNo: number; name: string; width: number; height: number; bleed: number; content: string }
export type Position = { id: string; pageNo: number; x: number; y: number; rotation: number; front: boolean }
export type Validation = { id: string; severity: '错误' | '警告'; pageNo?: number; title: string; detail: string }
export type Proof = { id: string; round: number; date: string; sample: string; deltaE: number; feedback: string; correction: string; owner: string; decision: '待决定' | '通过' | '退回' }

/** 拼版规格：装订、折手方向、纸纹、基准出血 */
export type Spec = { binding: string; foldDirection: string; grain: string; bleed: number }

export type ShardStatus = '已完成' | '待生成'
export type ExportShard = { index: number; status: ShardStatus }
export type ExportTaskStatus = '排队中' | '生成中' | '已完成' | '已中断'
export type ExportTask = {
  id: string
  name: string
  /** 规格指纹，用于重复发起时判重沿用 */
  spec: string
  progress: number
  status: ExportTaskStatus
  updatedAt: string
  resumable: boolean
  totalShards: number
  doneShards: number[]
}

/** 服务端权威基线（先到先得，后到存冲突副本） */
export type ServerBaseline = {
  revision: number
  positions: Position[]
  pages: Page[]
  spec: Spec
  savedAt: string
}

/** 冲突副本：后到窗口的改动不会被丢弃，也不会盖掉对方 */
export type ConflictCopy = {
  id: string
  basedOnRevision: number
  savedAt: string
  note: string
  positions: Position[]
  pages: Page[]
  spec: Spec
}

/** 版本历史条目 */
export type VersionEntry = {
  id: string
  revision: number
  label: string
  savedAt: string
  note: string
  source: 'save' | 'lock' | 'upgrade'
}

/** 提交基线时客户端上报的载荷 */
export type BaselineCommit = {
  baseRevision: number
  positions: Position[]
  pages: Page[]
  spec: Spec
  note: string
}

export type BaselineCommitResult =
  | { ok: true; revision: number; baseline: ServerBaseline }
  | { ok: false; currentRevision: number; conflict: ConflictCopy }
