import fs from 'node:fs/promises'
import path from 'node:path'
import type {
  BackupDetail,
  BackupPhase,
  BackupSummary,
  CreateResult,
  FileEntry,
  GameSettings,
  RestoreResult,
  Workspace
} from '../shared/types'
import { exportRegistry, importRegistry } from './sys'

export const SNAPSHOT_PREFIX = '_snapshot_'

const META_FILE = 'vault-meta.json'
const INVALID_NAME = /[\\/:*?"<>|]/
const ENTRY_LIMIT = 500

export interface ProgressEvent {
  phase: BackupPhase
  done: number
  total: number
  label: string
}
export type ProgressFn = (p: ProgressEvent) => void

interface BackupMeta {
  createdAt?: number
  note?: string
}

function timestamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

export function validateBackupName(name: string): string | null {
  if (!name || !name.trim()) return '备份名称不能为空'
  if (name !== name.trim()) return '名称首尾不能有空格'
  if (INVALID_NAME.test(name)) return '名称不能包含 \\ / : * ? " < > | 字符'
  if (name === '.' || name === '..') return '非法的备份名称'
  if (name.length > 100) return '备份名称过长'
  return null
}

/** 解析备份目录的绝对路径，并确保其严格位于工作区根目录下一层。 */
export function backupPath(ws: Workspace, name: string): string {
  const err = validateBackupName(name)
  if (err) throw new Error(err)
  const root = path.resolve(ws.path)
  const full = path.resolve(root, name)
  if (path.dirname(full) !== root) throw new Error('非法的备份名称')
  return full
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

async function readMeta(dir: string): Promise<BackupMeta> {
  try {
    return JSON.parse(await fs.readFile(path.join(dir, META_FILE), 'utf8')) as BackupMeta
  } catch {
    return {}
  }
}

async function writeMeta(dir: string, meta: BackupMeta): Promise<void> {
  await fs.writeFile(path.join(dir, META_FILE), JSON.stringify(meta, null, 2), 'utf8')
}

async function walkStats(dir: string): Promise<{ count: number; size: number }> {
  let count = 0
  let size = 0
  const stack = [dir]
  while (stack.length > 0) {
    const cur = stack.pop() as string
    let entries
    try {
      entries = await fs.readdir(cur, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      const full = path.join(cur, e.name)
      if (e.isDirectory()) {
        stack.push(full)
      } else if (e.isFile()) {
        count += 1
        try {
          size += (await fs.stat(full)).size
        } catch {
          // 忽略读取失败的个别文件
        }
      }
    }
  }
  return { count, size }
}

async function copyDir(src: string, dest: string, onFile: () => void): Promise<void> {
  await fs.mkdir(dest, { recursive: true })
  const entries = await fs.readdir(src, { withFileTypes: true })
  for (const e of entries) {
    const s = path.join(src, e.name)
    const d = path.join(dest, e.name)
    if (e.isDirectory()) {
      await copyDir(s, d, onFile)
    } else if (e.isFile()) {
      await fs.copyFile(s, d)
      onFile()
    }
  }
}

export async function listBackups(
  ws: Workspace,
  game: GameSettings
): Promise<{ missing: boolean; backups: BackupSummary[] }> {
  if (!(await pathExists(ws.path))) return { missing: true, backups: [] }
  const dirs = await fs.readdir(ws.path, { withFileTypes: true })
  const backups: BackupSummary[] = []
  for (const d of dirs) {
    if (!d.isDirectory()) continue
    const bPath = path.join(ws.path, d.name)
    const dataDir = path.join(bPath, game.dataDirName)
    const valid = await pathExists(dataDir)
    const meta = await readMeta(bPath)
    const st = await fs.stat(bPath)
    const stats = valid ? await walkStats(dataDir) : { count: 0, size: 0 }
    backups.push({
      name: d.name,
      path: bPath,
      workspaceId: ws.id,
      createdAt: meta.createdAt ?? (st.birthtimeMs || st.mtimeMs),
      fileCount: stats.count,
      totalSize: stats.size,
      hasRegistry: await pathExists(path.join(bPath, game.regFileName)),
      isSnapshot: d.name.startsWith(SNAPSHOT_PREFIX),
      note: meta.note ?? '',
      valid
    })
  }
  backups.sort((a, b) => b.createdAt - a.createdAt)
  return { missing: false, backups }
}

export async function backupDetail(
  ws: Workspace,
  game: GameSettings,
  name: string
): Promise<BackupDetail | null> {
  const { backups } = await listBackups(ws, game)
  const found = backups.find((b) => b.name === name)
  if (!found) return null
  const entries: FileEntry[] = []
  try {
    const dataDir = path.join(found.path, game.dataDirName)
    const list = await fs.readdir(dataDir, { withFileTypes: true })
    for (const e of list.slice(0, ENTRY_LIMIT)) {
      try {
        const st = await fs.stat(path.join(dataDir, e.name))
        entries.push({
          name: e.name,
          isDir: e.isDirectory(),
          size: e.isDirectory() ? 0 : st.size,
          mtime: st.mtimeMs
        })
      } catch {
        // 跳过无法读取的条目
      }
    }
  } catch {
    // 数据目录缺失时返回空列表
  }
  entries.sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name))
  return { ...found, entries }
}

export async function createBackup(
  ws: Workspace,
  game: GameSettings,
  name: string,
  note: string,
  overwrite: boolean,
  progress: ProgressFn
): Promise<CreateResult> {
  const target = backupPath(ws, name)
  if (await pathExists(target)) {
    if (!overwrite) {
      const err = new Error(`备份「${name}」已存在`) as Error & { code?: string }
      err.code = 'EXISTS'
      throw err
    }
    await fs.rm(target, { recursive: true, force: true })
  }
  if (!(await pathExists(game.sourcePath))) {
    throw new Error(`找不到存档来源目录：${game.sourcePath}`)
  }

  const { count } = await walkStats(game.sourcePath)
  let done = 0
  progress({ phase: 'copy', done, total: count, label: '复制存档文件' })
  await copyDir(game.sourcePath, path.join(target, game.dataDirName), () => {
    done += 1
    if (done % 5 === 0 || done === count) {
      progress({ phase: 'copy', done, total: count, label: '复制存档文件' })
    }
  })

  progress({ phase: 'registry', done, total: count, label: '导出注册表' })
  const hasRegistry = await exportRegistry(game.registryKey, path.join(target, game.regFileName))

  await writeMeta(target, { createdAt: Date.now(), note })
  progress({ phase: 'done', done: count, total: count, label: '完成' })
  return { hasRegistry }
}

export async function restoreBackup(
  ws: Workspace,
  game: GameSettings,
  name: string,
  progress: ProgressFn
): Promise<RestoreResult> {
  const bPath = backupPath(ws, name)
  const dataSrc = path.join(bPath, game.dataDirName)
  if (!(await pathExists(dataSrc))) {
    throw new Error('该备份缺少存档数据目录，无法恢复')
  }

  // 恢复前先为当前存档创建安全快照
  let snapshotName: string | null = null
  if (await pathExists(game.sourcePath)) {
    snapshotName = `${SNAPSHOT_PREFIX}${timestamp()}`
    progress({ phase: 'snapshot', done: 0, total: 0, label: '快照当前存档' })
    const snapDir = path.join(ws.path, snapshotName)
    await copyDir(game.sourcePath, path.join(snapDir, game.dataDirName), () => {})
    await exportRegistry(game.registryKey, path.join(snapDir, game.regFileName))
    await writeMeta(snapDir, { createdAt: Date.now(), note: `恢复「${name}」前的自动快照` })
  }

  const { count } = await walkStats(dataSrc)
  let done = 0
  progress({ phase: 'copy', done, total: count, label: '恢复存档文件' })
  await fs.rm(game.sourcePath, { recursive: true, force: true })
  await copyDir(dataSrc, game.sourcePath, () => {
    done += 1
    if (done % 5 === 0 || done === count) {
      progress({ phase: 'copy', done, total: count, label: '恢复存档文件' })
    }
  })

  let registry: RestoreResult['registry'] = 'missing'
  const regFile = path.join(bPath, game.regFileName)
  if (await pathExists(regFile)) {
    registry = (await importRegistry(regFile)) ? 'ok' : 'failed'
  }

  progress({ phase: 'done', done: count, total: count, label: '完成' })
  return { snapshotName, registry }
}

export async function deleteBackup(ws: Workspace, name: string): Promise<void> {
  await fs.rm(backupPath(ws, name), { recursive: true, force: true })
}

export async function renameBackup(ws: Workspace, name: string, newName: string): Promise<void> {
  const from = backupPath(ws, name)
  const to = backupPath(ws, newName)
  if (from === to) return
  if (await pathExists(to)) throw new Error(`备份「${newName}」已存在`)
  await fs.rename(from, to)
}

export async function setNote(ws: Workspace, name: string, note: string): Promise<void> {
  const dir = backupPath(ws, name)
  const meta = await readMeta(dir)
  await writeMeta(dir, { ...meta, note })
}
