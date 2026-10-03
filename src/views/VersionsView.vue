<script setup lang="ts">
import { computed } from 'vue'
import Button from 'primevue/button'
import Tag from 'primevue/tag'
import Message from 'primevue/message'
import ImpositionCanvas from '../components/ImpositionCanvas.vue'
import { useImpositionStore } from '../stores/imposition'

const store = useImpositionStore()
const errors = computed(() => store.validations.filter((item) => item.severity === '错误').length)
const sortedVersions = computed(() => [...store.versions].sort((a, b) => b.revision - a.revision))
const sortedConflicts = computed(() => [...store.conflicts].reverse())

const baselineForCanvas = computed(() => (store.serverRevision > 0 ? store.baselinePositions : store.positions))
</script>

<template>
  <section class="page">
    <div class="page-head">
      <div>
        <p class="eyebrow">VERSION COMPARE / 版本对比</p>
        <h1>拼版版本并排审阅</h1>
        <p class="muted">基线 {{ store.revisionLabel }} 与当前草稿对比；提交后生成只读生产版本，旧版本保留可查。</p>
      </div>
      <div class="actions">
        <Button label="导出对比报告" icon="pi pi-file-export" outlined />
        <Button
          :label="store.baselineState === 'none' ? '提交首版并锁定' : '提交基线并锁定'"
          icon="pi pi-lock"
          :loading="store.saving"
          :disabled="store.preflightStale"
          @click="store.commitBaseline()"
        />
      </div>
    </div>

    <Message v-if="store.message" :severity="store.message.type === 'conflict' ? 'error' : store.message.type === 'success' ? 'success' : 'info'" :closable="true" class="mb-3" @close="store.message = null">
      {{ store.message.text }}
    </Message>

    <div class="compare-grid">
      <section class="panel">
        <div class="panel-head"><h3>基线 {{ store.revisionLabel }}</h3><Tag value="只读" /></div>
        <div class="canvas-box">
          <ImpositionCanvas :positions="baselineForCanvas" side="front" :zoom="38" :selected="null" :validations="[]" @update="() => {}" @select="() => {}" />
        </div>
      </section>
      <section class="panel candidate">
        <div class="panel-head">
          <h3>当前草稿</h3>
          <Tag v-if="store.baselineState === 'invalid'" value="基线已失效" severity="warn" />
          <Tag v-else-if="store.baselineState === 'stale'" value="协作窗口已更新" severity="warn" />
          <Tag v-else-if="store.locked" value="与基线一致" severity="success" />
          <Tag v-else value="未提交" severity="info" />
        </div>
        <div class="canvas-box">
          <ImpositionCanvas :positions="store.positions" side="front" :zoom="38" :selected="null" :validations="store.validations" @update="() => {}" @select="() => {}" />
        </div>
      </section>
    </div>

    <section class="panel history-panel">
      <div class="panel-head"><h3>版本历史</h3><span class="muted">旧版本保留可查 · 共 {{ sortedVersions.length }} 版</span></div>
      <div v-if="!sortedVersions.length" class="empty-history">尚未提交任何基线版本。</div>
      <div v-else class="version-list">
        <article v-for="version in sortedVersions" :key="version.id">
          <div class="version-badge"><strong>{{ version.label }}</strong><small>{{ version.id }}</small></div>
          <div class="version-meta">
            <strong>{{ version.note }}</strong>
            <small>{{ version.savedAt }}</small>
          </div>
          <Tag :value="version.source === 'upgrade' ? '首版升级' : version.source === 'lock' ? '审批锁定' : '保存'" :severity="version.source === 'upgrade' ? 'info' : 'success'" />
        </article>
      </div>
    </section>

    <section v-if="sortedConflicts.length" class="panel conflict-panel">
      <div class="panel-head"><h3>冲突副本</h3><span class="muted">后到窗口的改动保留为副本，未覆盖对方 · 共 {{ sortedConflicts.length }} 份</span></div>
      <div class="version-list">
        <article v-for="conflict in sortedConflicts" :key="conflict.id" class="conflict-row">
          <div class="version-badge conflict"><strong>{{ conflict.id }}</strong><small>基于 R{{ conflict.basedOnRevision }}</small></div>
          <div class="version-meta">
            <strong>{{ conflict.note }}</strong>
            <small>{{ conflict.savedAt }} · {{ conflict.positions.length }} 个版位</small>
          </div>
          <Button label="载入草稿" icon="pi pi-download" size="small" outlined @click="store.adoptConflict(conflict)" />
        </article>
      </div>
    </section>
  </section>
</template>

<style scoped>
.actions { display: flex; gap: 8px; }
.mb-3 { margin-bottom: 12px; }
.compare-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 14px; }
.candidate { border-color: #5d9693; }
.canvas-box { height: 440px; overflow: auto; padding: 12px; background: #35474d; }
.history-panel, .conflict-panel { overflow: hidden; margin-bottom: 14px; }
.version-list { padding: 6px 16px 14px; }
.version-list article { display: grid; grid-template-columns: 130px 1fr auto; gap: 12px; align-items: center; padding: 12px 0; border-bottom: 1px solid #edf1f1; }
.version-badge { display: grid; gap: 2px; padding: 8px 10px; border-radius: 7px; background: #eef4f4; }
.version-badge strong { font-size: 13px; color: #2c5a58; }
.version-badge small { color: #7c898e; font-size: 10px; }
.version-badge.conflict { background: #fdf1e7; }
.version-badge.conflict strong { color: #b06a2c; }
.version-meta strong, .version-meta small { display: block; }
.version-meta strong { font-size: 12px; }
.version-meta small { margin-top: 3px; color: #7a878e; font-size: 10px; }
.empty-history { padding: 24px; color: #7e8a8f; text-align: center; font-size: 12px; }
@media (max-width: 1000px) { .compare-grid { grid-template-columns: 1fr; } }
</style>
