// Documentation-only fixtures. This preload never loads personal settings,
// invokes ADB/Appium, calls OpenAI, or starts a worker process.
const { contextBridge } = require('electron');

const devices = [
    { id: 'DEMO-01', model: 'Android 14' },
    { id: 'DEMO-02', model: 'Android 13' },
    { id: 'DEMO-03', model: 'Android 12' }
];
const defaultConfig = {
    mode: 'feed', tag: '', probLike: 0.7, probComment: 0.4, probFollow: 0.3,
    probReply: 0.35, workTime: 120, sleepTime: 60, commentMode: 'ai',
    likeEnabled: true, commentEnabled: true, followEnabled: true, replyEnabled: true,
    aiPrompt: 'Komentuj krótko i naturalnie, po polsku. Odnoś się do treści filmu.',
    staticComments: '', replyPrompt: '',
    followY: 54, likeY: 60.5, commentY: 66, sendButtonY: 61
};
const configs = Object.fromEntries(devices.map((device, index) => [
    device.id, { ...defaultConfig, nickname: `Android ${String(index + 1).padStart(2, '0')}` }
]));
const demoFolder = 'C:\\TTAutomator\\examples\\videos';
const unavailable = () => { throw new Error('Documentation preview cannot control devices.'); };

contextBridge.exposeInMainWorld('api', {
    getDevices: async () => devices,
    getDeviceConfig: async deviceId => configs[deviceId] || defaultConfig,
    getAllDeviceConfigs: async () => configs,
    saveDeviceConfig: async () => false,
    startBot: unavailable,
    stopBot: unavailable,
    startUnfollow: unavailable,
    selectFolder: async () => demoFolder,
    scanVideoFolder: async () => [
        { filename: '01-morning-routine.mp4', hasConfig: true },
        { filename: '02-workout-session.mp4', hasConfig: true },
        { filename: '03-city-walk.mp4', hasConfig: false }
    ].map(video => ({ ...video, fullPath: demoFolder + '\\' + video.filename })),
    startUpload: unavailable,
    stopUpload: unavailable,
    onConsoleLog: callback => queueMicrotask(() => callback('Tryb dokumentacji: urządzenia DEMO, bez połączenia ADB.')),
    onStatusUpdate: () => {},
    onStatsUpdate: () => {},
    onDeviceStatus: () => {},
    onAppiumStatus: () => {},
    onUnfollowComplete: () => {},
    onUploadProgress: () => {},
    onUploadStatus: () => {}
});
