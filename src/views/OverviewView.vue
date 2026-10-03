<script setup lang="ts">
import { computed } from 'vue'
import Button from 'primevue/button'
import Message from 'primevue/message'
import ProgressBar from 'primevue/progressbar'
import Tag from 'primevue/tag'
import { useImpositionStore } from '../stores/imposition'

const store = useImpositionStore()
const pendingProof = computed(() => store.proofs.find((proof) => proof.decision === '待决定'))
const baselineMetric = computed(() => {
  if (store.baseline.status === '有效') return { value: store.baseline.revision ?? '—', small: `已锁定 · ${store.baseline.lockedAt}` }
  if (store.baseline.status === '已失效') return { value: '已失效', small: store.baseline.reason ?? '' }
  return { value: '未锁定', small: '锁定后方可放行导出' }
})
const lastPreflight = computed(() => store.preflightRuns[0])
</script>

<template>
  <section class="page">
    <div class="page-head">
      <div><p class="eyebrow">PRINT PRODUCTION / 印刷生产</p><h1>拼版预检与打样总览</h1><p class="muted">在当前拼版版本进入生产前，集中处理页序、出血、色彩与装订风险。</p></div>
      <div class="actions"><Button label="运行完整预检" icon="pi pi-check-circle" outlined @click="store.runPreflight('手动')" /><Button label="进入拼版工作区" icon="pi pi-th-large" @click="$router.push('/imposition')" /></div>
    </div>

    <Message v-if="store.migrationNotice" severity="info" class="mb-3" @close="store.dismissMigration">{{ store.migrationNotice }}</Message>
    <Message v-if="store.baseline.status === '已失效'" severity="error" :closable="false" class="mb-3">
      审批基线已失效（{{ store.baseline.reason }}），已自动重新预检，需重新锁定后才能放行导出。
    </Message>

    <div class="metric-grid">
      <article class="metric"><span>页面文件</span><strong>{{ store.pages.length }}</strong><small>{{ store.positions.length }} 个已排版位</small></article>
      <article class="metric"><span>预检错误</span><strong class="error">{{ store.blockingErrors }}</strong><small>必须处理后方可锁定</small></article>
      <article class="metric"><span>审批基线</span><strong :class="{ error: store.baseline.status === '已失效' }">{{ baselineMetric.value }}</strong><small>{{ baselineMetric.small }}</small></article>
      <article class="metric"><span>待恢复导出</span><strong>{{ store.tasks.filter((task) => task.resumable && task.status !== '已完成').length }}</strong><small>{{ store.pendingConflicts.length ? `${store.pendingConflicts.length} 个冲突副本待处理` : '断点可继续' }}</small></article>
    </div>

    <div class="overview-grid">
      <section class="panel">
        <div class="panel-head"><h3>当前拼版任务</h3><Tag :value="store.revision" severity="info" /></div>
        <div class="project-card">
          <div>
            <strong>《潮汐来信》上海巡演节目册</strong>
            <p>成品 210 × 297mm · 8P · 骑马订 · 720 × 1020mm 对开纸</p>
            <div class="specs"><span>CMYK + 专色</span><span>{{ store.spec.folding }}</span><span>PDF/X-4</span><span>色彩控制条已配置</span></div>
          </div>
          <Button label="打开拼版" icon="pi pi-arrow-right" @click="$router.push('/imposition')" />
        </div>
        <div class="checklist">
          <div><i class="pi pi-check-circle" /><span>页面尺寸与成品规格</span><Tag value="通过" severity="success" /></div>
          <div><i class="pi pi-exclamation-triangle warn" /><span>折手与页码顺序</span><Tag :value="store.validations.some((item) => item.id.includes('order')) ? '1 项警告' : '通过'" :severity="store.validations.some((item) => item.id.includes('order')) ? 'warn' : 'success'" /></div>
          <div><i class="pi pi-times-circle error" /><span>出血与版位安全区</span><Tag :value="store.blockingErrors ? `${store.blockingErrors} 项错误` : '通过'" :severity="store.blockingErrors ? 'danger' : 'success'" /></div>
          <div><i class="pi pi-check-circle" /><span>色彩控制条与纸张规格</span><Tag value="通过" severity="success" /></div>
        </div>
      </section>

      <aside>
        <section class="panel">
          <div class="panel-head"><h3>预检记录</h3><Tag v-if="lastPreflight" :value="lastPreflight.result" :severity="lastPreflight.result === '通过' ? 'success' : 'danger'" /></div>
          <div class="preflight-list">
            <div v-for="run in store.preflightRuns.slice(0, 4)" :key="run.id" class="proof-row">
              <div><strong>{{ run.trigger }} · {{ run.revision }}</strong><small>{{ run.at }} · {{ run.errors }} 错误 / {{ run.warnings }} 警告</small></div>
              <Tag :value="run.result" :severity="run.result === '通过' ? 'success' : 'danger'" />
            </div>
            <div v-if="!store.preflightRuns.length" class="empty">尚无预检记录，版位、出血或折手方向变更会自动重检。</div>
          </div>
        </section>
        <section class="panel">
          <div class="panel-head"><h3>最近打样</h3><Button label="查看全部" text size="small" @click="$router.push('/proofs')" /></div>
          <div class="proof-summary">
            <template v-for="proof in store.proofs.slice().reverse()" :key="proof.id">
              <div class="proof-row">
                <div><strong>第 {{ proof.round }} 轮 · {{ proof.sample }}</strong><small>{{ proof.date }} · ΔE {{ proof.deltaE }}</small></div>
                <Tag :value="proof.decision" :severity="proof.decision === '通过' ? 'success' : proof.decision === '退回' ? 'danger' : 'warn'" />
              </div>
            </template>
          </div>
        </section>
        <section class="panel export-mini">
          <div class="panel-head"><h3>导出任务</h3></div>
          <div v-for="task in store.tasks" :key="task.id">
            <div><span>{{ task.name }}<Tag v-if="store.isTaskStale(task)" value="旧版" severity="danger" class="stale-tag" /></span><strong>{{ task.progress }}%</strong></div>
            <ProgressBar :value="task.progress" :showValue="false" :style="{ height: '7px' }" />
            <small>{{ task.status }} · 分片 {{ task.fragments.completed.length }}/{{ task.fragments.total }} · {{ task.updatedAt }}</small>
          </div>
        </section>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.actions { display: flex; gap: 8px; flex-wrap: wrap; }
