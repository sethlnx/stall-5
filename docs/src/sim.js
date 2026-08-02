import { ARC_SAMPLES, BLOCK_R, BLOCK_SKILL, CATCH_R, CATCH_SKILL, INTERCEPT_SHARE, MARK_PENALTY, MARK_RANGE, PICKUP_R, RELEASE_AT, RELEASE_CLEAR, SIM_DT, STALL_LIMIT, TURN_STEPS, WIN_SCORE } from './constants.js';
import { arcPoints, clone, dist, polylineLength, projectAlong } from './vec.js';
import { advanceRoutes, byId, carrier, clearPlans, clearRoute, flipEnds, inAttackEndzone, nearestOf, other, say, syncRoles, teamOf } from './state.js';
import { discSpeed, stepAll } from './motion.js';

/**
 * Contests are rolled, but a turn has to replay identically, so the stream is
 * seeded from the game rather than Math.random.
 */
function roll(game) {
  game.seed = (Math.imul(game.seed ^ (game.seed >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0;
  return (game.seed >>> 8) / 0x1000000;
}

const resetClock = (game) => {
  game.frame = 0;
  game.t = 0;
  game.settling = null;
};

/** Hold the planned throw until the thrower has read the defence's reaction. */
export function beginResolve(game) {
  game.release = game.pendingThrow ? { ...game.pendingThrow, at: RELEASE_AT } : null;
  game.pendingThrow = null;
  resetClock(game);
  game.phase = 'resolve';
}

function release(game) {
  const spec = game.release;
  game.release = null;
  const thrower = byId(game, spec.from);
  // You pivot around your mark, so a hand-block across the thrower is hard —
  // heavily penalised, but no longer impossible.
  const mark = nearestOf(game, other(thrower.team), thrower.pos);
  const pts = arcPoints(thrower.pos, spec.to, spec.bow, ARC_SAMPLES);
  game.disc.flight = {
    origin: pts[0],
    rest: pts.slice(1),
    dist: polylineLength(pts),
    traveled: 0,
    frames: 0, // whole frames flown, so speed is read off the same clock the sim uses
    thrower: thrower.id,
    pull: game.pulling === true, // a pull is given away on purpose: no turnover when it lands
    mark: mark && dist(mark.pos, thrower.pos) < MARK_RANGE ? mark.id : null,
    attempts: new Map(), // one go at it each, per body
  };
  game.disc.carrier = null;
  say(game, game.pulling ? `${thrower.id} pulls.` : `${thrower.id} releases.`);
}

/**
 * Advance the world one fixed step. Returns null, or a terminal event
 * ({type:'turnover'|'score'}) that ends the turn immediately.
 *
 * Time is `frame * SIM_DT`, never an accumulated float: the planning preview
 * quantises the same way, so what was drawn is exactly what happens.
 */
export function step(game, dt) {
  const t = game.frame * SIM_DT;
  stepAll(game.players, t, dt);
  if (game.release && t >= game.release.at) release(game);

  const f = game.disc.flight;
  if (f) {
    f.traveled = Math.min(f.dist, f.traveled + discSpeed(f.frames * SIM_DT) * dt);
    f.frames += 1;
    game.disc.pos = projectAlong(f.origin, f.rest, f.traveled);
    const done = f.traveled >= f.dist;

    const ev = contest(game, f, done);
    if (ev) return ev;

    if (game.disc.flight && done) {
      // A pull was always going to them. It lands, it lies there, they go and
      // get it — nobody has turned anything over.
      if (f.pull) return groundPull(game, game.disc.pos);
      return groundIt(game, game.disc.pos, 'Disc hits the ground.');
    }
  } else if (game.disc.loose) {
    tryPickup(game);
  } else {
    const holder = carrier(game);
    if (holder) game.disc.pos = clone(holder.pos);
  }

  game.frame += 1;
  game.t = game.frame * SIM_DT;
  return null;
}

/**
 * Everyone within reach of the passing disc gets one go at it, settled at their
 * closest approach so a body that nearly gets there nearly gets it. When two
 * bodies settle on the same frame the nearer one plays it first — otherwise
 * whoever happened to be earlier in the array would win every 50/50.
 *
 * A miss is logged and the disc flies on: nothing happens without explanation.
 */
function contest(game, f, flightOver) {
  // Nobody plays it out of the thrower's hand — that is what pivoting around
  // the mark buys you. A short dump becomes live halfway instead.
  if (f.traveled < Math.min(RELEASE_CLEAR, f.dist * 0.5)) return null;
  const settling = [];
  for (const p of game.players) {
    if (p.id === f.thrower) continue; // you cannot catch your own pass
    const attacking = p.team === game.offense;
    const reach = attacking ? CATCH_R : BLOCK_R;
    const d = dist(p.pos, game.disc.pos);
    let a = f.attempts.get(p.id);

    if (d < reach && !a) {
      a = { min: d, done: false };
      f.attempts.set(p.id, a);
    }
    if (!a || a.done) continue;
    if (d <= a.min) {
      a.min = d;
      if (!flightOver) continue; // still closing on it
    }
    a.done = true; // past them now, or out of flight: settle the attempt
    settling.push({ p, a, attacking, reach });
  }
  settling.sort((x, y) => x.a.min - y.a.min);

  for (const { p, a, attacking, reach } of settling) {
    const t = a.min / reach;

    // An open receiver catches it, full stop: if you put the disc inside their
    // reach with nobody on them, that is a completed pass. Dice belong only
    // where an offensive and a defensive body are both playing the same disc.
    const crowded =
      attacking && game.players.some((q) => q.team !== p.team && dist(q.pos, game.disc.pos) <= CATCH_R);
    const chance = attacking
      ? crowded
        ? CATCH_SKILL * (1 - t ** 4)
        : 1
      : BLOCK_SKILL * (1 - t ** 1.5) * (p.id === f.mark ? MARK_PENALTY : 1);

    if (roll(game) >= chance) {
      const how = `${a.min.toFixed(1)}m away`;
      // A defender who was right on it did not fail to *reach* it — they got
      // there and did not come down with it. Say the thing that happened.
      say(game, attacking ? `${p.id} drops it under pressure, ${how}.` : `${p.id} can't get enough on it, ${how}.`);
      continue;
    }
    if (attacking) return takeCatch(game, p);
    if (roll(game) < INTERCEPT_SHARE) return takeCatch(game, p);
    say(game, `${p.id} swats it down!`);
    return groundIt(game, game.disc.pos, `${p.id} gets a hand to it.`);
  }
  return null;
}

function takeCatch(game, player) {
  game.disc.flight = null;
  game.disc.carrier = player.id;
  game.disc.pos = clone(player.pos);
  game.pulling = false; // caught or collected, the pull is over
  clearRoute(player); // catch and pivot: you stop where you caught it

  if (player.team === game.offense) {
    game.stall = 0; // endTurn counts this turn as the first of the new possession
    if (inAttackEndzone(game, player.team, player.pos)) {
      game.score[player.team] += 1;
      return { type: 'score', team: player.team, msg: `${player.id} scores! Point ${player.team}.` };
    }
    say(game, `${player.id} catches it.`);
    // The turn has done its work. Let them run the catch off, and the moment
    // they have pulled up the next one starts — no standing about.
    game.settling = { id: player.id, at: game.frame };
    return null;
  }
  game.offense = player.team;
  flipEnds(game); // they attack the end they were just defending
  game.stall = 1;
  return { type: 'turnover', msg: `${player.id} intercepts! ${player.team} on offence.` };
}

/**
 * A grounded disc is not handed to anyone. It lies where it stopped and the
 * receiving team has to go and get it, on their stall count.
 */
function groundIt(game, pos, msg) {
  const receiving = other(game.offense);
  game.offense = receiving;
  flipEnds(game); // they attack the end they were just defending
  game.disc.flight = null;
  game.disc.carrier = null;
  game.disc.loose = true;
  game.disc.pos = clone(pos);
  game.stall = 1;
  return { type: 'turnover', msg: `${msg} ${receiving} must pick it up.` };
}

/**
 * A pull nobody caught. Same as any disc on the ground except that possession
 * does not change — it was always theirs — and the stall count does not start
 * until they actually have it. Walking out to collect a good pull is not
 * something to be punished for; `game.pulling` stays set until they do.
 */
function groundPull(game, pos) {
  game.disc.flight = null;
  game.disc.carrier = null;
  game.disc.loose = true;
  game.disc.pos = clone(pos);
  game.stall = 1;
  return { type: 'turnover', msg: `The pull lands. ${game.offense} to collect.` };
}

/** Someone from the entitled team reaches the disc and it is live again. */
function tryPickup(game) {
  let best = null;
  let bd = PICKUP_R;
  for (const p of teamOf(game, game.offense)) {
    const d = dist(p.pos, game.disc.pos);
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  if (!best) return null;
  game.disc.loose = false;
  game.disc.carrier = best.id;
  clearRoute(best); // they pick it up on the run and pull up with it
  game.pulling = false;
  game.stall = 0;
  say(game, `${best.id} picks it up.`);
  return null;
}

/** Apply a terminal event; returns true if a whole new point was set up. */
export function applyEvent(game, ev) {
  say(game, ev.msg);
  if (ev.type === 'score') {
    if (game.score[ev.team] >= WIN_SCORE) {
      game.over = ev.team;
      game.phase = 'offense';
      say(game, `${ev.team} win it, ${game.score.A}–${game.score.B}.`);
      return true;
    }
    // Make it, take it: no pull, no reset, nobody walks anywhere. The scorers
    // keep the disc where they caught it and turn straight round.
    flipEnds(game);
    clearPlans(game);
    game.turn += 1;
    resetClock(game);
    game.stall = 1;
    game.phase = 'offense';
    say(game, `${ev.team} keep it — attacking the other way now.`);
    return true;
  }
  clearPlans(game);
  game.turn += 1;
  resetClock(game);
  game.phase = 'offense';
  return false;
}

/** Close out a turn that ran its full duration without a terminal event. */
export function endTurn(game) {
  // Routes are not wiped between turns: whatever they ran is spent and the
  // rest of the line they drew carries on into the next turn.
  syncRoles(game);
  game.pendingThrow = null;
  game.release = null;
  advanceRoutes(game);
  game.turn += 1;
  resetClock(game);

  // The clock runs on whoever the disc belongs to, whether they are holding it
  // or still jogging over to pick it up — but not on a pull they have not
  // reached yet. Nobody is stalling while the pull is still coming down.
  const holder = game.disc.carrier ? byId(game, game.disc.carrier) : null;
  const onTheClock = !game.pulling && (game.disc.loose || (holder && holder.team === game.offense));
  if (onTheClock) {
    game.stall += 1;
    if (game.stall > STALL_LIMIT) {
      const msg = game.disc.loose
        ? `Stall out — ${game.offense} never got to it!`
        : 'Stall out!';
      say(game, groundIt(game, game.disc.pos, msg).msg);
    } else {
      say(game, `Stall ${game.stall}.`);
    }
  }
  game.phase = 'offense';
}

/** How slow counts as pulled up. Braking zeroes velocity outright below this. */
const STOPPED = 0.05;

/**
 * Longest a catch may hold the turn open. Pulling up from top speed takes about
 * a second; this is the backstop for a catcher who never quite stops because a
 * defender is leaning on them.
 */
const SETTLE_MAX = 90; // frames

/**
 * A turn runs its full length — unless somebody caught it, in which case it
 * ends the moment the catcher has run the catch off and come to a stop.
 *
 * That cuts both ways, and deliberately. Catch early and the turn is over as
 * soon as they pull up rather than leaving everyone to mill about with the disc
 * in hand. Catch late, as most catches are, and the turn runs a beat past the
 * whistle so the catch finishes properly instead of being sliced in half.
 */
export function turnOver(game) {
  if (!game.settling) return game.frame >= TURN_STEPS;
  const p = byId(game, game.settling.id);
  if (!p || Math.hypot(p.vel.x, p.vel.y) <= STOPPED) return true;
  return game.frame - game.settling.at >= SETTLE_MAX;
}
