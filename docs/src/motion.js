import {
  BODY_R,
  CLOSING_LOOK,
  CORNER_SLACK,
  DESTINATION_EPS,
  DISC_DRAG,
  DISC_GLIDE,
  DISC_SPEED,
  JAB_STEP,
  LOOKAHEAD,
  PATHING_MODE,
  PLAN_TURNS,
  SIM_DT,
  TURN_STEPS,
} from './constants.js';
import { add, clamp, clone, dist, mag, mul, norm, sub } from './vec.js';

/**
 * Players are bodies, not cursors. They carry momentum between turns, they need
 * time to build speed, and a hard cut costs them speed because their sideways
 * acceleration is finite. One step function serves both the simulation and the
 * planning preview, so the arrow you draw is exactly the run you get.
 */

const zero = () => ({ x: 0, y: 0 });

/**
 * Point `s` metres along a polyline, using its cumulative lengths. Routes now
 * run for several turns, so this is on the hot path often enough to matter.
 */
function pointAt(path, cum, s) {
  const n = path.length;
  if (s <= 0) return path[0];
  if (s >= cum[n - 1]) return path[n - 1];
  let lo = 1;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] < s) lo = mid + 1;
    else hi = mid;
  }
  const before = cum[lo - 1];
  const seg = cum[lo] - before;
  const t = seg < 1e-9 ? 0 : (s - before) / seg;
  return { x: path[lo - 1].x + (path[lo].x - path[lo - 1].x) * t, y: path[lo - 1].y + (path[lo].y - path[lo - 1].y) * t };
}

/** Apply a desired velocity within the body's acceleration and agility limits. */
function steer(p, desired, dt) {
  const spec = p.spec;
  const speed = mag(p.vel);
  const heading = speed > 0.1 ? mul(p.vel, 1 / speed) : norm(desired);
  const dv = sub(desired, p.vel);

  let along = dv.x * heading.x + dv.y * heading.y;
  let lateral = sub(dv, mul(heading, along));
  along = clamp(along, -spec.brake * dt, spec.accel * dt);
  const lat = mag(lateral);
  const maxLat = spec.agility * dt;
  if (lat > maxLat) lateral = mul(lateral, maxLat / lat);

  p.vel = add(p.vel, add(mul(heading, along), lateral));
  const now = mag(p.vel);
  if (now > spec.maxSpeed) p.vel = mul(p.vel, spec.maxSpeed / now);
  p.pos = add(p.pos, mul(p.vel, dt));
}

/** Nothing to chase: run down to a stop, which takes about a second. */
function coastToStop(p, dt) {
  const speed = mag(p.vel);
  if (speed < 1e-4) {
    p.vel = zero();
    return;
  }
  p.vel = mul(p.vel, Math.max(0, speed - p.spec.brake * dt) / speed);
  p.pos = add(p.pos, mul(p.vel, dt));
}

/** A drawn endpoint is a destination, not merely the last direction to run. */
function finishRoute(p) {
  p.pos = clone(p.path.at(-1));
  p.vel = zero();
  p.s = p.pathLen;
}

/**
 * Spend the ground covered, then land exactly on the destination when this
 * frame reaches it. Without the snap, integration leaves the body circling a
 * point it can approach but never represent exactly.
 */
function advanceRoute(p, from) {
  const moved = dist(from, p.pos);
  p.s = Math.min(p.pathLen, p.s + moved);
  if (p.s >= p.pathLen - DESTINATION_EPS && dist(p.pos, p.path.at(-1)) <= DESTINATION_EPS) finishRoute(p);
}

/** Fastest the body may run now and still brake at the drawn endpoint. */
function endpointLimit(p) {
  const routeLeft = Math.max(p.pathLen - p.s, 0);
  const direct = dist(p.pos, p.path.at(-1));
  return Math.sqrt(2 * p.spec.brake * Math.max(routeLeft, direct));
}

/**
 * Bodies are solid, and they are solid to both sides. A runner angles around
 * anyone standing in the corridor they're running down rather than driving at
 * them — but they do not slow down for them. Bodies that do meet are stopped by
 * contact, below, and a runner who balks metres early is a force field, not a
 * player: nobody in this game gives a defender that much room.
 *
 * `crowd` is every body's position as it was at the top of this frame, and
 * `self` is the index to skip. Everyone reads the same snapshot, so nobody gets
 * the advantage of moving first and the result does not depend on array order.
 */
