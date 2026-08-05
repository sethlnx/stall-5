import { SIM_DT, STALL_LIMIT, TUNING, resetTuning, tune } from './constants.js';
import { clearRoute, controlledTeam, createGame, other, refreshPreviews, say } from './state.js';
import { applyEvent, beginResolve, endTurn, step, turnOver } from './sim.js';
import { planDefense, planPull } from './ai.js';
import { makeView, render, toPx } from './render.js';
import { bindInput } from './input.js';
import { bindTutorial } from './tutorial.js';

const canvas = document.getElementById('field');
const ctx = canvas.getContext('2d');
const ui = { drag: null, aim: null, activeId: null };

let game = createGame();

/**
 * Touch mode. A phone is not a small desktop: the field lies **up and down** so
 * its 100 m has the long side of the screen, every grip grows to fingertip size
 * (see `TOUCH_*` in constants), and the primary action sits in a fixed bar under
 * the thumb rather than up in the header.
 *
 * It turns itself on for a coarse pointer, which is the only honest signal for
 * "this is being played with a finger" — screen size is not, since a tablet is
 * wide and a small window is not a phone. `?touch=1` and `?touch=0` force it
 * either way, and the header button toggles it, so the layout can be worked on
 * and demonstrated from a desktop.
 *
 * Orientation follows the viewport rather than the mode: a portrait field on a
 * phone turned sideways would squeeze 100 m into 400 px and be unplayable.
 */
const forced = new URLSearchParams(location.search).get('touch');
const mode = {
  touch: forced != null ? forced !== '0' && forced !== 'false' : matchMedia('(pointer: coarse)').matches,
  portrait: true,
};
let view = makeView(canvas, mode);

/**
 * In touch mode the board is exactly the screen it is left: everything between
 * the bottom of the status strip, the top of the thumb bar, and the lesson sheet
 * when one is up. All of it measured, not assumed — the strip and the bar are
 * fixed heights, but they are fixed in CSS, not here, and mobile browser chrome
 * still slides in and out.
 *
 * The two measurements go back out as `--head` and `--bar` because the menu
 * panel and the lesson sheet are pinned between them.
 *
 * The sheet takes its height out of the board rather than lying over it. On a
 * 100 m field drawn portrait the near endzone ends 20 px above the bar, so
 * anything floating there would cover the very players a lesson step is asking
 * to be dragged. The menu is the opposite case: it covers the board on purpose,
 * because a board that resized itself every time you opened the settings would
 * be the one thing this layout is meant to stop.
 */
function fitCanvas() {
  const root = document.documentElement.style;
  if (mode.touch) {
    const coach = el('coach');
    const bar = document.querySelector('.actions').offsetHeight;
    const sheet = coach.hidden ? 0 : coach.offsetHeight;
    const top = canvas.getBoundingClientRect().top;
    root.setProperty('--bar', `${bar}px`);
    root.setProperty('--head', `${top}px`);
    canvas.style.height = `${Math.max(200, window.innerHeight - top - bar - sheet - 4)}px`;
  } else {
    canvas.style.height = '';
    root.removeProperty('--bar');
    root.removeProperty('--head');
  }
  mode.portrait = mode.touch && window.innerHeight >= window.innerWidth;

  const dpr = window.devicePixelRatio || 1;
  canvas.width = canvas.clientWidth * dpr;
  canvas.height = canvas.clientHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  view = makeView(canvas, mode);
}

/**
 * The settings are the same nodes in both layouts, moved: a tail of the header
 * row on a desktop, a list inside the menu panel on a phone. Moved rather than
 * duplicated — two copies of a checkbox bound to one setting is two things to
 * keep in step, and one of them is always the stale one.
 */
function applyMode() {
  document.body.classList.toggle('touch', mode.touch);
  el('touchMode').classList.toggle('on', mode.touch);
  el('touchMode').setAttribute('aria-pressed', String(mode.touch));
  const settings = document.querySelector('.secondary');
  if (mode.touch) el('below').prepend(settings);
  else document.querySelector('.actions').append(settings);
  showMenu(false);
  fitCanvas();
}

