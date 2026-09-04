const PODWAFFLE_API_KEY_STORAGE = 'PodwaffleApiKey';
const PODWAFFLE_REFRESH_MS = 30000;

let podwaffleState = createPodwaffleState();
let podwaffleRefreshTimer = null;
let podwaffleIdleRequest = null;

function createPodwaffleState() {
    return {
        loaded: false,
        loading: false,
        sending: false,
        playbackState: 'stopped',
        skipBackwardSeconds: 15,
        skipForwardSeconds: 30,
        error: ''
    };
}

function normalizePodwaffleConfig() {
    config.podwaffleEnabled = Boolean(config.podwaffleEnabled);
    config.podwaffleApiUrl = config.podwaffleApiUrl || '';
}

function podwaffleApiKey() {
    return localStorage.getItem(PODWAFFLE_API_KEY_STORAGE) || '';
}

function podwaffleBaseUrl() {
    return String(config.podwaffleApiUrl || '').trim().replace(/\/+$/, '');
}

function podwaffleApiRoot() {
    const base = podwaffleBaseUrl();
    return /\/api\/v1$/i.test(base) ? base : `${base}/api/v1`;
}

function podwaffleReady() {
    return config.podwaffleEnabled && Boolean(podwaffleBaseUrl()) && Boolean(podwaffleApiKey());
}

async function podwaffleRequest(path, options = {}) {
    const headers = new Headers(options.headers || {});
    headers.set('Accept', 'application/json');
    headers.set('Authorization', `Bearer ${podwaffleApiKey()}`);
    if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    try {
        const response = await fetch(`${podwaffleApiRoot()}${path}`, {
            ...options,
            headers,
            signal: controller.signal,
            cache: 'no-store',
            credentials: 'omit'
        });
        if (!response.ok) {
            let message = `Podwaffle returned ${response.status}`;
            try {
                const body = await response.json();
                if (body?.error?.message) message = body.error.message;
                else if (body?.message) message = body.message;
            } catch {}
            throw new Error(message);
        }
        if (response.status === 204) return null;
        return response.json();
    } catch (error) {
        if (error.name === 'AbortError') throw new Error('Podwaffle request timed out');
        throw error;
    } finally {
        window.clearTimeout(timeout);
    }
}

function podwaffleSettingsStatus() {
    if (!config.podwaffleEnabled) return 'Disabled.';
    if (!podwaffleBaseUrl() || !podwaffleApiKey()) return 'Add a server URL and API key, then save.';
    if (podwaffleState.error) return `Unavailable - ${podwaffleState.error}`;
    if (podwaffleState.loaded) return `Connected - ${podwaffleState.playbackState}`;
    return 'Connects in the background after settings are saved.';
}

function renderPodwaffleSettings() {
    const enabledInput = document.getElementById('podwaffle-enabled-input');
    const urlInput = document.getElementById('podwaffle-api-url-input');
    const keyInput = document.getElementById('podwaffle-api-key-input');
    if (!enabledInput || !urlInput || !keyInput) return;
    enabledInput.checked = Boolean(config.podwaffleEnabled);
    urlInput.value = config.podwaffleApiUrl || '';
    keyInput.value = podwaffleApiKey();
    renderPodwaffleControls();
}

