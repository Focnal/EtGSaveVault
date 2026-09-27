import { reactive } from 'vue'
import type { AppConfig, BackupDetail, BackupProgress, GameSettings, WorkspaceScan } from '../shared/types'
import { api, errMsg } from './api'

export type ModalState =
  | { kind: 'none' }
  | { kind: 'settings' }
  | { kind: 'newBackup'; workspaceId: string }
  | { kind: 'rename'; workspaceId: string; name: string }
  | {
      kind: 'confirm'
      title: string
      message: string
      confirmText: string
      danger: boolean
      onConfirm: () => void | Promise<void>
    }

interface Toast {
  id: number
  kind: 'ok' | 'err' | 'info'
  text: string
}

export const state = reactive({
  config: null as AppConfig | null,
  scans: {} as Record<string, WorkspaceScan>,
  expanded: {} as Record<string, boolean>,
  selectedWorkspaceId: null as string | null,
  selectedBackupName: null as string | null,
  detail: null as BackupDetail | null,
  detailLoading: false,
  progress: null as BackupProgress | null,
  gameRunning: null as boolean | null,
  modal: { kind: 'none' } as ModalState,
  toasts: [] as Toast[]
})

let toastId = 0

export function toast(kind: Toast['kind'], text: string): void {
  const id = ++toastId
  state.toasts.push({ id, kind, text })
  setTimeout(() => {
    state.toasts = state.toasts.filter((t) => t.id !== id)
  }, 4200)
}

export async function init(): Promise<void> {
  state.config = await api.getConfig()
  api.onProgress((p) => {
    state.progress = p.phase === 'done' ? null : p
  })
  for (const ws of state.config.workspaces) state.expanded[ws.id] = true
  await scanAll()
  const first = state.config.workspaces[0]
  if (first) selectWorkspace(first.id)
  void refreshGameStatus()
}

export async function scanAll(): Promise<void> {
  if (!state.config) return
  const ids = new Set(state.config.workspaces.map((w) => w.id))
  for (const key of Object.keys(state.scans)) {
    if (!ids.has(key)) delete state.scans[key]
  }
  for (const ws of state.config.workspaces) {
    await scanWorkspace(ws.id)
  }
}

export async function scanWorkspace(id: string): Promise<void> {
  try {
    state.scans[id] = await api.listBackups(id)
  } catch (e) {
    toast('err', errMsg(e))
    return
  }
  if (state.selectedWorkspaceId === id && state.selectedBackupName) {
    await refreshDetail()
  }
}

export function selectWorkspace(id: string): void {
  state.selectedWorkspaceId = id
  state.selectedBackupName = null
  state.detail = null
  state.expanded[id] = true
}

export async function selectBackup(workspaceId: string, name: string): Promise<void> {
  state.selectedWorkspaceId = workspaceId
  state.selectedBackupName = name
  state.expanded[workspaceId] = true
  await refreshDetail()
}

export async function refreshDetail(): Promise<void> {
  if (!state.selectedWorkspaceId || !state.selectedBackupName) {
    state.detail = null
    return
  }
  state.detailLoading = true
  try {
    state.detail = await api.backupDetail(state.selectedWorkspaceId, state.selectedBackupName)
    if (!state.detail) state.selectedBackupName = null
  } catch (e) {
    toast('err', errMsg(e))
  } finally {
    state.detailLoading = false
  }
}

export async function addWorkspace(): Promise<void> {
  const prev = new Set((state.config?.workspaces ?? []).map((w) => w.id))
  state.config = await api.addWorkspace()
  const added = state.config.workspaces.find((w) => !prev.has(w.id))
  if (added) {
    state.expanded[added.id] = true
    await scanWorkspace(added.id)
    selectWorkspace(added.id)
    toast('ok', `已添加工作区「${added.name}」`)
  }
}

export function requestRemoveWorkspace(id: string, name: string): void {
  state.modal = {
    kind: 'confirm',
    title: '移除工作区',
    message: `将「${name}」从列表中移除。目录里的备份文件不会被删除。`,
    confirmText: '移除',
    danger: false,
    onConfirm: async () => {
      state.config = await api.removeWorkspace(id)
      delete state.scans[id]
      if (state.selectedWorkspaceId === id) {
        state.selectedWorkspaceId = null
        state.selectedBackupName = null
        state.detail = null
      }
      toast('ok', '工作区已移除')
    }
  }
}

