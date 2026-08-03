import { FIELD, PULL_RANGE, REACT_LAG, SIM_DT, TURN_TIME } from './constants.js';
import { add, clamp, dist, mag, mul, norm, sub } from './vec.js';
import { frameAt } from './motion.js';
import { applyRoute, attackDir, clearRoute, teamOf } from './state.js';

const MARK_STANDOFF = 2.8; // how far off the thrower the mark stands
const COVER_GAP = 1.9; // ...and how far off a cutter, which has to be inside BLOCK_R

/**
 * You pick a mark and you stay on them. Reassigning by whoever happens to be
 * nearest, every single turn, made defenders trade cutters mid-play and run
 * back across the field to swap — which is what all the circling was. An
 * assignment only lapses when the player it names is no longer on offence,
 * which is to say when possession changes.
 */
function assignMarks(defenders, offense) {
  const taken = new Set();
  for (const d of defenders) {
    const still = d.marking && offense.some((o) => o.id === d.marking) && !taken.has(d.marking);
    if (still) taken.add(d.marking);
    else d.marking = null;
  }
  for (const d of defenders) {
    if (d.marking) continue;
    let best = null;
    let bd = Infinity;
    for (const o of offense) {
      if (taken.has(o.id)) continue;
      const dd = dist(d.pos, o.pos);
      if (dd < bd) {
        bd = dd;
        best = o;
      }
    }
    if (!best) continue;
    d.marking = best.id;
    taken.add(best.id);
  }
}

/**
 * Where the mark will be at the end of the turn, and which way they are going,
 * from what a defender is allowed to know: their heading and speed a reaction
 * beat in, and how quickly that particular body builds speed. Reading the
 * average pace over the beat instead — from a standing start — under-led an
 * accelerating cutter so badly that the defence fell a stride further behind
 * every single turn.
 */
function readTheCut(mark) {
  const i = frameAt(mark.plan, REACT_LAG);
  const at = mark.plan[i];
  const vel = mul(sub(at, mark.plan[Math.max(0, i - 1)]), 1 / SIM_DT);
  const speed = mag(vel);
  if (speed < 0.05) return { spot: at, heading: null };
  const heading = mul(vel, 1 / speed);
  const rest = Math.max(0, TURN_TIME - REACT_LAG);
  const run = Math.min(speed * rest + 0.5 * mark.spec.accel * rest * rest, mark.spec.maxSpeed * rest);
  return { spot: add(at, mul(heading, run)), heading };
}

/** Man defence, working only from what a defender can actually see. */
export function planDefense(game, defTeam) {
  const offense = teamOf(game, game.offense);
  const defenders = teamOf(game, defTeam);
  assignMarks(defenders, offense);

  for (const d of defenders) {
    clearRoute(d);
    const mark = offense.find((o) => o.id === d.marking);
    if (!mark) continue;

    const aim =
      mark.id === game.disc.carrier
        ? add(mark.pos, { x: 0, y: attackDir(game, mark.team) * MARK_STANDOFF })
        : coverPoint(game, d, mark);
    if (dist(aim, d.pos) < 0.15) continue;
    setChase(d, aim);
  }
}

/**
 * Lay a defender's route out the way an offensive one is laid out: legs from
 * where the body is, so the drawn line leaves the circle and reads the same.
 *
 * The catch is the reaction beat. A defender cannot act for `startAt`, and drifts
 * on old momentum through it, so a route beginning at their turn-start position
 * always started a stride behind the body that was drawn. Making that drift the
 * route's first leg fixes it exactly rather than approximately — and it costs
 * nothing, because they coast through that leg before they may steer, so the
 * corner at the end of it is already behind them when braking starts to apply.
 */
function setChase(d, aim) {
  const drift = mul(d.vel, d.startAt);
  d.route = mag(drift) > 0.3 ? [add(d.pos, drift), aim] : [aim];
  applyRoute(d);
}

/**
 * Cover shoulder to shoulder, on the side the disc is coming from.
 *
 * Sitting *behind* the cutter is what made the defence hopeless: bodies are
 * solid, so a defender who caught up spent the whole next turn shoving into
 * their mark's back, and contact cancelled their closing speed every frame —
 * measured at 9.3 m/s collapsing to 2.3 while the cutter ran on. Beside them
 * there is nothing to run into, and the disc side is still the side a block
 * comes from.
 */
function coverPoint(game, d, mark) {
  const { spot, heading } = readTheCut(mark);
  const toDisc = sub(game.disc.pos, spot);
  if (!heading) {
    const len = mag(toDisc);
    return add(spot, mul(len > 0.1 ? mul(toDisc, 1 / len) : { x: 1, y: 0 }, COVER_GAP));
  }
  const perp = { x: -heading.y, y: heading.x };
  let lean = toDisc.x * perp.x + toDisc.y * perp.y;
  // Disc straight up or down their line: hold whichever side you are already on
  // rather than cutting across them to pick one.
  if (Math.abs(lean) < 0.5) {
    const rel = sub(d.pos, spot);
    lean = rel.x * perp.x + rel.y * perp.y;
  }
  return add(spot, mul(mul(perp, lean >= 0 ? 1 : -1), COVER_GAP));
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
