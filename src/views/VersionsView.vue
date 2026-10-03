<script setup lang="ts">
import { computed, ref } from 'vue'
import Button from 'primevue/button'
import Checkbox from 'primevue/checkbox'
import Message from 'primevue/message'
import Tag from 'primevue/tag'
import ImpositionCanvas from '../components/ImpositionCanvas.vue'
import { useImpositionStore, type VersionRecord } from '../stores/imposition'

const store = useImpositionStore()
const accepted = ref<string[]>([])
const notice = ref<{ severity: 'success' | 'error'; text: string } | null>(null)

const baselineRecord = computed(() => store.versions.find((record) => record.version === store.baseline.version && store.baseline.status === '有效'))
const compareVersion = ref<number | null>(null)
const compareBase = computed<VersionRecord | undefined>(() =>
  store.versions.find((record) => record.version === compareVersion.value) ?? baselineRecord.value ?? store.versions.at(-1),
)

type Change = { id: string; title: string; before: string; after: string; risk: '低' | '中' | '高' }

const changes = computed<Change[]>(() => {
  const base = compareBase.value?.snapshot
  if (!base) return []
  const diffs: Change[] = []
  const basePositions = new Map(base.positions.map((position) => [position.id, position]))
  store.positions.forEach((position) => {
    const before = basePositions.get(position.id)
    if (!before) {
      diffs.push({ id: `add-${position.id}`, title: `新增版位 ${position.id}（P${position.pageNo}）`, before: '—', after: `x ${position.x} / y ${position.y} / ${position.rotation}°`, risk: '中' })
      return
    }
    if (before.pageNo !== position.pageNo) diffs.push({ id: `page-${position.id}`, title: `${position.id} 换页 P${before.pageNo} → P${position.pageNo}`, before: `P${before.pageNo}`, after: `P${position.pageNo}`, risk: '高' })
    if (before.x !== position.x || before.y !== position.y) diffs.push({ id: `move-${position.id}`, title: `${position.id} 位置移动`, before: `x ${before.x} / y ${before.y}`, after: `x ${position.x} / y ${position.y}`, risk: '低' })
    if (before.rotation !== position.rotation) diffs.push({ id: `rot-${position.id}`, title: `${position.id} 旋转方向变更`, before: `${before.rotation}°`, after: `${position.rotation}°`, risk: '中' })
    if (before.front !== position.front) diffs.push({ id: `side-${position.id}`, title: `${position.id} 正反面变更`, before: before.front ? '正面' : '反面', after: position.front ? '正面' : '反面', risk: '高' })
  })
  base.positions.forEach((position) => {
    if (!store.positions.some((item) => item.id === position.id)) diffs.push({ id: `del-${position.id}`, title: `移除版位 ${position.id}（P${position.pageNo}）`, before: `x ${position.x} / y ${position.y}`, after: '—', risk: '高' })
  })
  store.pages.forEach((page) => {
    const before = base.pages.find((item) => item.pageNo === page.pageNo)
    if (before && before.bleed !== page.bleed) diffs.push({ id: `bleed-${page.pageNo}`, title: `P${page.pageNo} 出血变更`, before: `bleed ${before.bleed}mm`, after: `bleed ${page.bleed}mm`, risk: page.bleed < store.spec.bleed ? '高' : '低' })
  })
  if (base.spec.folding !== store.spec.folding) diffs.push({ id: 'spec-folding', title: '折手方向变更', before: base.spec.folding, after: store.spec.folding, risk: '高' })
  if (base.spec.bleed !== store.spec.bleed) diffs.push({ id: 'spec-bleed', title: '出血要求变更', before: `${base.spec.bleed}mm`, after: `${store.spec.bleed}mm`, risk: '中' })
  return diffs
})

const canLock = computed(() => changes.value.length === 0 || accepted.value.length === changes.value.length)

function lock() {
  const result = store.lockBaseline()
  notice.value = result.ok
    ? { severity: 'success', text: `已接受变更并锁定基线 ${store.baseline.revision}，可放行导出。` }
    : { severity: 'error', text: result.reason ?? '锁定失败' }
}

function kindSeverity(kind: VersionRecord['kind']) {
  return kind === '基线' ? 'success' : kind === '首版' ? 'info' : 'warn'
}
</script>

