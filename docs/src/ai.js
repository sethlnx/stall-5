import { FIELD, PULL_RANGE, REACT_LAG, TURN_TIME } from './constants.js';
import { add, clamp, dist, mul, norm, sub } from './vec.js';
import { frameAt } from './motion.js';
import { applyRoute, attackDir, clearRoute, teamOf } from './state.js';

const MARK_STANDOFF = 2.8;

/**
 * Man defence working from the same information a human defender gets:
 * the offence's position a split second in, extrapolated forward.
 */
export function planDefense(game, defTeam) {
  const offense = teamOf(game, game.offense);
  const defenders = teamOf(game, defTeam);
  const taken = new Set();

  for (const d of defenders) {
    let mark = null;
    let bd = Infinity;
    for (const o of offense) {
      if (taken.has(o.id)) continue;
      const dd = dist(d.pos, o.pos);
      if (dd < bd) {
        bd = dd;
        mark = o;
      }
    }
    clearRoute(d);
    if (!mark) continue;
    taken.add(mark.id);

    // Same information a human defender gets: where the mark had got to a
    // split second in, carried on at the pace they were showing.
    const peek = mark.plan[frameAt(mark.plan, REACT_LAG)] ?? mark.pos;
    const step = sub(peek, mark.pos);
    const pace = Math.hypot(step.x, step.y) / REACT_LAG;
    const predicted =
      mark.id === game.disc.carrier
        ? add(mark.pos, { x: 0, y: attackDir(game, mark.team) * MARK_STANDOFF })
        : add(peek, mul(norm(step), pace * (TURN_TIME - REACT_LAG)));

    const toTarget = sub(predicted, d.pos);
    const len = Math.hypot(toTarget.x, toTarget.y);
    if (len < 0.3) continue;
    const reach = d.spec.maxSpeed * (TURN_TIME - d.startAt);
    d.route = [add(d.pos, mul(toTarget, Math.min(1, reach / len)))];
    applyRoute(d);
  }
}

/**
 * A pull is aimed deep and down the middle: hang it up and make them come back
 * under it. The pullers are standing in the end they defend, so downfield for
 * them is the way they would be attacking if they had the disc.
 */
export function planPull(game) {
  const puller = game.players.find((p) => p.id === game.disc.carrier);
  if (!puller) return;
  const dir = attackDir(game, puller.team);
  const target = {
    x: FIELD.width / 2,
    y: clamp(puller.pos.y + dir * PULL_RANGE, 2, FIELD.length - 2),
  };
  game.pendingThrow = { from: puller.id, to: target, bow: 0 };
}
