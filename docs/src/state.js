import { ARCHETYPES, DESTINATION_EPS, FIELD, REACT_LAG } from './constants.js';
import { add, clone, dist, mag, mul } from './vec.js';
import { cornerTable, previewAll } from './motion.js';
import { defaultCoverage } from './defense.js';

export const other = (team) => (team === 'A' ? 'B' : 'A');

/**
 * Which way the offence is running. It is not a property of the team: under
 * make-it-take-it a side that scores keeps the disc and turns straight round,
 * so the target end flips on every score and every turnover alike.
 */
export const attackDir = (game, team) => (team === game.offense ? game.attacking : -game.attacking);

/** The end changes hands. Called wherever possession does, and on a score. */
export const flipEnds = (game) => {
  game.attacking = -game.attacking;
};

export function inAttackEndzone(game, team, pos) {
  return attackDir(game, team) < 0 ? pos.y <= FIELD.endzone : pos.y >= FIELD.length - FIELD.endzone;
}

export const byId = (game, id) => game.players.find((p) => p.id === id);
export const teamOf = (game, team) => game.players.filter((p) => p.team === team);
export const carrier = (game) => (game.disc.carrier ? byId(game, game.disc.carrier) : null);

function makePlayer(id, team, pos, spec) {
  return {
    id,
    team,
    spec,
    pos: clone(pos),
    vel: { x: 0, y: 0 }, // carried between turns: momentum is yours to manage
    route: [], // the arrow you drew — pure intent, never trimmed
    path: [], // that intent sampled into a polyline to chase
    pathLen: 0,
    s: 0, // metres of the route consumed so far
    plan: [], // predicted trajectory for this turn, one point per physics step
    startAt: 0, // when in the turn they can first act on their decision
    marking: null, // who this defender has picked up, and stays on
    guardSpot: null, // a persistent space to defend instead of a matchup
    coverage: defaultCoverage(),
    biteRead: null, // one-turn commitment, captured only after the reaction beat
    momentumRead: null, // observed velocity and acceleration of the current matchup
  };
}

/**
 * The offence commits first and runs from the whistle. The defence only decides
 * once it has seen that first movement, so it can't act until REACT_LAG — and
 * whatever momentum it already had carries it until then.
 */
export function syncRoles(game) {
  for (const p of game.players) p.startAt = p.team === game.offense ? 0 : REACT_LAG;
}

/**
 * Which team the human is allowed to command right now, or null. The pull is
 * the one moment the disc is in the hands of the side that is not on offence,
 * so it follows the same rule the defence does: theirs unless the AI has it.
 */
export function controlledTeam(game) {
  if (game.over) return null;
  if (game.phase === 'pull') return game.aiDefense ? null : other(game.offense);
  if (game.phase === 'offense' || game.phase === 'throw') return game.offense;
  if (game.phase === 'defense' && !game.aiDefense) return other(game.offense);
  return null;
}

/**
 * A drawn route is straight legs between the anchors. A cut is a cut — you say
 * where you want the corner, and the body brakes into it and drives out of it.
 *
 * A player with a reaction beat gets the ground they drift through as the first
 * leg. Without it the line begins at where the turn found them, which for a
 * defender is a stride behind the body on screen — so the run appeared to come
 * out of the ghost they had already left. Costs nothing in play: they coast
 * through that leg before they may steer, so its corner is behind them by the
 * time braking applies.
 */
function buildPath(player) {
  if (player.route.length) {
    const legs = [clone(player.pos)];
    const drift = mul(player.vel, player.startAt);
    if (mag(drift) > 0.3) legs.push(add(player.pos, drift));
    for (const a of player.route) legs.push(clone(a));
    player.path = legs;
    player.cum = [0];
    let acc = 0;
    for (let i = 1; i < player.path.length; i++) {
      acc += dist(player.path[i - 1], player.path[i]);
      player.cum.push(acc);
    }
    player.pathLen = acc;
  } else {
    player.path = [];
    player.cum = [0];
    player.pathLen = 0;
  }
  player.corners = cornerTable(player.path, player.cum);
  player.s = 0;
}

/** How many leading path points are not drawn anchors: the body, plus any drift. */
const leadIn = (player) => player.path.length - player.route.length;

/** Arc length along the built path at which each drawn anchor sits. */
const anchorArcLengths = (player) => player.route.map((_, i) => player.cum[i + leadIn(player)]);

/**
 * Rebuild every player's predicted trajectory, projected PLAN_TURNS turns
 * ahead with the same physics the simulation runs — so a cut too sharp for
 * their agility shows up in the drawn line before you commit to it.
 *
 * What it does *not* show is anybody else. Each body is run alone, down its own
 * route, as though the field were empty. Whether a defender is standing in that
 * lane is the turn's to reveal.
 */
