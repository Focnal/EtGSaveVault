import { ExternalLink, Pencil, Plus, RefreshCw, RotateCcw, Trash2 } from 'lucide-vue-next'
import type { BackupSummary, Workspace } from '../shared/types'
import { api } from './api'
import {
  openMenu,
  openNewBackup,
  openRename,
  requestDeleteBackup,
  requestRemoveWorkspace,
  restoreBackup,
  scanWorkspace,
  type MenuEntry
} from './store'

/**
 * 右键菜单的定义集中在这里。
 * 同一个备份菜单会出现在左侧树和工作区视图两处，集中定义可避免两边逐渐不一致。
 */

/** 工作区文件夹的菜单，替代原先悬浮才出现的小按钮。 */
export function openWorkspaceMenu(e: MouseEvent, ws: Workspace): void {
  const entries: MenuEntry[] = [
    { label: '新建备份', icon: Plus, run: () => openNewBackup(ws.id) },
    { label: '刷新', icon: RefreshCw, run: () => scanWorkspace(ws.id) },
    { label: '在资源管理器中打开', icon: ExternalLink, run: () => api.openPath(ws.path) },
    { divider: true },
    { label: '移除工作区', icon: Trash2, danger: true, run: () => requestRemoveWorkspace(ws.id, ws.name) }
  ]
  openMenu(e, entries)
}

/** 备份条目的菜单，与详情页头部的操作保持一致。 */
export function openBackupMenu(e: MouseEvent, workspaceId: string, b: BackupSummary): void {
  const entries: MenuEntry[] = [
    { label: '重命名', icon: Pencil, run: () => openRename(workspaceId, b.name) },
    // 数据目录或注册表缺失的备份无法恢复，与详情页的按钮保持一致
    { label: '恢复此存档', icon: RotateCcw, disabled: !b.valid, run: () => restoreBackup(workspaceId, b.name) },
    { label: '在资源管理器中打开', icon: ExternalLink, run: () => api.openPath(b.path) },
    { divider: true },
    { label: '删除', icon: Trash2, danger: true, run: () => requestDeleteBackup(workspaceId, b.name) }
  ]
  openMenu(e, entries)
}