/** Opens over the board, so it closes on anything that is not itself. */
function showMenu(open) {
  document.body.classList.toggle('menu-open', open);
  el('menu').classList.toggle('on', open);
  el('menu').setAttribute('aria-expanded', String(open));
}

const el = (id) => document.getElementById(id);

const HINTS = {
  pull: 'Drag the puller to aim it, then send it. Get it deep — they have to come back and get it.',
  offense:
    'Drag a player to pull out a run arrow; drag anywhere along it to bend it there. Drag the carrier to wind up a throw — the defence will see you load it.',
  defense:
    "The offence is already moving — ghosts and trails show what they've done, and a white tell means the thrower is winding up that way. You start from here, a beat behind.",
  throw:
    'The defence has committed. Release the throw you loaded, or fake it and keep the disc — either way they already bit.',
  resolve: 'Playing out the turn…',
};

/** Every value worth arguing about, as a slider or a choice. */
function buildTuning() {
  const groups = [];
  for (const t of TUNING) {
    const g = groups.find((x) => x.name === t.group) ?? (groups.push({ name: t.group, items: [] }), groups.at(-1));
    g.items.push(t);
  }
  const control = (t) =>
    t.options
      ? `<label class="tune choice"><span>${t.label}</span>` +
        `<select id="in-${t.key}" data-key="${t.key}">${Object.entries(t.options)
          .map(([k, name]) => `<option value="${k}">${name}</option>`)
          .join('')}</select></label>`
      : `<label class="tune"><span>${t.label}</span><output id="out-${t.key}"></output>` +
        `<input type="range" id="in-${t.key}" data-key="${t.key}" min="${t.min}" max="${t.max}" step="${t.step}"></label>`;

  el('tuning').innerHTML =
    groups
      .map(
        (g) =>
          `<details${g.name === 'Pathing' ? ' open' : ''}><summary>${g.name}</summary>` +
          `${g.items.map(control).join('')}</details>`,
      )
      .join('') + `<button type="button" id="reset-tuning" class="reset">Reset to defaults</button>`;

  el('reset-tuning').addEventListener('click', () => {
    resetTuning();
    syncTuning();
    if (game.phase !== 'resolve') refreshPreviews(game);
    syncHud();
  });

  el('tuning').addEventListener('input', (e) => {
    const key = e.target.dataset.key;
    if (!key) return;
    const t = TUNING.find((x) => x.key === key);
    tune(key, t.options ? e.target.value : Number(e.target.value));
    syncTuning();
    if (game.phase !== 'resolve') refreshPreviews(game);
    syncHud();
  });
  syncTuning();
}

/** Values are clamped against each other, so re-read them all after a change. */
function syncTuning() {
  for (const t of TUNING) {
    const v = t.get();
    el(`in-${t.key}`).value = v;
    if (t.options) continue;
    el(`out-${t.key}`).textContent = `${t.step < 1 ? v.toFixed(t.step < 0.1 ? 2 : 1) : v} ${t.unit}`;
  }
}

