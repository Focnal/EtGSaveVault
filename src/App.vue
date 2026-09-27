<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { AlertTriangle, Archive, CheckCircle2, Gamepad2, Info, Settings } from 'lucide-vue-next'
import BackupDetail from './components/BackupDetail.vue'
import ConfirmModal from './components/ConfirmModal.vue'
import NewBackupModal from './components/NewBackupModal.vue'
import RenameModal from './components/RenameModal.vue'
import SettingsModal from './components/SettingsModal.vue'
import Sidebar from './components/Sidebar.vue'
import WorkspaceView from './components/WorkspaceView.vue'
import { init, refreshGameStatus, state } from './store'

onMounted(() => {
  void init()
})

const progressPct = computed(() => {
  const p = state.progress
  if (!p || !p.total) return p && p.phase !== 'done' ? 100 : 0
  return Math.min(100, Math.round((p.done / p.total) * 100))
})

const gameStatusText = computed(() => {
  if (state.gameRunning === null) return '状态未知'
  return state.gameRunning ? '游戏运行中' : '游戏未运行'
})
</script>

<template>
  <div class="app">
    <header class="topbar">
      <div class="brand">
        <Archive :size="17" class="brand-icon" />
        <span>EtG Save Vault</span>
      </div>
      <div class="topbar-right">
        <button
          class="chip"
          :class="state.gameRunning ? 'chip-warn' : 'chip-ok'"
          title="点击刷新游戏进程状态"
          @click="refreshGameStatus"
        >
          <Gamepad2 :size="13" />
          <span>{{ gameStatusText }}</span>
        </button>
        <button class="icon-btn" title="设置" @click="state.modal = { kind: 'settings' }">
          <Settings :size="16" />
        </button>
      </div>
    </header>

    <div v-if="state.progress" class="progress-strip">
      <span class="progress-label">
        {{ state.progress.label }}
        <template v-if="state.progress.total">{{ state.progress.done }}/{{ state.progress.total }}</template>
      </span>
      <div class="progress-track">
        <div class="progress-fill" :style="{ width: progressPct + '%' }"></div>
      </div>
    </div>

    <div class="body">
      <Sidebar />
      <main class="main">
        <BackupDetail v-if="state.selectedBackupName && state.detail" />
        <WorkspaceView v-else-if="state.selectedWorkspaceId" />
        <div v-else class="empty-state">
          <Archive :size="42" :stroke-width="1.1" />
          <p>在左侧选择一个备份查看详情</p>
          <p class="dim">或先添加一个工作区目录</p>
        </div>
      </main>
    </div>

    <SettingsModal v-if="state.modal.kind === 'settings'" />
    <NewBackupModal v-if="state.modal.kind === 'newBackup'" />
    <RenameModal v-if="state.modal.kind === 'rename'" />
    <ConfirmModal v-if="state.modal.kind === 'confirm'" />

    <div class="toasts">
      <div v-for="t in state.toasts" :key="t.id" class="toast" :class="'toast-' + t.kind">
        <CheckCircle2 v-if="t.kind === 'ok'" :size="15" />
        <AlertTriangle v-else-if="t.kind === 'err'" :size="15" />
        <Info v-else :size="15" />
        <span>{{ t.text }}</span>
      </div>
    </div>
  </div>
</template>
