<script setup lang="ts">
import { ref } from 'vue'
import { api } from '../api'
import { saveSettings, state } from '../store'

const game = state.config?.game
const sourcePath = ref(game?.sourcePath ?? '')
const registryKey = ref(game?.registryKey ?? '')
const processName = ref(game?.processName ?? '')
const busy = ref(false)

async function pickSource(): Promise<void> {
  const p = await api.pickDirectory('选择存档来源目录')
  if (p) sourcePath.value = p
}

async function save(): Promise<void> {
  if (busy.value) return
  busy.value = true
  await saveSettings({
    sourcePath: sourcePath.value.trim(),
    registryKey: registryKey.value.trim(),
    processName: processName.value.trim()
  })
  busy.value = false
  state.modal = { kind: 'none' }
}

function cancel(): void {
  state.modal = { kind: 'none' }
}
</script>

<template>
  <div class="modal-mask" @click.self="cancel">
    <div class="modal">
      <div class="modal-title">设置</div>
      <label class="field">
        <span>存档来源目录</span>
        <div class="field-row">
          <input v-model="sourcePath" type="text" />
          <button class="btn" @click="pickSource">浏览…</button>
        </div>
      </label>
      <label class="field">
        <span>注册表键（备份/恢复时一并导出导入）</span>
        <input v-model="registryKey" type="text" />
      </label>
      <label class="field">
        <span>游戏进程名（恢复前检测）</span>
        <input v-model="processName" type="text" />
      </label>
      <div class="modal-actions">
        <button class="btn" @click="cancel">取消</button>
        <button class="btn btn-primary" :disabled="busy" @click="save">{{ busy ? '保存中…' : '保存' }}</button>
      </div>
    </div>
  </div>
</template>