function syncHud() {
  el('possession').textContent = game.disc.flight
    ? 'Disc: in the air'
    : game.disc.loose
      ? `Disc: loose — ${game.offense} to collect`
      : `Disc: ${game.disc.carrier}`;
  el('scoreA').textContent = game.score.A;
  el('scoreB').textContent = game.score.B;
  el('turn').textContent = game.turn;
  el('stall').textContent = game.stall;
  el('stallLimit').textContent = STALL_LIMIT;

  const defTeam = other(game.offense);
  const label = game.over
    ? `${game.over} win it, ${game.score.A}–${game.score.B}`
    : game.phase === 'pull'
      ? `${defTeam} pull to ${game.offense}`
      : game.phase === 'offense'
        ? `Offence ${game.offense} — runs`
        : game.phase === 'defense'
          ? `Defence ${defTeam} — react`
          : game.phase === 'throw'
            ? `Offence ${game.offense} — release?`
            : 'Resolving';
  el('phase').textContent = label;
  el('hint').textContent = game.over ? 'Play again?' : HINTS[game.phase];
  // The primary is never a dead button. With the settings behind the ☰ on a
  // phone, a finished game would otherwise leave three greyed buttons and a
  // line of prose telling you to press something you cannot see.
  el('ready').textContent = game.over
    ? 'New game ▸'
    : game.phase === 'throw'
      ? 'Release ▸'
      : game.phase === 'pull'
        ? 'Pull ▸'
        : 'Ready ▸';
  el('ready').disabled = game.phase === 'resolve' && !game.over;
  // Greyed, never gone, in both layouts. A button that appears for one phase
  // moves whatever sits beside it — the other two plays under a thumb, or the
  // whole header row on a desktop.
  el('fake').disabled = game.phase !== 'throw' || !!game.over;
  el('clear').disabled = game.phase !== 'offense' && game.phase !== 'defense';
  el('clock').classList.toggle('off', !!game.over); // invisible, but still holding its line
  el('log').innerHTML = game.log
    .slice(0, 10)
    .map((m) => `<li>${m}</li>`)
    .join('');
}

/** pull -> runs + wind-up -> defence reacts -> release or fake -> resolve */
function ready() {
  if (game.phase === 'resolve' || game.over) return;
  ui.drag = null;
  ui.aim = null;

  if (game.phase === 'pull') {
    // Nobody has to aim it: if the human left it alone, or the AI has that
    // side, the puller sends it deep on their own.
    if (!game.pendingThrow) planPull(game);
    refreshPreviews(game);
    beginResolve(game);
  } else if (game.phase === 'offense') {
    if (game.aiDefense) {
      planDefense(game, other(game.offense));
      toDecision();
    } else {
      game.phase = 'defense';
    }
  } else if (game.phase === 'defense') {
    toDecision();
  } else {
    beginResolve(game); // release: the wind-up comes round and the disc goes
  }
  resetClock();
  syncHud();
}

/** What the big button does, which at the end of a game is start another. */
function primary() {
  if (game.over) newGame();
  else ready();
}

/**
 * No wound-up throw means there is nothing to decide — play it out. Either way
 * the offence's runs are recomputed first: the defence has committed, and the
 * offence has to give way to whoever is now standing in their lane.
 */
function toDecision() {
  refreshPreviews(game);
  if (game.pendingThrow && game.disc.carrier) game.phase = 'throw';
  else beginResolve(game);
}

/** Pull it back down. The wind-up still happened; the defence still bit. */
function fake() {
  if (game.phase !== 'throw') return;
  say(game, `${game.pendingThrow.from} fakes it.`);
  game.pendingThrow = null;
  beginResolve(game);
  resetClock();
  syncHud();
}

function clearPlansForController() {
  const team = controlledTeam(game);
  if (!team || game.phase === 'throw') return; // the wind-up is committed
  for (const p of game.players) if (p.team === team) clearRoute(p);
  game.pendingThrow = null;
  ui.aim = null;
}

const DT = SIM_DT; // the sim must step exactly as the preview did
let acc = 0;

function advanceResolve(dtReal) {
  acc += dtReal;
  while (acc >= DT && game.phase === 'resolve') {
    acc -= DT;
    const ev = step(game, DT);
    if (ev) {
      applyEvent(game, ev);
      acc = 0;
      syncHud();
      return;
    }
    if (turnOver(game)) {
      endTurn(game);
      acc = 0;
      syncHud();
      return;
    }
  }
}

/**
 * A shot clock on the thinking, not the play. It is reset by the act of moving
 * the game on — Ready, Fake, a new game, or the count running itself out — so
 * every planning phase gets the full allowance. Keying it on the phase *name*
 * instead was wrong: the clock does not tick while a turn resolves, so the
 * re-arm never ran and a turn that came back round to `offense` (a fake, or a
 * throw nobody caught) inherited whatever was left of the last one.
 *
 * Off is `Infinity`, not zero, and that is deliberate. Zero means `left <= 0`
 * on the very first frame, and any build that does not special-case it fires
 * `ready()` sixty times a second — turns blow past and the button never comes
 * back. A clock that runs forever is off under every reading, including an old
 * cached copy of this file.
 */
