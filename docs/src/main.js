import { SIM_DT, STALL_LIMIT, TUNING, resetTuning, tune } from './constants.js';
import { byId, clearRoute, controlledTeam, createGame, other, refreshPreviews, say } from './state.js';
import { applyEvent, beginDecision, beginResolve, endTurn, step, turnOver } from './sim.js';
import { planDefense, planPull, resetDefense, setCoverage } from './ai.js';
import { makeView, render, toPx } from './render.js';
import { bindInput } from './input.js';
import { bindTutorial } from './tutorial.js';

const canvas = document.getElementById('field');
const ctx = canvas.getContext('2d');
const ui = { drag: null, aim: null, activeId: null, guardSpace: false };

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
    const height = window.visualViewport?.height ?? window.innerHeight;
    root.setProperty('--bar', `${bar}px`);
    root.setProperty('--head', `${top}px`);
    canvas.style.height = `${Math.max(1, height - top - bar - sheet)}px`;
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
 * The settings are the same nodes in both layouts, moved: a row below the field
 * on a desktop, a list inside the menu panel on a phone. Moved rather than
 * duplicated — two copies of a checkbox bound to one setting is two things to
 * keep in step, and one of them is always the stale one.
 */
function applyMode() {
  document.body.classList.toggle('touch', mode.touch);
  el('touchMode').classList.toggle('on', mode.touch);
  el('touchMode').setAttribute('aria-pressed', String(mode.touch));
  const settings = document.querySelector('.secondary');
  if (mode.touch) {
    el('below').prepend(settings);
    el('below').prepend(el('defense-controls'));
  } else {
    el('settings-home').append(settings);
    el('defense-home').append(el('defense-controls'));
  }
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

const TOUCH_HINTS = {
  pull: 'Drag the disc carrier to aim, or tap Pull.',
  offense: 'Drag to run. Drag the disc carrier to aim.',
  defense: 'Drag defender onto opponent. Menu: coverage options.',
  throw: 'Release your pass, or fake to keep the disc.',
  resolve: 'Everyone moves together…',
};

const HINTS = {
  pull: 'Start here: drag the player holding the disc to aim, or press Pull for an automatic opening throw.',
  offense:
    'Drag teammates to plan runs. Drag the disc carrier to aim a pass. Then press Ready to set the defence.',
  defense:
    'Drag a defender onto an opponent to switch, or tap defender then opponent. Play continues at ⅒ speed.',
  throw:
    'Play continues at ⅒ speed. Release your pass, or Fake it to keep the disc.',
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
          `<details><summary>${g.name}</summary>` +
          `${g.items.map(control).join('')}</details>`,
      )
      .join('') + `<button type="button" id="reset-tuning" class="reset">Reset to defaults</button>`;

  el('reset-tuning').addEventListener('click', () => {
    resetTuning();
    syncTuning();
    if (game.phase !== 'resolve' && !game.liveDecision) refreshPreviews(game);
    syncHud();
  });

  el('tuning').addEventListener('input', (e) => {
    const key = e.target.dataset.key;
    if (!key) return;
    const t = TUNING.find((x) => x.key === key);
    tune(key, t.options ? e.target.value : Number(e.target.value));
    syncTuning();
    if (game.phase !== 'resolve' && !game.liveDecision) refreshPreviews(game);
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
      ? `Team ${defTeam} · Pull · ⅒ speed`
      : game.phase === 'offense'
        ? `Team ${game.offense} · Plan runs & pass · ⅒ speed`
        : game.phase === 'defense'
          ? `Team ${defTeam} · Defence · ⅒ speed`
          : game.phase === 'throw'
            ? `Team ${game.offense} · Throw or fake? · ⅒ speed`
            : 'Watch your play unfold';
  el('phase').textContent = label;
  el('hint').textContent = game.over ? 'First to 3 wins. Start a new game to play again.' : (mode.touch ? TOUCH_HINTS : HINTS)[game.phase];
  for (const phase of ['pull', 'offense', 'defense', 'throw', 'resolve']) {
    const active = !game.over && game.phase === phase;
    el(`step-${phase}`).classList.toggle('active', active);
    el(`step-${phase}`).setAttribute('aria-current', active ? 'step' : 'false');
  }
  if (!game.over && game.phase === 'offense' && (game.disc.flight || game.disc.loose)) {
    el('hint').textContent = game.disc.flight
      ? 'The disc is in the air. Drag your receivers toward it, then press Ready.'
      : 'The disc is on the ground. Drag a player to collect it, then press Ready.';
  }
  el('field-guide').hidden = game.phase === 'defense' || !!game.over;
  const defending = game.phase === 'defense' && !game.over;
  const selected = defending && byId(game, ui.activeId);
  if (selected) {
    const job = selected.guardSpot ? 'guarding space' : `following ${selected.marking}`;
    el('hint').textContent = mode.touch
      ? `${selected.id} → ${selected.marking ?? 'space'} · tap opponent to switch.`
      : ui.guardSpace
      ? `${selected.id}: Guard space is on. Drag to pin a spot. Turn it off in settings to follow a player.`
      : `${selected.id} ${job}. Tap an opponent or drag onto them to switch. Drag elsewhere to shade.`;
  }
  const policy = selected && !selected.guardSpot ? selected.coverage : null;
  el('coverage-force').disabled = !policy;
  el('coverage-priority').disabled = !policy || selected.marking === game.disc.carrier;
  el('coverage-bite').disabled = !policy || selected.marking === game.disc.carrier;
  el('coverage-force').value = policy?.force ?? 'right';
  el('coverage-priority').value = policy?.priority ?? 'under';
  el('coverage-bite').textContent = `${policy?.bite ? 'Biting' : 'Bite'} ${policy?.priority ?? 'under'}`;
  el('coverage-bite').setAttribute('aria-pressed', String(!!policy?.bite));
  el('defense-controls').hidden = !defending;
  if (defending) {
    for (const button of el('defender-buttons').children) {
      const p = game.players.filter((p) => p.team === defTeam)[Number(button.dataset.slot)];
      button.dataset.player = p.id;
      button.textContent = `${p.id} · ${p.guardSpot ? 'Space' : p.marking}`;
      button.setAttribute('aria-pressed', String(ui.activeId === p.id));
    }
  }
  el('clear').textContent = defending ? 'Auto cover' : 'Clear plans';
  // The primary is never a dead button. With the settings behind the ☰ on a
  // phone, a finished game would otherwise leave three greyed buttons and a
  // line of prose telling you to press something you cannot see.
  el('ready').textContent = game.over
    ? 'New game ▸'
    : game.phase === 'throw'
      ? 'Release ▸'
      : game.phase === 'pull'
        ? 'Pull ▸'
        : defending ? 'Defend ▸' : 'Ready ▸';
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
  ui.activeId = null;

  if (game.phase === 'pull') {
    // Nobody has to aim it: if the human left it alone, or the AI has that
    // side, the puller sends it deep on their own.
    if (!game.pendingThrow) planPull(game);
    if (!game.liveDecision) refreshPreviews(game);
    beginResolve(game);
  } else if (game.phase === 'offense') {
    planDefense(game, other(game.offense));
    beginDecision(game);
    if (game.aiDefense) {
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

/** A wound-up throw gets a release decision; otherwise resume full speed.
 * Live routes must not be rebuilt here: their progress has already happened.
 */
function toDecision() {
  if (!game.liveDecision) refreshPreviews(game);
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
  if (game.phase === 'defense') {
    resetDefense(game, team);
    ui.drag = null;
    ui.activeId = null;
    syncHud();
    return;
  }
  for (const p of game.players) if (p.team === team) clearRoute(p);
  game.pendingThrow = null;
  ui.aim = null;
}

const DT = SIM_DT; // the sim must step exactly as the preview did
let acc = 0;

function advanceResolve(dtReal) {
  acc += dtReal;
  while (acc >= DT && (game.phase === 'resolve' || game.liveDecision) && !game.over) {
    acc -= DT;
    const ev = step(game, DT);
    if (ev) {
      applyEvent(game, ev);
      acc = 0;
      ui.drag = null;
      ui.aim = null;
      ui.activeId = null;
      resetClock();
      syncHud();
      return;
    }
    if (turnOver(game)) {
      if (game.phase === 'pull') {
        // Keep the opening decision live without discarding its aim or routes.
        game.frame = 0;
        game.t = 0;
        continue;
      }
      endTurn(game);
      acc = 0;
      ui.drag = null;
      ui.aim = null;
      ui.activeId = null;
      resetClock();
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
const clock = { limit: Infinity, left: Infinity, shown: null };

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
  else {
    if (!game.over) {
      if (!game.liveDecision) {
        beginDecision(game);
        if (game.phase !== 'pull') planDefense(game, other(game.offense));
      }
      advanceResolve(dt * 0.1);
    }
    tickClock(dt);
  }
  tutorial.tick(); // the lesson has to notice the learner acting
  render(ctx, view, game, ui);
  requestAnimationFrame(frame);
}

el('ready').addEventListener('click', primary);
el('fake').addEventListener('click', fake);
el('clear').addEventListener('click', () => clearPlansForController());
el('ai').addEventListener('change', (e) => {
  game.aiDefense = e.target.checked;
  if (game.aiDefense && game.phase === 'defense') {
    ui.drag = null;
    ui.activeId = null;
    planDefense(game, other(game.offense));
    toDecision();
    resetClock();
  }
  syncHud();
});
ui.onChange = syncHud;
el('guard-space').addEventListener('change', (e) => {
  ui.guardSpace = e.target.checked;
  syncHud();
});
el('defender-buttons').addEventListener('click', (e) => {
  const button = e.target.closest('button');
  if (!button || game.phase !== 'defense' || game.aiDefense) return;
  ui.activeId = button.dataset.player;
  syncHud();
});
for (const key of ['force', 'priority']) {
  el(`coverage-${key}`).addEventListener('change', (e) => {
    const selected = byId(game, ui.activeId);
    if (!selected) return;
    setCoverage(game, selected, { [key]: e.target.value });
    syncHud();
  });
}
el('coverage-bite').addEventListener('click', () => {
  const selected = byId(game, ui.activeId);
  if (!selected) return;
  setCoverage(game, selected, { bite: !selected.coverage.bite });
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
  acc = 0;
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
  syncHud();
});
el('menu').addEventListener('click', () => showMenu(!document.body.classList.contains('menu-open')));
el('scrim').addEventListener('click', () => showMenu(false));
// Every button in the panel either starts something (Tutorial, New) or changes
// the layout under it (Touch), and none of those want to be read through a
// sheet. The AI and clock settings are not buttons, and stay put.
el('below').addEventListener('click', (e) => {
  if (e.target.closest('button') && !e.target.closest('#defense-controls')) showMenu(false);
});
const tutorial = bindTutorial({ getGame: () => game, newGame, setControl });
// Touching the board is the learner starting the step: the sheet folds down to
// the line saying what it is waiting for, and the board takes its height back.
canvas.addEventListener('pointerdown', () => {
  if (mode.touch) tutorial.fold();
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Shift' && ui.drag?.mode === 'defend') ui.drag.fixed = true;
  if (e.key === 'Escape') {
    showMenu(false);
    ui.activeId = null;
    syncHud();
  }
  if (['INPUT', 'SELECT', 'BUTTON', 'TEXTAREA'].includes(e.target.tagName)) return;
  if (e.code === 'Space') {
    e.preventDefault();
    primary();
  }
  if (e.key === 'f' || e.key === 'F') fake();
  if (e.key === 'c' || e.key === 'C') clearPlansForController();
});
window.addEventListener('keyup', (e) => {
  if (e.key === 'Shift' && ui.drag?.mode === 'defend') ui.drag.fixed = ui.guardSpace;
});
window.addEventListener('resize', fitCanvas);
window.visualViewport?.addEventListener('resize', fitCanvas);
// The bar rewraps and the lesson sheet opens, folds and closes, all of it above
// the board, so the board has to be re-measured whenever either changes size.
if (window.ResizeObserver) {
  const fit = new ResizeObserver(fitCanvas);
  fit.observe(document.querySelector('.actions'));
  fit.observe(el('coach'));
  fit.observe(el('scorebar'));
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
