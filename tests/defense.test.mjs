import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, byId, teamOf, refreshPreviews, applyRoute } from '../docs/src/state.js';
import { assignDefender, defenseSteering, guardSpace, planDefense, resetDefense, setCoverage } from '../docs/src/ai.js';
import { applyEvent, endTurn, beginDecision, beginResolve, step, turnOver } from '../docs/src/sim.js';
import { bindInput } from '../docs/src/input.js';
import { drawnAt, makeView, toPx } from '../docs/src/render.js';
import { FIELD, REACT_LAG, SIM_DT, STALL_LIMIT } from '../docs/src/constants.js';
import { BITE_TIME, coverageOffset } from '../docs/src/defense.js';
import { stepAll } from '../docs/src/motion.js';

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
  const send = (type, pos, pointerId = 1, shiftKey = false) => {
    const at = toPx(view, pos);
    handlers[type]({ type, clientX: at.x, clientY: at.y, pointerId, shiftKey });
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
  assert.deepEqual(d.route, []);
  assert.deepEqual(defenseSteering(g, REACT_LAG).get(d.id).target, spot);
  assert(spot.x > 0 && spot.y < FIELD.length);
  assignDefender(g, d, byId(g, teammate.marking));
  assert.deepEqual(teammate.guardSpot, spot);
  resetDefense(g, 'B');
  assert(teamOf(g, 'B').every(p => p.marking && !p.guardSpot));
});

test('coverage tracks live movement within a turn, without reading planned cuts or throws', () => {
  const g = fixture();
  const d = byId(g, 'B1');
  const mark = byId(g, d.marking);
  assert.deepEqual(d.route, [], 'automatic coverage must not create a fixed running route');
  const before = defenseSteering(g, REACT_LAG).get(d.id);
  mark.route = [{ x: mark.pos.x, y: mark.pos.y - 9 }];
  applyRoute(mark);
  assert.deepEqual(defenseSteering(g, REACT_LAG).get(d.id), before, 'a future route is hidden');
  g.pendingThrow = { from: 'A0', to: { x: 3, y: 3 }, bow: 4 };
  assert.deepEqual(defenseSteering(g, REACT_LAG).get(d.id), before);
  mark.pos = { x: mark.pos.x + 1, y: mark.pos.y - 3 };
  mark.vel = { x: 2, y: -5 };
  const after = defenseSteering(g, REACT_LAG + SIM_DT).get(d.id);
  assert.notDeepEqual(after.target, before.target);
  assert.deepEqual(after.velocity, mark.vel);
});

test('force and threat offsets hold their side through cuts and reverse with attack direction', () => {
  for (const dir of [-1, 1]) {
    for (const force of ['left', 'right']) {
      const under = coverageOffset({ force, priority: 'under' }, dir);
      const deep = coverageOffset({ force, priority: 'deep' }, dir);
      assert.equal(Math.sign(under.x), force === 'left' ? -dir : dir);
      assert.equal(deep.x, under.x);
      assert.equal(Math.sign(under.y), -dir);
      assert.equal(Math.sign(deep.y), dir);
    }
  }
});

test('a hard bite holds its initial read, then recovers; shading follows a reversal', () => {
  const g = fixture();
  const d = byId(g, 'B1');
  const mark = byId(g, d.marking);
  mark.pos = { x: 9, y: 15 };
  mark.vel = { x: 0, y: 0 };
  setCoverage(g, d, { force: 'left', priority: 'under', bite: true });
  assert.equal(defenseSteering(g, REACT_LAG - SIM_DT).has(d.id), false);
  const initial = defenseSteering(g, REACT_LAG).get(d.id);
  mark.pos = { x: 10, y: 11 };
  mark.vel = { x: 1, y: -5 };
  assert.deepEqual(defenseSteering(g, REACT_LAG + 0.2).get(d.id), initial);
  const recovered = defenseSteering(g, REACT_LAG + BITE_TIME + SIM_DT).get(d.id);
  assert.notDeepEqual(recovered.target, initial.target);
  assert.deepEqual(recovered.velocity, mark.vel);
  endTurn(g);
  assert.deepEqual(d.coverage, { force: 'left', priority: 'under', bite: false });
  assert.equal(d.biteRead, null);
});

