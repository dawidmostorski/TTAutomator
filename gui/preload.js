const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    getDevices: () => ipcRenderer.invoke('get-devices'),
    startBot: (config) => ipcRenderer.send('start-bot', config),
    stopBot: (deviceId) => ipcRenderer.send('stop-bot', deviceId),
    startUnfollow: (config) => ipcRenderer.send('start-unfollow', config),

    // Konfiguracja per device
    getDeviceConfig: (deviceId) => ipcRenderer.invoke('get-device-config', deviceId),
    saveDeviceConfig: (deviceId, config) => ipcRenderer.invoke('save-device-config', deviceId, config),
    getAllDeviceConfigs: () => ipcRenderer.invoke('get-all-device-configs'),

    // Listenery
    onConsoleLog: (callback) => ipcRenderer.on('console-log', (event, text) => callback(text)),
    onStatusUpdate: (callback) => ipcRenderer.on('status-update', (event, data) => callback(data)),
    onStatsUpdate: (callback) => ipcRenderer.on('stats-update', (event, type) => callback(type)),
    onDeviceStatus: (callback) => ipcRenderer.on('device-status', (event, data) => callback(data)),
    onAppiumStatus: (callback) => ipcRenderer.on('appium-status', (event, data) => callback(data)),
    onUnfollowComplete: (callback) => ipcRenderer.on('unfollow-complete', (event, data) => callback(data)),

    // Upload
    selectFolder: () => ipcRenderer.invoke('select-folder'),
    scanVideoFolder: (folderPath) => ipcRenderer.invoke('scan-video-folder', folderPath),
    startUpload: (config) => ipcRenderer.send('start-upload', config),
    stopUpload: (deviceId) => ipcRenderer.send('stop-upload', deviceId),
    onUploadProgress: (callback) => ipcRenderer.on('upload-progress', (event, data) => callback(data)),
    onUploadStatus: (callback) => ipcRenderer.on('upload-status', (event, data) => callback(data)),
});
