<script setup lang="ts">
import { computed, ref } from 'vue'
import Button from 'primevue/button'
import SelectButton from 'primevue/selectbutton'
import Select from 'primevue/select'
import Slider from 'primevue/slider'
import Tag from 'primevue/tag'
import Message from 'primevue/message'
import ImpositionCanvas from '../components/ImpositionCanvas.vue'
import { foldingOptions, useImpositionStore } from '../stores/imposition'

const store = useImpositionStore()
const sideOptions = [
  { label: '正面', value: 'front' },
  { label: '反面', value: 'back' },
]
const selected = computed(() => store.positions.find((item) => item.id === store.selectedPosition))
const selectedPage = computed(() => store.pages.find((page) => page.pageNo === selected.value?.pageNo))
const activeValidations = computed(() => store.validations.filter((item) => !item.pageNo || item.pageNo === selected.value?.pageNo || sideContains(item.pageNo)))
const saveNotice = ref<{ severity: 'success' | 'warn' | 'error'; text: string } | null>(null)

const baselineTag = computed(() => {
  if (store.baseline.status === '有效') return { value: `基线 ${store.baseline.revision} 有效`, severity: 'success' as const }
  if (store.baseline.status === '已失效') return { value: '基线已失效', severity: 'danger' as const }
  return { value: '未锁定基线', severity: 'warn' as const }
})

function sideContains(pageNo?: number) {
  if (!pageNo) return true
  return store.positions.some((position) => position.pageNo === pageNo && position.front === (store.side === 'front'))
}

function locate(pageNo?: number) {
  const position = store.positions.find((item) => item.pageNo === pageNo)
  if (position) {
    store.selectedPosition = position.id
    store.side = position.front ? 'front' : 'back'
  }
}

function saveVersion() {
  const result = store.commit('保存拼版版本')
  saveNotice.value = result.ok
    ? { severity: 'success', text: `已保存为新版本 ${store.revision}，其他窗口将以本版本为新基线。` }
    : { severity: 'warn', text: `保存冲突：另一窗口已先保存为 V${result.conflict?.againstVersion} 并成为新基线；本次改动已保留为冲突副本 ${result.conflict?.id}，未覆盖对方。` }
}

function lock() {
  const result = store.lockBaseline()
  saveNotice.value = result.ok
    ? { severity: 'success', text: `审批基线 ${store.baseline.revision} 已锁定，可放行导出。` }
    : { severity: 'error', text: result.reason ?? '锁定失败' }
}
</script>

