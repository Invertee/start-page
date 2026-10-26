const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../js/index.js'), 'utf8');

function setup(now = '2026-10-26T23:30:00') {
    const storage = new Map([
        ['PageConfig', JSON.stringify({ lambdaTodosEnabled: true, lambdaApiUrl: 'https://lambda.example.test/app/', categories: [] })],
        ['LambdaTodoApiKey', 'test-key']
    ]);
    const elements = new Map();
    const element = id => {
        if (!elements.has(id)) elements.set(id, {
            value: id === 'todo-add-due' ? 'today' : '', disabled: false, hidden: false, innerHTML: '', textContent: '',
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
        Date: class extends Date {
            constructor(...args) { super(...(args.length ? args : [now])); }
        },
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

test('submits the selected shortcut, caches the date, and resets to Today', async () => {
    const { context, element, requests, submit, storage } = setup();
    context.renderTodoWidget = () => {};
    element('todo-add-input').value = '  Plan next week  ';
    element('todo-add-due').value = 'tomorrow';
    await submit();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://lambda.example.test/app/api/todos');
    assert.equal(requests[0].options.headers.get('Authorization'), 'Bearer test-key');
    assert.deepEqual(JSON.parse(requests[0].options.body), {
        title: 'Plan next week', dueDate: '2026-10-27', subtasks: [], completed: false
    });
    assert.equal(JSON.parse(storage.get('LambdaTodoCache')).items[0].dueDate, '2026-10-27');
    assert.equal(element('todo-add-input').value, '');
    assert.equal(element('todo-add-due').value, 'today');
    assert.equal(element('todo-add-input').disabled, false);
});

test('defaults new tasks to Today', async () => {
    const { context, element, requests, submit } = setup();
    context.renderTodoWidget = () => {};
    element('todo-add-input').value = 'Task due today';
    await submit();
    assert.equal(JSON.parse(requests[0].options.body).dueDate, '2026-10-26');
});

test('matches Lambda shortcuts across weekends, year boundaries, leap days, and clock changes', () => {
    const { context } = setup();
    const cases = [
        ['2026-10-26T23:30:00', ['2026-10-26', '2026-10-27', '2026-10-30', '2026-11-02']],
        ['2026-10-30T23:30:00', ['2026-10-30', '2026-10-31', '2026-10-30', '2026-11-02']],
        ['2026-10-31T23:30:00', ['2026-10-31', '2026-11-01', '2026-11-06', '2026-11-02']],
        ['2026-11-01T23:30:00', ['2026-11-01', '2026-11-02', '2026-11-06', '2026-11-02']],
        ['2026-12-31T23:30:00', ['2026-12-31', '2027-01-01', '2027-01-01', '2027-01-04']],
        ['2028-02-28T23:30:00', ['2028-02-28', '2028-02-29', '2028-03-03', '2028-03-06']],
        ['2026-03-28T23:30:00', ['2026-03-28', '2026-03-29', '2026-04-03', '2026-03-30']]
    ];
    const choices = ['today', 'tomorrow', 'end-week', 'next-week'];
    for (const [now, expected] of cases) {
        choices.forEach((choice, index) => {
            assert.equal(context.todoDueDateForChoice(choice, new Date(now)), expected[index], `${now}: ${choice}`);
        });
    }
});

test('sends every dropdown choice as a Lambda due date', async () => {
    for (const [choice, expected] of [['today', '2026-10-26'], ['tomorrow', '2026-10-27'], ['end-week', '2026-10-30'], ['next-week', '2026-11-02']]) {
        const { context, element, requests, submit } = setup();
        context.renderTodoWidget = () => {};
        element('todo-add-input').value = 'A task';
        element('todo-add-due').value = choice;
        await submit();
        assert.equal(JSON.parse(requests[0].options.body).dueDate, expected);
    }
});

test('retains the description and date on failure, then permits retry', async () => {
    const { context, element, requests, submit, submitButton } = setup();
    const statuses = [];
    context.renderTodoWidget = message => statuses.push(message);
    const successfulFetch = context.fetch;
    context.fetch = async () => { throw new Error('offline'); };
    element('todo-add-input').value = 'Retry this task';
    element('todo-add-due').value = 'next-week';
    await submit();
    assert.equal(element('todo-add-input').value, 'Retry this task');
    assert.equal(element('todo-add-due').value, 'next-week');
    assert.equal(element('todo-add-input').disabled, false);
    assert.equal(element('todo-add-due').disabled, false);
    assert.equal(submitButton.disabled, false);
    assert.equal(statuses.at(-1), 'save failed');
    context.fetch = successfulFetch;
    await submit();
    assert.equal(requests.length, 1);
    assert.equal(JSON.parse(requests[0].options.body).dueDate, '2026-11-02');
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
