const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../js/index.js'), 'utf8');

function setup() {
    let now;
    const document = { activeElement: null };
    const context = vm.createContext({
        document,
        localStorage: { getItem: () => null },
        Date: class extends Date {
            constructor(...args) { super(...(args.length ? args : [now])); }
        }
    });
    vm.runInContext(source.replace(/\ninit\(\);\s*$/, ''), context);

    function setTime(time) {
        now = time;
        context.refreshPanelSchedules();
    }

    function makePanel(windows) {
        const handlers = {};
        const link = {};
        const shortcuts = { contains: target => target === link };
        const unlockButton = {};
        const elements = { '.panel-shortcuts': shortcuts, '.panel-freeze-button': unlockButton };
        const heading = {};
        const classes = new Set();
        const panel = {
            classList: { toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name) },
            querySelector: selector => elements[selector],
            addEventListener: (type, handler) => { handlers[type] = handler; }
        };
        context.wirePanelSchedule(panel, { enabled: true, windows });
        function interact(type = 'click', target = heading) {
            let cancelled = false;
            handlers[type]({ type, target, preventDefault() { cancelled = true; } });
            return cancelled;
        }
        function isFrozen() {
            const frozen = classes.has('is-frozen');
            assert.equal(shortcuts.inert, frozen);
            assert.equal(unlockButton.hidden, !frozen);
            return frozen;
        }
        return { isFrozen, interact, link };
    }

    return { context, makePanel, setTime };
}

test('only opens the configured half-hour windows, including their start but excluding their end', () => {
    const { makePanel, setTime } = setup();
    const panel = makePanel([{ start: 21, end: 22 }, { start: 34, end: 46 }]);
    for (const [time, frozen] of [
        ['10:29:59', true], ['10:30:00', false], ['10:59:59', false], ['11:00:00', true],
        ['16:59:59', true], ['17:00:00', false], ['22:59:59', false], ['23:00:00', true]
    ]) {
        setTime(`2026-11-25T${time}`);
        assert.equal(panel.isFrozen(), frozen, time);
    }
});

test('supports an overnight window and a window ending at midnight', () => {
    const { makePanel, setTime } = setup();
    const overnight = makePanel([{ start: 47, end: 2 }]);
    const untilMidnight = makePanel([{ start: 46, end: 48 }]);
    for (const [time, firstFrozen, secondFrozen] of [
        ['2026-11-25T23:29:59', true, false],
        ['2026-11-25T23:30:00', false, false],
        ['2026-11-26T00:00:00', false, true],
        ['2026-11-26T01:00:00', true, true]
    ]) {
        setTime(time);
        assert.equal(overnight.isFrozen(), firstFrozen, time);
        assert.equal(untilMidnight.isFrozen(), secondFrozen, time);
    }
});

test('blocks shortcut actions and only overrides the clicked panel after four quick clicks', () => {
    const { makePanel, setTime } = setup();
    const panel = makePanel([]);
    const other = makePanel([]);
    setTime('2026-11-25T10:00:00');
    for (const type of ['click', 'auxclick', 'contextmenu']) {
        assert.equal(panel.interact(type, panel.link), true);
    }
    panel.interact();
    panel.interact();
    assert.equal(panel.isFrozen(), true);

    setTime('2026-11-25T10:00:01');
    panel.interact();
    panel.interact();
    panel.interact();
    assert.equal(panel.isFrozen(), true);
    panel.interact();
    assert.equal(panel.isFrozen(), false);
    assert.equal(panel.interact('click', panel.link), false);
    assert.equal(other.isFrozen(), true);

    setTime('2026-11-25T10:05:00');
    assert.equal(panel.isFrozen(), false);
    setTime('2026-11-25T10:05:01');
    assert.equal(panel.isFrozen(), true);
});

test('handles older configs and skips invalid imported windows', () => {
    const { context } = setup();
    const copy = value => JSON.parse(JSON.stringify(value));
    assert.deepEqual(copy(context.readPanelSchedule({ title: 'Legacy panel' })), { enabled: false, windows: [] });
    const windows = [null, { start: -1, end: 1 }, { start: 3, end: 3 }, { start: 0, end: 49 }, { start: 1.5, end: 4 }, { start: 0, end: 48 }];
    assert.deepEqual(copy(context.readPanelSchedule({ schedule: { enabled: true, windows } })), {
        enabled: true, windows: [{ start: 0, end: 48 }]
    });
});

test('keeps schedule edits with their category when renaming, reordering, and exporting', () => {
    const { context } = setup();
    const result = vm.runInContext(`
        scheduleCategory = config.categories[1];
        const draft = getScheduleDraft();
        draft.enabled = true;
        draft.windows.push({ start: 21, end: 22 });
        scheduleCategory.title = '/time-wasting';
        moveArrayItem(config.categories, 1, 0);

        const exportable = JSON.parse(JSON.stringify(config.categories));
        applyScheduleDrafts(exportable);
        const scheduleBeforeSave = config.categories[0].schedule;
        applyScheduleDrafts(config.categories);
        JSON.stringify({ scheduleBeforeSave, exported: exportable, saved: config.categories });
    `, context);
    const { scheduleBeforeSave, exported, saved } = JSON.parse(result);
    assert.equal(scheduleBeforeSave, undefined);
    assert.deepEqual(exported, saved);
    assert.equal(saved[0].title, '/time-wasting');
    assert.deepEqual(saved[0].schedule, { enabled: true, windows: [{ start: 21, end: 22 }] });
    assert.equal(saved[1].schedule, undefined);
});
