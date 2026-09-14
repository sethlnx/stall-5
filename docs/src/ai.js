import { FIELD, PULL_RANGE } from './constants.js';
import { clamp, dist } from './vec.js';
import { BITE_TIME, bounded, committedIntent, coverageIntent, defaultCoverage } from './defense.js';
import { applyRoute, attackDir, clearRoute, teamOf } from './state.js';

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
    if (d.guardSpot) { d.marking = null; continue; }
    const still = d.marking && offense.some((o) => o.id === d.marking) && !taken.has(d.marking);
    if (still) taken.add(d.marking);
    else d.marking = null;
  }
  for (const d of defenders) {
    if (d.marking || d.guardSpot) continue;
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

/** Coverage is a policy. Only a deliberately guarded spot gets a fixed route. */
export function planDefense(game, defTeam) {
  const offense = teamOf(game, game.offense);
  const defenders = teamOf(game, defTeam);
  assignMarks(defenders, offense);
  for (const d of defenders) {
    clearRoute(d);
    d.biteRead = null;
    if (d.guardSpot) setChase(d, d.guardSpot);
  }
}

/** Compute all steering commands before anyone moves, from the live snapshot.
 * The initial reaction beat and normal acceleration/braking still apply.
 */
export function defenseSteering(game, t) {
  const intents = new Map();
  for (const d of teamOf(game, game.offense === 'A' ? 'B' : 'A')) {
    if (d.guardSpot || t < d.startAt) continue;
    const mark = game.players.find((p) => p.id === d.marking && p.team === game.offense);
    if (!mark) continue;
    const carrying = mark.id === game.disc.carrier;
    const dir = attackDir(game, mark.team);
    // Biting on a receiver is optional and happens once, not every frame.
    if (d.coverage.bite && !carrying && !d.biteRead) {
      d.biteRead = { ...coverageIntent(d.coverage, mark, dir, false, true), at: t };
    }
    const read = d.biteRead;
    intents.set(d.id, read && !carrying && t - read.at < BITE_TIME
      ? committedIntent(read, t - read.at)
      : coverageIntent(d.coverage, mark, dir, carrying));
  }
  return intents;
}

export function setCoverage(game, defender, patch) {
  if (game.phase !== 'defense' || defender.team === game.offense || defender.guardSpot) return;
  if (patch.force === 'left' || patch.force === 'right') defender.coverage.force = patch.force;
  if (patch.priority === 'under' || patch.priority === 'deep') defender.coverage.priority = patch.priority;
  if (typeof patch.bite === 'boolean') defender.coverage.bite = patch.bite;
  defender.biteRead = null;
}

/** Switching a matchup trades assignments so nobody is accidentally left free. */
export function assignDefender(game, defender, target) {
  if (defender.team === game.offense || target.team !== game.offense) return;
  const teammate = teamOf(game, defender.team).find((p) => p !== defender && p.marking === target.id);
  if (teammate) {
    teammate.marking = defender.marking;
    teammate.guardSpot = defender.guardSpot ? { ...defender.guardSpot } : null;
  }
  defender.marking = target.id;
  defender.guardSpot = null;
  planDefense(game, defender.team);
}

export function guardSpace(game, defender, spot) {
  defender.marking = null;
  defender.guardSpot = bounded(spot);
  planDefense(game, defender.team);
}

export function resetDefense(game, defTeam) {
  for (const d of teamOf(game, defTeam)) {
    d.marking = null;
    d.guardSpot = null;
    d.coverage = defaultCoverage();
  }
  planDefense(game, defTeam);
}

/** Send them at the cover point. `buildPath` handles the beat they cannot act on. */
function setChase(d, aim) {
  d.route = [bounded(aim)];
  applyRoute(d);
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
