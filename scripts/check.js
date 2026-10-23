const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const directories = ['', 'gui', 'scripts'];
let checked = 0;

for (const directory of directories) {
    const absolute = path.join(root, directory);
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.js') || entry.name === 'main_v5.js') continue;
        const filename = path.join(absolute, entry.name);
        const result = spawnSync(process.execPath, ['--check', filename], { stdio: 'inherit' });
        if (result.error) throw result.error;
        if (result.status !== 0) process.exit(result.status || 1);
        checked++;
    }
}

console.log(`Syntax OK: ${checked} JavaScript files. No device actions were run.`);