export function openNewBackup(workspaceId: string): void {
  state.modal = { kind: 'newBackup', workspaceId }
}

export async function createBackup(
  workspaceId: string,
  name: string,
  note: string,
  overwrite: boolean
): Promise<boolean> {
  try {
    const r = await api.createBackup(workspaceId, name, note, overwrite)
    toast('ok', `备份「${name}」已创建${r.hasRegistry ? '' : '（注册表未导出）'}`)
    await scanWorkspace(workspaceId)
    return true
  } catch (e) {
    const msg = errMsg(e)
    if (msg.includes('已存在') && !overwrite) {
      state.modal = {
        kind: 'confirm',
        title: '覆盖备份',
        message: `备份「${name}」已存在，覆盖后原备份将被删除。`,
        confirmText: '覆盖',
        danger: true,
        onConfirm: async () => {
          await createBackup(workspaceId, name, note, true)
        }
      }
    } else {
      toast('err', msg)
    }
    return false
  }
}

export async function restoreBackup(workspaceId: string, name: string): Promise<void> {
  try {
    const status = await api.gameStatus()
    state.gameRunning = status.running
    if (status.running) {
      state.modal = {
        kind: 'confirm',
        title: '游戏正在运行',
        message: '恢复前需要结束游戏进程，否则游戏退出时可能把内存中的旧存档写回，覆盖恢复结果。',
        confirmText: '结束游戏并恢复',
        danger: true,
        onConfirm: async () => {
          const k = await api.killGame()
          if (!k.killed) {
            toast('err', '结束游戏进程失败，请手动关闭游戏后重试')
            return
          }
          await new Promise((r) => setTimeout(r, 800))
          await doRestore(workspaceId, name)
        }
      }
    } else {
      state.modal = {
        kind: 'confirm',
        title: '恢复备份',
        message: `将用「${name}」覆盖当前存档。覆盖前会自动为当前存档创建一份快照，可随时找回。`,
        confirmText: '确认恢复',
        danger: false,
        onConfirm: () => doRestore(workspaceId, name)
      }
    }
  } catch (e) {
    toast('err', errMsg(e))
  }
}

async function doRestore(workspaceId: string, name: string): Promise<void> {
  try {
    const r = await api.restoreBackup(workspaceId, name)
    const regText =
      r.registry === 'ok' ? '注册表已导入' : r.registry === 'failed' ? '注册表导入失败' : '备份中无注册表文件'
    toast('ok', `恢复完成：${regText}${r.snapshotName ? '，原存档已保存为快照' : ''}`)
    await scanWorkspace(workspaceId)
    void refreshGameStatus()
  } catch (e) {
    toast('err', errMsg(e))
  }
}

export function requestDeleteBackup(workspaceId: string, name: string): void {
  state.modal = {
    kind: 'confirm',
    title: '删除备份',
    message: `备份「${name}」将被永久删除，此操作无法撤销。`,
    confirmText: '删除',
    danger: true,
    onConfirm: async () => {
      try {
        await api.deleteBackup(workspaceId, name)
        toast('ok', '备份已删除')
        if (state.selectedBackupName === name) {
          state.selectedBackupName = null
          state.detail = null
        }
        await scanWorkspace(workspaceId)
      } catch (e) {
        toast('err', errMsg(e))
      }
    }
  }
}

export async function renameBackup(workspaceId: string, name: string, newName: string): Promise<boolean> {
  try {
    await api.renameBackup(workspaceId, name, newName)
    toast('ok', '已重命名')
    if (state.selectedBackupName === name) state.selectedBackupName = newName
    await scanWorkspace(workspaceId)
    await refreshDetail()
    return true
  } catch (e) {
    toast('err', errMsg(e))
    return false
  }
}

export async function saveNote(workspaceId: string, name: string, note: string): Promise<void> {
  try {
    await api.setNote(workspaceId, name, note)
    toast('ok', '备注已保存')
    await scanWorkspace(workspaceId)
  } catch (e) {
    toast('err', errMsg(e))
  }
}

export async function saveSettings(patch: Partial<GameSettings>): Promise<void> {
  state.config = await api.updateGame(patch)
  toast('ok', '设置已保存')
}

export async function refreshGameStatus(): Promise<void> {
  try {
    state.gameRunning = (await api.gameStatus()).running
  } catch {
    state.gameRunning = null
  }
}
