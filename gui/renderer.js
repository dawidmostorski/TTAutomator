// renderer.js - TTAutomator

const consoleOut = document.getElementById('console-output');
const devicesContainer = document.getElementById('devices-container');
const btnScan = document.getElementById('btn-scan-devices');
const btnStopAll = document.getElementById('btn-stop-all');

// Stan Farmy
const farmState = new Map();
const globalStats = { watched: 0, likes: 0, follows: 0, comments: 0 };

// Aktualnie edytowane urządzenie w modalu
let currentEditDevice = null;

// ===== INICJALIZACJA =====
document.addEventListener('DOMContentLoaded', () => {
    setupSliders();
    setupModalSliders();
    setupModal();
    setupNavTabs();
    setupUploadTab();
    setupUnfollow();

    if (btnScan) btnScan.addEventListener('click', refreshDevices);
    if (btnStopAll) btnStopAll.addEventListener('click', () => {
        logToUi('⏹️ Zatrzymywanie wszystkich botów...');
        window.api.stopBot(); // bez deviceId = stop all
    });

    // Auto-scan
    setTimeout(refreshDevices, 1000);
});

// ===== NAWIGACJA ZAKŁADEK =====
function setupNavTabs() {
    const navTabs = document.querySelectorAll('.nav-tab');

    navTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            // Usuń active z wszystkich zakładek
            navTabs.forEach(t => t.classList.remove('active'));
            // Dodaj active do klikniętej
            tab.classList.add('active');

            // Przełącz stronę
            const pageName = tab.getAttribute('data-page');
            document.querySelectorAll('.page').forEach(page => {
                page.classList.remove('active');
            });

            const targetPage = document.getElementById(`page-${pageName}`);
            if (targetPage) targetPage.classList.add('active');
        });
    });
}

// ===== UNFOLLOW =====
function setupUnfollow() {
    const btnUnfollow = document.getElementById('btn-unfollow');
    if (btnUnfollow) {
        btnUnfollow.addEventListener('click', () => {
            const deviceId = document.getElementById('unfollow-device')?.value;
            const daysOld = document.getElementById('unfollow-days')?.value || 3;
            const maxUnfollows = document.getElementById('unfollow-max')?.value || 10;

            if (!deviceId) {
                logToUi('❌ Wybierz urządzenie przed uruchomieniem Unfollow!');
                return;
            }

            logToUi(`🗑️ [${deviceId.slice(0, 5)}] Uruchamiam Unfollow (dni: ${daysOld}, max: ${maxUnfollows})...`);
            window.api.startUnfollow({ daysOld, maxUnfollows, deviceId });
        });
    }
}

function updateUnfollowDeviceSelect(devices) {
    const select = document.getElementById('unfollow-device');
    if (!select) return;

    select.innerHTML = '<option value="">Wybierz urządzenie...</option>';
    devices.forEach(device => {
        const deviceId = typeof device === 'string' ? device : device.id;
        const model = typeof device === 'string' ? '' : (device.model || '');
        const option = document.createElement('option');
        option.value = deviceId;
        option.textContent = `📱 ${deviceId}${model ? ' · ' + model : ''}`;
        select.appendChild(option);
    });
}

// ===== URZĄDZENIA =====
async function refreshDevices() {
    if (!window.api.getDevices) return;

    if (devicesContainer) {
        devicesContainer.innerHTML = '<div class="device-placeholder">Skanowanie ADB...</div>';
    }

    try {
        const devices = await window.api.getDevices();
        console.log('Znalezione urządzenia:', devices);
        renderDevices(devices);
        updateUnfollowDeviceSelect(devices); // Aktualizuj select na stronie Unfollow

        // Populate upload device dropdown
        const uploadDeviceSelect = document.getElementById('upload-device');
        if (uploadDeviceSelect) {
            const allConfigs = await window.api.getAllDeviceConfigs();
            uploadDeviceSelect.innerHTML = '<option value="">Wybierz urządzenie</option>';
            devices.forEach(d => {
                const config = allConfigs[d.id] || {};
                const label = config.nickname ? `${config.nickname} (${d.model})` : `${d.id} (${d.model})`;
                uploadDeviceSelect.innerHTML += `<option value="${d.id}">${label}</option>`;
            });
        }
    } catch (e) {
        logToUi(`Błąd skanowania: ${e.message}`);
    }
}

