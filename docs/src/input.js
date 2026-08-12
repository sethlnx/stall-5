import {
  FIELD,
  GRAB_R,
  HANDLE_GRAB,
  LINE_GRAB,
  PLAYER_R,
  MAX_BOW,
  MAX_BOW_RATIO,
  MAX_THROW,
  PULL_RANGE,
  THROW_MIN,
  TOUCH_GRAB_PX,
  TOUCH_TAP_PX,
} from './constants.js';
import { add, arcApex, clamp, closestOnPolyline, dist, lerp, mul, norm, perp, sub } from './vec.js';
import { applyRoute, byId, clearRoute, controlledTeam, teamOf } from './state.js';
import { drawnAt, extendGripAt, toField } from './render.js';

const inBounds = (p) => ({
  x: clamp(p.x, 0.4, FIELD.width - 0.4),
  y: clamp(p.y, 0.4, FIELD.length - 0.4),
});

const TAP_CLEAR = 0.4; // an anchor that moved less than this was a tap on the body
const TAP_BEND = 0.2; // ...or on the line, and should not leave a bend behind

/**
 * How much slack every pick radius gets. A mouse gets none: the constants are in
 * metres, and twenty pixels to the metre makes them 17–29 px targets already. A
 * fingertip is nearer 9 mm across, so on touch each threshold is widened by the
 * same pixel amount — uniformly, so the tiers and "nearest wins" still order
 * things as they did.
 */
const grabSlop = (v) => (v.touch ? TOUCH_GRAB_PX / v.scale : 0);

/** A press that never really moved. Floored in pixels, because that is what a thumb rolls. */
const tapSlop = (v, metres) => Math.max(metres, (v.touch ? TOUCH_TAP_PX : 0) / v.scale);

