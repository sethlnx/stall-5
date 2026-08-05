import { teamOf } from './state.js';

/**
 * The lesson: take the disc from the pull and complete one pass.
 *
 * A tutorial's whole contract is that it works, so every step that asks for an
 * action is gated on something the game can be observed to have done — `Next`
 * stays dark until it has. Nothing here asks the learner to do a thing the
 * current phase would refuse, and nothing here depends on them winning.
 *
 * What each rule *is*, and why it is that way, is the How it works panel's job.
 * This file is only the lesson: do this, now look at that.
 */

const carrierOf = (game) => (game.disc.carrier ? game.players.find((p) => p.id === game.disc.carrier) : null);
const holdingIt = (game) => {
  const c = carrierOf(game);
  return !!c && c.team === game.offense;
};
const drawnBy = (game, pick) => teamOf(game, game.offense).some((p) => p.route.length > 0 && pick(p));

const STEPS = [
  {
    title: 'We are going to complete one pass',
    body:
      'Six bodies, one disc, five stalls to move it. We will take the pull, run a cutter into space, and put the disc in their hands. Ten steps, in a fresh game, with the clock off while we learn.',
    watch: 'We are A — the red circles. B is green, and B is about to pull to us.',
  },
  {
    title: 'Send the pull',
    body: 'B has to give the disc away to start. Press <b>Pull ▸</b> and let it go.',
    watch:
      'It hangs the best part of three turns, so it is still in the air when the next turn starts. The throw line is white as far as the disc gets this turn and grey for the rest of the flight.',
    gate: (game) => game.turn > 1,
    gateNote: 'Press <b>Pull ▸</b>.',
  },
  {
    title: 'Draw a run to the disc',
    body:
      'A pull that lands untouched is still ours — we just have to walk out and get it. Drag one of our players toward the grey end of the throw line to pull out a run arrow.',
    watch: 'The arrow only reaches as far as that body can actually run. Drag the same player again and their line starts over.',
    gate: (game) => drawnBy(game, () => true),
    gateNote: 'Drag one of the red circles.',
  },
  {
    title: 'Read the line you drew',
    body:
      'The line is solid for the turn about to be run and steps back a shade for every turn after it, with a pip on each turn boundary. Drag anywhere along it to bend it there.',
    watch: 'Count the pips: that is how many turns of stall count the run spends. Nothing to press for this one.',
  },
  {
    title: 'Play the turn out',
    body: 'Press <b>Ready ▸</b> and watch it run. Press it again if nobody has reached the disc yet.',
    watch: 'Standing over a loose disc is how it is collected. The log names whoever picks it up.',
    gate: holdingIt,
    gateNote: 'Keep pressing <b>Ready ▸</b> until one of ours has the disc.',
  },
  {
    title: 'Draw a cut',
    body: 'The disc needs somewhere to go. Drag one of the two players who is <b>not</b> holding it, out into space away from the green circles.',
    watch: 'Bodies are solid to both sides, so a lane with a green circle standing in it is not a lane.',
    gate: (game) => drawnBy(game, (p) => p.id !== game.disc.carrier),
    gateNote: 'Drag a red circle that is not the one holding the disc.',
  },
  {
    title: 'Load a throw',
    body:
      'Now drag <b>from the player holding the disc</b> — dragging whoever has it winds up a throw instead of a run. Drop it where the cutter is going, not where they are.',
    watch: 'A white dashed tell appears: the first few metres of the throw, the real curve. Drag the dot on the line to bend it, or the end grip to re-aim.',
    gate: (game) => !!game.pendingThrow,
    gateNote: 'Drag out from the circle holding the disc.',
  },
  {
    title: 'Let the defence commit',
    body: 'Press <b>Ready ▸</b>. The defence now decides, and it only gets to decide once.',
    watch: 'Their chase arrows appear. They started a beat late and they cannot take it back — that beat is what we are throwing into.',
    gate: (game) => game.phase === 'throw',
    gateNote: 'Press <b>Ready ▸</b>.',
  },
  {
    title: 'Release it',
    body: 'Press <b>Release ▸</b> to send the throw we loaded. Or press <b>Fake it</b> to keep the disc — the defence already bit either way.',
    watch: 'The disc leaves fast and bleeds speed the whole way. Watch who ends up closest to it.',
    gate: (game) => game.phase === 'offense' || game.phase === 'pull' || !!game.over,
    gateNote: 'Press <b>Release ▸</b> or <b>Fake it</b>.',
  },
  {
    title: 'That is the game',
    body:
      'Read the log: it names who claimed the disc and why. A contested disc goes to whoever it came closest to against their own reach — no dice, so an accurate throw beats a body standing beside it. If it was blocked, cut into emptier space and go again.',
    watch: 'Games are to 3, and a goal does not stop play: you keep the disc and turn straight round. The How it works panel has everything this lesson left out.',
  },
];

