import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
const isWin = process.platform === 'win32'

export async function exportRegistry(key: string, file: string): Promise<boolean> {
  if (!isWin) return false
  try {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await run('reg.exe', ['export', key, file, '/y'])
    return true
  } catch {
    return false
  }
}

export async function importRegistry(file: string): Promise<boolean> {
  if (!isWin) return false
  try {
    await run('reg.exe', ['import', file])
    return true
  } catch {
    return false
  }
}

export async function isGameRunning(processName: string): Promise<boolean> {
  if (!isWin) return false
  try {
    const { stdout } = await run('tasklist.exe', ['/FI', `IMAGENAME eq ${processName}`, '/NH'])
    return stdout.toLowerCase().includes(processName.toLowerCase())
  } catch {
    return false
  }
}

export async function killGame(processName: string): Promise<boolean> {
  if (!isWin) return false
  try {
    await run('taskkill.exe', ['/F', '/IM', processName])
    return true
  } catch {
    return false
  }
}
