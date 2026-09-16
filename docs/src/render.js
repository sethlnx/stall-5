import {
  ARC_SAMPLES,
  CATCH_R,
  COLORS,
  EXTEND_GRIP_PX,
  FIELD,
  PICKUP_R,
  PLAYER_R,
  REACT_LAG,
  RELEASE_AT,
  TELL_LENGTH,
  TOUCH_END_PX,
  TOUCH_GRIP_PX,
  TOUCH_GRAB_PX,
  TURN_TIME,
} from './constants.js';
import { add, arcApex, arcPoints, closestOnPolyline, dist, mul, polylineLength, projectAlong, splitPolyline, sub } from './vec.js';
import { attackDir, byId, controlledTeam, other, teamOf } from './state.js';
import { discFlightTime, discReach, frameAt } from './motion.js';
import { BITE_TIME, bounded, coverageOffset } from './defense.js';
import { arrow, circle, label, line, polyline, roundedRect } from './draw.js';

/**
 * The model keeps x across the field and y down its length. The view lays that
 * out one of two ways, and everything else draws through `toPx` and rotates for
 * free:
 *
 * - **landscape** — a quarter turn, so the pitch lies on its side and its
 *   length runs left to right. A mouse, and a board sized to hold it.
 * - **portrait** — that same picture turned another 90° clockwise, so the
 *   length runs up and down the screen. It is a rotation and not a mirror, so
 *   nothing learned in one reads backwards in the other, and it is the shape
 *   that spends a phone's width on the pitch instead of on margin.
 *
 * A mini pitch is 1.5 long to 1 wide, so portrait on a phone is **width-limited**
 * — the 20 yards across is what runs out first, and the margin is the only thing
 * between the sideline and the edge of the screen. It is a fingertip's worth,
 * enough that a body standing on the line is still drawn whole.
 *
 * `touch` rides along on the view because the things that have to grow for a
 * fingertip are all sized against `scale`.
 */
export function makeView(canvas, mode = {}, margin = mode.touch ? 10 : 22) {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const portrait = !!mode.portrait;
  const across = portrait ? w : h; // pixels the 20-yard width has to fit in
  const along = portrait ? h : w; // ...and the 30-yard length
  const scale = Math.min((across - 2 * margin) / FIELD.width, (along - 2 * margin) / FIELD.length);
  return {
    scale,
    ox: (w - (portrait ? FIELD.width : FIELD.length) * scale) / 2,
    oy: (h - (portrait ? FIELD.length : FIELD.width) * scale) / 2,
    w,
    h,
    portrait,
    touch: !!mode.touch,
  };
}

export const toPx = (v, p) =>
  v.portrait
    ? { x: v.ox + p.x * v.scale, y: v.oy + p.y * v.scale }
    : { x: v.ox + p.y * v.scale, y: v.oy + (FIELD.width - p.x) * v.scale };

export const toField = (v, p) =>
  v.portrait
    ? { x: (p.x - v.ox) / v.scale, y: (p.y - v.oy) / v.scale }
    : { x: FIELD.width - (p.y - v.oy) / v.scale, y: (p.x - v.ox) / v.scale };

/**
 * A grip's drawn radius. On a mouse it is a distance in metres like everything
 * else on the field; under a fingertip it has a pixel floor, because a dot the
 * size of the thing you are pointing with cannot be aimed at.
 */
const gripR = (v, metres, minPx) => (v.touch ? Math.max(metres * v.scale, minPx) : metres * v.scale);
const pxPath = (v, pts) => pts.map((p) => toPx(v, p));
const FONT = 'ui-sans-serif, system-ui, sans-serif';

