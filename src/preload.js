const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // main -> renderer
  onOpen: (cb) => ipcRenderer.on('overlay:open', (_e, config) => cb(config)),
  onHide: (cb) => ipcRenderer.on('overlay:hide', () => cb()),
  onSettings: (cb) => ipcRenderer.on('overlay:settings', (_e, data) => cb(data)),
  onEditMode: (cb) => ipcRenderer.on('overlay:editmode', () => cb()),
  // renderer -> main
  doHide: () => ipcRenderer.send('overlay:doHide'),
  runAction: (action) => ipcRenderer.send('action:run', action),
  // editor
  setEditMode: (on) => ipcRenderer.send('edit:setMode', on),
  saveConfig: (config) => ipcRenderer.invoke('config:save', config),
  pickFile: () => ipcRenderer.invoke('dialog:pickFile'),
  pickImage: () => ipcRenderer.invoke('dialog:pickImage'),
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  // configurações
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setHotkey: (accel) => ipcRenderer.invoke('settings:setHotkey', accel),
  setAutostart: (on) => ipcRenderer.invoke('settings:setAutostart', on)
});
