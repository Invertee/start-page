const TODO_CACHE_KEY = 'LambdaTodoCache';
const TODO_API_KEY_STORAGE = 'LambdaTodoApiKey';
const SCHEDULE_BLOCKS_PER_DAY = 48;
const PANEL_OVERRIDE_MS = 5 * 60 * 1000;
const PANEL_OVERRIDE_CLICKS = 4;
const PANEL_CLICK_GAP_MS = 750;

let config = JSON.parse(localStorage.getItem('PageConfig')) || {
    wallpaper: './img/wp.jpg',
    weatherLat: '',
    weatherLon: '',
    openCount: 0,
    openCountDate: '',
    lambdaTodosEnabled: false,
    lambdaApiUrl: '',
    categories: [
        { title: "/dev", color: "#48c774", links: [{ name: "Github", url: "https://github.com", icon: "fa-brands fa-github" }] },
        { title: "/social", color: "#3273dc", links: [{ name: "Reddit", url: "https://reddit.com", icon: "fa-brands fa-reddit-alien" }] }
    ]
};

config.lambdaTodosEnabled = Boolean(config.lambdaTodosEnabled);
config.lambdaApiUrl = config.lambdaApiUrl || '';

const scheduledPanels = [];
const scheduleDrafts = new Map();
let scheduleCategory;

let todoState = {
    items: loadTodoCache(),
    expanded: new Set(),
    refreshing: false
};

function getTodayDateStr() {
    const d = new Date();
    return d.toISOString().slice(0, 10);
}

function updateOpenCountTag() {
    const el = document.getElementById('open-count-tag');
    if (!el) return;
    el.textContent = (config.openCount || 0).toString();
}

function ensureAndIncrementOpenCount() {
    const today = getTodayDateStr();
    if (!config.openCountDate || config.openCountDate !== today) {
        config.openCount = 0;
        config.openCountDate = today;
    }
    config.openCount = (config.openCount || 0) + 1;
    localStorage.setItem('PageConfig', JSON.stringify(config));
}