function renderDevices(devices) {
    if (!devices || devices.length === 0) {
        devicesContainer.innerHTML = '<div class="device-placeholder">Brak urządzeń. Kliknij "Skanuj ADB".</div>';
        return;
    }

    devicesContainer.innerHTML = '';

    devices.forEach(device => {
        // Obsługa starego formatu (string) i nowego ({id, model})
        const deviceId = typeof device === 'string' ? device : device.id;
        const model = typeof device === 'string' ? '' : (device.model || '');

        if (!farmState.has(deviceId)) {
            farmState.set(deviceId, {
                status: 'idle',
                text: 'Gotowy',
                model: model,
                stats: { likes: 0, follows: 0, comments: 0, watched: 0 }
            });
        } else {
            // Aktualizuj model jeśli już istniał
            farmState.get(deviceId).model = model;
        }

        const state = farmState.get(deviceId);
        createDeviceCard(deviceId, state).then(card => {
            devicesContainer.appendChild(card);
        });
    });
}

async function createDeviceCard(deviceId, state) {
    const card = document.createElement('div');
    card.className = `device-card ${state.status === 'working' ? 'running' : ''}`;
    card.id = `device-${deviceId}`;

    const statusLabel = state.status === 'working' ? 'Running' :
        state.status === 'stopping' ? 'Stopping' :
            state.status === 'sleeping' ? 'Sleeping' : 'Idle';

    // Pobierz nickname z zapisanej konfiguracji
    let nickname = '';
    try {
        const config = await window.api.getDeviceConfig(deviceId);
        nickname = config.nickname || '';
    } catch (e) {}

    const model = state.model || '';

    card.innerHTML = `
        <div class="device-header">
            <div class="device-name-block">
                ${nickname ? `<span class="device-nickname">${nickname}</span>` : ''}
                <span class="device-name">📱 ${deviceId}${model ? ` <span class="device-model-label">· ${model}</span>` : ''}</span>
            </div>
            <span class="device-status ${state.status === 'working' ? 'running' : state.status === 'sleeping' ? 'sleeping' : state.status}">
                <span class="device-status-dot"></span>
                ${statusLabel}
            </span>
        </div>
        <div class="device-stats">
            <div class="device-stat">
                <span class="device-stat-value watched">${state.stats.watched}</span>
                <span class="device-stat-label">Watched</span>
            </div>
            <div class="device-stat">
                <span class="device-stat-value likes">${state.stats.likes}</span>
                <span class="device-stat-label">Likes</span>
            </div>
            <div class="device-stat">
                <span class="device-stat-value follows">${state.stats.follows}</span>
                <span class="device-stat-label">Follows</span>
            </div>
            <div class="device-stat">
                <span class="device-stat-value comments">${state.stats.comments}</span>
                <span class="device-stat-label">Comments</span>
            </div>
        </div>
        <div class="device-text" id="text-${deviceId}">${state.text || ''}</div>
        <div class="device-actions">
            <button class="btn btn-secondary btn-settings" data-device="${deviceId}">⚙️ Ustawienia</button>
            ${state.status === 'working' || state.status === 'stopping' || state.status === 'sleeping' ?
            `<button class="btn btn-danger btn-stop" data-device="${deviceId}">⏹️ Stop</button>` :
            `<button class="btn btn-primary btn-start" data-device="${deviceId}">▶️ Start</button>`
        }
        </div>
    `;

    // Event listeners
    card.querySelector('.btn-settings').addEventListener('click', () => openDeviceSettings(deviceId));

    const startBtn = card.querySelector('.btn-start');
    const stopBtn = card.querySelector('.btn-stop');

    if (startBtn) startBtn.addEventListener('click', () => startDevice(deviceId));
    if (stopBtn) stopBtn.addEventListener('click', () => stopDevice(deviceId));

    return card;
}