function renderPodwaffleControls() {
    const navbarItem = document.getElementById('podwaffle-navbar-item');
    const controls = document.getElementById('podwaffle-controls');
    const settingsStatus = document.getElementById('podwaffle-settings-status');
    if (settingsStatus) settingsStatus.textContent = podwaffleSettingsStatus();
    if (!navbarItem || !controls) return;

    const visible = podwaffleReady() && podwaffleState.loaded;
    navbarItem.hidden = !visible;
    controls.hidden = !visible;
    if (!visible) return;

    const busy = podwaffleState.loading || podwaffleState.sending;
    controls.classList.toggle('has-error', Boolean(podwaffleState.error));
    controls.dataset.state = podwaffleState.playbackState;
    controls.title = podwaffleState.error
        ? `Podwaffle unavailable - ${podwaffleState.error}`
        : `Podwaffle is ${podwaffleState.playbackState}`;

    const toggleButton = controls.querySelector('[data-podwaffle-action="toggle"]');
    const toggleIcon = toggleButton?.querySelector('i');
    const skipBackButton = controls.querySelector('[data-podwaffle-action="skip-backward"]');
    const skipForwardButton = controls.querySelector('[data-podwaffle-action="skip-forward"]');
    controls.querySelectorAll('[data-podwaffle-action]').forEach(button => {
        button.disabled = busy || Boolean(podwaffleState.error);
    });

    const playing = podwaffleState.playbackState === 'playing';
    const toggleLabel = playing ? 'Pause' : 'Play';
    if (toggleButton) {
        toggleButton.classList.toggle('is-active', playing);
        toggleButton.setAttribute('aria-pressed', String(playing));
        toggleButton.setAttribute('aria-label', toggleLabel);
        toggleButton.title = toggleLabel;
    }
    if (toggleIcon) {
        toggleIcon.className = playing ? 'fas fa-pause' : 'fas fa-play';
    }
    if (skipBackButton) {
        const label = `Skip back ${podwaffleState.skipBackwardSeconds} seconds`;
        skipBackButton.title = label;
        skipBackButton.setAttribute('aria-label', label);
    }
    if (skipForwardButton) {
        const label = `Skip forward ${podwaffleState.skipForwardSeconds} seconds`;
        skipForwardButton.title = label;
        skipForwardButton.setAttribute('aria-label', label);
    }
}

function applyPodwaffleSnapshot(snapshot) {
    const playback = snapshot && typeof snapshot.playback === 'object' ? snapshot.playback : {};
    const playbackState = ['playing', 'paused', 'stopped'].includes(playback.state) ? playback.state : 'stopped';
    const playbackSettings = snapshot?.profile?.settings?.playback;
    const configuredSkipBackward = Number(playbackSettings?.skipBackwardSeconds);
    const configuredSkipForward = Number(playbackSettings?.skipForwardSeconds);

    podwaffleState.loaded = true;
    podwaffleState.playbackState = playbackState;
    podwaffleState.skipBackwardSeconds = Number.isFinite(configuredSkipBackward)
        ? Math.max(1, Math.min(120, Math.round(configuredSkipBackward)))
        : 15;
    podwaffleState.skipForwardSeconds = Number.isFinite(configuredSkipForward)
        ? Math.max(1, Math.min(120, Math.round(configuredSkipForward)))
        : 30;
    podwaffleState.error = '';
}

async function refreshPodwaffleState() {
    if (!podwaffleReady() || podwaffleState.loading || podwaffleState.sending) return;
    podwaffleState.loading = true;
    renderPodwaffleControls();
    try {
        applyPodwaffleSnapshot(await podwaffleRequest('/snapshot'));
    } catch (error) {
        podwaffleState.error = error.message || 'Could not connect';
    } finally {
        podwaffleState.loading = false;
        renderPodwaffleControls();
        schedulePodwaffleRefresh(PODWAFFLE_REFRESH_MS);
    }
}

function clearPodwaffleSchedule() {
    if (podwaffleRefreshTimer !== null) {
        window.clearTimeout(podwaffleRefreshTimer);
        podwaffleRefreshTimer = null;
    }
    if (podwaffleIdleRequest !== null && 'cancelIdleCallback' in window) {
        window.cancelIdleCallback(podwaffleIdleRequest);
        podwaffleIdleRequest = null;
    }
}