<template>
  <section class="page">
    <div class="page-head">
      <div><p class="eyebrow">IMPOSITION / 拼版工作区</p><h1>Canvas 版位编排与预检</h1><p class="muted">拖拽页面位置，系统实时检查出血、安全区、重叠和骑马订方向。</p></div>
      <div class="actions"><Button label="批量校验" icon="pi pi-check-circle" outlined @click="store.runPreflight('手动')" /><Button label="保存拼版版本" icon="pi pi-save" @click="saveVersion" /></div>
    </div>

    <Message v-if="store.migrationNotice" severity="info" class="mb-3" @close="store.dismissMigration">{{ store.migrationNotice }}</Message>
    <Message v-if="store.baseline.status === '已失效'" severity="error" :closable="false" class="mb-3">
      审批基线已失效（{{ store.baseline.reason }}），已重新预检：{{ store.blockingErrors }} 个阻断错误。需重新锁定后才能放行导出。
    </Message>
    <Message v-if="store.pendingConflicts.length" severity="warn" :closable="false" class="mb-3">
      有 {{ store.pendingConflicts.length }} 个冲突副本待处理（另一窗口的保存先到，本地改动未被覆盖）。
      <RouterLink to="/versions">前往版本对比处理 →</RouterLink>
    </Message>
    <Message v-if="saveNotice" :severity="saveNotice.severity" class="mb-3" @close="saveNotice = null">{{ saveNotice.text }}</Message>
    <Message v-else-if="store.validations.length" severity="warn" :closable="false" class="mb-3">
      当前版本有 {{ store.blockingErrors }} 个阻断错误和 {{ store.validations.filter((item) => item.severity === '警告').length }} 个警告。
    </Message>

    <div class="toolbar panel">
      <SelectButton v-model="store.side" :options="sideOptions" optionLabel="label" optionValue="value" />
      <span class="muted">缩放 {{ store.zoom }}%</span>
      <Slider v-model="store.zoom" :min="35" :max="100" :step="5" style="width:150px" />
      <label class="spec-field">折手方向
        <Select :modelValue="store.spec.folding" :options="foldingOptions" @update:modelValue="store.updateSpec({ folding: String($event) })" />
      </label>
      <label class="spec-field">出血要求
        <Select :modelValue="store.spec.bleed" :options="[2, 3, 5]" @update:modelValue="store.updateSpec({ bleed: Number($event) })" />
      </label>
      <span class="paper-spec">{{ store.spec.width }} × {{ store.spec.height }}mm · 出血 {{ store.spec.bleed }}mm · 安全区 {{ store.spec.safe }}mm · {{ store.revision }}{{ store.dirty ? ' · 未保存改动' : '' }}</span>
      <Tag :value="baselineTag.value" :severity="baselineTag.severity" />
      <Button v-if="!store.locked" label="审批锁定" icon="pi pi-lock" size="small" @click="lock" />
      <Button v-else label="解除锁定" icon="pi pi-lock-open" size="small" severity="warn" outlined @click="store.releaseBaseline" />
    </div>

    <div class="imposition-grid">
      <aside class="panel pages-panel">
        <div class="panel-head"><h3>页面文件</h3><Tag :value="`${store.pages.length}P`" /></div>
        <div class="page-list">
          <button v-for="page in store.pages" :key="page.pageNo" :disabled="store.positions.some((item) => item.pageNo === page.pageNo && item.front === (store.side === 'front'))" @click="store.addPosition(page.pageNo)">
            <div class="thumb"><span>P{{ page.pageNo }}</span><i /></div>
            <div><strong>{{ page.name }}</strong><small>{{ page.width }}×{{ page.height }} · 出血 {{ page.bleed }}mm</small></div>
            <i class="pi pi-plus" />
          </button>
        </div>
      </aside>

      <section class="panel canvas-panel">
        <div class="panel-head"><h3>{{ store.side === 'front' ? '正面版式' : '反面版式' }}</h3><span class="muted">拖动页面 · 点击选择</span></div>
        <div class="canvas-scroll">
          <ImpositionCanvas
            :positions="store.positions"
            :side="store.side"
            :zoom="store.zoom"
            :selected="store.selectedPosition"
            :validations="store.validations"
            @select="store.selectedPosition = $event"
            @update="store.updatePosition"
          />
        </div>
      </section>

      <aside class="right-panel">
        <section class="panel">
          <div class="panel-head"><h3>版位属性</h3><Tag v-if="selected" :value="selected.id" /></div>
          <div v-if="selected" class="properties">
            <label>页面<select :value="selected.pageNo" @change="store.updatePosition(selected.id, { pageNo: Number(($event.target as HTMLSelectElement).value) })"><option v-for="page in store.pages" :key="page.pageNo" :value="page.pageNo">P{{ page.pageNo }} · {{ page.name }}</option></select></label>
            <div class="pair"><label>X<input type="number" :value="selected.x" @change="store.updatePosition(selected.id, { x: Number(($event.target as HTMLInputElement).value) })" /></label><label>Y<input type="number" :value="selected.y" @change="store.updatePosition(selected.id, { y: Number(($event.target as HTMLInputElement).value) })" /></label></div>
            <label>旋转方向<select :value="selected.rotation" @change="store.updatePosition(selected.id, { rotation: Number(($event.target as HTMLSelectElement).value) })"><option :value="0">0°</option><option :value="90">顺时针 90°</option><option :value="180">倒置 180°</option><option :value="270">顺时针 270°</option></select></label>
            <label v-if="selectedPage">页面出血 (mm)<input type="number" min="0" max="10" :value="selectedPage.bleed" @change="store.updatePageBleed(selectedPage.pageNo, Number(($event.target as HTMLInputElement).value))" /></label>
            <div class="binding-note"><i class="pi pi-info-circle" /><span>{{ selectedPage?.content }}</span></div>
          </div>
          <div v-else class="empty">在画布中选择一个版位以编辑属性。</div>
        </section>

        <section class="panel">
          <div class="panel-head"><h3>预检结果</h3><Tag :value="`${activeValidations.length} 项`" :severity="activeValidations.some((item) => item.severity === '错误') ? 'danger' : 'warn'" /></div>
          <div class="validation-list">
            <button v-for="issue in activeValidations" :key="issue.id" :class="issue.severity" @click="locate(issue.pageNo)">
              <i :class="issue.severity === '错误' ? 'pi pi-times-circle' : 'pi pi-exclamation-triangle'" />
              <div><strong>{{ issue.title }}</strong><p>{{ issue.detail }}</p></div>
              <i class="pi pi-arrow-right" />
            </button>
          </div>
        </section>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.actions { display: flex; gap: 8px; }
