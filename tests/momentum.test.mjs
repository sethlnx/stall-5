import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, byId } from '../docs/src/state.js';
import { defenseSteering, planDefense } from '../docs/src/ai.js';
import { coverageVelocity, readMomentum } from '../docs/src/defense.js';
import { stepAll } from '../docs/src/motion.js';
import { SIM_DT } from '../docs/src/constants.js';

const defender = () => {
  const p = byId(createGame(), 'B1');
  p.startAt = 0;
  return p;
};

test('a fast approach brakes before the shoulder and settles without running past it', () => {
  const p = defender();
  p.pos = { x: 8, y: 16 };
  p.vel = { x: 0, y: -9 };
  const intent = { target: { x: 8, y: 10 }, velocity: { x: 0, y: 0 } };
  let firstBrake = null;
  let overshoot = 0;
  for (let frame = 0; frame < 240; frame++) {
    const previousSpeed = -p.vel.y;
    stepAll([p], frame * SIM_DT, SIM_DT, new Map([[p.id, intent]]));
    if (firstBrake === null && -p.vel.y < previousSpeed - 0.001) firstBrake = p.pos.y - intent.target.y;
    overshoot = Math.max(overshoot, intent.target.y - p.pos.y);
  }
  assert(firstBrake > 4, 'start braking with enough room to stop from a sprint');
  assert(overshoot < 0.05, 'do not run past the protected position and double back');
  assert(Math.abs(p.pos.y - intent.target.y) < 0.03);
  assert(Math.abs(p.vel.y) < 0.02);
});

test('closing on a decelerating cutter sheds speed before the cutter stops', () => {
  const game = createGame();
  game.disc.carrier = null;
  planDefense(game, 'B');
  const p = byId(game, 'B1');
  const mark = byId(game, p.marking);
  game.players = [mark, p];
  p.startAt = 0;
  p.pos = { x: 7.35, y: 21.4 }; // two metres behind the protected shoulder
  p.vel = { x: 0, y: -9.3 };
  const cutterAt = (t) => {
    const braking = Math.min(1, Math.max(0, t - 0.2));
    return {
      pos: { x: 9, y: 18 - 8 * Math.min(t, 0.2) - 8 * braking + 4 * braking ** 2 },
      vel: { x: 0, y: t < 0.2 ? -8 : -8 + 8 * braking },
    };
  };
  let overshoot = 0;
  let speedWhileSlowing;
  for (let frame = 0; frame < 240; frame++) {
    const t = frame * SIM_DT;
    Object.assign(mark, cutterAt(t));
    // Isolate steering from collisions: the cutter's measured movement is the input.
    stepAll([p], t, SIM_DT, defenseSteering(game, t));
    const shoulder = cutterAt(t + SIM_DT).pos.y + 1.4;
    overshoot = Math.max(overshoot, shoulder - p.pos.y);
    if (frame === 48) speedWhileSlowing = -p.vel.y;
  }
  assert(speedWhileSlowing < 6, 'shed closing speed while the cutter is still slowing');
  assert(overshoot < 0.15, 'hold the under shoulder instead of sprinting through it');
  assert(Math.abs(p.pos.y - 13.8) < 0.03);
  assert(Math.abs(p.vel.y) < 0.02);
});

test('momentum matching does not accelerate beside a steady cutter or reverse a stopped one', () => {
  const p = defender();
  p.pos = { x: 8, y: 12 };
  p.vel = { x: 2, y: -6 };
  assert.deepEqual(coverageVelocity(p, { target: p.pos, velocity: p.vel }), p.vel);
  p.vel = { x: 0, y: 0 };
  assert.deepEqual(coverageVelocity(p, {
    target: p.pos, velocity: p.vel, acceleration: { x: 0, y: 9 },
  }), p.vel, 'a stale braking read must not invent movement after the stop');
});

test('observed braking informs steering and old momentum is discarded on a new matchup or turn', () => {
  const mark = byId(createGame(), 'A1');
  mark.vel = { x: 0, y: -8 };
  const first = readMomentum(null, mark, 0);
  mark.vel = { x: 0, y: -7.85 };
  const slowing = readMomentum(first, mark, SIM_DT);
  assert(slowing.acceleration.y > 0);
  const p = defender();
  p.pos = { x: 8, y: 12 };
  p.vel = { ...mark.vel };
  const intent = { target: p.pos, velocity: mark.vel };
  const anticipated = coverageVelocity(p, { ...intent, acceleration: slowing.acceleration });
  assert(anticipated.y > coverageVelocity(p, intent).y, 'visible braking should prompt earlier deceleration');
  assert.deepEqual(readMomentum(slowing, mark, 0).acceleration, { x: 0, y: 0 });
  assert.deepEqual(readMomentum(slowing, { ...mark, id: 'A2' }, 2 * SIM_DT).acceleration, { x: 0, y: 0 });
});