export function bindInput(canvas, getGame, ui, getView) {
  const pt = (e) => {
    const r = canvas.getBoundingClientRect();
    return toField(getView(), { x: e.clientX - r.left, y: e.clientY - r.top });
  };

  /** Signed sideways offset of `at` from the throw's chord, clamped. */
  const bowAt = (from, to, at) => {
    const chord = sub(to, from);
    const len = Math.hypot(chord.x, chord.y);
    if (len < 1e-6) return 0;
    const n = perp({ x: chord.x / len, y: chord.y / len });
    const rel = sub(at, lerp(from, to, 0.5));
    const limit = Math.min(MAX_BOW, MAX_BOW_RATIO * len);
    return clamp(rel.x * n.x + rel.y * n.y, -limit, limit);
  };

  /** Dragging a player winds up a throw (carrier) or starts a run arrow. */
  const grabPlayer = (game, p, at) => {
    if (p.id === game.disc.carrier) {
      const t = game.pendingThrow;
      ui.aim = { from: p.id, to: at, bow: t && t.from === p.id ? t.bow : 0 };
      return { mode: 'throw', player: p };
    }
    p.route = [at];
    applyRoute(p);
    return { mode: 'anchor', player: p, index: 0, fresh: true, origin: { ...at } };
  };

  /**
   * Grabbing the drawn line adds a bend where you grabbed it. The path carries
   * the body on the front, and for anyone with a reaction beat the ground they
   * drift through as well, so drop those before reading off the leg.
   */
  const grabLine = (game, p, hit) => {
    const lead = p.path.length - p.route.length;
    const i = clamp(hit.index - (lead - 1), 0, Math.max(0, p.route.length - 1));
    p.route.splice(i, 0, hit.point);
    applyRoute(p);
    return { mode: 'anchor', player: p, index: i, inserted: true, origin: hit.point };
  };

  /**
   * Add a leg to the end of a route and grab its new end. Shift does this on a
   * mouse; on touch it is the `+` grip drawn past the tip.
   */
  const extendRoute = (p) => {
    const from = { ...p.route.at(-1) };
    p.route.push({ ...from });
    applyRoute(p);
    return { mode: 'anchor', player: p, index: p.route.length - 1, inserted: true, origin: from };
  };

  canvas.addEventListener('pointerdown', (e) => {
    const game = getGame();
    const team = controlledTeam(game);
    // By the release decision everything is committed: it is release or fake.
    if (!team || game.phase === 'throw') return;
    if (ui.drag) return; // one drag at a time: a second finger is not a second plan
    const v = getView();
    const slop = grabSlop(v);
    const at = pt(e);
    const mine = teamOf(game, team);

    // Tiers, matching what is drawn on top of what: throw handles beat bodies,
    // a body beats every line and grip near it — grabbing a player always means
    // "start this player again" — then grips, then the line, then the loose 3m
    // body grab.
    let best = null;
    const consider = (tier, d, make) => {
      if (!best || tier < best.tier || (tier === best.tier && d < best.d)) best = { tier, d, make };
    };

    const t = game.pendingThrow;
    if ((game.phase === 'offense' || game.phase === 'pull') && t) {
      const thrower = byId(game, t.from);
      const apex = dist(arcApex(thrower.pos, t.to, t.bow), at);
      if (apex <= HANDLE_GRAB + slop) consider(0, apex, () => ({ mode: 'bow', player: thrower }));
      // the end of the throw arrow re-aims it, keeping whatever curve you set
      const tip = dist(t.to, at);
      if (tip <= HANDLE_GRAB + slop) {
        consider(0, tip, () => {
          ui.aim = { ...t };
          return { mode: 'aim', player: thrower };
        });
      }
    }

    for (const p of mine) {
      const carrying = p.id === game.disc.carrier;
      // Aim at the body on screen. On defence they are drawn a reaction beat
      // ahead of where the turn found them, and grabbing the ghost they left
      // behind is not what anyone is trying to do.
      const d = dist(drawnAt(game, p), at);
      if (d <= PLAYER_R + slop) consider(1, d, () => grabPlayer(game, p, at));
      for (let i = 0; i < p.route.length; i++) {
        const dh = dist(p.route[i], at);
        if (dh > HANDLE_GRAB + slop) continue;
        const isEnd = i === p.route.length - 1;
        // shift on the end grip starts a fresh leg from there
        consider(2, dh, () => (isEnd && e.shiftKey ? extendRoute(p) : { mode: 'anchor', player: p, index: i }));
      }
      // No shift key on a phone, so the grip drawn past the tip is where a leg
      // gets added. Same tier as the grip it sits beside: whichever your finger
      // landed nearer to is the one you meant.
      const ext = v.touch && !carrying ? extendGripAt(v, game, p) : null;
      if (ext) {
        const de = dist(ext, at);
        if (de <= HANDLE_GRAB + slop) consider(2, de, () => extendRoute(p));
      }
      if (!carrying && p.path.length > 1) {
        const hit = closestOnPolyline(p.path, at);
        if (hit.dist <= LINE_GRAB + slop) consider(3, hit.dist, () => grabLine(game, p, hit));
      }
      if (d <= GRAB_R + slop) consider(4, d, () => grabPlayer(game, p, at));
    }
    if (!best) return;

    canvas.setPointerCapture(e.pointerId);
    ui.drag = best.make();
    ui.drag.pointerId = e.pointerId;
    ui.activeId = ui.drag.player.id;
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!ui.drag || e.pointerId !== ui.drag.pointerId) return;
    const at = inBounds(pt(e));
    const { mode, player } = ui.drag;

    if (mode === 'bow') {
      const t = getGame().pendingThrow;
      if (t) t.bow = bowAt(player.pos, t.to, at);
      return;
    }

    if (mode === 'throw' || mode === 'aim') {
      // A pull is thrown far harder than anything in open play.
      const reach = getGame().phase === 'pull' ? PULL_RANGE : MAX_THROW;
      const d = sub(at, player.pos);
      const len = Math.hypot(d.x, d.y);
      const to = len > reach ? add(player.pos, mul(norm(d), reach)) : at;
      const limit = Math.min(MAX_BOW, MAX_BOW_RATIO * Math.min(len, reach));
      ui.aim = { from: player.id, to, bow: clamp(ui.aim?.bow ?? 0, -limit, limit) };
      return;
    }

    // Routes run as far as you care to draw them; the colour of the line says
    // which turn each stretch belongs to.
    const i = Math.min(ui.drag.index, player.route.length - 1);
    ui.drag.index = i;
    player.route[i] = at;
    applyRoute(player);
  });

  /**
   * A press that never really moved is a tap, and a tap undoes rather than
   * draws: on a body it erases the arrow, on the line it leaves no bend. Read
   * off how far the anchor travelled from where it was grabbed — measuring it
   * against the body instead means a click on the rim of a token leaves a
   * two-metre stub nobody asked for, and at phone scale the rim is the target.
   */
  const finish = (e) => {
    if (!ui.drag || (e && e.pointerId !== ui.drag.pointerId)) return;
    const game = getGame();
    const { mode, player, index, fresh, inserted, origin } = ui.drag;

    if (mode === 'throw' || mode === 'aim') {
      const aim = ui.aim;
      game.pendingThrow =
        aim && dist(player.pos, aim.to) >= THROW_MIN ? { from: player.id, to: aim.to, bow: aim.bow } : null;
      ui.aim = null;
    } else if (mode === 'anchor') {
      if (e?.type === 'pointerup') {
        const at = inBounds(pt(e));
        player.route[Math.min(index, player.route.length - 1)] = at;
      }
      const anchor = player.route[Math.min(index, player.route.length - 1)];
      const still = (fresh || inserted) && dist(anchor, origin) < tapSlop(getView(), fresh ? TAP_CLEAR : TAP_BEND);
      if (fresh && player.route.length === 1 && still) clearRoute(player);
      else if (inserted && still) player.route.splice(index, 1);
      applyRoute(player);
    }

    ui.drag = null;
    ui.activeId = null;
  };

  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', finish);
}
