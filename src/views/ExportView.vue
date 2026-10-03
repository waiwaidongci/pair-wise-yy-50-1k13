<script setup lang="ts">
import { ref } from 'vue'
import Button from 'primevue/button'
import ProgressBar from 'primevue/progressbar'
import Tag from 'primevue/tag'
import Message from 'primevue/message'
import InputText from 'primevue/inputtext'
import { useImpositionStore } from '../stores/imposition'

const store = useImpositionStore()
const newName = ref('印刷交付包 · PDF/X-4')
const resumeId = ref('')

function statusSeverity(status?: string) {
  return status === '已完成' ? 'success' : status === '已中断' ? 'danger' : status === '生成中' ? 'warn' : 'info'
}

function shardStatus(taskId: string, index: number) {
  const task = store.tasks.find((item) => item.id === taskId)
  return task?.doneShards.includes(index) ? '已完成' : '待生成'
}
</script>

<template>
  <section class="page">
    <div class="page-head">
      <div>
        <p class="eyebrow">EXPORT JOBS / 导出任务</p>
        <h1>交付包与分片断点恢复</h1>
        <p class="muted">导出失败后按任务号恢复未完成分片；重复发起沿用原任务，不重复创建。</p>
      </div>
      <div class="actions">
        <InputText v-model="newName" placeholder="导出任务名称" style="min-width:240px" />
        <Button label="发起导出（重复发起沿用原任务）" icon="pi pi-plus" @click="store.createExportTask(newName)" />
      </div>
    </div>

    <Message v-if="store.message" :severity="store.message.type === 'success' ? 'success' : store.message.type === 'error' ? 'error' : 'info'" :closable="true" class="mb-3" @close="store.message = null">
      {{ store.message.text }}
    </Message>

    <div class="export-grid">
      <section class="panel">
        <div class="panel-head"><h3>导出队列</h3><span class="muted">按任务号恢复分片</span></div>
        <div class="task-list">
          <article v-for="task in store.tasks" :key="task.id">
            <div class="task-head">
              <div><strong>{{ task.name }}</strong><small>{{ task.id }} · {{ task.updatedAt }}</small></div>
              <Tag :value="task.status" :severity="statusSeverity(task.status)" />
            </div>
            <ProgressBar :value="task.progress" :showValue="false" :style="{ height: '8px' }" />
            <div class="shards">
              <span
                v-for="index in task.totalShards"
                :key="index"
                class="shard"
                :class="{ done: shardStatus(task.id, index - 1) === '已完成' }"
              >{{ index }}</span>
            </div>
            <div class="task-foot">
              <span>{{ task.progress }}% · 已完成 {{ task.doneShards.length }}/{{ task.totalShards }} 分片 · {{ task.status === '已完成' ? '文件哈希已校验' : '失败后从下一未完成分片续传' }}</span>
              <Button
                v-if="task.resumable && task.status !== '已完成'"
                label="按任务号恢复"
                icon="pi pi-play"
                size="small"
                :loading="store.resumingTaskId === task.id"
                @click="store.resumeTask(task.id)"
              />
              <Button v-else-if="task.status !== '已完成'" label="重新生成" icon="pi pi-refresh" size="small" outlined />
              <Button v-else label="打开结果" icon="pi pi-external-link" size="small" text />
            </div>
          </article>
        </div>

        <div class="resume-by-id">
          <InputText v-model="resumeId" placeholder="输入任务号，如 EXP-0925-01" />
          <Button label="按任务号恢复未完成分片" icon="pi pi-play" outlined :loading="!!store.resumingTaskId" @click="resumeId && store.resumeTask(resumeId)" />
        </div>
      </section>

      <aside>
        <section class="panel">
          <div class="panel-head"><h3>交付包内容</h3><Tag :value="store.revisionLabel" /></div>
          <div class="package-list">
            <div><i class="pi pi-file-pdf" /><span>拼版 PDF/X-4</span><strong>{{ store.locked ? '待生成' : '基线未锁定' }}</strong></div>
            <div><i class="pi pi-check-circle" /><span>预检报告 JSON</span><strong>{{ store.validations.length }} 项</strong></div>
            <div><i class="pi pi-check-circle" /><span>色彩控制条报告</span><strong>已包含</strong></div>
            <div><i class="pi pi-check-circle" /><span>打样审批记录</span><strong>{{ store.proofs.length }} 轮</strong></div>
            <div><i class="pi pi-check-circle" /><span>纸张与折手规格</span><strong>{{ store.spec.binding }} · {{ store.spec.foldDirection }}</strong></div>
          </div>
        </section>
        <section class="panel recovery">
          <div class="panel-head"><h3>恢复说明</h3></div>
          <p>任务分片按 16 页一组写入临时目录。导出中断后，按任务号恢复会从第一个未完成分片继续，已完成分片直接复用，不重跑、不重复建任务。</p>
          <Button label="清理已完成任务" severity="secondary" outlined fluid />
        </section>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.actions { display: flex; gap: 8px; align-items: center; }
.mb-3 { margin-bottom: 12px; }
.export-grid { display: grid; grid-template-columns: minmax(0,1fr) 330px; gap: 14px; align-items: start; }
.task-list { padding: 8px 16px 16px; }
.task-list article { padding: 15px 0; border-bottom: 1px solid #e9eeee; }
.task-head, .task-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.task-head { margin-bottom: 11px; }
.task-head strong, .task-head small { display: block; }
.task-head small { margin-top: 4px; color: #7c898f; font-size: 10px; }
.shards { display: flex; gap: 6px; margin: 10px 0 4px; }
.shard { display: grid; width: 26px; height: 22px; place-items: center; border: 1px solid #cfd8da; border-radius: 5px; color: #8a979c; font-size: 10px; }
.shard.done { border-color: #3b8a67; background: #e6f3ec; color: #2f7a57; font-weight: 700; }
.task-foot { margin-top: 9px; }
.task-foot span { color: #68777e; font-size: 10px; }
.resume-by-id { display: flex; gap: 8px; padding: 0 16px 16px; }
.resume-by-id .p-inputtext { flex: 1; }
aside { display: grid; gap: 14px; }
.package-list { padding: 8px 16px 16px; }
.package-list div { display: grid; grid-template-columns: 24px 1fr auto; align-items: center; gap: 8px; padding: 10px 0; border-bottom: 1px solid #edf1f1; font-size: 11px; }
.package-list i { color: #397d64; }
.package-list strong { color: #536b72; font-size: 10px; }
.recovery p { padding: 0 16px; color: #67767d; font-size: 11px; line-height: 1.6; }
.recovery :deep(.p-button) { width: calc(100% - 32px); margin: 0 16px 16px; }
@media (max-width: 1000px) { .export-grid { grid-template-columns: 1fr; } }
</style>
