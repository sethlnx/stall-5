# Stall 5

Turn-based ultimate frisbee on a mini field — 30 yards by 20, five-yard endzones.
Six circles, one disc, and a stall count that never stops.

You draw what your players should do, then everyone does it at once. The catch is
that you commit before you know: the defence is always a reaction beat behind,
and the line you draw tells you what your own body will do to it and deliberately
hides what everybody else's will.

No build step, no dependencies, no framework. Vanilla ES modules and a canvas —
`docs/` is the whole site, served exactly as it sits.

## Play it

**<https://sethlnx.github.io/stall-5/>**

Or locally:

```sh
python3 -m http.server 8123
```

Then open <http://127.0.0.1:8123/docs/>.

Either way, press **Tutorial** — in the header on a desktop, behind the **☰** on a
phone: ten steps that walk you through one point from the pull, waiting for you at
each one rather than talking over you.

**On a phone** it is a different page, not a narrower one. The pitch stands up so
its 20 yards of width runs across the screen and spends all of it, every grip
grows to fingertip size, and the only controls on it are **Fake it**, **Ready**
and **Clear** in a bar under your thumb.
Everything else — the settings, the log, how it works — is behind the **☰** in the
corner, which opens over the board. Nothing shifts while you play and there is
nowhere to scroll to, so the board is never moving under your finger. That is
automatic for a touch screen, and the **Touch** button turns it on and off
anywhere.

## A turn

**0 · The pull.** A game opens with both lines on their own goal line and the
disc with the defence. Aim it deep — it is still in the air when the next turn
starts, and the receivers have to come back under it. Under make-it-take-it there
is only ever one.

**1 · Runs and wind-up.** Drag a player to pull out a run arrow, as long as you
like. It is straight legs between your anchors, coloured by which turn each
stretch belongs to, so you can map a cutter's whole stall count before pressing
Ready once. Drag the carrier to load a throw — the defence will see you do it.

**2 · Defence.** The offence is already moving. Ghosts and dashed trails show
what has happened, and a white tell shows the first few metres of the throw that
is loaded: its real curve, but not where it ends and not whether it is coming.

**3 · Release or fake.** The defence has committed and you can see their chase
arrows. Send the throw you loaded, or fake it and keep the disc. Either way they
already bit.

Then it all resolves at once.

## What the game thinks it is about

- **Bodies, not cursors.** Top speed, acceleration, braking, agility, and
  momentum that carries between turns. A cutter brakes into a cut and drives out
  of it; doubling straight back needs an almost complete stop. A jab step under
  a couple of metres is free — the feet do it without the hips.
- **The numbers are real ones.** Speed and acceleration are solved together
  against the NBA combine three-quarter-court sprint (22.86 m in 3.08–3.18 s,
  topping out at 19–21 mph). Braking and agility come off measured peak
  decelerations of 7–10 m/s². The disc leaves the hand at the 20 m/s a
  motion-capture study measured, and bleeds speed the whole way.
- **A small pitch, full-size bodies.** 27.4 m by 18.3 m is about two seconds of
  sprint wide, so nobody is ever out of the play: a turn is six to ten metres of
  running, a pass is fifteen, and a body is drawn at the 0.85 m it actually
  occupies rather than a token twice that.
- **Bodies are solid to both sides.** Nobody runs through anybody. Two players
  who meet are stopped by the contact and shoved apart.
- **You have to read the defence yourself.** The drawn line is honest about your
  own body and silent about everyone else's. Finding out is the game.
- **No dice.** Who gets a contested disc is geometry: whoever it came closest to,
  measured against their own reach. Nothing is rolled, and every claim is logged.
- **Every number is a slider.** Twenty-nine of them, plus Reset to defaults.

## Layout

| file | what it holds |
|---|---|
| `docs/index.html` | the page, the tutorial card, and the how-it-works panel |
| `docs/src/constants.js` | every tunable, the slider table, and `resetTuning` |
| `docs/src/state.js` | the game object, routes, setup, possession |
| `docs/src/motion.js` | how a body runs a line, contact, and the disc's flight model |
| `docs/src/sim.js` | resolving a turn: flight, contests, stalls, scoring |
| `docs/src/ai.js` | man defence, and the pull |
| `docs/src/render.js` | everything drawn |
| `docs/src/input.js` | pointer handling |
| `docs/src/draw.js` | canvas primitives |
| `docs/src/vec.js` | geometry |
| `docs/src/tutorial.js` | the ten-step lesson, and what each step waits for |
| `docs/src/main.js` | the loop, the HUD, the clock, and the touch mode |

`TODO.md` is the build log — twenty-seven entries recording what shipped, what it
cost, and what was measured to check it.
