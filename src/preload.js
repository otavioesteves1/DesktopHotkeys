const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // main -> renderer
  onOpen: (cb) => ipcRenderer.on('overlay:open', (_e, config) => cb(config)),
  onHide: (cb) => ipcRenderer.on('overlay:hide', () => cb()),
  // renderer -> main
  doHide: () => ipcRenderer.send('overlay:doHide'),
  runAction: (action) => ipcRenderer.send('action:run', action),
  // editor
  setEditMode: (on) => ipcRenderer.send('edit:setMode', on),
  saveConfig: (config) => ipcRenderer.invoke('config:save', config),
  pickFile: () => ipcRenderer.invoke('dialog:pickFile')
});