// ===== MODAL USTAWIEŃ =====
function setupModal() {
    const modal = document.getElementById('device-settings-modal');
    const closeBtn = document.getElementById('modal-close');
    const cancelBtn = document.getElementById('modal-cancel');
    const saveBtn = document.getElementById('modal-save');

    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeModal);
    if (saveBtn) saveBtn.addEventListener('click', saveDeviceSettings);

    // Zamknij modal po kliknięciu w tło
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal();
        });
    }

    // Pokaż/ukryj kontenery w zależności od trybu pracy
    const modeSelect = document.getElementById('modal-mode');
    if (modeSelect) {
        modeSelect.addEventListener('change', (e) => {
            const mode = e.target.value;
            const tagContainer = document.getElementById('modal-tag-container');
            const repliesContainer = document.getElementById('modal-replies-container');

            // Tag container - tylko dla trybu 'tags'
            if (tagContainer) tagContainer.style.display = mode === 'tags' ? 'block' : 'none';

            // Replies container - tylko dla trybu 'replies'
            if (repliesContainer) repliesContainer.style.display = mode === 'replies' ? 'block' : 'none';
        });
    }

    // Tryb komentarzy (AI / Lista)
    const commentModeSelect = document.getElementById('modal-comment-mode');
    if (commentModeSelect) {
        commentModeSelect.addEventListener('change', updateCommentModeVisibility);
    }
}

function updateCommentModeVisibility() {
    const mode = document.getElementById('modal-comment-mode').value;
    const aiContainer = document.getElementById('modal-ai-container');
    const listContainer = document.getElementById('modal-list-container');

    if (aiContainer) aiContainer.style.display = mode === 'ai' ? 'block' : 'none';
    if (listContainer) listContainer.style.display = mode === 'list' ? 'block' : 'none';
}

function setupModalSliders() {
    ['like', 'comment', 'follow', 'reply'].forEach(type => {
        const slider = document.getElementById(`modal-prob-${type}`);
        const display = document.getElementById(`modal-val-${type}`);
        const checkbox = document.getElementById(`modal-check-${type}`);

        if (slider && display) {
            slider.addEventListener('input', (e) => {
                display.innerText = `${Math.round(e.target.value * 100)}%`;
            });
        }

        // Checkbox toggle slider
        if (checkbox && slider && display) {
            checkbox.addEventListener('change', (e) => {
                slider.disabled = !e.target.checked;
                slider.style.opacity = e.target.checked ? '1' : '0.5';
                if (!e.target.checked) {
                    display.innerText = '0% (Wył)';
                } else {
                    display.innerText = `${Math.round(slider.value * 100)}%`;
                }
            });
        }
    });
}

async function openDeviceSettings(deviceId) {
    currentEditDevice = deviceId;

    // Pobierz zapisaną konfigurację dla tego urządzenia
    const config = await window.api.getDeviceConfig(deviceId);

    // Wypełnij modal danymi
    const model = farmState.has(deviceId) ? (farmState.get(deviceId).model || '') : '';
    document.getElementById('modal-device-name').innerText = deviceId + (model ? ' · ' + model : '');
    document.getElementById('modal-nickname').value = config.nickname || '';
    document.getElementById('modal-mode').value = config.mode || 'feed';
    document.getElementById('modal-tag').value = config.tag || '';
    document.getElementById('modal-prob-like').value = config.probLike || 0.7;
    document.getElementById('modal-val-like').innerText = `${Math.round((config.probLike || 0.7) * 100)}%`;
    document.getElementById('modal-prob-comment').value = config.probComment || 0.4;
    document.getElementById('modal-val-comment').innerText = `${Math.round((config.probComment || 0.4) * 100)}%`;
    document.getElementById('modal-prob-follow').value = config.probFollow || 0.3;
    document.getElementById('modal-val-follow').innerText = `${Math.round((config.probFollow || 0.3) * 100)}%`;

    // Replies mode
    document.getElementById('modal-prob-reply').value = config.probReply || 0.35;
    document.getElementById('modal-val-reply').innerText = `${Math.round((config.probReply || 0.35) * 100)}%`;
    document.getElementById('modal-reply-prompt').value = config.replyPrompt || '';

    // Checkboxy enabled/disabled
    const likeEnabled = config.likeEnabled !== false;
    const commentEnabled = config.commentEnabled !== false;
    const followEnabled = config.followEnabled !== false;
    const replyEnabled = config.replyEnabled !== false;

    document.getElementById('modal-check-like').checked = likeEnabled;
    document.getElementById('modal-check-comment').checked = commentEnabled;
    document.getElementById('modal-check-follow').checked = followEnabled;
    document.getElementById('modal-check-reply').checked = replyEnabled;

    // Aktualizuj stan sliderów na podstawie checkboxów
    ['like', 'comment', 'follow', 'reply'].forEach(type => {
        const checkbox = document.getElementById(`modal-check-${type}`);
        const slider = document.getElementById(`modal-prob-${type}`);
        const display = document.getElementById(`modal-val-${type}`);
        if (checkbox && slider && display) {
            slider.disabled = !checkbox.checked;
            slider.style.opacity = checkbox.checked ? '1' : '0.5';
            if (!checkbox.checked) display.innerText = '0% (Wył)';
        }
    });

    document.getElementById('modal-ai-prompt').value = config.aiPrompt || 'Jesteś luźnym użytkownikiem TikToka. Komentuj krótko, naturalnie, po polsku.';
    document.getElementById('modal-static-comments').value = config.staticComments || '';
    document.getElementById('modal-comment-mode').value = config.commentMode || 'ai';
    document.getElementById('modal-work-time').value = config.workTime || 120;
    document.getElementById('modal-sleep-time').value = config.sleepTime || 60;

    // Kalibracja współrzędnych
    document.getElementById('modal-cal-follow').value = config.followY ?? 54;
    document.getElementById('modal-cal-like').value = config.likeY ?? 60.5;
    document.getElementById('modal-cal-comment').value = config.commentY ?? 66;
    document.getElementById('modal-cal-send').value = config.sendButtonY ?? 61;

    // Pokaż/ukryj kontenery w zależności od trybu
    const mode = config.mode || 'feed';
    const tagContainer = document.getElementById('modal-tag-container');
    const repliesContainer = document.getElementById('modal-replies-container');

    if (tagContainer) tagContainer.style.display = mode === 'tags' ? 'block' : 'none';
    if (repliesContainer) repliesContainer.style.display = mode === 'replies' ? 'block' : 'none';

    // Pokaż/ukryj AI/List container w zależności od trybu komentarzy
    updateCommentModeVisibility();

    // Pokaż modal
    document.getElementById('device-settings-modal').style.display = 'flex';
}

