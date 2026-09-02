const TODO_CACHE_KEY = 'LambdaTodoCache';
const TODO_API_KEY_STORAGE = 'LambdaTodoApiKey';

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

function renderPage() {
    document.getElementById('body-bg').style.backgroundImage = `url('${config.wallpaper}')`;
    const grid = document.getElementById('link-grid');
    grid.innerHTML = '';

    config.categories.forEach(cat => {
        const col = document.createElement('div');
        col.className = 'column is-narrow';
        const headingBg = hexToRgba(cat.color, 0.4);
        col.innerHTML = `
            <nav class="panel">
                <p class="panel-heading has-text-centered" style="background-color: ${headingBg};">
                    ${escapeHtml(cat.title)}
                </p>
                ${cat.links.map(link => `
                    <a class="panel-block" href="${escapeAttribute(link.url)}">
                        <span class="panel-icon"><i class="${escapeAttribute(link.icon || 'fas fa-link')}"></i></span>
                        ${escapeHtml(link.name)}
                    </a>
                `).join('')}
            </nav>
        `;
        grid.appendChild(col);
    });

    renderTodoWidget();
    fetchWeather();
    updateOpenCountTag();
}

function updateTimeandDate() {
    document.getElementById('time-btn').textContent = moment().format('MMMM Do YYYY - h:mm:ss a');
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

async function createTodo(title) {
    const created = await lambdaRequest('/api/todos', {
        method: 'POST',
        body: JSON.stringify({ title, subtasks: [], completed: false })
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
        const title = input.value.trim();
        if (!title) return;
        input.value = '';
        try {
            await createTodo(title);
        } catch (error) {
            input.value = title;
            renderTodoWidget('save failed');
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
                <div class="column"><input class="input is-small" value="${escapeAttribute(cat.title)}" onchange="config.categories[${cIdx}].title=this.value"></div>
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
        navigator.serviceWorker.register('/sw.js?v=2.0.0').catch(() => {});
    }
    ensureAndIncrementOpenCount();
    wireTodoWidget();
    renderPage();
    updateTimeandDate();
    setInterval(updateTimeandDate, 200);

    const mod = document.getElementById('config-modal');
    document.getElementById('config-btn').onclick = () => { renderEditor(); mod.classList.add('is-active'); };
    document.getElementById('close-btn').onclick = () => mod.classList.remove('is-active');
    document.getElementById('add-category-btn').onclick = () => { config.categories.push({title:'/new', color:'#3273dc', links:[]}); renderEditor(); };
    document.getElementById('export-btn').onclick = exportConfig;
    document.getElementById('import-file-input').addEventListener('change', handleImportFile);
    document.getElementById('save-btn').onclick = () => {
        config.wallpaper = document.getElementById('wallpaper-input').value;
        config.weatherLat = document.getElementById('lat-input').value;
        config.weatherLon = document.getElementById('lon-input').value;
        config.lambdaTodosEnabled = document.getElementById('todo-enabled-input').checked;
        config.lambdaApiUrl = document.getElementById('todo-api-url-input').value.trim().replace(/\/+$/, '');
        localStorage.setItem(TODO_API_KEY_STORAGE, document.getElementById('todo-api-key-input').value.trim());
        localStorage.setItem('PageConfig', JSON.stringify(config));
        renderPage();
        if (config.lambdaTodosEnabled) setTimeout(refreshTodos, 0);
        mod.classList.remove('is-active');
    };

    if (config.lambdaTodosEnabled) setTimeout(refreshTodos, 0);
}

init();
