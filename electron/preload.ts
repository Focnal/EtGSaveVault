import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args)

const api = {
  getConfig: () => invoke('vault:config:get'),
  updateGame: (patch: unknown) => invoke('vault:config:updateGame', patch),
  addWorkspace: () => invoke('vault:workspace:add'),
  removeWorkspace: (id: string) => invoke('vault:workspace:remove', id),
  listBackups: (workspaceId: string) => invoke('vault:backup:list', workspaceId),
  backupDetail: (workspaceId: string, name: string) => invoke('vault:backup:detail', workspaceId, name),
  createBackup: (workspaceId: string, name: string, note: string, overwrite: boolean) =>
    invoke('vault:backup:create', { workspaceId, name, note, overwrite }),
  restoreBackup: (workspaceId: string, name: string) => invoke('vault:backup:restore', { workspaceId, name }),
  deleteBackup: (workspaceId: string, name: string) => invoke('vault:backup:delete', { workspaceId, name }),
  renameBackup: (workspaceId: string, name: string, newName: string) =>
    invoke('vault:backup:rename', { workspaceId, name, newName }),
  setNote: (workspaceId: string, name: string, note: string) =>
    invoke('vault:backup:setNote', { workspaceId, name, note }),
  openPath: (p: string) => invoke('vault:shell:openPath', p),
  gameStatus: () => invoke('vault:game:status'),
  killGame: () => invoke('vault:game:kill'),
  pickDirectory: (title?: string) => invoke('vault:dialog:pickDirectory', { title }),
  onProgress: (cb: (p: unknown) => void) => {
    const listener = (_e: IpcRendererEvent, p: unknown) => cb(p)
    ipcRenderer.on('vault:progress', listener)
    return () => ipcRenderer.removeListener('vault:progress', listener)
  }
}

contextBridge.exposeInMainWorld('vault', api)