function closeModal() {
    document.getElementById('device-settings-modal').style.display = 'none';
    currentEditDevice = null;
}

async function saveDeviceSettings() {
    if (!currentEditDevice) return;

    // Pobierz stan checkboxów
    const likeEnabled = document.getElementById('modal-check-like').checked;
    const commentEnabled = document.getElementById('modal-check-comment').checked;
    const followEnabled = document.getElementById('modal-check-follow').checked;
    const replyEnabled = document.getElementById('modal-check-reply').checked;

    const config = {
        nickname: document.getElementById('modal-nickname').value.trim(),
        mode: document.getElementById('modal-mode').value,
        tag: document.getElementById('modal-tag').value,
        probLike: likeEnabled ? parseFloat(document.getElementById('modal-prob-like').value) : 0,
        probComment: commentEnabled ? parseFloat(document.getElementById('modal-prob-comment').value) : 0,
        probFollow: followEnabled ? parseFloat(document.getElementById('modal-prob-follow').value) : 0,
        probReply: replyEnabled ? parseFloat(document.getElementById('modal-prob-reply').value) : 0,
        likeEnabled: likeEnabled,
        commentEnabled: commentEnabled,
        followEnabled: followEnabled,
        replyEnabled: replyEnabled,
        commentMode: document.getElementById('modal-comment-mode').value,
        aiPrompt: document.getElementById('modal-ai-prompt').value,
        staticComments: document.getElementById('modal-static-comments').value,
        replyPrompt: document.getElementById('modal-reply-prompt').value,
        workTime: parseInt(document.getElementById('modal-work-time').value),
        sleepTime: parseInt(document.getElementById('modal-sleep-time').value),
        // Kalibracja współrzędnych
        followY: parseFloat(document.getElementById('modal-cal-follow').value),
        likeY: parseFloat(document.getElementById('modal-cal-like').value),
        commentY: parseFloat(document.getElementById('modal-cal-comment').value),
        sendButtonY: parseFloat(document.getElementById('modal-cal-send').value)
    };

    const result = await window.api.saveDeviceConfig(currentEditDevice, config);

    if (result) {
        logToUi(`✅ Ustawienia zapisane dla ${currentEditDevice.slice(0, 8)}...`);
    } else {
        logToUi(`❌ Błąd zapisu ustawień dla ${currentEditDevice.slice(0, 8)}...`);
    }

    closeModal();
}