export function refreshPreviews(game) {
  for (const p of game.players) buildPath(p);
  const runs = previewAll(game.players);
  game.players.forEach((p, i) => {
    p.plan = runs[i].trajectory;
    p.arc = runs[i].arc; // route spent at each frame, so a line can start where the body is
    p.reached = runs[i].endS; // how much of the route the projection covers
    p.marks = runs[i].marks; // ...and where it had got to at each turn boundary
  });
}

/** A player's route was edited: rebuild their line. Nobody else is affected. */
export function applyRoute(player) {
  buildPath(player);
  const [run] = previewAll([player]);
  player.plan = run.trajectory;
  player.arc = run.arc;
  player.reached = run.endS;
  player.marks = run.marks;
  return player.reached;
}

/**
 * Carry routes into the next turn. Whatever they ran is spent; the rest of the
 * line they drew stays, rebuilt from where they have got to — so a route drawn
 * five turns deep keeps playing itself out turn after turn.
 */
export function advanceRoutes(game) {
  for (const p of game.players) {
    if (!p.route.length) continue;
    const arc = anchorArcLengths(p);
    const last = p.route.length - 1;
    p.route = p.route.filter(
      (anchor, i) => arc[i] > p.s + 0.25 || (i === last && dist(p.pos, anchor) > DESTINATION_EPS),
    );
  }
  refreshPreviews(game);
}

/** Wipe one player's line. Still moving: the preview becomes their run-down. */
export function clearRoute(player) {
  player.route.length = 0;
  applyRoute(player);
}

export function createGame() {
  const game = {
    phase: 'offense', // offense | defense | throw | resolve
    turn: 1,
    t: 0,
    score: { A: 0, B: 0 },
    frame: 0,
    offense: 'A',
    attacking: -1, // which way the offence runs; flips on a score or a turnover
    over: null, // the team that got to WIN_SCORE first
    stall: 1,
    players: [],
    disc: { pos: { x: 0, y: 0 }, carrier: null, flight: null, loose: false },
    pendingThrow: null,
    pulling: false, // the disc is a pull in the air, not a pass
    settling: null, // a receiver running off a catch: the turn ends when they stop
    release: null, // a committed throw waiting on the thrower's reaction beat
    aiDefense: false,
    log: [],
  };
  setupPoint(game, 'A');
  say(game, `${other(game.offense)} to pull. ${game.offense} receiving.`);
  return game;
}

/**
 * A game starts with a pull: both lines on their own goal line, the full length
 * of the field between them, and the disc in the hands of the team that is
 * about to give it away. Nothing else in the game sets up like this — under
 * make-it-take-it a score does not stop play, so this happens once.
 */
export function setupPoint(game, receivingTeam) {
  const pullingTeam = other(receivingTeam);
  const dir = receivingTeam === 'A' ? -1 : 1; // A opens attacking the top
  game.attacking = dir;

  // Each side stands on the goal line of the endzone it is defending, which for
  // the receivers is the one behind them and for the pullers is the one they
  // are about to throw away from.
  const receiveLine = dir < 0 ? FIELD.length - FIELD.endzone : FIELD.endzone;
  const pullLine = dir < 0 ? FIELD.endzone : FIELD.length - FIELD.endzone;
  // Fractions of the width, not metres: 20 yards across only has room for three
  // bodies if they are spread by a share of it.
  const across = [FIELD.width / 2, FIELD.width * 0.22, FIELD.width * 0.78];

  game.players = [];
  across.forEach((x, i) => {
    game.players.push(makePlayer(`${receivingTeam}${i}`, receivingTeam, { x, y: receiveLine }, ARCHETYPES[i]));
    game.players.push(makePlayer(`${pullingTeam}${i}`, pullingTeam, { x, y: pullLine }, ARCHETYPES[i]));
  });

  // The receivers are already the offence — the pull is a gift, not a contest.
  game.offense = receivingTeam;
  game.disc = { pos: { x: FIELD.width / 2, y: pullLine }, carrier: `${pullingTeam}0`, flight: null, loose: false };
  game.pulling = true;
  game.pendingThrow = null;
  game.release = null;
  game.stall = 1;
  game.t = 0;
  game.frame = 0;
  game.settling = null;
  game.phase = 'pull';
  syncRoles(game);
  refreshPreviews(game);
}

export function say(game, msg) {
  game.log.unshift(`T${game.turn} · ${msg}`);
  if (game.log.length > 40) game.log.pop();
}

/** Possession changed: every line goes, and everyone is re-run against it. */
export function clearPlans(game) {
  syncRoles(game);
  for (const p of game.players) {
    p.route.length = 0;
    p.marking = null;
    p.guardSpot = null;
    p.coverage = defaultCoverage();
    p.biteRead = null;
    p.momentumRead = null;
  }
  game.pendingThrow = null;
  game.release = null;
  refreshPreviews(game);
}

export function nearestOf(game, team, pos) {
  let best = null;
  let bd = Infinity;
  for (const p of teamOf(game, team)) {
    const d = dist(p.pos, pos);
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  return best;
}