function traffic(p, crowd, self, target) {
  if (!crowd) return target;
  const dir0 = norm(sub(target, p.pos));
  const clearance = 2 * BODY_R;
  const sideways = { x: -dir0.y, y: dir0.x };
  let aim = target;

  for (let i = 0; i < crowd.length; i++) {
    if (i === self) continue;
    const rel = sub(crowd[i].pos, p.pos);
    const along = rel.x * dir0.x + rel.y * dir0.y;
    if (along <= 0 || along > CLOSING_LOOK) continue; // behind, or far off

    // Only give way to somebody you are actually closing on. A body running
    // away from you at your own pace is never going to be hit, and swerving
    // round it every frame costs forward speed — which is exactly what made
    // chasing a cutter hopeless: the defender tucked in behind and then bled
    // 9 m/s down to 1 trying to go round a back that kept receding.
    const closing = (p.vel.x - crowd[i].vel.x) * dir0.x + (p.vel.y - crowd[i].vel.y) * dir0.y;
    if (closing <= 0.25) continue;
    const side = rel.x * sideways.x + rel.y * sideways.y;
    const perp = Math.abs(side);
    if (perp >= clearance) continue; // this heading already goes by them
    // Which hand to go round on. Dead-ahead the sign of `side` is noise and
    // would whipsaw, so once they are leaning a way they keep going that way.
    let hand;
    if (perp > 0.4) hand = side >= 0 ? -1 : 1;
    else {
      const lean = p.vel.x * sideways.x + p.vel.y * sideways.y;
      hand = Math.abs(lean) > 0.05 ? Math.sign(lean) : -1;
    }

    // Move the aim point sideways until it clears them. Chasing the shifted
    // point *is* going round: the route no longer pulls back through the body.
    // How hard they lean scales with how close the body is, so a runner drifts
    // round someone far up the field and swerves hard at someone on top of them.
    const urgency = clamp(1 - (along - clearance) / CLOSING_LOOK, 0, 1);
    aim = add(aim, mul(sideways, hand * (clearance - perp + 0.3) * urgency));
  }
  return aim;
}

/**
 * Steering alone never quite gets there — two bodies converging on the same
 * metre will still end up sharing it. This is the backstop: any overlapping
 * pair is pushed apart evenly and the part of their velocities driving them
 * together is cancelled, so contact reads as contact rather than as one body
 * sliding through another.
 *
 * Pairs are relaxed rather than solved in one go: prising one pair apart can
 * shove a third body into someone else, so the sweep repeats until a pass finds
 * nothing left to fix. In a knot it usually settles in two or three.
 */
const SEPARATION_PASSES = 8;

function separate(bodies) {
  const min = 2 * BODY_R;
  for (let pass = 0; pass < SEPARATION_PASSES; pass++) {
    let overlapped = false;
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i];
        const b = bodies[j];
        let dx = b.pos.x - a.pos.x;
        let dy = b.pos.y - a.pos.y;
        let d = Math.hypot(dx, dy);
        if (d >= min) continue;
        overlapped = true;
        if (d < 1e-6) {
          // exactly stacked: any axis will do, but it must be the same one
          // every replay, so it comes from their order and not from chance
          dx = 0;
          dy = 1;
          d = 1;
        }
        const nx = dx / d;
        const ny = dy / d;
        const push = (min - d) / 2;
        a.pos = { x: a.pos.x - nx * push, y: a.pos.y - ny * push };
        b.pos = { x: b.pos.x + nx * push, y: b.pos.y + ny * push };

        // Cancel the closing part of their velocities. Once done the pair reads
        // as not closing, so later passes leave it alone.
        const closing = (b.vel.x - a.vel.x) * nx + (b.vel.y - a.vel.y) * ny;
        if (closing >= 0) continue;
        const c = closing / 2;
        a.vel = { x: a.vel.x + nx * c, y: a.vel.y + ny * c };
        b.vel = { x: b.vel.x - nx * c, y: b.vel.y - ny * c };
      }
    }
    if (!overlapped) return;
  }
}

/**
 * Where a drawn line actually turns, and how much. A route is straight legs, so
 * every interior anchor is a corner with a real angle to it — worked out once
 * when the path is built rather than sniffed at from the trajectory each frame.
 *
 * A corner is **free** when either leg beside it is shorter than `JAB_STEP`.
 * That is a jab step: the feet move, the hips do not, and there is nothing to
 * redirect. You can only get away with it over a small distance, which is
 * exactly what the length test is measuring.
 */