function schedulePodwaffleRefresh(delay = 0) {
    clearPodwaffleSchedule();
    if (!podwaffleReady()) return;

    const run = () => {
        podwaffleRefreshTimer = null;
        podwaffleIdleRequest = null;
        refreshPodwaffleState();
    };

    if (delay > 0) {
        podwaffleRefreshTimer = window.setTimeout(run, delay);
    } else if ('requestIdleCallback' in window) {
        podwaffleIdleRequest = window.requestIdleCallback(run, { timeout: 2000 });
    } else {
        podwaffleRefreshTimer = window.setTimeout(run, 500);
    }
}

function resetPodwaffleState() {
    clearPodwaffleSchedule();
    podwaffleState = createPodwaffleState();
    renderPodwaffleControls();
}

function podwaffleCommandId() {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    const bytes = new Uint8Array(16);
    if (typeof crypto.getRandomValues === 'function') crypto.getRandomValues(bytes);
    else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function sendPodwaffleCommand(action) {
    if (!podwaffleReady() || !podwaffleState.loaded || podwaffleState.sending) return;
    const previousState = podwaffleState.playbackState;
    const commandAction = action === 'toggle'
        ? (previousState === 'playing' ? 'pause' : 'play')
        : action;

    podwaffleState.sending = true;
    podwaffleState.error = '';
    if (commandAction === 'play') podwaffleState.playbackState = 'playing';
    if (commandAction === 'pause') podwaffleState.playbackState = 'paused';
    renderPodwaffleControls();

    const payload = { commandId: podwaffleCommandId(), action: commandAction };
    if (commandAction === 'skip-backward') payload.offsetMs = podwaffleState.skipBackwardSeconds * 1000;
    if (commandAction === 'skip-forward') payload.offsetMs = podwaffleState.skipForwardSeconds * 1000;

    try {
        const result = await podwaffleRequest('/playback/commands', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        if (result?.status === 'pending' && !result?.delivered) {
            throw new Error('The active Podwaffle playback device is not connected');
        }
        if (['rejected', 'cancelled'].includes(result?.status)) {
            throw new Error(result?.result?.message || 'The active Podwaffle player rejected the command');
        }
    } catch (error) {
        podwaffleState.playbackState = previousState;
        podwaffleState.error = error.message || 'Command failed';
    } finally {
        podwaffleState.sending = false;
        renderPodwaffleControls();
        schedulePodwaffleRefresh(900);
    }
}

function savePodwaffleSettings() {
    config.podwaffleEnabled = document.getElementById('podwaffle-enabled-input').checked;
    config.podwaffleApiUrl = document.getElementById('podwaffle-api-url-input').value.trim().replace(/\/+$/, '');
    localStorage.setItem(PODWAFFLE_API_KEY_STORAGE, document.getElementById('podwaffle-api-key-input').value.trim());
    localStorage.setItem('PageConfig', JSON.stringify(config));
    resetPodwaffleState();
    schedulePodwaffleRefresh();
}

function wirePodwaffleIntegration() {
    document.getElementById('podwaffle-controls').addEventListener('click', event => {
        const button = event.target.closest('[data-podwaffle-action]');
        if (!button || button.disabled) return;
        sendPodwaffleCommand(button.dataset.podwaffleAction);
    });

    document.getElementById('config-btn').addEventListener('click', renderPodwaffleSettings);
    document.getElementById('save-btn').addEventListener('click', savePodwaffleSettings);
    document.getElementById('import-file-input').addEventListener('change', () => {
        window.setTimeout(() => {
            normalizePodwaffleConfig();
            resetPodwaffleState();
            renderPodwaffleSettings();
            schedulePodwaffleRefresh();
        }, 350);
    });

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && podwaffleReady()) schedulePodwaffleRefresh(250);
    });
}

function initPodwaffleIntegration() {
    normalizePodwaffleConfig();
    wirePodwaffleIntegration();
    renderPodwaffleControls();
    schedulePodwaffleRefresh();
    if ('serviceWorker' in navigator) {
        window.setTimeout(() => {
            navigator.serviceWorker.register('/sw.js?v=2.2.1').catch(() => {});
        }, 1000);
    }
}

initPodwaffleIntegration();
