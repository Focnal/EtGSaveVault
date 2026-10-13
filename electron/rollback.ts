import { app } from 'electron'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { BackupPhase, GameSettings, RollbackList, RollbackMode, RollbackPoint } from '../shared/types'
import { copyDir, pathExists, pointStamp, walkStats } from './fsutil'
import { exportRegistry, importRegistry } from './sys'

/**
 * 回档点：恢复备份前自动保存的当前存档。
 * 放在应用数据目录而非工作区，以便与来源目录同卷、用 rename 零拷贝捕获。
 */

const META_FILE = 'rollback-meta.json'
const ID_PATTERN = /^[0-9]{8}_[0-9]{6}_[0-9]{3}$/

export interface CaptureResult {
  id: string
  mode: RollbackMode
}

export type ProgressFn = (p: { phase: BackupPhase; done: number; total: number; label: string }) => void

interface PointMeta {
  createdAt: number
  note: string
  sourceBackup: string | null
  mode: RollbackMode
  sourcePath: string
}

/** 回档点根目录：优先 %LOCALAPPDATA%（与存档同在 C: 卷） */
function storeBase(): string {
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, 'EtG Save Vault')
  }
  return app.getPath('userData')
}

/** 按存档来源目录归属：恢复改写的始终是来源目录，多个工作区可能指向同一存档 */
export function storePath(game: GameSettings): string {
  const raw = (game.sourcePath || '').trim() || '(unset)'
  const norm = path.resolve(raw).replace(/[\\/]+$/, '').toLowerCase()
  const key = crypto.createHash('sha1').update(norm).digest('hex').slice(0, 12)
  return path.join(storeBase(), 'rollback', key)
}

function resolvePoint(dir: string, id: string): string {
  if (!ID_PATTERN.test(id)) throw new Error('非法的回档点标识')
  return path.join(dir, id)
}

async function readMeta(dir: string): Promise<Partial<PointMeta>> {
  try {
    return JSON.parse(await fs.readFile(path.join(dir, META_FILE), 'utf8')) as Partial<PointMeta>
  } catch {
    return {}
  }
}

async function listPoints(game: GameSettings): Promise<RollbackPoint[]> {
  const dir = storePath(game)
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const points: RollbackPoint[] = []
  for (const e of entries) {
    if (!e.isDirectory()) continue
    const p = path.join(dir, e.name)
    const meta = await readMeta(p)
    const st = await fs.stat(p).catch(() => null)
    const hasData = await pathExists(path.join(p, game.dataDirName))
    const hasRegistry = await pathExists(path.join(p, game.regFileName))
    const stats = hasData ? await walkStats(path.join(p, game.dataDirName)) : { count: 0, size: 0 }
    points.push({
      id: e.name,
      path: p,
      createdAt: meta.createdAt ?? st?.birthtimeMs ?? st?.mtimeMs ?? 0,
      note: meta.note ?? '',
      sourceBackup: meta.sourceBackup ?? null,
      mode: meta.mode ?? 'copy',
      fileCount: stats.count,
      totalSize: stats.size,
      hasData,
      hasRegistry
    })
  }
  points.sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))
  return points
}

export async function list(game: GameSettings): Promise<RollbackList> {
  return { storePath: storePath(game), keep: game.rollbackKeep, points: await listPoints(game) }
}

/** 只保留最新的 keep 份，其余按时间从旧到新删除 */
async function prune(dir: string, keep: number): Promise<void> {
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  const items: { name: string; createdAt: number }[] = []
  for (const e of entries) {
    if (!e.isDirectory()) continue
    const meta = await readMeta(path.join(dir, e.name))
    items.push({ name: e.name, createdAt: meta.createdAt ?? 0 })
  }
  items.sort((a, b) => b.createdAt - a.createdAt || b.name.localeCompare(a.name))
  for (const item of items.slice(Math.max(0, keep))) {
    await fs.rm(path.join(dir, item.name), { recursive: true, force: true })
  }
}

/**
 * 捕获当前存档为回档点：同卷 rename（零拷贝），跨卷退化为复制。
 * move 会消耗源目录，copy 保留源目录由调用方删除；返回 null 表示未捕获。
 */
export async function capture(
  game: GameSettings,
  sourceBackup: string,
  keep: number,
  progress?: ProgressFn
): Promise<CaptureResult | null> {
  if (!keep || keep <= 0) return null
  if (!(await pathExists(game.sourcePath))) return null

  const dir = storePath(game)
  await fs.mkdir(dir, { recursive: true })
  const id = pointStamp()
  const target = path.join(dir, id)
  const dataDest = path.join(target, game.dataDirName)

  let mode: RollbackMode = 'move'
  await fs.mkdir(target, { recursive: true })
  try {
    await fs.rename(game.sourcePath, dataDest)
  } catch {
    // 跨卷或目录被占用：退化为复制
    mode = 'copy'
    progress?.({ phase: 'snapshot', done: 0, total: 0, label: '复制回档点' })
    await copyDir(game.sourcePath, dataDest, () => {})
  }

  // 注册表不能随目录搬迁，单独导出到回档点内
  await exportRegistry(game.registryKey, path.join(target, game.regFileName))

  const meta: PointMeta = {
    createdAt: Date.now(),
    note: `恢复「${sourceBackup}」前的自动回档点`,
    sourceBackup,
    mode,
    sourcePath: game.sourcePath
  }
  await fs.writeFile(path.join(target, META_FILE), JSON.stringify(meta, null, 2), 'utf8')

  await prune(dir, keep)
  return { id, mode }
}

/** 用回档点覆盖当前存档（「撤销本次恢复」的底层实现） */
export async function restorePoint(
  game: GameSettings,
  id: string
): Promise<{ registry: 'ok' | 'missing' | 'failed' }> {
  const dir = storePath(game)
  const src = resolvePoint(dir, id)
  const dataSrc = path.join(src, game.dataDirName)
  if (!(await pathExists(dataSrc))) throw new Error('该回档点缺少存档数据目录，无法还原')

  await fs.rm(game.sourcePath, { recursive: true, force: true })
  await copyDir(dataSrc, game.sourcePath, () => {})

  const regFile = path.join(src, game.regFileName)
  if (!(await pathExists(regFile))) return { registry: 'missing' }
  return { registry: (await importRegistry(regFile)) ? 'ok' : 'failed' }
}

export async function removePoint(game: GameSettings, id: string): Promise<void> {
  await fs.rm(resolvePoint(storePath(game), id), { recursive: true, force: true })
}

export async function clearPoints(game: GameSettings): Promise<void> {
  await fs.rm(storePath(game), { recursive: true, force: true })
}
