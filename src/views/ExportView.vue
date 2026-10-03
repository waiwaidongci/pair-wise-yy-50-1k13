<script setup lang="ts">
import { ref, watch } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import Button from 'primevue/button'
import Message from 'primevue/message'
import ProgressBar from 'primevue/progressbar'
import Tag from 'primevue/tag'
import { useImpositionStore } from '../stores/imposition'
import { exportApi } from '../api/exportApi'

const store = useImpositionStore()
const queryClient = useQueryClient()
const notice = ref('')

const { data: tasks, isPending } = useQuery({
  queryKey: ['export-tasks'],
  queryFn: async () => (await exportApi.list()).data,
  refetchInterval: (query) => ((query.state.data ?? []).some((task) => task.status === '生成中' || task.status === '排队中') ? 500 : false),
})
watch(tasks, (list) => { if (list) store.syncTasks(list) }, { immediate: true })

function refresh() {
  queryClient.invalidateQueries({ queryKey: ['export-tasks'] })
}

const createMutation = useMutation({
  mutationFn: async () => {
    store.runPreflight('导出前')
    return (await exportApi.create({
      name: '印刷交付包 · PDF/X-4',
      revision: store.revision,
      baselineVersion: store.baseline.version ?? 0,
      idempotencyKey: `${store.revision}:印刷交付包 · PDF/X-4`,
    })).data
  },
  onSuccess: (result) => {
    notice.value = result.reused
      ? `同一基线版本的任务已存在，沿用原任务 ${result.task.id} 继续生成，未重复发起。`
      : `已按当前基线 ${store.baseline.revision} 创建导出任务 ${result.task.id}。`
    refresh()
  },
})
const resumeMutation = useMutation({
  mutationFn: async (id: string) => (await exportApi.resume(id)).data,
  onSuccess: (task) => { notice.value = `任务 ${task.id} 已按任务号恢复，从未完成分片继续生成。`; refresh() },
})
const interruptMutation = useMutation({
  mutationFn: async (id: string) => (await exportApi.interrupt(id)).data,
  onSuccess: (task) => { notice.value = `模拟导出失败：任务 ${task.id} 已中断，已完成分片保留，可按任务号恢复。`; refresh() },
})
const clearMutation = useMutation({
  mutationFn: async () => (await exportApi.clearCompleted()).data,
  onSuccess: () => { notice.value = '已清理已完成任务。'; refresh() },
})

function statusSeverity(status?: string) {
  return status === '已完成' ? 'success' : status === '已中断' ? 'danger' : status === '生成中' ? 'warn' : 'info'
}
</script>

