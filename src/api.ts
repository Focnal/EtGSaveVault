import type {
  AppConfig,
  BackupDetail,
  BackupProgress,
  CreateResult,
  GameSettings,
  GameStatus,
  RestoreResult,
  WorkspaceScan
} from '../shared/types'

export interface VaultApi {
  getConfig(): Promise<AppConfig>
  updateGame(patch: Partial<GameSettings>): Promise<AppConfig>
  addWorkspace(): Promise<AppConfig>
  removeWorkspace(id: string): Promise<AppConfig>
  listBackups(workspaceId: string): Promise<WorkspaceScan>
  backupDetail(workspaceId: string, name: string): Promise<BackupDetail | null>
  createBackup(workspaceId: string, name: string, note: string, overwrite: boolean): Promise<CreateResult>
  restoreBackup(workspaceId: string, name: string): Promise<RestoreResult>
  deleteBackup(workspaceId: string, name: string): Promise<void>
  renameBackup(workspaceId: string, name: string, newName: string): Promise<void>
  setNote(workspaceId: string, name: string, note: string): Promise<void>
  openPath(p: string): Promise<string>
  gameStatus(): Promise<GameStatus>
  killGame(): Promise<{ killed: boolean }>
  pickDirectory(title?: string): Promise<string | null>
  onProgress(cb: (p: BackupProgress) => void): () => void
}

declare global {
  interface Window {
    vault: VaultApi
  }
}

export const api = window.vault

/** ipcRenderer.invoke 抛出的错误带有通道名前缀，这里剥掉后展示给用户。 */
export function errMsg(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  return m.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}
