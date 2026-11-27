// ui/boot.js: when VeyvoUI.app.start() throws (a saved state the app cannot show), the error box offers
// a way out - the stored state is kept under 'veyvo-state-corrupt-<time>' and the app restarts empty,
// so Settings › Data (automatic backups, import) can be reached again.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const BOOT = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'boot.js'), 'utf8');

function fakeEnv(stored) {
  const storage = new Map(stored === undefined ? [] : [['veyvo-state', stored]]);
  const made = [];
  const el = tag => {
    const node = { tag, children: [], attrs: {}, style: {}, listeners: {}, textContent: '',
      setAttribute(k, v) { this.attrs[k] = v; }, appendChild(c) { this.children.push(c); return c; },
      addEventListener(type, fn) { this.listeners[type] = fn; } };
    made.push(node);
    return node;
  };
  const body = el('body');
  let reloaded = 0;
  const root = {
    document: { createElement: el, body },
    localStorage: { getItem: k => (storage.has(k) ? storage.get(k) : null), setItem: (k, v) => storage.set(k, String(v)), removeItem: k => storage.delete(k) },
    location: { reload: () => { reloaded += 1; } },
    VeyvoStore: { CORRUPT_KEY_PREFIX: 'veyvo-state-corrupt-' },
    VeyvoI18n: { has: () => false, t: k => k },
    VeyvoUI: { app: { start() { throw new Error('(notes[e.id] || []).concat is not a function'); } } }
  };
  root.globalThis = root;
  const context = vm.createContext({ globalThis: root, console: { error() {} } });
  return { root, context, storage, body, made, reloads: () => reloaded };
}

test('boot: a start failure offers "start without the saved data", which keeps a copy and restarts', () => {
  const env = fakeEnv('{"schemaVersion":2,"runHistory":[{"id":"toString"}]}');
  vm.runInContext(BOOT, env.context);
  const box = env.body.children[0];
  assert.equal(box.attrs.role, 'alert');
  assert.match(box.children[0].textContent, /concat is not a function/);
  const button = env.made.find(n => n.tag === 'button');
  assert.ok(button, 'a recovery button is offered');
  assert.equal(button.attrs['data-key'], 'boot-safe-start');
  button.listeners.click();
  const copies = [...env.storage.keys()].filter(k => k.startsWith('veyvo-state-corrupt-'));
  assert.equal(copies.length, 1, 'the stored state is kept under a corrupt-copy key');
  assert.equal(env.storage.get(copies[0]), '{"schemaVersion":2,"runHistory":[{"id":"toString"}]}');
  assert.equal(env.storage.has('veyvo-state'), false, 'the app starts empty next time');
  assert.equal(env.reloads(), 1);
});

test('boot: nothing stored -> only the error text, no recovery button', () => {
  const env = fakeEnv(undefined);
  vm.runInContext(BOOT, env.context);
  assert.equal(env.made.filter(n => n.tag === 'button').length, 0);
  assert.equal(env.body.children.length, 1);
});