// ===== START / STOP =====
async function startDevice(deviceId) {
    // Pobierz config zapisany dla tego urządzenia (lub domyślny)
    const savedConfig = await window.api.getDeviceConfig(deviceId);

    // Użyj też globalnych ustawień z sidebara jako fallback
    const globalConfig = getGlobalConfig();

    const config = {
        ...globalConfig,
        ...savedConfig,
        deviceId: deviceId,
        devices: [deviceId]
    };

    console.log(`Uruchamianie ${deviceId}...`, config);
    window.api.startBot(config);

    // Optimistic update
    updateDeviceState(deviceId, { status: 'working', text: 'Startowanie...' });
}

function stopDevice(deviceId) {
    window.api.stopBot(deviceId);
    updateDeviceState(deviceId, { status: 'stopping', text: 'Zatrzymywanie...' });
}

function getGlobalConfig() {
    const getProb = (type) => {
        const checkbox = document.getElementById(`check-${type}`);
        const slider = document.getElementById(`prob-${type}`);
        return checkbox && checkbox.checked ? parseFloat(slider.value) : 0;
    };

    let commentMode = 'ai';
    const tabBtnAI = document.getElementById('tab-btn-ai');
    if (tabBtnAI && tabBtnAI.classList.contains('active')) commentMode = 'ai';
    else commentMode = 'list';

    return {
        mode: document.getElementById('mode')?.value || 'feed',
        tag: document.getElementById('tag')?.value || '',
        probLike: getProb('like'),
        probComment: getProb('comment'),
        probFollow: getProb('follow'),
        workTime: parseInt(document.getElementById('time-work')?.value || 120),
        sleepTime: parseInt(document.getElementById('time-sleep')?.value || 60),
        commentMode: commentMode,
        aiPrompt: document.getElementById('ai-prompt')?.value || '',
        staticComments: document.getElementById('comments-list')?.value || ''
    };
}

// ===== AKTUALIZACJA STANU =====
function updateDeviceState(deviceId, newState) {
    if (!farmState.has(deviceId)) {
        farmState.set(deviceId, {
            status: 'idle',
            text: '',
            stats: { likes: 0, follows: 0, comments: 0, watched: 0 }
        });
    }

    const current = farmState.get(deviceId);

    if (newState.status) current.status = newState.status;
    if (newState.text) current.text = newState.text;

    if (newState.statsUpdate) {
        const type = newState.statsUpdate;
        if (current.stats[type] !== undefined) current.stats[type]++;
        if (globalStats[type] !== undefined) globalStats[type]++;
        updateGlobalStatsDisplay();
    }

    // Aktualizuj kartę urządzenia
    updateDeviceCard(deviceId, current);
}

function updateDeviceCard(deviceId, state) {
    const card = document.getElementById(`device-${deviceId}`);
    if (!card) return;

    // Aktualizuj klasę karty
    card.className = `device-card ${state.status === 'working' ? 'running' : ''}`;

    // Aktualizuj status
    const statusLabel = state.status === 'working' ? 'Running' :
        state.status === 'stopping' ? 'Stopping' :
            state.status === 'sleeping' ? 'Sleeping' : 'Idle';
    const statusEl = card.querySelector('.device-status');
    if (statusEl) {
        statusEl.className = `device-status ${state.status === 'working' ? 'running' : state.status === 'sleeping' ? 'sleeping' : state.status}`;
        statusEl.innerHTML = `<span class="device-status-dot"></span>${statusLabel}`;
    }

    // Aktualizuj statystyki
    const watchedEl = card.querySelector('.device-stat-value.watched');
    const likesEl = card.querySelector('.device-stat-value.likes');
    const followsEl = card.querySelector('.device-stat-value.follows');
    const commentsEl = card.querySelector('.device-stat-value.comments');

    if (watchedEl) watchedEl.innerText = state.stats.watched;
    if (likesEl) likesEl.innerText = state.stats.likes;
    if (followsEl) followsEl.innerText = state.stats.follows;
    if (commentsEl) commentsEl.innerText = state.stats.comments;

    // Aktualizuj tekst statusu
    const textEl = document.getElementById(`text-${deviceId}`);
    if (textEl) textEl.innerText = state.text || '';

    // Aktualizuj przyciski
    const actionsEl = card.querySelector('.device-actions');
    if (actionsEl) {
        const settingsBtn = actionsEl.querySelector('.btn-settings');
        actionsEl.innerHTML = '';

        const newSettingsBtn = document.createElement('button');
        newSettingsBtn.className = 'btn btn-secondary btn-settings';
        newSettingsBtn.setAttribute('data-device', deviceId);
        newSettingsBtn.innerText = '⚙️ Ustawienia';
        newSettingsBtn.addEventListener('click', () => openDeviceSettings(deviceId));
        actionsEl.appendChild(newSettingsBtn);

        if (state.status === 'working' || state.status === 'stopping' || state.status === 'sleeping') {
            const stopBtn = document.createElement('button');
            stopBtn.className = 'btn btn-danger btn-stop';
            stopBtn.setAttribute('data-device', deviceId);
            stopBtn.innerText = '⏹️ Stop';
            stopBtn.addEventListener('click', () => stopDevice(deviceId));
            actionsEl.appendChild(stopBtn);
        } else {
            const startBtn = document.createElement('button');
            startBtn.className = 'btn btn-primary btn-start';
            startBtn.setAttribute('data-device', deviceId);
            startBtn.innerText = '▶️ Start';
            startBtn.addEventListener('click', () => startDevice(deviceId));
            actionsEl.appendChild(startBtn);
        }
    }
}

