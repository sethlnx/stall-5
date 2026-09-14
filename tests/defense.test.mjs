import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, byId, teamOf, refreshPreviews, applyRoute } from '../docs/src/state.js';
import { assignDefender, guardSpace, planDefense, resetDefense } from '../docs/src/ai.js';
import { applyEvent, endTurn, beginResolve, step, turnOver } from '../docs/src/sim.js';
import { bindInput } from '../docs/src/input.js';
import { drawnAt, makeView, toPx } from '../docs/src/render.js';
import { FIELD, SIM_DT, STALL_LIMIT } from '../docs/src/constants.js';

function fixture() {
  const game = createGame();
  game.phase = 'defense';
  game.pulling = false;
  game.disc.carrier = 'A0';
  game.disc.pos = { ...byId(game, 'A0').pos };
  planDefense(game, 'B');
  return game;
}

function pointer(game, touch = false) {
  const handlers = {};
  const canvas = {
    clientWidth: touch ? 390 : 620, clientHeight: touch ? 570 : 420,
    addEventListener: (name, fn) => handlers[name] = fn,
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    setPointerCapture() {},
  };
  const view = makeView(canvas, { touch, portrait: touch });
  const ui = { drag: null, activeId: null, aim: null };
  bindInput(canvas, () => game, ui, () => view);
  const send = (type, pos, pointerId = 1) => {
    const at = toPx(view, pos);
    handlers[type]({ type, clientX: at.x, clientY: at.y, pointerId });
  };
  const tap = (p) => { send('pointerdown', p); send('pointerup', p); };
  return { ui, send, tap };
}

test('coverage starts complete and switching trades matchups', () => {
  const g = fixture();
  const [d, other] = teamOf(g, 'B');
  const previous = d.marking;
  const target = other.marking;
  assignDefender(g, d, byId(g, target));
  assert.equal(d.marking, target);
  assert.equal(other.marking, previous);
  assert.equal(new Set(teamOf(g, 'B').map(p => p.marking)).size, 3);
});

test('guarded space persists, stays in bounds, and swaps with a matchup', () => {
  const g = fixture();
  const [d, teammate] = teamOf(g, 'B');
  guardSpace(g, d, { x: -10, y: 999 });
  const spot = { ...d.guardSpot };
  planDefense(g, 'B');
  assert.deepEqual(d.route, [spot]);
  assert(spot.x > 0 && spot.y < FIELD.length);
  assignDefender(g, d, byId(g, teammate.marking));
  assert.deepEqual(teammate.guardSpot, spot);
  resetDefense(g, 'B');
  assert(teamOf(g, 'B').every(p => p.marking && !p.guardSpot));
});

test('coverage follows observed cuts next turn, without reading hidden throw targets', () => {
  const g = fixture();
  const d = byId(g, 'B1');
  const mark = byId(g, d.marking);
  const before = { ...d.route[0] };
  mark.route = [{ x: mark.pos.x, y: mark.pos.y - 9 }];
  applyRoute(mark);
  planDefense(g, 'B');
  assert.notDeepEqual(d.route[0], before);
  const predicted = { ...d.route[0] };
  g.pendingThrow = { from: 'A0', to: { x: 3, y: 3 }, bow: 4 };
  planDefense(g, 'B');
  assert.deepEqual(d.route[0], predicted);
});

for (const touch of [false, true]) {
  test(`${touch ? 'touch' : 'mouse'}: select, switch, guard, drag and cancel`, () => {
    const g = fixture();
    const { ui, send, tap } = pointer(g, touch);
    const d = byId(g, 'B1');
    const original = d.marking;
    tap(drawnAt(g, d));
    assert.equal(ui.activeId, d.id);
    assert.equal(d.marking, original, 'selection must not erase coverage');
    tap(drawnAt(g, byId(g, 'A2')));
    assert.equal(d.marking, 'A2');
    tap({ x: 9, y: 13 });
    assert.deepEqual(d.guardSpot, { x: 9, y: 13 });
    send('pointerdown', drawnAt(g, d));
    send('pointermove', { x: 3, y: 10 });
    send('pointercancel', { x: 3, y: 10 });
    assert.deepEqual(d.guardSpot, { x: 9, y: 13 });
    send('pointerdown', drawnAt(g, d));
    send('pointermove', drawnAt(g, byId(g, 'A1')));
    send('pointerup', drawnAt(g, byId(g, 'A1')));
    assert.equal(d.marking, 'A1');
    assert.equal(d.guardSpot, null);
  });
}

test('offensive route and throw drawing still work, release phase is locked', () => {
  const g = fixture();
  g.phase = 'offense';
  const { send, tap } = pointer(g);
  const d = byId(g, 'A1');
  send('pointerdown', drawnAt(g, d));
  send('pointermove', { x: 4, y: 12 });
  send('pointerup', { x: 4, y: 12 });
  assert.equal(d.route.length, 1);
  assert(Math.abs(d.route[0].y - 12) < 1e-8);
  tap(drawnAt(g, d));
  assert.equal(d.route.length, 0);
  send('pointerdown', drawnAt(g, byId(g, 'A0')));
  send('pointermove', { x: 9, y: 10 });
  send('pointerup', { x: 9, y: 10 });
  assert.equal(g.pendingThrow.from, 'A0');
  g.phase = 'throw';
  tap(drawnAt(g, d));
  assert.equal(d.route.length, 0);
  assert(g.pendingThrow);
});

test('a nearby defender does not steal a touch aimed at an opponent', () => {
  const g = fixture();
  const selected = byId(g, 'B1');
  const mark = byId(g, 'A2');
  byId(g, 'B2').pos = { x: mark.pos.x - 1.6, y: mark.pos.y };
  refreshPreviews(g);
  const { tap, ui } = pointer(g, true);
  tap(drawnAt(g, selected));
  tap(drawnAt(g, mark));
  assert.equal(selected.marking, mark.id);
  assert.equal(ui.activeId, selected.id);
});

test('turns preserve orders; possession changes and stall outs clear them', () => {
  const g = fixture();
  guardSpace(g, byId(g, 'B1'), { x: 4, y: 12 });
  endTurn(g);
  assert.deepEqual(byId(g, 'B1').guardSpot, { x: 4, y: 12 });
  g.stall = STALL_LIMIT;
  endTurn(g);
  assert.equal(g.offense, 'B');
  assert(g.players.every(p => !p.marking && !p.guardSpot));
  g.phase = 'defense';
  planDefense(g, 'A');
  applyEvent(g, { type: 'turnover', msg: 'Test turnover' });
  assert(g.players.every(p => !p.marking && !p.guardSpot));
});

test('assigned defenders actually move during resolution and produce finite previews', () => {
  const g = fixture();
  const d = byId(g, 'B1');
  const before = { ...d.pos };
  guardSpace(g, d, { x: 4, y: 12 });
  refreshPreviews(g);
  beginResolve(g);
  for (let i = 0; i < 180 && !turnOver(g); i++) {
    const event = step(g, SIM_DT);
    assert.equal(event, null);
  }
  assert(d.pos.y > before.y + 1);
  assert(g.players.every(p => Number.isFinite(p.pos.x) && Number.isFinite(p.pos.y)));
  endTurn(g);
  planDefense(g, 'B');
  assert.deepEqual(d.guardSpot, { x: 4, y: 12 });
});
