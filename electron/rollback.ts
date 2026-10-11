import { app } from 'electron'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { BackupPhase, GameSettings, RollbackList, RollbackMode, RollbackPoint } from '../shared/types'
import { copyDir, pathExists, pointStamp, walkStats } from './fsutil'
import { exportRegistry, importRegistry } from './sys'

/**
 * 回档点（rollback point）= 恢复备份前自动保存的“当前存档”。
 *
 * 它与用户主动创建的备份是两种东西，因此存放在应用数据目录而不是工作区里：
 * 既不会污染工作区的备份树，也能和存档来源目录同卷 —— 同卷时用 rename 捕获，
 * 零拷贝、瞬时完成。
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

/** 回档点的根目录：优先 %LOCALAPPDATA%（与游戏存档同在 C: 卷）。 */
function storeBase(): string {
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, 'EtG Save Vault')
  }
  return app.getPath('userData')
}

/**
 * 回档点按“存档来源目录”归属，而不是按工作区 —— 恢复动作改写的始终是来源目录，
 * 多个工作区可能指向同一个游戏存档。
 */
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

/** 只保留最新的 keep 份，多余的按时间从旧到新删除。 */
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
 * 捕获当前存档为回档点。
 * 同卷时直接 rename（零拷贝、瞬时），跨卷时回退为复制。
 * 返回 null 表示未捕获（已关闭该功能或来源目录不存在）。
 *
 * 注意两种模式的副作用不同：move 会消耗掉源目录（rename 的必然结果），
 * copy 保留源目录，由调用方在替换存档时自行删除。两条路径下回档点内容都完整。
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
  // 两种模式下回档点布局保持一致：<回档点>/<dataDirName>/ 与 <回档点>/<regFileName>
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

  // 注册表无法随目录一起搬走，单独导出到回档点内
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

/** 用某个回档点覆盖当前存档（“撤销本次恢复”的底层实现）。 */
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
