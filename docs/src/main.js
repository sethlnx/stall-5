import { SIM_DT, STALL_LIMIT, TUNING, resetTuning, tune } from './constants.js';
import { clearRoute, controlledTeam, createGame, other, refreshPreviews, say } from './state.js';
import { applyEvent, beginResolve, endTurn, step, turnOver } from './sim.js';
import { planDefense, planPull } from './ai.js';
import { makeView, render, toPx } from './render.js';
import { bindInput } from './input.js';

const canvas = document.getElementById('field');
const ctx = canvas.getContext('2d');
const ui = { drag: null, aim: null, activeId: null };

let game = createGame();
let view = makeView(canvas);

function fitCanvas() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = canvas.clientWidth * dpr;
  canvas.height = canvas.clientHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  view = makeView(canvas);
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
  el('hint').textContent = game.over ? 'New game to play again.' : HINTS[game.phase];
  el('ready').textContent = game.phase === 'throw' ? 'Release ▸' : game.phase === 'pull' ? 'Pull ▸' : 'Ready ▸';
  el('ready').disabled = game.phase === 'resolve' || !!game.over;
  el('fake').hidden = game.phase !== 'throw' || !!game.over;
  el('clear').disabled = game.phase !== 'offense' && game.phase !== 'defense';
  el('clock').hidden = !!game.over;
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
  syncHud();
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
 * A shot clock on the thinking, not the play. Each planning phase gets the full
 * allowance — they are separate decisions, and you cannot choose the release
 * until you have seen the defence commit. Run it down and the phase goes as it
 * stands, which is the point.
 *
 * A limit of zero is no clock at all: take as long as you like.
 */
const clock = { limit: 20, left: 20, shown: null };
let clockPhase = null;

function resetClockFor(phase) {
  clockPhase = phase;
  clock.left = clock.limit;
}

function showClock(text, urgent = false) {
  if (text === clock.shown) return;
  clock.shown = text;
  el('clockLeft').textContent = text;
  el('clock').classList.toggle('urgent', urgent);
}

function tickClock(dt) {
  if (!clock.limit) {
    clockPhase = null;
    showClock('off');
    return;
  }
  if (game.over || game.phase === 'resolve') {
    clockPhase = null;
    showClock(`${clock.limit}s`);
    return;
  }
  if (game.phase !== clockPhase) resetClockFor(game.phase);
  clock.left -= dt;
  if (clock.left <= 0) {
    resetClockFor(null); // ready() moves the phase on; the next frame re-arms it
    ready();
    return;
  }
  const secs = Math.ceil(clock.left);
  showClock(`${secs}s`, secs <= 5);
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (game.phase === 'resolve') advanceResolve(dt);
  else tickClock(dt);
  render(ctx, view, game, ui);
  requestAnimationFrame(frame);
}

el('ready').addEventListener('click', ready);
el('fake').addEventListener('click', fake);
el('clear').addEventListener('click', () => clearPlansForController());
el('ai').addEventListener('change', (e) => {
  game.aiDefense = e.target.checked;
  syncHud();
});
el('clockLimit').addEventListener('change', (e) => {
  clock.limit = Number(e.target.value);
  resetClockFor(game.phase);
});
el('new').addEventListener('click', () => {
  game = createGame();
  game.aiDefense = el('ai').checked;
  ui.drag = null;
  ui.aim = null;
  ui.activeId = null;
  syncHud();
});
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'Space') {
    e.preventDefault();
    ready();
  }
  if (e.key === 'f' || e.key === 'F') fake();
  if (e.key === 'c' || e.key === 'C') clearPlansForController();
});
window.addEventListener('resize', fitCanvas);

fitCanvas();
bindInput(canvas, () => game, ui, () => view);
buildTuning();
syncHud();
requestAnimationFrame(frame);

// minimal hooks for browser smoke tests
window.__game = () => game;
window.__px = (p) => toPx(view, p);