function hexToRgba(hex, alpha = 0.7) {
    hex = hex.replace(/^#/, '');
    if (hex.length === 3) hex = hex.split('').map(x => x + x).join('');
    const num = parseInt(hex, 16);
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    return `rgba(${r},${g},${b},${alpha})`;
}

function readPanelSchedule(category) {
    const schedule = category.schedule;
    const windows = Array.isArray(schedule?.windows) ? schedule.windows : [];
    return {
        enabled: schedule?.enabled === true,
        windows: windows.filter(block =>
            Number.isInteger(block?.start) && block.start >= 0 && block.start < SCHEDULE_BLOCKS_PER_DAY &&
            Number.isInteger(block.end) && block.end > 0 && block.end <= SCHEDULE_BLOCKS_PER_DAY &&
            block.start !== block.end
        )
    };
}

function updatePanelSchedule(panel, now) {
    const block = now.getHours() * 2 + Math.floor(now.getMinutes() / 30);
    const inWindow = panel.schedule.windows.some(({ start, end }) =>
        start < end ? block >= start && block < end : block >= start || block < end
    );
    const frozen = !inWindow && now.getTime() >= panel.overrideUntil;
    if (frozen === panel.frozen) return;

    const focusWasInside = panel.shortcuts.contains(document.activeElement);
    const focusWasOnButton = document.activeElement === panel.unlockButton;
    panel.frozen = frozen;
    panel.clicks = 0;
    panel.element.classList.toggle('is-frozen', frozen);
    panel.shortcuts.inert = frozen;
    panel.unlockButton.hidden = !frozen;
    if (frozen && focusWasInside) panel.unlockButton.focus({ preventScroll: true });
    if (!frozen && focusWasOnButton) panel.shortcuts.querySelector('a')?.focus({ preventScroll: true });
}

function refreshPanelSchedules() {
    const now = new Date();
    scheduledPanels.forEach(panel => updatePanelSchedule(panel, now));
}

function wirePanelSchedule(element, schedule) {
    const panel = {
        element,
        schedule,
        shortcuts: element.querySelector('.panel-shortcuts'),
        unlockButton: element.querySelector('.panel-freeze-button'),
        overrideUntil: 0,
        lastClick: 0,
        clicks: 0
    };
    scheduledPanels.push(panel);

    function handleInteraction(event) {
        const now = new Date();
        updatePanelSchedule(panel, now);
        if (!panel.frozen) return;

        if (panel.shortcuts.contains(event.target)) {
            event.preventDefault();
            return;
        }
        if (event.type !== 'click') return;

        const time = now.getTime();
        if (time - panel.lastClick > PANEL_CLICK_GAP_MS) panel.clicks = 0;
        panel.lastClick = time;
        panel.clicks++;
        if (panel.clicks === PANEL_OVERRIDE_CLICKS) {
            panel.overrideUntil = time + PANEL_OVERRIDE_MS;
            updatePanelSchedule(panel, now);
        }
    }

    for (const type of ['click', 'auxclick', 'contextmenu']) {
        element.addEventListener(type, handleInteraction, true);
    }
}

function renderPage() {
    document.getElementById('body-bg').style.backgroundImage = `url('${config.wallpaper}')`;
    const grid = document.getElementById('link-grid');
    grid.innerHTML = '';
    scheduledPanels.length = 0;

    config.categories.forEach(cat => {
        const col = document.createElement('div');
        col.className = 'column is-narrow';
        const headingBg = hexToRgba(cat.color, 0.4);
        const schedule = readPanelSchedule(cat);
        const canFreeze = schedule.enabled && cat.links.length > 0;
        col.innerHTML = `
            <nav class="panel shortcut-panel">
                <p class="panel-heading has-text-centered" style="background-color: ${headingBg};">
                    ${escapeHtml(cat.title)}
                </p>
                <div class="panel-shortcut-body">
                    <div class="panel-shortcuts">
                        ${cat.links.map(link => `
                            <a class="panel-block" href="${escapeAttribute(link.url)}">
                                <span class="panel-icon"><i class="${escapeAttribute(link.icon || 'fas fa-link')}"></i></span>
                                ${escapeHtml(link.name)}
                            </a>
                        `).join('')}
                    </div>
                    ${canFreeze ? `
                        <button type="button" class="panel-freeze-button" hidden
                            aria-label="Frozen. Activate four times to unlock for five minutes.">
                            <i class="fas fa-snowflake" aria-hidden="true"></i>
                        </button>
                    ` : ''}
                </div>
            </nav>
        `;
        grid.appendChild(col);
        if (canFreeze) wirePanelSchedule(col.firstElementChild, schedule);
    });
    refreshPanelSchedules();

    renderTodoWidget();
    fetchWeather();
    updateOpenCountTag();
}

function updateTimeandDate() {
    document.getElementById('time-btn').textContent = moment().format('MMMM Do YYYY - h:mm:ss a');
    refreshPanelSchedules();
}

async function fetchWeather() {
    if (!config.weatherLat || !config.weatherLon) {
        document.getElementById('weather-btn').textContent = "No coordinates";
        return;
    }
    try {
        const url = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${config.weatherLat}&lon=${config.weatherLon}`;
        if ('serviceWorker' in navigator && navigator.serviceWorker.ready) {
            navigator.serviceWorker.ready.then(reg => {
                if (reg && reg.active) reg.active.postMessage({ type: 'CACHE_WEATHER', url });
            }).catch(() => {});
        }
        const res = await fetch(url, {});
        const data = await res.json();
        const timeseries = data.properties.timeseries;
        const now = timeseries[0];
        const plus3h = timeseries.find(ts => {
            const diff = (new Date(ts.time) - new Date(now.time)) / (1000 * 60 * 60);
            return diff >= 3 - 0.5 && diff <= 3 + 0.5;
        });
        const plus6h = timeseries.find(ts => {
            const diff = (new Date(ts.time) - new Date(now.time)) / (1000 * 60 * 60);
            return diff >= 6 - 0.5 && diff <= 6 + 0.5;
        });

        function format(ts) {
            if (!ts) return "N/A";
            const details = ts.data.instant.details;
            let summary = `${Math.round(details.air_temperature)}°C`;
            if (details.feels_like_temperature !== undefined) {
                summary += ` (feels like ${Math.round(details.feels_like_temperature)}°C)`;
            }
            const next = ts.data.next_1_hours || ts.data.next_6_hours || ts.data.next_12_hours;
            if (next && next.summary && next.summary.symbol_code) {
                summary += `, ${next.summary.symbol_code.replace(/_/g, ' ')}`;
            }
            if (next && next.details && typeof next.details.probability_of_precipitation === "number") {
                summary += `, Rain: ${next.details.probability_of_precipitation}%`;
            }
            return summary;
        }

        document.getElementById('weather-btn').textContent = `Now: ${format(now)} | +3h: ${format(plus3h)} | +6h: ${format(plus6h)}`;
    } catch (e) {
        document.getElementById('weather-btn').textContent = " ";
    }
}

function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = String(value ?? '');
    return div.innerHTML;
}

function escapeAttribute(value) {
    return escapeHtml(value).replace(/`/g, '&#96;');
}

function loadTodoCache() {
    try {
        const cached = JSON.parse(localStorage.getItem(TODO_CACHE_KEY));
        return Array.isArray(cached?.items) ? cached.items : [];
    } catch {
        return [];
    }
}

function saveTodoCache(items) {
    try {
        localStorage.setItem(TODO_CACHE_KEY, JSON.stringify({ items, cachedAt: new Date().toISOString() }));
    } catch {}
}

function lambdaApiKey() {
    return localStorage.getItem(TODO_API_KEY_STORAGE) || '';
}

function lambdaBaseUrl() {
    return String(config.lambdaApiUrl || '').trim().replace(/\/+$/, '');
}

function lambdaReady() {
    return config.lambdaTodosEnabled && Boolean(lambdaBaseUrl()) && Boolean(lambdaApiKey());
}

async function lambdaRequest(path, options = {}) {
    const headers = new Headers(options.headers || {});
    headers.set('Authorization', `Bearer ${lambdaApiKey()}`);
    if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const response = await fetch(`${lambdaBaseUrl()}${path}`, { ...options, headers });
    if (!response.ok) {
        let message = `Lambda returned ${response.status}`;
        try {
            const body = await response.json();
            if (body?.error) message = body.error;
        } catch {}
        throw new Error(message);
    }
    if (response.status === 204) return null;
    return response.json();
}

function renderTodoWidget(message = '') {
    const widget = document.getElementById('todo-widget');
    const list = document.getElementById('todo-list');
    const status = document.getElementById('todo-status');
    if (!widget || !list || !status) return;

    widget.hidden = !config.lambdaTodosEnabled;
    if (widget.hidden) return;

    const openLambda = document.getElementById('todo-open-lambda');
    openLambda.hidden = true;
    openLambda.removeAttribute('href');
    try {
        const url = new URL(lambdaBaseUrl());
        if (url.protocol === 'https:' || url.protocol === 'http:') {
            openLambda.href = url.href;
            openLambda.hidden = false;
        }
    } catch {}

    status.textContent = message || (todoState.refreshing ? 'updating…' : `${todoState.items.length} open`);

    if (!lambdaBaseUrl() || !lambdaApiKey()) {
        list.innerHTML = '<div class="todo-empty">Configure the Lambda URL and API key in settings.</div>';
        return;
    }

    if (!todoState.items.length) {
        list.innerHTML = '<div class="todo-empty">No open to-dos.</div>';
        return;
    }

    list.innerHTML = todoState.items.map(todo => {
        const subtasks = Array.isArray(todo.subtasks) ? todo.subtasks : [];
        const expanded = todoState.expanded.has(todo.id);
        const due = todo.dueDate ? `<span class="todo-due">${escapeHtml(todo.dueDate)}</span>` : '';
        const subtaskMarkup = expanded ? `
            <div class="todo-subtasks">
                ${subtasks.map(subtask => `
                    <label class="todo-subtask-row">
                        <input type="checkbox" data-action="subtask" data-todo-id="${escapeAttribute(todo.id)}" data-subtask-id="${escapeAttribute(subtask.id)}" ${subtask.completed ? 'checked' : ''}>
                        <span class="todo-subtask-title">${escapeHtml(subtask.title)}</span>
                    </label>
                `).join('')}
                <button class="todo-action" data-action="add-subtask" data-todo-id="${escapeAttribute(todo.id)}">+ subtask</button>
            </div>
        ` : '';
        return `
            <div class="todo-item">
                <div class="todo-row">
                    <input type="checkbox" data-action="complete" data-todo-id="${escapeAttribute(todo.id)}">
                    <span class="todo-title" title="${escapeAttribute(todo.title)}">${escapeHtml(todo.title)}</span>
                    ${due}
                    <button class="todo-action" data-action="expand" data-todo-id="${escapeAttribute(todo.id)}" title="Subtasks">
                        ${expanded ? '−' : '+'}${subtasks.length ? ` ${subtasks.filter(item => item.completed).length}/${subtasks.length}` : ''}
                    </button>
                </div>
                ${subtaskMarkup}
            </div>
        `;
    }).join('');
}

async function refreshTodos() {
    if (!lambdaReady() || todoState.refreshing) return;
    todoState.refreshing = true;
    renderTodoWidget();
    try {
        const items = await lambdaRequest('/api/todos');
        todoState.items = Array.isArray(items) ? items : [];
        saveTodoCache(todoState.items);
        renderTodoWidget();
    } catch (error) {
        renderTodoWidget('offline');
        if (!todoState.items.length) {
            document.getElementById('todo-list').innerHTML = `<div class="todo-error">${escapeHtml(error.message)}</div>`;
        }
    } finally {
        todoState.refreshing = false;
        if (document.getElementById('todo-status')?.textContent !== 'offline') renderTodoWidget();
    }
}

function updateCachedTodo(updated) {
    const index = todoState.items.findIndex(item => item.id === updated.id);
    if (updated.completed) {
        if (index >= 0) todoState.items.splice(index, 1);
    } else if (index >= 0) {
        todoState.items[index] = updated;
    } else {
        todoState.items.push(updated);
    }
    saveTodoCache(todoState.items);
    renderTodoWidget();
}

function todoDueDateForChoice(choice, now = new Date()) {
    const date = new Date(now);
    const day = date.getDay();
    let offset = 0;
    if (choice === 'tomorrow') offset = 1;
    if (choice === 'end-week') offset = (5 - day + 7) % 7;
    if (choice === 'next-week') offset = (8 - day) % 7 || 7;
    date.setDate(date.getDate() + offset);
    // Lambda expects a local calendar date, without a UTC conversion.
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

async function createTodo(title, dueDate = null) {
    const created = await lambdaRequest('/api/todos', {
        method: 'POST',
        body: JSON.stringify({ title, dueDate, subtasks: [], completed: false })
    });
    updateCachedTodo(created);
}

async function completeTodo(todoId) {
    const todo = todoState.items.find(item => item.id === todoId);
    if (!todo) return;
    todoState.items = todoState.items.filter(item => item.id !== todoId);
    saveTodoCache(todoState.items);
    renderTodoWidget('saving…');
    try {
        await lambdaRequest(`/api/todos/${encodeURIComponent(todoId)}`, {
            method: 'PATCH',
            body: JSON.stringify({ completed: true })
        });
        renderTodoWidget();
    } catch (error) {
        todoState.items.push(todo);
        saveTodoCache(todoState.items);
        renderTodoWidget('save failed');
    }
}

async function addSubtask(todoId) {
    const todo = todoState.items.find(item => item.id === todoId);
    if (!todo) return;
    const title = window.prompt('Subtask');
    if (!title || !title.trim()) return;
    const subtasks = [...(todo.subtasks || []), { title: title.trim(), completed: false }];
    try {
        const updated = await lambdaRequest(`/api/todos/${encodeURIComponent(todoId)}`, {
            method: 'PATCH',
            body: JSON.stringify({ subtasks })
        });
        todoState.expanded.add(todoId);
        updateCachedTodo(updated);
    } catch (error) {
        renderTodoWidget('save failed');
    }
}

async function toggleSubtask(todoId, subtaskId, completed) {
    const todo = todoState.items.find(item => item.id === todoId);
    if (!todo) return;
    const subtasks = (todo.subtasks || []).map(item => item.id === subtaskId ? { ...item, completed } : item);
    const previous = todo.subtasks;
    todo.subtasks = subtasks;
    saveTodoCache(todoState.items);
    renderTodoWidget('saving…');
    try {
        const updated = await lambdaRequest(`/api/todos/${encodeURIComponent(todoId)}`, {
            method: 'PATCH',
            body: JSON.stringify({ subtasks })
        });
        updateCachedTodo(updated);
    } catch (error) {
        todo.subtasks = previous;
        saveTodoCache(todoState.items);
        renderTodoWidget('save failed');
    }
}

function wireTodoWidget() {
    document.getElementById('todo-add-form').addEventListener('submit', async event => {
        event.preventDefault();
        if (!lambdaReady()) return;
        const input = document.getElementById('todo-add-input');
        const dueInput = document.getElementById('todo-add-due');
        const submitButton = event.currentTarget.querySelector('button[type="submit"]');
        if (submitButton.disabled) return;
        const title = input.value.trim();
        if (!title) return;
        const dueDate = todoDueDateForChoice(dueInput.value);
        input.disabled = dueInput.disabled = submitButton.disabled = true;
        try {
            await createTodo(title, dueDate);
            input.value = '';
            dueInput.value = 'today';
        } catch (error) {
            renderTodoWidget('save failed');
        } finally {
            input.disabled = dueInput.disabled = submitButton.disabled = false;
        }
    });

    document.getElementById('todo-list').addEventListener('click', event => {
        const button = event.target.closest('[data-action="expand"], [data-action="add-subtask"]');
        if (!button) return;
        const todoId = button.dataset.todoId;
        if (button.dataset.action === 'expand') {
            if (todoState.expanded.has(todoId)) todoState.expanded.delete(todoId);
            else todoState.expanded.add(todoId);
            renderTodoWidget();
        } else {
            addSubtask(todoId);
        }
    });

    document.getElementById('todo-list').addEventListener('change', event => {
        const target = event.target;
        if (target.dataset.action === 'complete') completeTodo(target.dataset.todoId);
        if (target.dataset.action === 'subtask') toggleSubtask(target.dataset.todoId, target.dataset.subtaskId, target.checked);
    });
}

// --- Editor Logic ---
function getScheduleDraft() {
    if (!scheduleCategory) return null;
    if (!scheduleDrafts.has(scheduleCategory)) {
        scheduleDrafts.set(scheduleCategory, readPanelSchedule(scheduleCategory));
    }
    return scheduleDrafts.get(scheduleCategory);
}

function scheduleCategoryLabel(category, index) {
    return String(category.title ?? '').trim() || `Untitled panel ${index + 1}`;
}

function formatScheduleTime(block) {
    const hours = String(Math.floor(block / 2)).padStart(2, '0');
    return `${hours}:${block % 2 ? '30' : '00'}`;
}

function renderScheduleWindows() {
    const schedule = getScheduleDraft();
    const enabled = document.getElementById('schedule-enabled');
    enabled.disabled = !schedule;
    enabled.checked = Boolean(schedule?.enabled);
    document.getElementById('schedule-controls').hidden = !enabled.checked;
    document.getElementById('schedule-window-error').textContent = '';

    const windows = schedule?.windows || [];
    document.getElementById('schedule-no-windows').hidden = windows.length > 0;
    document.getElementById('schedule-windows').innerHTML = windows.map(({ start, end }, index) => {
        const range = `${formatScheduleTime(start)}–${formatScheduleTime(end)}${end < start ? ' (next day)' : ''}`;
        return `
            <li>
                <span>${range}</span>
                <button type="button" class="button is-small" data-window-index="${index}" aria-label="Remove ${range}">Remove</button>
            </li>
        `;
    }).join('');
}

function renderScheduleEditor() {
    const select = document.getElementById('schedule-panel');
    if (!config.categories.includes(scheduleCategory)) scheduleCategory = config.categories[0];
    select.replaceChildren(...config.categories.map((category, index) =>
        new Option(scheduleCategoryLabel(category, index), index)
    ));
    select.disabled = !scheduleCategory;
    if (scheduleCategory) select.value = config.categories.indexOf(scheduleCategory);
    else select.add(new Option('Add a category to set a schedule', ''));
    renderScheduleWindows();
}

function wireScheduleEditor() {
    const panelInput = document.getElementById('schedule-panel');
    const enabled = document.getElementById('schedule-enabled');
    const startInput = document.getElementById('schedule-start');
    const endInput = document.getElementById('schedule-end');
    const error = document.getElementById('schedule-window-error');
    const windowList = document.getElementById('schedule-windows');

    for (let block = 0; block <= SCHEDULE_BLOCKS_PER_DAY; block++) {
        const time = formatScheduleTime(block);
        if (block < SCHEDULE_BLOCKS_PER_DAY) startInput.add(new Option(time, block));
        if (block > 0) endInput.add(new Option(time, block));
    }

    panelInput.addEventListener('change', () => {
        scheduleCategory = config.categories[Number(panelInput.value)];
        renderScheduleWindows();
    });
    enabled.addEventListener('change', () => {
        getScheduleDraft().enabled = enabled.checked;
        renderScheduleWindows();
    });
    startInput.addEventListener('change', () => {
        const start = Number(startInput.value);
        if (Number(endInput.value) <= start) endInput.value = start + 1;
        error.textContent = '';
    });
    endInput.addEventListener('change', () => { error.textContent = ''; });
    document.getElementById('schedule-window-form').addEventListener('submit', event => {
        event.preventDefault();
        const schedule = getScheduleDraft();
        if (!schedule?.enabled) return;
        const start = Number(startInput.value);
        const end = Number(endInput.value);
        if (start === end) {
            error.textContent = 'Choose a different end time.';
            return;
        }
        if (schedule.windows.some(block => block.start === start && block.end === end)) {
            error.textContent = 'This window is already scheduled.';
            return;
        }
        schedule.windows.push({ start, end });
        schedule.windows.sort((first, second) => first.start - second.start || first.end - second.end);
        renderScheduleWindows();
    });
    windowList.addEventListener('click', event => {
        const button = event.target.closest('button[data-window-index]');
        if (!button) return;
        const index = Number(button.dataset.windowIndex);
        getScheduleDraft().windows.splice(index, 1);
        renderScheduleWindows();
        const buttons = windowList.querySelectorAll('button');
        (buttons[index] || buttons[index - 1] || startInput).focus();
    });
}

function applyScheduleDrafts(categories) {
    config.categories.forEach((category, index) => {
        const draft = scheduleDrafts.get(category);
        if (!draft) return;
        if (draft.enabled || draft.windows.length) categories[index].schedule = draft;
        else delete categories[index].schedule;
    });
}

function renderEditor() {
    const list = document.getElementById('menu-editor-list');
    list.innerHTML = '';
    document.getElementById('wallpaper-input').value = config.wallpaper;
    document.getElementById('lat-input').value = config.weatherLat || '';
    document.getElementById('lon-input').value = config.weatherLon || '';
    document.getElementById('todo-enabled-input').checked = Boolean(config.lambdaTodosEnabled);
    document.getElementById('todo-api-url-input').value = config.lambdaApiUrl || '';
    document.getElementById('todo-api-key-input').value = lambdaApiKey();

    config.categories.forEach((cat, cIdx) => {
        const div = document.createElement('div');
        div.className = 'category-edit-box';
        div.innerHTML = `
            <div class="columns is-mobile is-gapless mb-2">
                <div class="column"><input class="input is-small category-title-input" value="${escapeAttribute(cat.title)}"></div>
                <div class="column is-narrow mx-1"><input type="color" value="${escapeAttribute(cat.color)}" onchange="config.categories[${cIdx}].color=this.value"></div>
                <div class="column is-narrow">
                    <div style="display:flex; gap:6px;">
                        <button class="button is-small" onclick="moveCategory(${cIdx}, -1)">&#8593;</button>
                        <button class="button is-small" onclick="moveCategory(${cIdx}, 1)">&#8595;</button>
                        <button class="button is-danger is-small" onclick="config.categories.splice(${cIdx},1);renderEditor()">&times;</button>
                    </div>
                </div>
            </div>
            <div id="links-${cIdx}"></div>
            <button class="button is-small is-fullwidth mt-1" onclick="config.categories[${cIdx}].links.push({name:'',url:'',icon:'fas fa-link'});renderEditor()">+ Link</button>
        `;
        div.querySelector('.category-title-input').addEventListener('change', event => {
            cat.title = event.target.value;
            document.getElementById('schedule-panel').options[cIdx].textContent = scheduleCategoryLabel(cat, cIdx);
        });
        cat.links.forEach((link, lIdx) => {
            const row = document.createElement('div');
            row.className = 'is-flex mb-1';
            row.innerHTML = `
                <input class="input is-small mr-1" placeholder="Name" value="${escapeAttribute(link.name)}" onchange="config.categories[${cIdx}].links[${lIdx}].name=this.value">
                <input class="input is-small mr-1" placeholder="URL" value="${escapeAttribute(link.url)}" onchange="config.categories[${cIdx}].links[${lIdx}].url=this.value">
                <input class="input is-small mr-1" placeholder="Icon" value="${escapeAttribute(link.icon)}" onchange="config.categories[${cIdx}].links[${lIdx}].icon=this.value">
                <div style="display:flex; gap:6px;">
                    <button class="button is-small" onclick="moveLink(${cIdx}, ${lIdx}, -1)">&#8593;</button>
                    <button class="button is-small" onclick="moveLink(${cIdx}, ${lIdx}, 1)">&#8595;</button>
                    <button class="button is-small" onclick="config.categories[${cIdx}].links.splice(${lIdx},1);renderEditor()">&times;</button>
                </div>
            `;
            div.querySelector(`#links-${cIdx}`).appendChild(row);
        });
        list.appendChild(div);
    });
    renderScheduleEditor();
}

function moveArrayItem(arr, from, to) {
    if (to < 0 || to >= arr.length) return;
    const item = arr.splice(from, 1)[0];
    arr.splice(to, 0, item);
}

function moveCategory(idx, dir) {
    moveArrayItem(config.categories, idx, idx + dir);
    renderEditor();
}

function moveLink(catIdx, linkIdx, dir) {
    const links = config.categories[catIdx].links;
    moveArrayItem(links, linkIdx, linkIdx + dir);
    renderEditor();
}

function exportConfig() {
    try {
        const exportable = JSON.parse(JSON.stringify(config));
        applyScheduleDrafts(exportable.categories);
        const data = JSON.stringify(exportable, null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'page-config.json';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    } catch (e) {
        alert('Export failed');
    }
}

function handleImportFile(evt) {
    const file = evt.target.files && evt.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
        try {
            const parsed = JSON.parse(reader.result);
            if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.categories)) {
                alert('Invalid config file');
                return;
            }
            config = parsed;
            config.lambdaTodosEnabled = Boolean(config.lambdaTodosEnabled);
            config.lambdaApiUrl = config.lambdaApiUrl || '';
            scheduleDrafts.clear();
            localStorage.setItem('PageConfig', JSON.stringify(config));
            renderEditor();
            renderPage();
            if (config.lambdaTodosEnabled) setTimeout(refreshTodos, 0);
            alert('Config imported');
        } catch (e) {
            alert('Failed to read config: ' + e.message);
        }
    };
    reader.readAsText(file);
    evt.target.value = '';
}