function drawField(ctx, v, game) {
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, v.w, v.h);

  const a = toPx(v, { x: 0, y: 0 });
  const b = toPx(v, { x: FIELD.width, y: FIELD.length });
  roundedRect(ctx, Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y), 3, {
    color: COLORS.line,
    width: 1.5,
    alpha: 0.8,
  });

  for (const y of [FIELD.endzone, FIELD.length - FIELD.endzone]) {
    line(ctx, toPx(v, { x: 0, y }), toPx(v, { x: FIELD.width, y }), {
      color: COLORS.line,
      width: 1.5,
      alpha: 0.55,
    });
  }

  // Which end is worth anything changes hands, so the labels follow the play
  // rather than the team names. Each sits inside its own endzone, which is one
  // field point and so needs no idea of which way the pitch is lying — but 5
  // yards of endzone is only about a label's length, so they sit 40% of the way
  // in rather than halfway, clear of a body standing on the goal line.
  const opts = { color: COLORS.line, font: `9px ${FONT}`, alpha: 0.3 };
  const near = game.attacking < 0 ? game.offense : other(game.offense); // the y = 0 end
  for (const [team, y] of [
    [near, FIELD.endzone * 0.4],
    [other(near), FIELD.length - FIELD.endzone * 0.4],
  ]) {
    const at = toPx(v, { x: FIELD.width / 2, y });
    label(ctx, `${team} ATTACKS`, at.x, at.y, opts);
  }
}