.mb-3 { margin-bottom: 12px; }
.metric .error { color: #b84e35; }
.overview-grid { display: grid; grid-template-columns: minmax(0,1fr) 350px; gap: 14px; align-items: start; }
.project-card { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 22px; }
.project-card strong { font-size: 17px; }
.project-card p { margin: 7px 0 14px; color: #66757c; }
.specs { display: flex; flex-wrap: wrap; gap: 7px; }
.specs span { padding: 5px 8px; border-radius: 5px; color: #45676d; background: #eef4f4; font-size: 10px; }
.checklist { padding: 0 18px 16px; }
.checklist > div { display: grid; grid-template-columns: 24px 1fr auto; align-items: center; gap: 9px; padding: 11px 0; border-top: 1px solid #ecf0f0; font-size: 12px; }
.checklist i { color: #3b8a67; }
.checklist i.warn { color: #c4872f; }
.checklist i.error { color: #bb4c35; }
aside { display: grid; gap: 14px; }
.preflight-list { padding: 8px 16px 14px; }
.proof-summary { padding: 8px 16px 14px; }
.proof-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 11px 0; border-bottom: 1px solid #edf1f1; }
.proof-row strong, .proof-row small { display: block; }
.proof-row small { margin-top: 4px; color: #7a878d; font-size: 10px; }
.empty { padding: 18px; color: #7e8a8f; text-align: center; font-size: 12px; }
.export-mini > div:not(.panel-head) { padding: 11px 16px 4px; }
.export-mini > div > div { display: flex; justify-content: space-between; margin-bottom: 6px; font-size: 11px; }
.export-mini small { display: block; margin-top: 5px; color: #7d898e; }
.stale-tag { margin-left: 6px; }
@media (max-width: 1050px) { .overview-grid { grid-template-columns: 1fr; } }
</style>
