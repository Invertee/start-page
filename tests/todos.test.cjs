const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../js/index.js'), 'utf8');

function setup() {
    const storage = new Map([
        ['PageConfig', JSON.stringify({ lambdaTodosEnabled: true, lambdaApiUrl: 'https://lambda.example.test/app/', categories: [] })],
        ['LambdaTodoApiKey', 'test-key']
    ]);
    const elements = new Map();
    const element = id => {
        if (!elements.has(id)) elements.set(id, {
            value: '', disabled: false, hidden: false, innerHTML: '', textContent: '',
            listeners: {},
            addEventListener(type, handler) { this.listeners[type] = handler; },
            removeAttribute(name) { delete this[name]; }
        });
        return elements.get(id);
    };
    const requests = [];
    const context = vm.createContext({
        localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
        document: { getElementById: element },
        Headers, URL,
        fetch: async (url, options) => {
            requests.push({ url, options });
            return { ok: true, status: 200, json: async () => ({ id: 'new-task', ...JSON.parse(options.body) }) };
        }
    });
    vm.runInContext(source.replace(/\ninit\(\);\s*$/, ''), context);
    const submitButton = { disabled: false };
    element('todo-add-form').querySelector = () => submitButton;
    context.wireTodoWidget();
    const submit = () => element('todo-add-form').listeners.submit({
        preventDefault() {}, currentTarget: element('todo-add-form')
    });
    return { context, element, requests, submit, submitButton, storage };
}

test('opens the configured Lambda base URL and updates after settings change', () => {
    const { context, element } = setup();
    context.renderTodoWidget();
    assert.equal(element('todo-open-lambda').href, 'https://lambda.example.test/app');
    assert.equal(element('todo-open-lambda').hidden, false);
    vm.runInContext("config.lambdaApiUrl = 'http://localhost:8099/';", context);
    context.renderTodoWidget();
    assert.equal(element('todo-open-lambda').href, 'http://localhost:8099/');
});

test('hides the app link for missing, invalid, or unsafe URLs', () => {
    const { context, element } = setup();
    for (const url of ['', 'not a URL', 'javascript:alert(1)', 'data:text/html,test']) {
        vm.runInContext(`config.lambdaApiUrl = ${JSON.stringify(url)};`, context);
        context.renderTodoWidget();
        assert.equal(element('todo-open-lambda').hidden, true);
        assert.equal(element('todo-open-lambda').href, undefined);
    }
});

test('submits the selected date unchanged, caches the result, and clears both fields', async () => {
    const { context, element, requests, submit, storage } = setup();
    context.renderTodoWidget = () => {};
    element('todo-add-input').value = '  Plan next week  ';
    element('todo-add-due').value = '2026-10-26';
    await submit();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://lambda.example.test/app/api/todos');
    assert.equal(requests[0].options.headers.get('Authorization'), 'Bearer test-key');
    assert.deepEqual(JSON.parse(requests[0].options.body), {
        title: 'Plan next week', dueDate: '2026-10-26', subtasks: [], completed: false
    });
    assert.equal(JSON.parse(storage.get('LambdaTodoCache')).items[0].dueDate, '2026-10-26');
    assert.equal(element('todo-add-input').value, '');
    assert.equal(element('todo-add-due').value, '');
    assert.equal(element('todo-add-input').disabled, false);
});

test('allows tasks without a due date', async () => {
    const { context, element, requests, submit } = setup();
    context.renderTodoWidget = () => {};
    element('todo-add-input').value = 'Undated task';
    await submit();
    assert.equal(JSON.parse(requests[0].options.body).dueDate, null);
});

test('retains the description and date on failure, then permits retry', async () => {
    const { context, element, requests, submit, submitButton } = setup();
    const statuses = [];
    context.renderTodoWidget = message => statuses.push(message);
    const successfulFetch = context.fetch;
    context.fetch = async () => { throw new Error('offline'); };
    element('todo-add-input').value = 'Retry this task';
    element('todo-add-due').value = '2026-11-03';
    await submit();
    assert.equal(element('todo-add-input').value, 'Retry this task');
    assert.equal(element('todo-add-due').value, '2026-11-03');
    assert.equal(element('todo-add-input').disabled, false);
    assert.equal(element('todo-add-due').disabled, false);
    assert.equal(submitButton.disabled, false);
    assert.equal(statuses.at(-1), 'save failed');
    context.fetch = successfulFetch;
    await submit();
    assert.equal(requests.length, 1);
    assert.equal(JSON.parse(requests[0].options.body).dueDate, '2026-11-03');
});

test('prevents duplicate submissions while saving', async () => {
    const { context, element, submit } = setup();
    context.renderTodoWidget = () => {};
    let release;
    const originalFetch = context.fetch;
    let calls = 0;
    context.fetch = async (...args) => {
        calls++;
        await new Promise(resolve => { release = resolve; });
        return originalFetch(...args);
    };
    element('todo-add-input').value = 'One task';
    const pending = submit();
    assert.equal(element('todo-add-due').disabled, true);
    await submit();
    assert.equal(calls, 1);
    release();
    await pending;
});

test('does not submit blank descriptions or an unconfigured integration', async () => {
    const { context, element, requests, submit } = setup();
    element('todo-add-input').value = '   ';
    await submit();
    element('todo-add-input').value = 'A task';
    vm.runInContext("config.lambdaApiUrl = '';", context);
    await submit();
    assert.equal(requests.length, 0);
});