function updateGlobalStatsDisplay() {
    const updateEl = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.innerText = value;
    };

    updateEl('global-likes', globalStats.likes);
    updateEl('global-follows', globalStats.follows);
    updateEl('global-comments', globalStats.comments);
    updateEl('global-replies', globalStats.replies || 0);
    updateEl('global-watched', globalStats.watched);
}

// ===== IPC LISTENERY =====
if (window.api) {
    window.api.onDeviceStatus((data) => {
        updateDeviceState(data.deviceId, { status: data.status, text: data.text });
    });

    window.api.onStatsUpdate((data) => {
        if (data.deviceId && data.type) {
            updateDeviceState(data.deviceId, { statsUpdate: data.type });
        }
    });

    window.api.onConsoleLog((text) => logToUi(text));
}

// ===== HELPERS =====
function logToUi(text) {
    if (!consoleOut) return;
    const line = document.createElement('div');
    line.className = 'console-line';
    line.innerText = text;
    consoleOut.insertBefore(line, consoleOut.firstChild);

    // Limit 500 linii - usuwaj najstarsze (zapobiega memory leak po godzinach działania)
    while (consoleOut.children.length > 500) {
        consoleOut.removeChild(consoleOut.lastChild);
    }
}

function setupSliders() {
    ['like', 'comment', 'follow'].forEach(type => {
        const slider = document.getElementById(`prob-${type}`);
        const display = document.getElementById(`val-${type}`);
        const checkbox = document.getElementById(`check-${type}`);

        if (slider && display && checkbox) {
            slider.addEventListener('input', (e) => {
                display.innerText = `${Math.round(e.target.value * 100)}%`;
            });

            checkbox.addEventListener('change', (e) => {
                slider.disabled = !e.target.checked;
                slider.style.opacity = e.target.checked ? '1' : '0.5';
                if (!e.target.checked) display.innerText = '0% (Wył)';
                else display.innerText = `${Math.round(slider.value * 100)}%`;
            });
        }
    });

    // Tabs komentarzy
    const tabBtnAI = document.getElementById('tab-btn-ai');
    const tabBtnList = document.getElementById('tab-btn-list');
    const tabContentAI = document.getElementById('tab-ai');
    const tabContentList = document.getElementById('tab-list');

    if (tabBtnAI && tabBtnList) {
        tabBtnAI.addEventListener('click', () => {
            tabBtnAI.classList.add('active');
            tabBtnList.classList.remove('active');
            if (tabContentAI) tabContentAI.classList.add('active');
            if (tabContentList) tabContentList.classList.remove('active');
        });

        tabBtnList.addEventListener('click', () => {
            tabBtnList.classList.add('active');
            tabBtnAI.classList.remove('active');
            if (tabContentList) tabContentList.classList.add('active');
            if (tabContentAI) tabContentAI.classList.remove('active');
        });
    }

    // Tryb pracy
    const modeSelect = document.getElementById('mode');
    const tagContainer = document.getElementById('tag-container');
    if (modeSelect && tagContainer) {
        modeSelect.addEventListener('change', (e) => {
            tagContainer.style.display = e.target.value === 'tags' ? 'block' : 'none';
        });
        tagContainer.style.display = modeSelect.value === 'tags' ? 'block' : 'none';
    }
}

// ─── UPLOAD TAB ───

let uploadFolderPath = null;
let uploadQueue = [];