const clock = { limit: 20, left: 20, shown: null };

const clockOff = () => !Number.isFinite(clock.limit) || clock.limit <= 0;

function resetClock() {
  clock.left = clock.limit;
  paintClock();
}

function paintClock() {
  if (clockOff()) return showClock('off');
  const secs = Math.max(0, Math.ceil(clock.left));
  showClock(`${secs}s`, secs <= 5);
}

function showClock(text, urgent = false) {
  if (text === clock.shown) return;
  clock.shown = text;
  el('clockLeft').textContent = text;
  el('clock').classList.toggle('urgent', urgent);
}

function tickClock(dt) {
  if (clockOff()) return showClock('off');
  if (game.over) return;
  clock.left -= dt;
  if (clock.left <= 0) {
    clock.left = clock.limit; // before ready(), so a no-op press cannot re-fire every frame
    ready();
    return;
  }
  paintClock();
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (game.phase === 'resolve') advanceResolve(dt);
  else tickClock(dt);
  tutorial.tick(); // the lesson has to notice the learner acting
  render(ctx, view, game, ui);
  requestAnimationFrame(frame);
}

el('ready').addEventListener('click', primary);
el('fake').addEventListener('click', fake);
el('clear').addEventListener('click', () => clearPlansForController());
el('ai').addEventListener('change', (e) => {
  game.aiDefense = e.target.checked;
  syncHud();
});
el('clockLimit').addEventListener('change', (e) => {
  clock.limit = Number(e.target.value);
  resetClock();
});
/** Drive a header control as though the learner had set it themselves. */
function setControl(id, value) {
  const c = el(id);
  if (c.type === 'checkbox') c.checked = value;
  else c.value = value;
  c.dispatchEvent(new Event('change'));
}

function newGame() {
  game = createGame();
  game.aiDefense = el('ai').checked;
  ui.drag = null;
  ui.aim = null;
  ui.activeId = null;
  resetClock();
  syncHud();
}

el('new').addEventListener('click', newGame);
el('touchMode').addEventListener('click', () => {
  mode.touch = !mode.touch;
  applyMode();
});
el('menu').addEventListener('click', () => showMenu(!document.body.classList.contains('menu-open')));
el('scrim').addEventListener('click', () => showMenu(false));
// Every button in the panel either starts something (Tutorial, New) or changes
// the layout under it (Touch), and none of those want to be read through a
// sheet. The AI and clock settings are not buttons, and stay put.
el('below').addEventListener('click', (e) => {
  if (e.target.closest('button')) showMenu(false);
});
const tutorial = bindTutorial({ getGame: () => game, newGame, setControl });
// Touching the board is the learner starting the step: the sheet folds down to
// the line saying what it is waiting for, and the board takes its height back.
canvas.addEventListener('pointerdown', () => {
  if (mode.touch) tutorial.fold();
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') showMenu(false);
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'Space') {
    e.preventDefault();
    primary();
  }
  if (e.key === 'f' || e.key === 'F') fake();
  if (e.key === 'c' || e.key === 'C') clearPlansForController();
});
window.addEventListener('resize', fitCanvas);
// The bar rewraps and the lesson sheet opens, folds and closes, all of it above
// the board, so the board has to be re-measured whenever either changes size.
if (window.ResizeObserver) {
  const fit = new ResizeObserver(fitCanvas);
  fit.observe(document.querySelector('.actions'));
  fit.observe(el('coach'));
}

applyMode();
bindInput(canvas, () => game, ui, () => view);
buildTuning();
syncHud();
requestAnimationFrame(frame);

// minimal hooks for browser smoke tests
window.__game = () => game;
window.__px = (p) => toPx(view, p);
window.__mode = () => ({ ...mode, scale: view.scale });
window.__view = () => view;