<template>
  <section class="page">
    <div class="page-head">
      <div><p class="eyebrow">EXPORT JOBS / 导出任务</p><h1>交付包与断点恢复</h1><p class="muted">导出按审批基线放行；中断任务保留已完成分片，按任务号恢复，重复发起沿用原任务。</p></div>
      <Button label="新建印刷交付包" icon="pi pi-plus" :disabled="!store.canExport" :loading="createMutation.isPending.value" @click="createMutation.mutate()" />
    </div>

    <Message v-if="!store.canExport" severity="warn" :closable="false" class="mb-3">
      {{ store.baseline.status === '已失效' ? '审批基线已失效，请在拼版工作区重新锁定后再发起导出。' : store.blockingErrors > 0 ? `存在 ${store.blockingErrors} 个阻断错误，预检未通过，不能放行导出。` : '尚未锁定审批基线，不能放行导出。' }}
    </Message>
    <Message v-if="notice" severity="info" class="mb-3" @close="notice = ''">{{ notice }}</Message>

    <div class="export-grid">
      <section class="panel">
        <div class="panel-head"><h3>导出队列</h3><span class="muted">Axios 模拟 REST · 分片断点续传</span></div>
        <div v-if="isPending" class="loading">正在加载导出任务…</div>
        <div v-else class="task-list">
          <article v-for="task in (tasks ?? [])" :key="task.id">
            <div class="task-head">
              <div><strong>{{ task.name }}</strong><small>{{ task.id }} · 基线 {{ task.revision }} · {{ task.updatedAt }}</small></div>
              <div class="tags">
                <Tag v-if="store.isTaskStale(task)" value="旧版基线" severity="danger" />
                <Tag :value="task.status" :severity="statusSeverity(task.status)" />
              </div>
            </div>
            <ProgressBar :value="task.progress" :showValue="false" :style="{ height: '8px' }" />
            <div class="task-foot">
              <span>{{ task.progress }}% · 分片 {{ task.fragments.completed.length }}/{{ task.fragments.total }} · {{ task.status === '已完成' ? '文件哈希已校验' : '保留已完成分片' }}</span>
              <div class="ops">
                <Button v-if="task.status === '生成中' || task.status === '排队中'" label="模拟中断" icon="pi pi-stop" size="small" severity="danger" outlined :loading="interruptMutation.isPending.value" @click="interruptMutation.mutate(task.id)" />
                <Button v-if="task.resumable && task.status === '已中断'" label="恢复任务" icon="pi pi-play" size="small" :loading="resumeMutation.isPending.value" @click="resumeMutation.mutate(task.id)" />
                <Button v-if="task.status === '已完成'" label="打开结果" icon="pi pi-external-link" size="small" text />
              </div>
            </div>
          </article>
          <div v-if="!(tasks ?? []).length" class="loading">暂无导出任务。</div>
        </div>
      </section>

      <aside>
        <section class="panel">
          <div class="panel-head"><h3>交付包内容</h3><Tag :value="store.revision" /></div>
          <div class="package-list">
            <div><i class="pi pi-file-pdf" /><span>拼版 PDF/X-4</span><strong>待生成</strong></div>
            <div><i class="pi pi-check-circle" /><span>预检报告 JSON</span><strong>{{ store.validations.length }} 项</strong></div>
            <div><i class="pi pi-check-circle" /><span>色彩控制条报告</span><strong>已包含</strong></div>
            <div><i class="pi pi-check-circle" /><span>打样审批记录</span><strong>{{ store.proofs.length }} 轮</strong></div>
            <div><i class="pi pi-check-circle" /><span>纸张与折手规格</span><strong>{{ store.spec.folding }}</strong></div>
          </div>
        </section>
        <section class="panel recovery">
          <div class="panel-head"><h3>恢复说明</h3></div>
          <p>任务分片按 16 页一组写入临时目录。导出失败、浏览器刷新或网络中断后，按任务号恢复时只补未完成分片；同一基线版本重复发起导出会沿用原任务，不会生成重复任务。</p>
          <Button label="清理已完成任务" severity="secondary" outlined :loading="clearMutation.isPending.value" @click="clearMutation.mutate()" />
        </section>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.mb-3 { margin-bottom: 12px; }
.export-grid { display: grid; grid-template-columns: minmax(0,1fr) 330px; gap: 14px; align-items: start; }
.loading { padding: 30px; color: #75838a; text-align: center; }
.task-list { padding: 8px 16px 16px; }
.task-list article { padding: 15px 0; border-bottom: 1px solid #e9eeee; }
.task-head, .task-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.task-head { margin-bottom: 11px; }
.task-head strong, .task-head small { display: block; }
.task-head small { margin-top: 4px; color: #7c898f; font-size: 10px; }
.tags { display: flex; gap: 6px; }
.task-foot { margin-top: 9px; }
.task-foot span { color: #68777e; font-size: 10px; }
.ops { display: flex; gap: 8px; }
aside { display: grid; gap: 14px; }
.package-list { padding: 8px 16px 16px; }
.package-list div { display: grid; grid-template-columns: 24px 1fr auto; align-items: center; gap: 8px; padding: 10px 0; border-bottom: 1px solid #edf1f1; font-size: 11px; }
.package-list i { color: #397d64; }
.package-list strong { color: #536b72; font-size: 10px; }
.recovery p { padding: 0 16px; color: #67767d; font-size: 11px; line-height: 1.6; }
.recovery :deep(.p-button) { width: calc(100% - 32px); margin: 0 16px 16px; }
@media (max-width: 1000px) { .export-grid { grid-template-columns: 1fr; } }
</style>