function runDeep(priority, bite = false) {
  const g = fixture();
  const d = byId(g, 'B1');
  const mark = byId(g, d.marking);
  g.players = [mark, d];
  g.disc.carrier = null;
  mark.pos = { x: 9, y: 20 };
  mark.vel = { x: 0, y: -5 };
  mark.route = [{ x: 9, y: 5 }];
  setCoverage(g, d, { priority, bite });
  const offset = coverageOffset(d.coverage, -1);
  d.pos = { x: mark.pos.x + offset.x, y: mark.pos.y + offset.y };
  d.vel = { ...mark.vel };
  refreshPreviews(g);
  beginResolve(g);
  for (let i = 0; i < 72; i++) assert.equal(step(g, SIM_DT), null);
  return { d, mark };
}

test('continuous steering keeps the chosen shoulder of a sprinting cutter', () => {
  for (const priority of ['under', 'deep']) {
    const { d, mark } = runDeep(priority);
    assert(d.pos.x < mark.pos.x, 'force right holds the left shoulder');
    assert.equal(Math.sign(d.pos.y - mark.pos.y), priority === 'under' ? 1 : -1);
    assert(d.vel.y < -5, 'the defender runs with the receiver instead of braking at an old endpoint');
    assert.deepEqual(d.route, []);
  }
});