export function cornerTable(path, cum) {
  const out = [];
  for (let i = 1; i < path.length - 1; i++) {
    const legIn = cum[i] - cum[i - 1];
    const legOut = cum[i + 1] - cum[i];
    if (legIn < 1e-6 || legOut < 1e-6) continue;
    const a = norm(sub(path[i], path[i - 1]));
    const b = norm(sub(path[i + 1], path[i]));
    const turn = Math.acos(clamp(a.x * b.x + a.y * b.y, -1, 1));
    if (turn < 1e-3) continue; // straight through
    out.push({ s: cum[i], turn, free: Math.min(legIn, legOut) <= JAB_STEP });
  }
  return out;
}

/**
 * How fast you can still be going through a corner. Round the vertex with an
 * arc that starts `CORNER_SLACK` before it and the radius is
 * `R = CORNER_SLACK / tan(turn/2)`, so the harder the corner the tighter the
 * arc; then the usual `v <= sqrt(agility * R)`. Doubling back needs
 * `tan(90°) = ∞`, radius zero, and a full stop — which is right.
 */
function cornerSpeed(c, spec) {
  if (c.free) return Infinity;
  const t = Math.tan(c.turn / 2);
  if (t < 1e-3) return Infinity;
  return Math.sqrt((spec.agility * CORNER_SLACK) / t);
}

/**
 * Fastest they can be running *now* and still make every corner still to come.
 * Braking is not instant, so each corner reaches back up the route by the
 * distance it takes to shed the speed: `u² = v² + 2·a·d`. This is what makes a
 * cutter slow down before the cut rather than sail through it.
 */
function cornerLimit(p) {
  let limit = p.spec.maxSpeed;
  const corners = p.corners;
  if (!corners) return limit;
  for (let i = 0; i < corners.length; i++) {
    const d = corners[i].s - p.s;
    if (d < 0) continue; // behind them now
    const v = cornerSpeed(corners[i], p.spec);
    if (v === Infinity) continue;
    const allowed = Math.sqrt(v * v + 2 * p.spec.brake * d);
    if (allowed < limit) limit = allowed;
  }
  return limit;
}

/** One body's step at turn-time `t`, avoiding everyone in `crowd` but itself. */
function stepPlayer(p, t, dt, crowd, self) {
  if (t < p.startAt) {
    // Hasn't reacted yet — whatever they were already doing carries on. But the
    // ground they cover still counts against the route, or the lookahead ends
    // up *behind* them the instant they do react and they brake to turn round
    // and chase it. Only the defence has a reaction beat, so only the defence
    // ever suffered it: every defender stamped on the brakes a beat into every
    // turn, which is most of why they could not cover anybody.
    const from = clone(p.pos);
    p.pos = add(p.pos, mul(p.vel, dt));
    if (p.pathLen > 0) {
      // Measured against the route's own tangent where they are up to, not
      // against the direction from the body to some point on it — a drifting
      // body sails past that point and the direction swings sideways, which
      // credited less than half the ground they actually covered.
      const here = pointAt(p.path, p.cum, Math.min(p.pathLen, p.s));
      const next = pointAt(p.path, p.cum, Math.min(p.pathLen, p.s + 0.5));
      const dir = norm(sub(next, here));
      const along = (p.pos.x - from.x) * dir.x + (p.pos.y - from.y) * dir.y;
      if (along > 0) p.s = Math.min(p.pathLen, p.s + along);
    }
    return;
  }
  if (!p.path || p.path.length < 2) {
    if (PATHING_MODE === 'rigid') p.vel = zero();
    else coastToStop(p, dt);
    return;
  }
  if (p.s >= p.pathLen - DESTINATION_EPS && dist(p.pos, p.path.at(-1)) <= DESTINATION_EPS) {
    finishRoute(p);
    return;
  }

  const from = clone(p.pos);
  const target = pointAt(p.path, p.cum, Math.min(p.pathLen, p.s + LOOKAHEAD));

  if (PATHING_MODE === 'rigid') {
    if (p.s >= p.pathLen - DESTINATION_EPS && dist(p.pos, p.path.at(-1)) <= p.spec.maxSpeed * dt) {
      finishRoute(p);
      return;
    }
    p.vel = mul(norm(sub(traffic(p, crowd, self, target), p.pos)), p.spec.maxSpeed);
    p.pos = add(p.pos, mul(p.vel, dt));
    advanceRoute(p, from);
    return;
  }

  const maxWant = PATHING_MODE === 'floaty' ? p.spec.maxSpeed : cornerLimit(p);
  const want = Math.min(maxWant, endpointLimit(p));

  const aim = traffic(p, crowd, self, target);
  steer(p, mul(norm(sub(aim, p.pos)), want), dt);
  advanceRoute(p, from);
}

