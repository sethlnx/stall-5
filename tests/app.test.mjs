import test from 'node:test';
import assert from 'node:assert/strict';

// Run the actual app wiring and animation loop with DOM/canvas stand-ins.
// Geometry and pointer behavior are exercised separately in defense.test.mjs.
test('app phases, coverage controls, fake, autoplay and default clock work together', async () => {
  const nodes = new Map();
  const context = new Proxy({}, { get: () => () => {} });
  function node(id) {
    if (nodes.has(id)) return nodes.get(id);
    const listeners = new Map();
    const n = {
      id, tagName: 'DIV', hidden: id === 'coach', checked: false, value: 'Infinity',
      style: {}, dataset: {}, children: [], clientWidth: 620, clientHeight: 420,
      offsetHeight: 44, textContent: '', innerHTML: '', disabled: false,
      classList: { toggle() {}, contains: () => false, add() {}, remove() {} },
      addEventListener: (type, fn) => {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(fn);
      },
      dispatchEvent: (event) => { for (const fn of listeners.get(event.type) ?? []) fn({ target: n, ...event }); },
      setAttribute: (name, val) => n[name] = val,
      append(...children) { for (const child of children) child.parentElement = n; },
      prepend(...children) { for (const child of children) child.parentElement = n; },
      getContext: () => context,
      getBoundingClientRect: () => ({ left: 0, top: 0 }),
      setPointerCapture() {},
    };
    nodes.set(id, n);
    return n;
  }
  node('defender-buttons').children = [0, 1, 2].map(slot => {
    const b = node(`defender-${slot}`);
    b.dataset.slot = String(slot);
    b.closest = () => b;
    return b;
  });
  globalThis.document = {
    getElementById: node, querySelector: node, body: node('body'),
    documentElement: { style: { setProperty() {}, removeProperty() {} } },
  };
  globalThis.window = { innerHeight: 900, innerWidth: 1200, devicePixelRatio: 1,
    addEventListener: node('window').addEventListener };
  globalThis.location = { search: '' };
  globalThis.matchMedia = () => ({ matches: false });
  let nextFrame;
  globalThis.requestAnimationFrame = fn => nextFrame = fn;
  await import('../docs/src/main.js');
  const game = window.__game();
  let now = performance.now();
  function frames(count) { for (let i = 0; i < count; i++) nextFrame(now += 50); }
  const click = id => node(id).dispatchEvent({ type: 'click' });
  const change = (id, checked) => { node(id).checked = checked; node(id).dispatchEvent({ type: 'change' }); };

  assert.equal(game.aiDefense, false);
  frames(500);
  assert.equal(game.phase, 'pull', 'clock is off until the user chooses a time limit');
  click('ready');
  frames(30);
  assert.equal(game.phase, 'offense');
  // Give the offense a loaded throw to exercise the full decision sequence.
  game.pulling = false;
  game.disc.flight = null;
  game.disc.carrier = 'A0';
  const throwSpec = { from: 'A0', to: { x: 9, y: 10 }, bow: 0 };
  game.pendingThrow = { ...throwSpec };
  click('ready');
  assert.equal(game.phase, 'defense');
  assert.equal(node('ready').textContent, 'Defend ▸');
  assert.equal(node('clear').textContent, 'Auto cover');
  assert.equal(node('defense-controls').hidden, false);
  click('touchMode');
  assert.equal(window.__mode().touch, true);
  assert.equal(node('defense-controls').parentElement, node('below'), 'touch coverage does not consume field space');
  assert.match(node('hint').textContent, /Menu: coverage/);
  const desktopHeight = window.innerHeight;
  window.innerHeight = 180;
  node('window').dispatchEvent({ type: 'resize' });
  assert.equal(node('field').style.height, '136px', 'small viewports do not force the field underneath actions');
  window.innerHeight = desktopHeight;
  click('touchMode');
  assert.equal(node('defense-controls').parentElement, node('defense-home'));
  assert.equal(node('.secondary').parentElement, node('settings-home'));
  const button = node('defender-buttons').children[1];
  node('defender-buttons').dispatchEvent({ type: 'click', target: button });
  assert.equal(button['aria-pressed'], 'true');
  assert.match(node('hint').textContent, /B1 following/);
  assert.equal(node('coverage-force').disabled, false);
  node('coverage-force').value = 'left';
  node('coverage-force').dispatchEvent({ type: 'change' });
  node('coverage-priority').value = 'deep';
  node('coverage-priority').dispatchEvent({ type: 'change' });
  click('coverage-bite');
  const defender = game.players.find(p => p.id === 'B1');
  assert.deepEqual(defender.coverage, { force: 'left', priority: 'deep', bite: true });
  assert.equal(node('coverage-bite')['aria-pressed'], 'true');
  click('clear');
  assert.deepEqual(game.pendingThrow, throwSpec, 'resetting coverage must preserve the loaded throw');
  assert.equal(button['aria-pressed'], 'false');
  assert.deepEqual(defender.coverage, { force: 'right', priority: 'under', bite: false });
  node('defender-buttons').dispatchEvent({ type: 'click', target: button });
  node('coverage-priority').value = 'deep';
  node('coverage-priority').dispatchEvent({ type: 'change' });
  click('coverage-bite');
  click('ready');
  assert.equal(game.phase, 'throw');
  assert.equal(node('defense-controls').hidden, true);
  assert.equal(node('coverage-force').disabled, true);
  click('fake');
  assert.equal(game.phase, 'resolve');
  assert.equal(game.release, null);
  assert.equal(defender.coverage.bite, true, 'a fake does not cancel the defensive commitment');
  frames(30);
  assert.equal(game.phase, 'offense');
  assert.equal(defender.coverage.bite, false, 'a bite lasts one turn');
  assert.equal(defender.coverage.priority, 'deep');
  click('ready');
  assert.equal(game.phase, 'defense');
  change('ai', true);
  assert.equal(defender.coverage.priority, 'deep', 'autoplay preserves chosen coverage');
  assert.equal(game.phase, 'resolve', 'enabling autoplay finishes the current defensive decision');
  frames(30);
  assert.equal(game.phase, 'offense');
  click('ready');
  assert.equal(game.phase, 'resolve', 'autoplay skips manual defense');
});
