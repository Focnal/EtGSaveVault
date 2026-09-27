import { app } from 'electron'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { AppConfig, GameSettings, Workspace } from '../shared/types'

export function defaultGameSettings(): GameSettings {
  const home = process.env.USERPROFILE || app.getPath('home')
  return {
    sourcePath: path.join(home, 'AppData', 'LocalLow', 'Dodge Roll', 'Enter the Gungeon'),
    registryKey: 'HKCU\\Software\\Dodge Roll\\Enter the Gungeon',
    processName: 'etg.exe',
    dataDirName: 'Enter the Gungeon',
    regFileName: 'Enter the Gungeon.reg'
  }
}

let config: AppConfig | null = null

function configPath(): string {
  return path.join(app.getPath('userData'), 'vault-config.json')
}

function normalize(raw: unknown): AppConfig {
  const data = (raw ?? {}) as Partial<AppConfig>
  const game = { ...defaultGameSettings(), ...(data.game ?? {}) }
  const workspaces = Array.isArray(data.workspaces)
    ? data.workspaces.filter((w): w is Workspace => !!w && typeof w.id === 'string' && typeof w.path === 'string')
    : []
  return { workspaces, game }
}

function save(): void {
  if (!config) return
  fs.mkdirSync(path.dirname(configPath()), { recursive: true })
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2), 'utf8')
}

export function getConfig(): AppConfig {
  if (config) return config
  try {
    config = normalize(JSON.parse(fs.readFileSync(configPath(), 'utf8')))
  } catch {
    config = { workspaces: [], game: defaultGameSettings() }
  }
  return config
}

export function addWorkspace(dirPath: string, name?: string): Workspace {
  const c = getConfig()
  const samePath = (a: string, b: string) => path.normalize(a).toLowerCase() === path.normalize(b).toLowerCase()
  const existing = c.workspaces.find((w) => samePath(w.path, dirPath))
  if (existing) return existing
  const ws: Workspace = {
    id: crypto.randomUUID(),
    name: name?.trim() || path.basename(dirPath) || dirPath,
    path: dirPath
  }
  c.workspaces.push(ws)
  save()
  return ws
}

export function removeWorkspace(id: string): void {
  const c = getConfig()
  c.workspaces = c.workspaces.filter((w) => w.id !== id)
  save()
}

export function updateGame(patch: Partial<GameSettings>): void {
  const c = getConfig()
  c.game = { ...c.game, ...patch }
  save()
}

export function getWorkspace(id: string): Workspace | null {
  return getConfig().workspaces.find((w) => w.id === id) ?? null
}