function init() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js?v=2.1.1').catch(() => {});
    }
    ensureAndIncrementOpenCount();
    wireTodoWidget();
    renderPage();
    updateTimeandDate();
    setInterval(updateTimeandDate, 200);
    window.addEventListener('pageshow', refreshPanelSchedules);
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) refreshPanelSchedules();
    });

    const mod = document.getElementById('config-modal');
    wireScheduleEditor();
    document.getElementById('config-btn').onclick = () => { renderEditor(); mod.classList.add('is-active'); };
    document.getElementById('close-btn').onclick = () => {
        scheduleDrafts.clear();
        mod.classList.remove('is-active');
    };
    document.getElementById('add-category-btn').onclick = () => { config.categories.push({title:'/new', color:'#3273dc', links:[]}); renderEditor(); };
    document.getElementById('export-btn').onclick = exportConfig;
    document.getElementById('import-file-input').addEventListener('change', handleImportFile);
    document.getElementById('save-btn').onclick = () => {
        config.wallpaper = document.getElementById('wallpaper-input').value;
        config.weatherLat = document.getElementById('lat-input').value;
        config.weatherLon = document.getElementById('lon-input').value;
        config.lambdaTodosEnabled = document.getElementById('todo-enabled-input').checked;
        config.lambdaApiUrl = document.getElementById('todo-api-url-input').value.trim().replace(/\/+$/, '');
        applyScheduleDrafts(config.categories);
        scheduleDrafts.clear();
        localStorage.setItem(TODO_API_KEY_STORAGE, document.getElementById('todo-api-key-input').value.trim());
        localStorage.setItem('PageConfig', JSON.stringify(config));
        renderPage();
        if (config.lambdaTodosEnabled) setTimeout(refreshTodos, 0);
        mod.classList.remove('is-active');
    };

    if (config.lambdaTodosEnabled) setTimeout(refreshTodos, 0);
}

init();