/**
 * `getGame` is read every frame, `newGame` starts the lesson from a known state,
 * and `setControl` drives the header's own controls so the clock and AI switch
 * behave exactly as if the learner had set them.
 */
export function bindTutorial({ getGame, newGame, setControl }) {
  const el = (id) => document.getElementById(id);
  const card = el('coach');
  let at = -1; // closed
  let held = null; // the learner's own clock and AI settings, to be given back
  let passing = null; // last gate result, so a frame that changed nothing touches no DOM

  function paint() {
    const step = STEPS[at];
    el('coachStep').textContent = `Step ${at + 1} of ${STEPS.length}`;
    el('coachTitle').innerHTML = step.title;
    el('coachBody').innerHTML = step.body;
    el('coachWatch').innerHTML = step.watch;
    el('coachBack').disabled = at === 0;
    el('coachNext').textContent = at === STEPS.length - 1 ? 'Done' : 'Next ▸';
    card.classList.remove('folded'); // a new step is a new thing to read
    passing = null;
    gate();
  }

  /** Light up `Next` the moment the game shows the step was done. */
  function gate() {
    const step = STEPS[at];
    const ok = !step.gate || step.gate(getGame());
    if (ok === passing) return;
    passing = ok;
    const note = el('coachGate');
    note.hidden = !step.gate;
    // A reading step has nothing to wait for. Empty it rather than leave the
    // last step's "Done" sitting in a hidden node for a screen reader to find.
    note.innerHTML = !step.gate ? '' : ok ? 'Done ✓' : step.gateNote;
    note.classList.toggle('met', !!step.gate && ok);
    el('coachNext').disabled = !ok;
  }

  function go(by) {
    const to = at + by;
    if (to < 0) return;
    if (to >= STEPS.length) return close();
    at = to;
    paint();
  }

  function open() {
    if (at >= 0) return close(); // the button is a toggle
    held = { clockLimit: el('clockLimit').value, ai: el('ai').checked };
    setControl('ai', true);
    setControl('clockLimit', 'Infinity'); // a lesson is not a timed exercise
    newGame();
    at = 0;
    card.hidden = false;
    el('tutorial').classList.add('on');
    paint();
  }

  function close() {
    at = -1;
    card.hidden = true;
    el('tutorial').classList.remove('on');
    if (held) {
      setControl('ai', held.ai);
      setControl('clockLimit', held.clockLimit);
      held = null;
    }
  }

  el('tutorial').addEventListener('click', open);
  el('coachClose').addEventListener('click', close);
  el('coachBack').addEventListener('click', () => go(-1));
  el('coachNext').addEventListener('click', () => go(1));
  window.addEventListener('keydown', (e) => {
    if (at >= 0 && e.key === 'Escape') close();
  });
  // On a phone the card is a sheet and the board gives up its height to it, so
  // reading costs field. Touching the field folds the sheet down to the line
  // that says what the step is waiting for — act at full size, and the whole
  // step comes back when it is done, or when the line is tapped.
  card.addEventListener('click', () => card.classList.remove('folded'));

  return {
    /** Called from the render loop: the gate has to notice the learner acting. */
    tick: () => {
      if (at >= 0) gate();
    },
    /** Get out of the way: the learner has started doing the step. */
    fold: () => {
      if (at >= 0) card.classList.add('folded');
    },
    close,
  };
}
