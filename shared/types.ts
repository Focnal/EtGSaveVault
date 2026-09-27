export interface Workspace {
  id: string
  name: string
  path: string
}

export interface GameSettings {
  /** 游戏存档所在目录（备份来源） */
  sourcePath: string
  /** 随存档一起导出的注册表键 */
  registryKey: string
  /** 游戏进程名，用于恢复前检测 */
  processName: string
  /** 备份内保存存档数据的子目录名 */
  dataDirName: string
  /** 备份内注册表导出文件名 */
  regFileName: string
}

export interface AppConfig {
  workspaces: Workspace[]
  game: GameSettings
}

export interface BackupSummary {
  name: string
  path: string
  workspaceId: string
  createdAt: number
  fileCount: number
  totalSize: number
  hasRegistry: boolean
  isSnapshot: boolean
  note: string
  /** 是否包含有效的存档数据目录 */
  valid: boolean
}

export interface WorkspaceScan {
  workspaceId: string
  /** 工作区目录是否已丢失 */
  missing: boolean
  backups: BackupSummary[]
}

export interface FileEntry {
  name: string
  isDir: boolean
  size: number
  mtime: number
}

export interface BackupDetail extends BackupSummary {
  /** 存档数据目录的顶层条目 */
  entries: FileEntry[]
}

export type BackupPhase = 'copy' | 'registry' | 'snapshot' | 'done'

export interface BackupProgress {
  workspaceId: string
  phase: BackupPhase
  done: number
  total: number
  label: string
}

export interface GameStatus {
  running: boolean
}

export interface RestoreResult {
  snapshotName: string | null
  registry: 'ok' | 'missing' | 'failed'
}

export interface CreateResult {
  hasRegistry: boolean
}