test('biting under gives up more deep separation than shading under', () => {
  const shade = runDeep('under');
  const bite = runDeep('under', true);
  assert(bite.d.pos.y - bite.mark.pos.y > shade.d.pos.y - shade.mark.pos.y + 0.5);
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
    assert.equal(d.guardSpot, null);
    const offset = { ...d.coverage.offset };
    assert.equal(d.marking, 'A2');
    send('pointerdown', drawnAt(g, d));
    send('pointermove', { x: 3, y: 10 });
    send('pointercancel', { x: 3, y: 10 });
    assert.deepEqual(d.coverage.offset, offset);
    send('pointerdown', drawnAt(g, d));
    send('pointermove', drawnAt(g, byId(g, 'A1')));
    send('pointerup', drawnAt(g, byId(g, 'A1')));
    assert.equal(d.marking, 'A1', 'dropping on an opponent switches the matchup');
    assert.equal(new Set(teamOf(g, 'B').map(p => p.marking)).size, 3);
    tap(drawnAt(g, byId(g, 'A1')));
    assert.equal(d.marking, 'A1', 'tapping switches the matchup');
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

for (const touch of [false, true]) {
  test(`${touch ? 'touch' : 'mouse'} drag stores the offset from the visible opponent and follows their movement`, () => {
    const g = fixture();
    const d = byId(g, 'B1');
    const mark = byId(g, d.marking);
    mark.pos = { x: 9, y: 15 };
    mark.vel = { x: 0, y: -4 };
    mark.route = [{ x: 9, y: 5 }];
    applyRoute(mark);
    const seen = drawnAt(g, mark);
    assert(seen.y < mark.pos.y, 'the offense has already moved in the displayed reaction beat');
    const drop = { x: seen.x - 2.5, y: seen.y + 3 };
    const { send } = pointer(g, touch);
    send('pointerdown', drawnAt(g, d));
    send('pointermove', drop);
    send('pointerup', drop);
    assert.equal(d.marking, mark.id);
    assert.equal(d.guardSpot, null);
    assert(Math.abs(d.coverage.offset.x + 2.5) < 1e-8);
    assert(Math.abs(d.coverage.offset.y - 3) < 1e-8);
    mark.pos = { x: 11, y: 10 };
    mark.vel = { x: 3, y: 1 }; // changing heading does not rotate the chosen offset
    const intent = defenseSteering(g, REACT_LAG).get(d.id);
    assert(Math.abs(intent.target.x - 8.5) < 1e-8);
    assert(Math.abs(intent.target.y - 13) < 1e-8);
    const stored = { ...d.coverage.offset };
    endTurn(g);
    assert.deepEqual(d.coverage.offset, stored);
    applyEvent(g, { type: 'turnover', msg: 'Change possession' });
    assert.equal(d.coverage.offset, undefined);
  });
}

test('Shift overrides opponent picking and pins space, including when pressed at release', () => {
  const g = fixture();
  const d = byId(g, 'B1');
  const mark = byId(g, 'A1');
  const { send } = pointer(g);
  const spot = { ...drawnAt(g, mark) };
  send('pointerdown', drawnAt(g, d));
  send('pointermove', spot);
  send('pointerup', spot, 1, true);
  assert.equal(d.marking, null);
  assert.equal(d.coverage.offset, undefined);
  assert(Math.abs(d.guardSpot.x - spot.x) < 1e-8);
  assert(Math.abs(d.guardSpot.y - spot.y) < 1e-8);
  mark.pos = { x: 10, y: 12 };
  assert.deepEqual(defenseSteering(g, REACT_LAG).get(d.id).target, d.guardSpot);
  // Once displaced, a space defender recovers to the same spot without a new turn.
  d.pos = { x: d.guardSpot.x, y: d.guardSpot.y - 3 };
  d.vel = { x: 0, y: 0 };
  d.startAt = 0;
  for (let i = 0; i < 240; i++) stepAll([d], i * SIM_DT, SIM_DT, defenseSteering(g, i * SIM_DT));
  assert(Math.abs(d.pos.y - d.guardSpot.y) < 0.05);
  assert(Math.hypot(d.vel.x, d.vel.y) < 0.05);
});

test('releasing Shift changes a drag back to relative; touch has a fixed-space toggle', () => {
  const g = fixture();
  const d = byId(g, 'B1');
  const { send, ui } = pointer(g, true);
  send('pointerdown', drawnAt(g, d), 1, true);
  send('pointermove', { x: 7, y: 13 }, 1, true);
  assert.equal(ui.drag.fixed, true);
  send('pointermove', { x: 7, y: 13 });
  assert.equal(ui.drag.fixed, false);
  send('pointerup', { x: 7, y: 13 });
  assert(d.coverage.offset);
  assert.equal(d.guardSpot, null);
  ui.guardSpace = true;
  send('pointerdown', drawnAt(g, d));
  send('pointermove', { x: 7, y: 13 });
  send('pointerup', { x: 7, y: 13 });
  assert.deepEqual(d.guardSpot, { x: 7, y: 13 });
  assert.equal(d.marking, null);
  ui.guardSpace = false;
  const mark = byId(g, 'A1');
  const drop = { x: mark.pos.x + 2, y: mark.pos.y - 2 };
  send('pointerdown', drawnAt(g, d));
  send('pointermove', drop);
  send('pointerup', drop);
  assert.equal(d.guardSpot, null);
  assert.equal(d.marking, 'A1', 'an unassigned defender reconnects to the nearest opponent');
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

for (const fake of [false, true]) {
  test(`live decision continues without rewinding on ${fake ? 'fake' : 'release'}`, () => {
    const g = fixture();
    const runner = byId(g, 'A1');
    runner.route = [{ x: runner.pos.x, y: runner.pos.y - 10 }];
    refreshPreviews(g);
    g.pendingThrow = { from: 'A0', to: { x: 9, y: 10 }, bow: 0 };
    beginDecision(g);
    for (let i = 0; i < 54; i++) assert.equal(step(g, SIM_DT), null);
    assert.equal(g.disc.flight, null, 'wind-up waits for the release decision');
    assert(runner.pos.y < runner.route[0].y + 10, 'the actual runner moves while deciding');
    assert.deepEqual(drawnAt(g, runner), runner.pos, 'hit targets follow live positions');
    const position = { ...runner.pos };
    const frame = g.frame;
    if (fake) g.pendingThrow = null;
    beginResolve(g);
    assert.equal(g.frame, frame);
    assert.deepEqual(runner.pos, position);
    step(g, SIM_DT);
    assert.equal(!!g.disc.flight, !fake);
    assert.equal(g.frame, frame + 1);
  });
}
