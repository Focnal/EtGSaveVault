import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import path from 'node:path'
import type {
  AppConfig,
  BackupProgress,
  CreateResult,
  GameSettings,
  RestoreResult,
  RollbackList,
  RollbackRestoreResult,
  Workspace,
  WorkspaceScan
} from '../shared/types'
import * as backups from './backups'
import * as rollback from './rollback'
import { addWorkspace, getConfig, getWorkspace, removeWorkspace, updateGame } from './store'
import * as sys from './sys'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 980,
    minHeight: 620,
    title: 'EtG Save Vault',
    backgroundColor: '#101318',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (devUrl) {
    void win.loadURL(devUrl)
  } else {
    void win.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

function requireWorkspace(id: string): Workspace {
  const ws = getWorkspace(id)
  if (!ws) throw new Error('工作区不存在或已被移除')
  return ws
}

function progressSender(e: Electron.IpcMainInvokeEvent, workspaceId: string): backups.ProgressFn {
  return (p) => {
    const payload: BackupProgress = { workspaceId, ...p }
    if (!e.sender.isDestroyed()) e.sender.send('vault:progress', payload)
  }
}

function registerIpc(): void {
  ipcMain.handle('vault:config:get', (): AppConfig => getConfig())

  ipcMain.handle('vault:config:updateGame', (_e, patch: Partial<GameSettings>): AppConfig => {
    updateGame(patch ?? {})
    return getConfig()
  })

  ipcMain.handle('vault:workspace:add', async (e): Promise<AppConfig> => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const res = await dialog.showOpenDialog(win as BrowserWindow, {
      title: '选择工作区目录',
      properties: ['openDirectory', 'createDirectory']
    })
    if (!res.canceled && res.filePaths[0]) addWorkspace(res.filePaths[0])
    return getConfig()
  })

  ipcMain.handle('vault:workspace:remove', (_e, id: string): AppConfig => {
    removeWorkspace(id)
    return getConfig()
  })

  ipcMain.handle('vault:backup:list', async (_e, workspaceId: string): Promise<WorkspaceScan> => {
    const ws = requireWorkspace(workspaceId)
    const r = await backups.listBackups(ws, getConfig().game)
    return { workspaceId, ...r }
  })

  ipcMain.handle('vault:backup:detail', (_e, workspaceId: string, name: string) => {
    return backups.backupDetail(requireWorkspace(workspaceId), getConfig().game, name)
  })

  ipcMain.handle(
    'vault:backup:create',
    async (e, args: { workspaceId: string; name: string; note: string; overwrite: boolean }): Promise<CreateResult> => {
      const ws = requireWorkspace(args.workspaceId)
      return backups.createBackup(ws, getConfig().game, args.name, args.note ?? '', !!args.overwrite, progressSender(e, ws.id))
    }
  )

  ipcMain.handle(
    'vault:backup:restore',
    async (e, args: { workspaceId: string; name: string }): Promise<RestoreResult> => {
      const ws = requireWorkspace(args.workspaceId)
      return backups.restoreBackup(ws, getConfig().game, args.name, progressSender(e, ws.id))
    }
  )

  ipcMain.handle('vault:backup:delete', (_e, args: { workspaceId: string; name: string }) => {
    return backups.deleteBackup(requireWorkspace(args.workspaceId), args.name)
  })

  ipcMain.handle('vault:backup:rename', (_e, args: { workspaceId: string; name: string; newName: string }) => {
    return backups.renameBackup(requireWorkspace(args.workspaceId), args.name, args.newName)
  })

  ipcMain.handle('vault:backup:setNote', (_e, args: { workspaceId: string; name: string; note: string }) => {
    return backups.setNote(requireWorkspace(args.workspaceId), args.name, args.note ?? '')
  })

  ipcMain.handle('vault:shell:openPath', (_e, p: string) => shell.openPath(p))

  ipcMain.handle('vault:rollback:list', (): Promise<RollbackList> => rollback.list(getConfig().game))

  ipcMain.handle('vault:rollback:restore', async (_e, id: string): Promise<RollbackRestoreResult> => {
    const game = getConfig().game
    const r = await rollback.restorePoint(game, id)
    return { ...r, points: (await rollback.list(game)).points }
  })

  ipcMain.handle('vault:rollback:remove', async (_e, id: string): Promise<RollbackList> => {
    const game = getConfig().game
    await rollback.removePoint(game, id)
    return rollback.list(game)
  })

  ipcMain.handle('vault:rollback:clear', async (): Promise<RollbackList> => {
    const game = getConfig().game
    await rollback.clearPoints(game)
    return rollback.list(game)
  })

  ipcMain.handle('vault:game:status', async () => ({
    running: await sys.isGameRunning(getConfig().game.processName)
  }))

  ipcMain.handle('vault:game:kill', async () => ({
    killed: await sys.killGame(getConfig().game.processName)
  }))

  ipcMain.handle('vault:dialog:pickDirectory', async (e, opts?: { title?: string }) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const res = await dialog.showOpenDialog(win as BrowserWindow, {
      title: opts?.title ?? '选择目录',
      properties: ['openDirectory', 'createDirectory']
    })
    return res.canceled ? null : res.filePaths[0]
  })
}

void app.whenReady().then(() => {
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
