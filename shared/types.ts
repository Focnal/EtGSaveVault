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
  /** 恢复备份前自动保留的回档点数量上限，0 表示关闭 */
  rollbackKeep: number
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
  /** 是否包含存档数据目录 */
  hasData: boolean
  isSnapshot: boolean
  note: string
  /** 存档数据目录与注册表文件齐全，缺一不可，否则视为损坏 */
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

/** move = 原目录直接移入回档点（同卷零拷贝）；copy = 跨卷复制 */
export type RollbackMode = 'move' | 'copy'

/**
 * 回档点：恢复备份前自动捕获的“当前存档”。
 * 与用户主动创建的备份不同，它存放在应用数据目录，不占用工作区。
 */
export interface RollbackPoint {
  id: string
  path: string
  createdAt: number
  note: string
  /** 触发该回档点的备份名称 */
  sourceBackup: string | null
  mode: RollbackMode
  fileCount: number
  totalSize: number
  hasData: boolean
  hasRegistry: boolean
}

export interface RollbackList {
  /** 回档点存放目录，可在资源管理器中打开 */
  storePath: string
  /** 当前设置的保留份数，0 表示已关闭 */
  keep: number
  points: RollbackPoint[]
}

export interface RollbackRestoreResult {
  registry: 'ok' | 'missing' | 'failed'
  points: RollbackPoint[]
}

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
  /** 恢复前捕获的回档点，null 表示未捕获（功能关闭或来源目录不存在） */
  rollback: { id: string; mode: RollbackMode } | null
  registry: 'ok' | 'missing' | 'failed'
}

export interface CreateResult {
  hasRegistry: boolean
}