/** Trajectories are one point per physics step: thin them out to draw. */
function thin(pts, every = 6) {
  if (pts.length <= 2) return pts;
  const out = [];
  for (let i = 0; i < pts.length; i += every) out.push(pts[i]);
  const last = pts[pts.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

/** What a player looks like at turn-time T: where they are, and their run. */
function viewOf(p, T) {
  if (!p.plan.length) return { at: p.pos, i: 0, trail: null, rest: null, vel: p.vel };
  const i = frameAt(p.plan, T);
  const prev = p.plan[Math.max(0, i - 1)];
  const here = p.plan[i];
  return {
    at: here,
    i,
    trail: i > 0 ? p.plan.slice(0, i + 1) : null,
    rest: i < p.plan.length - 1 ? p.plan.slice(i) : null,
    vel: mul(sub(here, prev), 60),
  };
}

// How solid the line is for this turn, the next, the one after...
const TURN_FADE = [0.95, 0.6, 0.42, 0.3, 0.22, 0.17, 0.14, 0.12];

/**
 * How much of the route is behind the body being drawn, so the line starts at
 * the circle rather than at the hollow ghost a reaction beat behind it.
 *
 * Taken by projecting the body onto its own route rather than by reading the
 * arc the physics has spent. The two agree while a player is on their line, but
 * a body that has overshot and is doubling back — a mark pulling up onto a
 * standoff, say — is metres from the arc it has notionally consumed, and the
 * line has to start where they are, not where the bookkeeping says.
 */
function spentAt(player, at) {
  if (!at) return player.s; // resolving: the sim's own progress is the truth
  const path = player.path;
  if (!path || path.length < 2) return 0;
  const hit = closestOnPolyline(path, at);
  return player.cum[hit.index] + dist(path[hit.index], hit.point);
}

/**
 * The line as drawn — straight legs, sharp corners — cut into turns. The
 * stretch covered this turn is solid and every turn after it steps back, with a
 * pip on each boundary, so a route drawn five stalls deep reads as five legs.
 *
 * The boundaries come from the projection, which brakes into every corner, so
 * a route full of hard cuts visibly gets through less of itself per turn than a
 * straight sprint of the same length.
 *
 * `ran` is the route already spent at the moment being drawn, which is what
 * makes the line leave the body rather than the hollow ghost behind it. On
 * defence the two are a reaction beat apart and starting from the ghost looked
 * like the run belonged to something that was not there.
 */
function drawPlan(ctx, v, player, color, ran = 0) {
  const path = player.path;
  if (!path || path.length < 2 || player.pathLen - ran < 0.6) return;
  const marks = player.marks ?? [];

  let from = Math.min(ran, player.pathLen);
  for (let turn = 0; turn < marks.length && from < player.pathLen - 1e-6; turn++) {
    const to = Math.min(marks[turn], player.pathLen);
    if (to <= from + 1e-6) continue;
    const seg = splitPolyline(splitPolyline(path, from).after, to - from).before;
    if (seg.length < 2) continue;
    const fade = TURN_FADE[Math.min(turn, TURN_FADE.length - 1)];
    const opts = { color, width: turn === 0 ? 2 : 1.5, alpha: fade, head: 8 };
    if (to >= player.pathLen - 1e-6) arrow(ctx, pxPath(v, seg), opts);
    else {
      polyline(ctx, pxPath(v, seg), opts);
      const pip = toPx(v, seg.at(-1));
      circle(ctx, pip.x, pip.y, 2.2, { fill: color, alpha: fade });
    }
    from = to;
  }

  // drawn further than they are projected to get in the turns we look ahead
  if (player.pathLen - from > 0.5) {
    const tail = splitPolyline(path, from).after;
    polyline(ctx, pxPath(v, tail), { color, width: 1, alpha: 0.12, dash: [3, 5] });
  }
}

/**
 * Where the offence came from: hollow origin, faint trail. It is there so the
 * defence can see the beat of movement it is reacting to.
 *
 * The defence gets none of it. Their own prior position is not information they
 * are reading — it is just where they happened to be a moment ago — and drawing
 * a hollow circle behind every defender made their run look like it belonged to
 * the circle rather than to the body.
 */
function drawTrail(ctx, v, game, p, view) {
  if (p.team !== game.offense) return;
  if (!view.trail || polylineLength(view.trail) < 0.15) return;
  const c = COLORS[p.team];
  const origin = toPx(v, view.trail[0]);
  circle(ctx, origin.x, origin.y, PLAYER_R * v.scale, { color: c.ring, width: 1, alpha: 0.3 });
  polyline(ctx, pxPath(v, thin(view.trail, 4)), { color: c.ring, width: 1.5, alpha: 0.45, dash: [3, 3] });
}

/** Momentum, made legible: a tick in the direction of travel, scaled by speed. */
function drawMomentum(ctx, v, p, view) {
  const speed = Math.hypot(view.vel.x, view.vel.y);
  if (speed < 0.4) return;
  const dir = mul(view.vel, 1 / speed);
  const len = PLAYER_R + (speed / p.spec.maxSpeed) * 1.6;
  line(ctx, toPx(v, add(view.at, mul(dir, PLAYER_R * 0.6))), toPx(v, add(view.at, mul(dir, len))), {
    color: COLORS[p.team].ring,
    width: 2.5,
    alpha: 0.85,
  });
}

/** The token is the body now: 0.85 m of shoulders, which at this scale is a
 *  35 px disc and still holds its label. Two players in contact no longer
 *  overlap on screen, because the drawing is finally the same size as the thing. */
function drawPlayer(ctx, v, p, at, active) {
  const c = COLORS[p.team];
  const pos = toPx(v, at);
  const r = PLAYER_R * v.scale;
  circle(ctx, pos.x, pos.y, r, { fill: c.fill, color: active ? '#fff' : c.ring, width: active ? 2.5 : 1.8 });
  label(ctx, p.id, pos.x, pos.y, { color: c.text, font: `${Math.round(r * 0.8)}px ${FONT}` });
}

function drawDisc(ctx, v, game, views) {
  const holder = !game.disc.flight && game.disc.carrier ? byId(game, game.disc.carrier) : null;
  const at = holder
    ? add(views.get(holder.id).at, { x: PLAYER_R * 0.8, y: attackDir(game, holder.team) * PLAYER_R * 0.5 })
    : game.disc.pos;
  const pos = toPx(v, at);
  if (game.disc.loose) {
    circle(ctx, pos.x, pos.y, PICKUP_R * v.scale, {
      color: COLORS[game.offense].ring,
      width: 1.5,
      alpha: 0.6,
      dash: [4, 4],
    });
  }
  circle(ctx, pos.x, pos.y, 0.3 * v.scale, { fill: COLORS.disc, color: '#0d0f0e', width: 1 });
}

const throwArc = (t, from) => arcPoints(from, t.to, t.bow, ARC_SAMPLES);

/**
 * The disc only covers so much ground before the turn ends: that part is white,
 * the rest is grey. A white dotted ring sits on the boundary — where the disc
 * actually is when the whistle goes, drawn at catching radius, so you can plan
 * a cut that arrives on it. Receivers get their own ring where they will be
 * when it finally comes down.
 */
function drawThrow(ctx, v, game, aim, ui, views) {
  const t = aim ?? game.pendingThrow;
  if (!t) return;
  const from = views.get(t.from).at;
  const arc = throwArc(t, from);
  const thisTurn = discReach(Math.max(0, TURN_TIME - RELEASE_AT));
  const { before, after } = splitPolyline(arc, thisTurn);

  polyline(ctx, pxPath(v, after), { color: COLORS.late, width: 2, alpha: 0.85, dash: [6, 5] });
  arrow(ctx, pxPath(v, arc), { color: COLORS.late, width: 0, alpha: 0.85, head: 8 });
  polyline(ctx, pxPath(v, before), { color: COLORS.disc, width: 2.5, dash: [6, 5] });
  if (after.length < 2) arrow(ctx, pxPath(v, arc), { color: COLORS.disc, width: 0, head: 8 });

  const turnEnd = toPx(v, before.at(-1));
  circle(ctx, turnEnd.x, turnEnd.y, CATCH_R * v.scale, {
    color: COLORS.disc,
    width: 1.3,
    alpha: 0.85,
    dash: [2, 4],
  });

  const arrival = RELEASE_AT + discFlightTime(polylineLength(arc));
  for (const p of teamOf(game, game.offense)) {
    if (p.id === t.from || !p.plan.length) continue;
    const at = toPx(v, p.plan[frameAt(p.plan, arrival)]);
    circle(ctx, at.x, at.y, CATCH_R * v.scale, {
      color: COLORS[game.offense].ring,
      width: 1.2,
      alpha: 0.6,
      dash: [3, 4],
    });
  }

  if (aim || (game.phase !== 'offense' && game.phase !== 'pull')) return;
  // grips: the curve at the apex, the target at the end
  const apex = toPx(v, arcApex(from, t.to, t.bow));
  circle(ctx, apex.x, apex.y, gripR(v, 0.4, TOUCH_END_PX), {
    fill: ui.drag?.mode === 'bow' ? COLORS.disc : COLORS.bg,
    color: COLORS.disc,
    width: 1.5,
  });
  const tip = toPx(v, t.to);
  circle(ctx, tip.x, tip.y, gripR(v, 0.5, TOUCH_END_PX), {
    fill: ui.drag?.mode === 'aim' ? COLORS.disc : COLORS.bg,
    color: COLORS.disc,
    width: 1.8,
  });
}

/**
 * What the defence can read: the first few metres of the actual flight, so a
 * heavy bend looks like a bend from the moment it leaves the hand.
 */
function drawTell(ctx, v, game, views) {
  const t = game.pendingThrow;
  if (!t) return;
  const from = views.get(t.from).at;
  const arc = throwArc(t, from);
  const seen = splitPolyline(arc, TELL_LENGTH).before;
  arrow(ctx, pxPath(v, seen), { color: COLORS.disc, width: 2, alpha: 0.75, dash: [4, 4], head: 7 });
}

/** The rest of a throw already in the air. */
function drawFlight(ctx, v, game) {
  const f = game.disc.flight;
  if (!f) return;
  polyline(ctx, pxPath(v, [f.origin, ...f.rest]), {
    color: COLORS.late,
    width: 1.5,
    alpha: 0.4,
    dash: [5, 6],
  });
}

/**
 * Where the "add a leg" grip sits: a thumb's width past the end of the arrow,
 * carrying straight on from its last leg. Shift-drag does this job on a mouse,
 * and touch has no shift key, so the same move needs somewhere to put a finger.
 * Null when the arrow has no direction to carry on in.
 */
export function extendGripAt(v, game, p) {
  if (!p.route.length) return null;
  const tip = p.route.at(-1);
  const d = sub(tip, p.route.length > 1 ? p.route.at(-2) : drawnAt(game, p));
  const len = Math.hypot(d.x, d.y);
  if (len < 1e-6) return null;
  return add(tip, mul(d, EXTEND_GRIP_PX / v.scale / len));
}

/** Bends are dots; the end of the arrow is the grip you pull, and on touch the
 * dotted `+` past it starts a fresh leg. */
function drawHandles(ctx, v, game) {
  const team = controlledTeam(game);
  if (!team || game.phase === 'throw' || game.phase === 'defense') return;
  for (const p of teamOf(game, team)) {
    if (p.id === game.disc.carrier || !p.route.length) continue;
    const last = p.route.length - 1;
    p.route.forEach((a, i) => {
      const q = toPx(v, a);
      circle(ctx, q.x, q.y, i === last ? gripR(v, 0.45, TOUCH_END_PX) : gripR(v, 0.25, TOUCH_GRIP_PX), {
        fill: COLORS.bg,
        color: COLORS[p.team].ring,
        width: i === last ? 1.8 : 1.2,
      });
    });

    const ext = v.touch ? extendGripAt(v, game, p) : null;
    if (!ext) continue;
    const ring = COLORS[p.team].ring;
    const q = toPx(v, ext);
    const r = TOUCH_END_PX * 0.95;
    line(ctx, toPx(v, p.route[last]), q, { color: ring, width: 1, alpha: 0.35, dash: [2, 3] });
    circle(ctx, q.x, q.y, r, { fill: COLORS.bg, color: ring, width: 1.4, alpha: 0.9 });
    label(ctx, '+', q.x, q.y, { color: ring, font: `${Math.round(r * 1.6)}px ${FONT}`, alpha: 0.9 });
  }
}

/** The moment each phase is deciding about. */
function phaseTime(game) {
  if (game.phase === 'defense') return REACT_LAG;
  if (game.phase === 'throw') return RELEASE_AT;
  if (game.phase === 'resolve') return game.t;
  return 0;
}

/**
 * Where a player is actually drawn right now. On defence that is a reaction
 * beat downfield of where their turn began, so it is not `p.pos` — and the
 * pointer has to aim at the body you can see, not the ghost it started from.
 */
export const drawnAt = (game, p) =>
  game.phase === 'resolve' || game.liveDecision || !p.plan.length ? p.pos : viewOf(p, playerViewTime(game, p)).at;

// Automatic coverage has no knowable future trajectory. Show the reaction
// snapshot while committing, rather than a fictional coast-to-stop preview.
const playerViewTime = (game, p) => p.team !== game.offense && p.marking
  ? Math.min(phaseTime(game), REACT_LAG) : phaseTime(game);

/** Small shoulder markers describe coverage; they are not promised run paths. */
function drawCoverage(ctx, v, game, ui) {
  for (const p of teamOf(game, other(game.offense))) {
    const active = p.id === ui.activeId;
    if (!active) continue;
    const drag = active && ui.drag?.mode === 'defend' && dist(ui.drag.origin, ui.drag.to) > 0.4 ? ui.drag : null;
    const space = drag ? drag.fixed : !!p.guardSpot;
    let mark = byId(game, p.marking);
    if (drag && !space && !mark) {
      mark = teamOf(game, game.offense).sort((a, b) => dist(drawnAt(game, a), drag.to) - dist(drawnAt(game, b), drag.to))[0];
    }
    const hovered = drag && !space && teamOf(game, game.offense)
      .map(p => ({ p, d: dist(drawnAt(game, p), drag.to) }))
      .filter(({ d }) => d <= PLAYER_R + (v.touch ? TOUCH_GRAB_PX / v.scale : 0))
      .sort((a, b) => a.d - b.d)[0]?.p;
    if (hovered) mark = hovered;
    const target = space ? (drag?.to ?? p.guardSpot) : (mark && drawnAt(game, mark));
    if (!target) continue;
    const from = toPx(v, drawnAt(game, p));
    const to = toPx(v, target);
    const color = COLORS[p.team].ring;
    if (active) line(ctx, from, to, { color, width: 1, alpha: 0.45, dash: [3, 6] });
    circle(ctx, to.x, to.y, (space ? 1.5 : PLAYER_R + 0.25) * v.scale, {
      color, width: active ? 2 : 1, alpha: active ? 0.9 : 0.35, dash: space ? [4, 4] : [],
    });
    const biting = game.phase === 'resolve' || game.liveDecision
      ? p.biteRead && game.t - p.biteRead.at < BITE_TIME
      : p.coverage.bite;
    if (mark && !space && !hovered) {
      const offset = coverageOffset(p.coverage, attackDir(game, mark.team), mark.id === game.disc.carrier, biting);
      const shoulder = toPx(v, bounded(drag?.to ?? add(target, offset)));
      const shade = biting ? '#efb06a' : color;
      circle(ctx, shoulder.x, shoulder.y, (drag || p.coverage.offset ? PLAYER_R : 0.6) * v.scale, { fill: shade, color: shade, width: 1, alpha: 0.35 });
      arrow(ctx, [to, shoulder], { color: shade, width: 2.5, alpha: 0.7, head: 6 });
    }
    const job = mark?.id === game.disc.carrier ? `FORCE ${p.coverage.force.toUpperCase()}`
      : `${biting ? 'BITE ' : ''}${p.coverage.priority.toUpperCase()}`;
    label(ctx, hovered ? `MARK ${hovered.id}` : space ? 'GUARD SPACE' : drag || p.coverage.offset ? `FOLLOW ${mark.id}` : `${p.marking} · ${job}`, from.x, from.y + PLAYER_R * v.scale + 12, {
      color: biting ? '#efb06a' : color, font: `10px ${FONT}`, alpha: active ? 1 : 0.7,
    });
  }
}

export function render(ctx, v, game, ui) {
  drawField(ctx, v, game);

  const resolving = game.phase === 'resolve' || game.liveDecision;
  const deciding = game.phase === 'throw';
  const owner = game.phase === 'defense' ? other(game.offense) : game.offense;
  const showBoth = resolving || deciding;

  const views = new Map();
  for (const p of game.players) {
    const view = resolving ? { at: p.pos, trail: null, rest: null, vel: p.vel } : viewOf(p, playerViewTime(game, p));
    views.set(p.id, view);
    if (game.phase !== 'defense') drawTrail(ctx, v, game, p, view);
  }

  for (const p of game.players) {
    if (!showBoth && p.team !== owner) continue;
    if (game.phase === 'defense' || game.phase === 'throw') continue;
    if (p.team !== game.offense && (p.marking || p.guardSpot)) continue;
    drawPlan(ctx, v, p, COLORS[p.team].ring, spentAt(p, resolving ? null : drawnAt(game, p)));
  }

  if (game.phase === 'defense' || deciding || resolving) drawCoverage(ctx, v, game, ui);

  for (const p of game.players) {
    const view = views.get(p.id);
    drawMomentum(ctx, v, p, view);
    drawPlayer(ctx, v, p, view.at, ui.activeId === p.id);
  }

  drawFlight(ctx, v, game);
  if (game.phase === 'defense') drawTell(ctx, v, game, views);
  else if (game.phase === 'offense' || game.phase === 'pull' || deciding) drawThrow(ctx, v, game, ui.aim, ui, views);
  drawDisc(ctx, v, game, views);
  drawHandles(ctx, v, game);
}
