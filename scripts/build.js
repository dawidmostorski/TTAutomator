const path = require('path');

// Only these project files may enter a distributable. Local configuration,
// screenshots, logs and old builds are deliberately absent from this list.
const applicationFiles = new Set([
    'package.json',
    'LICENSE',
    'README.md',
    '.env.example',
    'device_configs.example.json',
    'comments_config.example.json',
    'ai.js',
    'bot.js',
    'db.js',
    'publisher.js',
    'unfollow.js',
    'gui/index.html',
    'gui/main.js',
    'gui/preload.js',
    'gui/renderer.js',
    'prompt_fitness.txt',
    'prompt_humor.txt',
    'prompt_odpowiedzi.txt',
    'examples/video.txt'
]);

function shouldPackagePath(filename) {
    const relative = filename.replace(/\\/g, '/').replace(/^\/+/, '');
    if (relative === '' || relative === 'gui' || relative === 'examples') return true;
    if (relative === 'node_modules') return true;
    if (relative.startsWith('node_modules/')) {
        return !/^node_modules\/(appium|appium-uiautomator2-driver)(\/|$)/.test(relative);
    }
    return applicationFiles.has(relative);
}

const buildOptions = {
    dir: path.join(__dirname, '..'),
    name: 'TTAutomator',
    executableName: 'TTAutomator',
    platform: 'win32',
    arch: 'x64',
    out: path.join(__dirname, '..', 'dist'),
    overwrite: true,
    prune: true,
    ignore: filename => !shouldPackagePath(filename)
};

if (require.main === module) {
    require('electron-packager')(buildOptions).then(appPaths => {
        appPaths.forEach(appPath => console.log(`Built TTAutomator: ${appPath}`));
    }).catch(error => {
        console.error(`Build failed: ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = { applicationFiles, buildOptions, shouldPackagePath };