/**
 * Advance every body one step together. This is how the simulation moves
 * players, and the only place a body is ever pushed off the line it was told to
 * run: rounding a corner too tight for its agility, angling around someone in
 * the corridor, or hitting them.
 */
export function stepAll(bodies, t, dt) {
  // Everyone reacts to where everyone else was, and how fast they were going,
  // at the top of the frame. Reading half-updated state would make the result
  // depend on array order, and the side listed first would move through the
  // other. Stepping replaces `pos`/`vel` rather than mutating them, so holding
  // the objects is enough to freeze the frame.
  const crowd = bodies.map((b) => ({ pos: b.pos, vel: b.vel }));
  for (let i = 0; i < bodies.length; i++) stepPlayer(bodies[i], t, dt, crowd, i);
  separate(bodies);
}

/**
 * Run a player's whole turn without touching them, giving the trajectory to
 * draw and how far along their route they got. This is the same physics the
 * simulation runs — momentum, acceleration, a corner too sharp for their
 * agility — so the drawn line already knows what their own body will do to it.
 *
 * What it leaves out is everyone else. Each body is rolled forward **alone**,
 * as though the field were empty: no angling around a defender in the lane, no
 * contact. That part is the turn's to reveal. Passing no crowd is what does it
 * — `traffic` has nothing to see and `separate` never runs.
 */
export function previewAll(players) {
  const steps = TURN_STEPS * PLAN_TURNS;
  return players.map((p) => {
    const ghost = {
      pos: clone(p.pos),
      vel: clone(p.vel),
      s: p.s,
      path: p.path,
      cum: p.cum,
      pathLen: p.pathLen,
      corners: p.corners,
      spec: p.spec,
      startAt: p.startAt,
    };
    const trajectory = new Array(steps + 1);
    const arc = new Array(steps + 1); // how much of the route is spent at each frame
    const marks = []; // ...and the value at each turn boundary
    trajectory[0] = clone(ghost.pos);
    arc[0] = ghost.s;
    for (let i = 0; i < steps; i++) {
      stepPlayer(ghost, i * SIM_DT, SIM_DT, null, 0);
      trajectory[i + 1] = clone(ghost.pos);
      arc[i + 1] = ghost.s;
      if ((i + 1) % TURN_STEPS === 0) marks.push(ghost.s);
    }
    return { trajectory, arc, endS: ghost.s, marks };
  });
}

/** Index into a trajectory for a turn-time. */
export const frameAt = (trajectory, t) =>
  clamp(Math.round(t / SIM_DT), 0, Math.max(0, trajectory.length - 1));

/**
 * The disc leaves the hand fast and bleeds speed the whole way, settling into a
 * glide rather than stopping dead — so a dump arrives about when it always did
 * and a huck hangs, which is the whole point of throwing one.
 *
 * Everything that needs to know where the disc is reads these: the simulation
 * integrating the flight, the arc drawn white-then-grey at the turn boundary,
 * and the marker showing where a receiver will be when it arrives. They step
 * frame by frame rather than using a closed form, because the simulation does,
 * and the two answers have to be the same one.
 */
export const discSpeed = (t) => Math.max(DISC_SPEED * DISC_GLIDE, DISC_SPEED - DISC_DRAG * t);

/** How far the disc gets in `seconds` of flight. */
export function discReach(seconds) {
  const frames = Math.max(0, Math.round(seconds / SIM_DT));
  let d = 0;
  for (let i = 0; i < frames; i++) d += discSpeed(i * SIM_DT) * SIM_DT;
  return d;
}

/** How long the disc takes to cover `distance`. Terminates: the glide floor is > 0. */
export function discFlightTime(distance) {
  let d = 0;
  let i = 0;
  while (d < distance) {
    d += discSpeed(i * SIM_DT) * SIM_DT;
    i += 1;
  }
  return i * SIM_DT;
}
