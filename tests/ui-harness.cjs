const fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm');
function renderRole(role, initial = {}, options = {}) {
  const storage = new Map(Object.entries(initial)),
    session = new Map(options.browserSession || (role ? [['tisk-demo-user', role]] : [])),
    elements = new Map();
  class FixedDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : ['2026-10-13T12:00:00']));
    }
  }
  const get = (id) => {
    if (!elements.has(id))
      elements.set(id, {
        innerHTML: '',
        textContent: '',
        value: '',
        dataset: {},
        classList: { add() {}, remove() {} },
        selectedOptions: [],
        events: {},
        addEventListener(name, handler) {
          this.events[name] = handler;
        },
        querySelectorAll() {
          return [];
        }
      });
    return elements.get(id);
  };
  const context = vm.createContext({
    Date: FixedDate,
    console,
    structuredClone,
    fetch: options.fetch || (async () => ({ ok: true, json: async () => ({ user: null }) })),
    TISK_SERVER_AUTH: options.serverAuth !== false,
    setTimeout() {
      return 0;
    },
    localStorage: {
      getItem: (k) => storage.get(k) || null,
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k)
    },
    sessionStorage: {
      getItem: (k) => session.get(k) || null,
      setItem: (k, v) => session.set(k, String(v)),
      removeItem: (k) => session.delete(k)
    },
    document: {
      getElementById: get,
      querySelectorAll(selector) {
        const definitions = {
          '[data-page]': ['page', get('root').innerHTML],
          '[data-sem]': ['sem', get('main').innerHTML],
          '[data-date]': ['date', get('main').innerHTML],
          '[data-demo]': ['demo', get('root').innerHTML],
          '[data-pending]': ['pending', get('main').innerHTML],
          '[data-missing]': ['missing', get('main').innerHTML],
          '[data-group-calendar]': ['group-calendar', get('main').innerHTML],
          '[data-edit-group]': ['edit-group', get('main').innerHTML],
          '[data-edit-teacher]': ['edit-teacher', get('main').innerHTML],
          '[data-edit-course]': ['edit-course', get('main').innerHTML],
          '[data-substitute]': ['substitute', get('main').innerHTML],
          '[data-delete]': ['delete', get('main').innerHTML]
        };
        if (selector === 'tr[data-row]')
          return [
            ...get('main').innerHTML.matchAll(/<tr data-row="([^"]+)"[^>]*>([\s\S]*?)<\/tr>/g)
          ].map((match) => {
            const tr = get('row-' + match[1]);
            tr.dataset.row = match[1];
            tr.querySelectorAll = (fieldSelector) =>
              fieldSelector === '[data-field]'
                ? [
                    ...match[2].matchAll(
                      /<(input|select)\b([^>]*data-field="([^"]+)"[^>]*)>([\s\S]*?)(?:<\/select>|(?=<))/g
                    )
                  ].map((field) => {
                    const el = get('field-' + match[1] + '-' + field[3]);
                    el.dataset.field = field[3];
                    el.value =
                      (field[2].match(/value="([^"]*)"/) ||
                        field[4].match(/<option value="([^"]*)" selected/))?.[1] || '';
                    return el;
                  })
                : [];
            return tr;
          });
        const def = definitions[selector];
        if (!def) return [];
        return [...def[1].matchAll(new RegExp('data-' + def[0] + '="([^"]+)"', 'g'))].map(
          (match) => {
            const el = get((def[0] === 'page' ? 'nav' : def[0]) + '-' + match[1]);
            el.dataset[def[0].replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = match[1];
            return el;
          }
        );
      }
    }
  });
  // Domain/UI tests inject a role fixture inside the isolated VM, never into shipped code.
  context.__uiFixtureRole = role;
  for (const file of [
    'portal-seed.js',
    'portal-curators.js',
    'portal-data.js',
    'portal-admin.js',
    'portal-calendar.js',
    'portal.js'
  ]) {
    let source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    if (file === 'portal.js' && role)
      source = source.replace(
        /rebuildUsers\(\);\s*sessionStorage/,
        'rebuildUsers();session=USERS[__uiFixtureRole]||null;\nsessionStorage'
      );
    vm.runInContext(source, context);
  }
  get.storage = storage;
  get.session = session;
  get.context = context;
  return get;
}
module.exports = { renderRole };