.mb-3 { margin-bottom: 12px; }
.toolbar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; padding: 12px; }
.spec-field { display: flex; align-items: center; gap: 6px; color: #5f7076; font-size: 11px; font-weight: 700; }
.spec-field :deep(.p-select) { min-width: 108px; }
.paper-spec { margin-left: auto; color: #5d7077; font-size: 11px; }
.imposition-grid { display: grid; grid-template-columns: 220px minmax(0,1fr) 340px; gap: 12px; align-items: start; }
.pages-panel { max-height: 760px; overflow: auto; }
.page-list { padding: 8px; }
.page-list button { display: grid; width: 100%; grid-template-columns: 42px 1fr auto; gap: 8px; align-items: center; padding: 8px; border: 0; border-radius: 7px; text-align: left; background: transparent; cursor: pointer; }
.page-list button:hover:not(:disabled) { background: #eff5f4; }
.page-list button:disabled { opacity: .42; cursor: not-allowed; }
.thumb { display: grid; width: 38px; height: 50px; place-items: center; border: 1px solid #bdc7c9; background: #f4f3ef; font-size: 9px; font-weight: 800; }
.thumb i { width: 18px; height: 2px; background: #c36f42; }
.page-list strong, .page-list small { display: block; }
.page-list strong { font-size: 11px; }
.page-list small { margin-top: 4px; color: #7c898e; font-size: 9px; }
.canvas-panel { min-width: 0; }
.canvas-scroll { max-height: 760px; overflow: auto; padding: 18px; background: #34464c; }
.right-panel { display: grid; gap: 12px; }
.properties { display: grid; gap: 12px; padding: 14px; }
.pair { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; }
.properties label { display: grid; gap: 5px; color: #5f7076; font-size: 11px; font-weight: 700; }
.properties input, .properties select { width: 100%; padding: 8px; border: 1px solid #cbd5d7; border-radius: 6px; font: inherit; }
.binding-note { display: flex; gap: 7px; padding: 9px; color: #6a604f; background: #fff5e7; font-size: 11px; line-height: 1.5; }
.empty { padding: 28px; color: #7e8a8f; text-align: center; font-size: 12px; }
.validation-list { max-height: 340px; overflow: auto; padding: 7px; }
.validation-list button { display: grid; width: 100%; grid-template-columns: 22px 1fr 16px; gap: 7px; padding: 10px; border: 0; border-radius: 7px; text-align: left; background: transparent; cursor: pointer; }
.validation-list button:hover { background: #f5f7f7; }
.validation-list button.error > i:first-child { color: #bd4a34; }
.validation-list button.warning > i:first-child { color: #bf7f2c; }
.validation-list strong { font-size: 11px; }
.validation-list p { margin: 4px 0 0; color: #738087; font-size: 10px; line-height: 1.45; }
@media (max-width: 1200px) { .imposition-grid { grid-template-columns: 200px minmax(0,1fr); } .right-panel { grid-column: 1 / -1; grid-template-columns: 1fr 1fr; } }
@media (max-width: 760px) { .imposition-grid { grid-template-columns: 1fr; } .right-panel { grid-template-columns: 1fr; } .pages-panel { max-height: 300px; } }
</style>