<template>
  <section class="page">
    <div class="page-head">
      <div><p class="eyebrow">VERSION COMPARE / 版本对比</p><h1>拼版版本并排审阅</h1><p class="muted">以任一历史版本为基准对比当前草稿，变更逐项接受后锁定为只读生产基线。</p></div>
      <div class="actions"><Button label="导出对比报告" icon="pi pi-file-export" outlined /><Button :label="store.locked ? '已锁定' : '接受变更并锁定'" icon="pi pi-lock" :disabled="store.locked || !canLock" @click="lock" /></div>
    </div>

    <Message v-if="notice" :severity="notice.severity" class="mb-3" @close="notice = null">{{ notice.text }}</Message>

    <div class="compare-grid">
      <section class="panel">
        <div class="panel-head"><h3>基准 {{ compareBase?.revision ?? '—' }}</h3><Tag :value="compareBase?.kind ?? '只读'" :severity="kindSeverity(compareBase?.kind ?? '草稿')" /></div>
        <div class="canvas-box"><ImpositionCanvas :positions="compareBase?.snapshot.positions ?? []" side="front" :zoom="38" :selected="null" :validations="[]" @update="() => {}" @select="() => {}" /></div>
      </section>
      <section class="panel candidate">
        <div class="panel-head"><h3>当前草稿 {{ store.revision }}</h3><Tag :value="`${changes.length} 项变更`" :severity="changes.length ? 'warn' : 'success'" /></div>
        <div class="canvas-box"><ImpositionCanvas :positions="store.positions" side="front" :zoom="38" :selected="null" :validations="store.validations" @update="() => {}" @select="() => {}" /></div>
      </section>
    </div>

    <section class="panel change-panel">
      <div class="panel-head"><h3>版式变更差异</h3><span class="muted">{{ changes.length ? `接受 ${accepted.length}/${changes.length} 项` : '当前草稿与基准一致' }}</span></div>
      <div class="change-list">
        <article v-for="change in changes" :key="change.id">
          <Checkbox v-model="accepted" :inputId="change.id" :value="change.id" />
          <div><strong>{{ change.title }}</strong><div class="diff"><span class="before">{{ change.before }}</span><i class="pi pi-arrow-right" /><span class="after">{{ change.after }}</span></div></div>
          <Tag :value="`${change.risk}风险`" :severity="change.risk === '高' ? 'danger' : change.risk === '中' ? 'warn' : 'success'" />
        </article>
        <div v-if="!changes.length" class="empty">无差异，可直接锁定当前版本。</div>
      </div>
    </section>

    <div class="bottom-grid">
      <section class="panel">
        <div class="panel-head"><h3>版本历史</h3><span class="muted">旧版本保留可查</span></div>
        <div class="record-list">
          <article v-for="record in store.versions.slice().reverse()" :key="record.version" :class="{ current: record.version === compareBase?.version }">
            <div><strong>{{ record.revision }} · {{ record.note }}</strong><small>{{ record.at }} · {{ record.version === store.baseVersion ? '当前版本' : '历史版本' }}</small></div>
            <Tag :value="record.kind" :severity="kindSeverity(record.kind)" />
            <Button label="设为基准" size="small" text :disabled="record.version === compareBase?.version" @click="compareVersion = record.version" />
          </article>
        </div>
      </section>

      <section class="panel">
        <div class="panel-head"><h3>冲突副本</h3><Tag :value="`${store.pendingConflicts.length} 待处理`" :severity="store.pendingConflicts.length ? 'warn' : 'success'" /></div>
        <div class="record-list">
          <article v-for="conflict in store.conflicts.slice().reverse()" :key="conflict.id">
            <div>
              <strong>{{ conflict.id }} · {{ conflict.description }}</strong>
              <small>{{ conflict.at }} · 窗口 {{ conflict.windowId }} · 基于 V{{ conflict.baseVersion }}，对方 V{{ conflict.againstVersion }} 已成为新基线</small>
            </div>
            <Tag :value="conflict.status" :severity="conflict.status === '待处理' ? 'warn' : conflict.status === '已采用' ? 'success' : 'info'" />
            <div v-if="conflict.status === '待处理'" class="conflict-ops">
              <Button label="采用" size="small" @click="store.applyConflict(conflict.id)" />
              <Button label="放弃" size="small" severity="danger" outlined @click="store.discardConflict(conflict.id)" />
            </div>
          </article>
          <div v-if="!store.conflicts.length" class="empty">暂无冲突副本。两个窗口同时保存同一版位时，后到的改动会保留在这里。</div>
        </div>
      </section>
    </div>
  </section>
</template>

<style scoped>
.actions { display: flex; gap: 8px; }
.mb-3 { margin-bottom: 12px; }
.compare-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 14px; }
.candidate { border-color: #5d9693; }
.canvas-box { height: 440px; overflow: auto; padding: 12px; background: #35474d; }
.change-panel { overflow: hidden; margin-bottom: 14px; }
.change-list article { display: grid; grid-template-columns: 28px 1fr auto; gap: 10px; align-items: center; padding: 14px 16px; border-bottom: 1px solid #edf1f1; }
.change-list strong { font-size: 12px; }
.diff { display: flex; align-items: center; gap: 8px; margin-top: 7px; font-family: monospace; font-size: 10px; }
.diff span { padding: 4px 6px; border-radius: 4px; }
.before { color: #9f4c38; background: #fff0ec; }
.after { color: #2d735b; background: #e9f5ef; }
.bottom-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; align-items: start; }
.record-list { max-height: 360px; overflow: auto; padding: 8px; }
.record-list article { display: flex; align-items: center; gap: 10px; padding: 11px 10px; border-radius: 7px; }
.record-list article.current { background: #eef5f4; }
.record-list article > div:first-child { flex: 1; min-width: 0; }
.record-list strong, .record-list small { display: block; }
.record-list strong { font-size: 12px; }
.record-list small { margin-top: 4px; color: #7a878d; font-size: 10px; }
.conflict-ops { display: flex; gap: 6px; }
.empty { padding: 24px; color: #7e8a8f; text-align: center; font-size: 12px; }
@media (max-width: 1000px) { .compare-grid, .bottom-grid { grid-template-columns: 1fr; } }
</style>