function setupUploadTab() {
    // Wybór folderu
    document.getElementById('btn-select-folder').addEventListener('click', async () => {
        const folder = await window.api.selectFolder();
        if (folder) {
            uploadFolderPath = folder;
            document.getElementById('upload-folder').value = folder;
            await refreshUploadQueue();
        }
    });

    // Odśwież kolejkę
    document.getElementById('btn-refresh-queue').addEventListener('click', async () => {
        if (uploadFolderPath) await refreshUploadQueue();
    });

    // Publikuj następny
    document.getElementById('btn-publish-next').addEventListener('click', () => {
        const deviceId = document.getElementById('upload-device').value;
        if (!deviceId) {
            logToUi('❌ Wybierz urządzenie!');
            return;
        }
        const next = uploadQueue.find(v => v.status === 'pending');
        if (!next) {
            logToUi('❌ Brak filmów do publikacji');
            return;
        }
        next.status = 'publishing';
        renderUploadQueue();

        document.getElementById('btn-publish-next').disabled = true;
        document.getElementById('btn-publish-stop').disabled = false;
        showUploadProgress(true);

        window.api.startUpload({ deviceId, videoPath: next.fullPath });
    });

    // Stop
    document.getElementById('btn-publish-stop').addEventListener('click', () => {
        const deviceId = document.getElementById('upload-device').value;
        if (deviceId) window.api.stopUpload(deviceId);
        document.getElementById('btn-publish-next').disabled = false;
        document.getElementById('btn-publish-stop').disabled = true;
        showUploadProgress(false);
    });

    // IPC listeners
    if (window.api.onUploadProgress) {
        window.api.onUploadProgress((data) => {
            if (data.done) {
                const item = uploadQueue.find(v => v.status === 'publishing');
                if (item) {
                    item.status = data.success ? 'published' : 'failed';
                    if (data.error) item.error = data.error;
                }
                renderUploadQueue();
                document.getElementById('btn-publish-next').disabled = false;
                document.getElementById('btn-publish-stop').disabled = true;
                showUploadProgress(false);
            } else if (data.step && data.total) {
                updateUploadProgress(data.step, data.total, data.label);
            }
        });
    }

    if (window.api.onUploadStatus) {
        window.api.onUploadStatus((data) => {
            logToUi(`[UPLOAD] ${data.text}`);
        });
    }
}

async function refreshUploadQueue() {
    if (!uploadFolderPath) return;
    const videos = await window.api.scanVideoFolder(uploadFolderPath);

    // Zachowaj statusy istniejących elementów
    const oldStatuses = new Map(uploadQueue.map(v => [v.filename, v.status]));

    uploadQueue = videos.map(v => ({
        ...v,
        status: oldStatuses.get(v.filename) || 'pending'
    }));

    renderUploadQueue();
    document.getElementById('btn-publish-next').disabled = uploadQueue.filter(v => v.status === 'pending').length === 0;
}

function renderUploadQueue() {
    const container = document.getElementById('upload-queue');
    if (uploadQueue.length === 0) {
        container.innerHTML = '<p style="color: var(--text-muted); text-align: center;">Brak filmów w folderze</p>';
        return;
    }

    const icons = { pending: '⏳', publishing: '🔄', published: '✅', failed: '❌' };
    const labels = { pending: 'Oczekuje', publishing: 'Publikowanie...', published: 'Opublikowany', failed: 'Błąd' };

    container.innerHTML = uploadQueue.map(v => `
        <div style="display: flex; align-items: center; padding: 8px; border-bottom: 1px solid var(--border-color); gap: 12px;">
            <span style="font-size: 1.2em;">${icons[v.status] || '⏳'}</span>
            <span style="flex: 1; color: var(--text-primary);">${v.filename}</span>
            <span style="color: ${v.status === 'failed' ? 'var(--accent-pink)' : 'var(--text-secondary)'}; font-size: 0.85em;">
                ${labels[v.status] || v.status}${v.error ? ': ' + v.error : ''}
            </span>
            ${v.hasConfig ? '<span title="Ma plik .txt" style="font-size: 0.8em;">📄</span>' : ''}
        </div>
    `).join('');
}

function showUploadProgress(show) {
    document.getElementById('upload-progress').style.display = show ? 'block' : 'none';
}

function updateUploadProgress(step, total, label) {
    document.getElementById('upload-progress-label').textContent = label || '...';
    document.getElementById('upload-progress-step').textContent = `${step}/${total}`;
    document.getElementById('upload-progress-bar').style.width = `${(step / total) * 100}%`;
}
