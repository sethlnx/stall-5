# Stall 5 — build log

What shipped, what it cost, and what was measured to check it.

## 1. Throw arrow: white then grey — done
The disc covers `DISC_SPEED × (TURN_TIME − RELEASE_AT)` before the turn ends.
The arc is split at that distance: white for what happens this turn, grey for
what lands after it.

## 2. Declutter the GUI — done
`rough.js` deleted; `draw.js` replaces it with flat primitives (polyline,
arrow, circle, rounded rect, label). Thinner strokes, fewer dashes, squared-off
panel, tuning groups collapsed by default.

## 3. Tell shows the real start of the flight — done
The defence now sees the first `TELL_LENGTH` metres of the *actual* arc, so a
heavy bend reads as a bend from the hand.

## 4. Defence can actually make a play — done
Was: a deterministic radius test where the mark could never block and block
radius (1.5 m) was smaller than the drawn body (2.0 m) — so discs passed
visibly through defenders with no explanation.

Now: one attempt per body per flight, resolved at closest approach. Chance is
`skill × (1 − (miss/reach)^1.6)`; the mark is penalised (`MARK_PENALTY`) rather
than immune. A won defensive attempt is an interception (`INTERCEPT_SHARE`) or
a swat to the turf. Every attempt is logged — "B1 swats it down!", "B0 can't
get to it." Rolls come off a seeded stream so a turn replays identically.

Measured: defender on the throwing line breaks up 78% (57% swat, 22% pick);
six metres off the line, 27%.

## 5. Player collision — done
Offence gives way to defence (one-directional, so previews stay exact).
Obstacles are read from the other side's *predicted plans*, not live positions,
which keeps preview and simulation bit-identical — verified.

Three attempts before it behaved: capping speed alone froze cutters solid; a
lateral velocity push got cancelled by the route's restoring pull; steering to
the tangent deviated too late to execute within the turn rate. What works is
shifting the *aim point* sideways until it clears, with the dodging hand
committed once they start leaning — otherwise `side` flips sign on a millimetre
of drift and the swerve whipsaws to nothing.

## 6. Momentum legible — done
Every body carries a tick in its direction of travel, length scaled by speed.

## 7. Drag the throw from the end of its arrow — done
Grip on the target; dragging re-aims and keeps the curve. The apex grip still
bends it.

## 8. Housekeeping — done
Offence previews are recomputed when the defence commits, so the runs shown at
the release decision account for the defenders now standing in the lane.

## 9. Landscape layout — done
The pitch lies on its side: A attacks left, B attacks right. The model still
keeps x across the field and y along it; only `makeView`/`toPx`/`toField` turn
it a quarter turn, so every other drawing and hit test rotated for free and the
pointer round-trip stays exact (verified: field → pixels → field, unchanged).

The page is a stack now: score, phase and controls above; board in the middle;
tuning groups and the log below.

## 10. Open passes complete — done
Catching was rolled on every reception with a falloff that bit across the whole
body: a disc passing 1.4 m away — *visually inside the receiver's own circle,
which is drawn at 2.0 m* — was a 55% coin flip. That is where the mystery drops
came from.

Now an uncontested reception is certain. Dice apply only where an offensive and
a defensive body are both playing the same disc, which is what was asked for
originally: overlapped O and D is a percentage, everything else is not.

Two bugs fell out of testing it:
- Same-frame contests resolved in array order, so a defender standing exactly
  on the landing spot never got their block — the offence always won the tie.
  Contests now settle nearest-body-first.
- My earlier rewrite had dropped the `RELEASE_CLEAR` guard, so the mark got a
  point-blank play on every single throw. Restored, with a halfway rule so a
  short dump is still contestable.

Measured over 80 throws each: open **100%**, two metres of coverage 99%, a
defender standing on the landing spot 44% swatted / 27% intercepted / 19%
caught / 10% dropped.

## 11. Multi-turn routes — done
Routes were clipped to one turn's reach and wiped at every turn boundary. Now
you can draw a cutter's whole stall count in one go, before pressing Ready.

- The reach clip and its drag-time bisection are gone; draw as far as you like.
- Routes **persist across turns**. At each boundary the stretch they actually
  ran is consumed and the rest is rebuilt from where they got to, so a long
  route keeps playing itself out turn after turn. Possession changes still wipe
  them — a cutting plan means nothing once you are defending.
- `plan` is now a `PLAN_TURNS`-long projection (default 5, slider 1–8), and the
  drawn line is cut at turn boundaries: solid for the turn about to be run,
  stepping back for each one after, with a pip on every boundary. Route drawn
  past the projection shows as a faint dotted tail.
- `pointAt` became a binary search over cumulative path lengths, since a
  five-turn projection over a long route calls it 1200 times per preview.

Verified: frame 120 of the projection equals the simulated position exactly
(10.7491, 64.9911 both), and a three-leg route drawn once played out over four
turns at full speed with anchors falling away as they were consumed.

## 12. Bodies are solid to both sides — done
Only the offence gave way. A defender ran clean through whoever they were
covering: measured 0.56 m between centres, 1.14 m of interpenetration, and
still closing.

The old asymmetry existed to stop the previews chasing each other — the offence
read the defence's predicted `plan`, so the defence could not read the
offence's without the two becoming mutually defined. Making it symmetric that
way is impossible; the fix was to stop previewing players one at a time.

- `stepAll(bodies, t, dt)` advances **every body together** in the simulation.
  (Item 15 later stopped the *preview* using it — the preview runs each body
  alone so the interference stays hidden. The simulation still runs them all
  together, and that is where collisions happen.)
- Within a frame everyone reads a snapshot of where everyone else *was*, so the
  result does not depend on array order and neither side gets to move first.
- `traffic` reads live positions instead of `plan[frame]`, and applies to both
  teams. Its speed brake is gone: contact is now real, so a runner who balked
  metres early was just a force field. Lean scales with how close the body is.
- `separate()` is the backstop — overlapping pairs are pushed apart evenly and
  the closing part of their velocities is cancelled. Pairs are **relaxed, not
  solved**: prising one pair apart can shove a third body into someone else, so
  the sweep repeats (up to 8 passes) until nothing is left to fix.

Measured over 300 turns of real play: closest approach **exactly 1.7 m**
(`2 * BODY_R`), never breached, zero overlaps at any turn start. A 200-turn
stress test that spawns all six bodies in a 13 m knot holds the same floor to
within 0.1 mm.

The floor has to stay under `CATCH_R` (2.4 m) or a tightly-marked receiver
could never reach a disc at all — that is what fixes `BODY_R` at 0.85. Contest
outcomes came out where they were before: an open pass still completes 80/80, a
defender two metres off the landing spot allows 69/80, and one standing on it
gives 55% swatted / 15% intercepted / 30% caught.

Also here: dragging a player now always **restarts** their line. A body
outranks any grip or line drawn near it, so a route anchor the player happens
to be standing on can no longer swallow the drag — which used to happen
constantly once routes carried over between turns and cutters ran up close to
their own next anchor.

And a defender who was 0.1 m from the disc no longer logs "can't reach it".
They got there; they did not come down with it, and that is what it says now.

## 13. The disc slows down — done
Flight was a constant `DISC_SPEED` along the arc, so a 45 m huck and a 5 m dump
felt like the same throw at different lengths. Now the disc leaves the hand fast
and bleeds speed the whole way, settling into a glide rather than stopping dead:

```
v(t) = max(DISC_SPEED * DISC_GLIDE, DISC_SPEED - DISC_DRAG * t)
```

Defaults `DISC_DRAG = 3.5` m/s² and `DISC_GLIDE = 0.45`, both sliders. The floor
is what guarantees an aimed throw still arrives — without it a long throw would
stall in mid-air, and `MAX_THROW` would stop meaning anything.

| distance | was | now | turns in the air |
|---|---|---|---|
| 10 m | 0.59 s | 0.63 s | 0.7 |
| 20 m | 1.18 s | 1.37 s | 1.1 |
| 30 m | 1.76 s | 2.32 s | 1.6 |
| 45 m | 2.65 s | 4.25 s | 2.5 |

Short throws are barely touched; hucks hang. That falls out of the model rather
than being tuned in — the disc is quick where a dump lives and slow where a huck
does.

Three things need to agree about where the disc is: the simulation integrating
the flight, the arc drawn white-then-grey at the turn boundary, and the ring
showing where a receiver will be when it arrives. They all read `discSpeed` /
`discReach` / `discFlightTime` in `motion.js`, which step **frame by frame**
rather than using a closed form — because the simulation does, and the two
answers have to be the same one. The flight carries a `frames` count so its
speed is read off the same clock.

Verified: `discFlightTime(discReach(t)) === t` exactly; a huck released in turn 1
was still airborne at the boundary having covered 17.9 m — exactly
`discReach(TURN_TIME - RELEASE_AT)`, the same number the white/grey split uses —
and was caught in turn 2. A throw into space grounds two turns later. Open
passes still complete 80/80 and a defender on the landing spot still gives
54% swatted / 19% intercepted / 27% caught. Body exactness is untouched:
2400 predicted positions over 400 quiet turns, zero mismatches.

Also removed a duplicate `catchskill` slider that bound two controls to the same
id.

## 14. Real numbers — done
The body values were invented. They are now basketball's, on the assumption
that an elite ultimate player is that athlete.

**Top speed and acceleration are solved together** against the NBA combine's
three-quarter-court sprint — 22.86 m from a standstill, run in 3.05–3.14 s by
2025's quickest (Fears 3.05, Bailey and Lanier 3.12, Clayton 3.14), sub-3.00
being world class. Accelerating flat out to top speed and holding it:

| | top speed | accel | brake | agility | 22.86 m |
|---|---|---|---|---|---|
| handler | 8.4 m/s (18.8 mph) | 9.0 | 10.0 | 10.0 | 3.18 s |
| cutter | 8.8 m/s (19.7 mph) | 8.2 | 9.5 | 9.0 | 3.13 s |
| deep | 9.3 m/s (20.8 mph) | 7.4 | 9.0 | 8.0 | 3.08 s |

Measured by running them in the game's own engine, not by algebra. The handler
is quickest off the mark and the deep quickest by the end of it, which is the
shape you want. Top speeds of 19–21 mph are where tracking puts the league's
fastest in a short burst.

**Braking is now its own value, not an alias for top speed.** GPS work on team
sports puts peak decelerations at 7–10 m/s², well above what anyone can
accelerate at — stopping is harder-hitting than starting, and it was wrong to
tie the two together. `agility` is braking sideways, so it sits in the same
band and falls off with size.

**Release speed 17 → 20 m/s.** Motion-capture of experienced throwers measured
20.1 m/s backhand, 20.6 m/s closed-grip forehand, 19.2 m/s split-grip.

Everyone is roughly a third faster, so a deep now covers 18.6 m in a turn
against 14.4 m before. Re-measured after the change: open passes still complete
80/80, a defender on the landing spot gives 59% swatted / 20% intercepted /
21% caught (tighter than before — defenders got faster too), bodies still never
breach the 1.7 m floor, and 1638 predicted positions over 273 quiet turns match
the simulation exactly.

**Reset to defaults.** `constants.js` reads every tunable's shipped value into
`DEFAULTS` as `TUNING` is built, before anything can move; the button in the
panel puts them all back. Verified by driving all 27 sliders to their maximum
and the pathing select to `floaty`, then resetting: every value restored and
every on-screen control agreed with its variable.

Sources: [NBA combine sprint times](https://www.sportskeeda.com/college-basketball/news-best-player-draft-fans-impressed-rutgers-ace-bailey-dylan-harper-flex-speeds-nba-draft-combine),
[lane agility norms](https://www.topendsports.com/testing/tests/agility-lane.htm),
[accel/decel magnitudes](https://www.globalperformanceinsights.com/post/defining-high-speed-acceleration-and-deceleration-efforts-in-sport),
[throw velocities](https://thesportjournal.org/article/throwing-techniques-for-ultimate-frisbee/).

## 15. Traffic is a surprise — done
The preview showed everything, including how a cut was going to be spoiled by
whoever was standing in it. You could see the swerve before committing, which
meant you never really had to read the defence.

Now the preview runs **each body alone**, down its own route, as though the
field were empty. It is the same physics otherwise, so the drawn line still
knows everything about *your own* body — momentum carried in, acceleration, a
corner too sharp for your agility — and nothing at all about anyone else's.
`previewAll` steps each ghost with no crowd, so `traffic` has nothing to see
and `separate` never runs; the simulation still steps all six together, and
that is where the interference lands.

The line you draw is a spline through your anchors, exactly as before. A
detour was briefly tried as straight legs with a naive speed-only projection,
which threw away the honest agility cost too — reverted.

Measured over 273 turns of real play: **1543 of 1638** predicted end-of-turn
positions landed exactly on the plan, because nobody was near enough to
interfere. The other 95 were surprised, median 0.22 m and worst 7.66 m. Set up
deliberately: a clear lane and a sharp cut with nobody near both come out at
0.000 m — the drawn line was the truth — while the same runs with a defender
parked in the lane come out 2.56 m and 0.38 m from where the line promised.

So the rule is: what your own body does to your line is shown, what anybody
else does to it is not.

Since one route no longer changes anybody else's, `applyRoute` and `clearRoute`
dropped their `game` argument and the mid-resolve guard that came with it.
Contest outcomes and the 1.7 m contact floor are unchanged.

## 16. Straight legs, honest corners, free jab steps — done
A route is now **straight legs between the anchors**, not a spline through them.
A cut is a cut: you say where you want the corner, and the body has to deal
with it.

Dealing with it means **braking into the turn**. The old model capped speed by
curvature sniffed off the trajectory a couple of metres ahead, which meant a
runner discovered a corner far too late to do anything but sail through it.
Corners are now worked out once, when the path is built:

- `cornerTable` walks the anchors and records each interior vertex's arc length
  and turn angle.
- Speed through one comes from rounding the vertex with an arc that starts
  `CORNER_SLACK` (1.5 m) before it: `R = CORNER_SLACK / tan(turn/2)`, then the
  usual `v ≤ sqrt(agility · R)`. Doubling back needs `tan(90°) = ∞`, radius
  zero, and a full stop — which is right.
- `cornerLimit` reaches each corner *backwards* up the route by its braking
  distance, `u² = v² + 2·a·d`, and takes the tightest. That is what makes a
  cutter slow down **before** the cut instead of during it.

**A jab step costs nothing.** A corner is free when either leg beside it is
shorter than `JAB_STEP` (2.0 m): the feet move, the hips do not, and there is
no momentum to redirect. You can only get away with that over a small distance,
which is exactly what the length test measures. Both are sliders.

Measured, same body, same shape of move:

| route | corners | speed through the move |
|---|---|---|
| straight 36 m | — | 9.3 m/s held |
| hard cut, 69° | charged | 9.3 → **4.8** → 9.3 |
| full 180° turnaround | charged | 9.3 → **0.21**, then drives out |
| 1.5 m jab, then on | **free** | 9.3 → 8.5, barely dips |
| 6 m detour, same shape | charged | 9.3 → **5.18** |

The turn pips show the cost directly: on one three-leg route the second turn
covers 16.5 m and the third only 13.9 m, because the third brakes into a cut.

`PATHING_MODE`'s `planted` option is gone — `physical` now *is* "brake into the
cut, drive out". A dead duplicate of the mode list in `motion.js` went with it,
along with `spline` and `ROUTE_STEPS`, which nothing curves any more.

Item 15 still holds on top of this: own-body physics is shown, traffic is not.
Verified — a clear lane, a hard cut with nobody near, and a jab step with
nobody near all come out at **0.000 m** from the drawn promise; put a defender
in the lane and it is 1.99 m. Over 250 turns, 1221 positions went exactly to
plan and 147 were surprised. Contact floor still exactly 1.7 m, open passes
80/80, preview speed jumps peak at 0.176 m/s per frame — the braking limit, so
no jitter.

## 17. Make it, take it — done
Scoring used to stop the game: a new point was set up, both lines walked back
to a pull formation, and everyone was teleported. Now **play does not stop**.

The side that scores keeps the disc where they caught it and turns straight
round to attack the other endzone. Nobody moves, there is no pull, and the
stall count starts again. **Games are to 3** (`WIN_SCORE`, a slider).

Which way a team runs could no longer be a property of the team, so it is now
`game.attacking` — the direction the *current offence* runs — and `attackDir`
reads it. It flips in exactly two situations, and they turn out to be the same
one: a score, and a turnover. Both are "the end changes hands", so both call
`flipEnds`. The endzone labels follow the play rather than the team names.

Traced through a whole game: A scores and keeps it with `attacking` −1 → +1 and
the scorer still holding the disc; scores again and it flips back; the third
makes it 3–0 and the game closes out with "A win it, 3–0" — Ready, Fake and
Clear all disabled until New game. Turnovers flip the same way, so the team
that wins the disc attacks the end they were defending.

Worth knowing: a scorer restarts deep in what has just become their own
defensive endzone, so make-it-take-it means going the full length against a set
defence, on a fresh stall count. That is the rule as asked for and it is hard.

## 18. A ring on the disc, and a clock — done
**Where the disc will be.** The throw line was already white as far as the disc
gets this turn and grey after, but the boundary was just where one dash ended
and another began. There is now a white dotted ring on it, drawn at `CATCH_R`,
so while planning a cut you can see the circle you have to be standing in when
the whistle goes. It costs nothing to compute — the split point was already
there.

**A clock.** 10 s, 15 s or 20 s per planning phase, in the header, counting
down and turning red under five. Run it out and the phase goes as it stands,
which is the point of having one.

Each planning phase gets the full allowance rather than sharing one budget
across the turn: they are genuinely separate decisions, and you cannot choose
the release until you have seen the defence commit. It never runs during
`resolve` or after the game is won.

The clock lives in `main.js`, not in `game` — it is a real-time UI concern and
the game state has to stay deterministic and replayable.

## 19. A catch ends the turn — done
A catch used to leave the rest of the turn to run out with the disc already in
hand and nothing left to decide. Now the turn ends the moment the catcher has
run the catch off and come to a stop.

`takeCatch` records `game.settling = { id, at }` and `turnOver` watches that
player instead of the frame count: the turn is over when their speed drops to
`STOPPED` (0.05 m/s — braking zeroes velocity outright below that).

It cuts both ways, and that is the point. A stationary receiver taking a short
dump ends the turn at frame 73 of 120, saving three quarters of a second of
nothing. A receiver caught at full stride runs 0.4–0.7 s **past** the nominal
whistle so the catch finishes properly instead of being sliced in half —
measured at 145, 161 and 154 frames against a 120-frame turn, every one ending
with the catcher at exactly 0.000 m/s.

`SETTLE_MAX` (90 frames) is the backstop for a catcher who never quite stops
because a defender is leaning on them. It has not fired in any test.

Over a full AI game to 3–0: 290 turns, 6 held open by a catch, 2 cut short, the
1.7 m contact floor never breached.

## 20. Grab the body you can see — done
Dragging a defender did nothing. Not "failed to reset their line" — nothing at
all, no route created.

The pointer was hit-testing against `p.pos`, the position the turn *started*
from, while the renderer draws each player at `viewOf(p, phaseTime(game))`. On
offence those are the same point, so it never showed. On defence the phase time
is `REACT_LAG`, and a defender carrying any momentum is drawn a beat downfield
of where the turn found them — measured at **3.2 m** apart for a defender
moving at 8 m/s, which is past `PLAYER_R` (2.0) and past the loose `GRAB_R`
(3.0) as well. Every click landed on the hollow origin ghost instead of the
body, and missed both.

`render.js` now exports `drawnAt(game, p)` and the pointer uses it. Grabbing a
defender resets their line exactly as grabbing a cutter does — verified by
drawing a two-leg defensive route and then dragging the body, which came back
with one anchor at the new spot.

## 21. It starts with a pull — done
The game used to open mid-field with the disc already in a handler's hand and a
log line claiming "Pull complete" for a pull that never happened. Now it opens
with the actual pull.

Both lines stand on their own goal line — the receivers on the one they are
defending, the pullers on the one they are about to throw away from — the full
64 m of field between them. The disc is with a puller, and there is a new
`pull` phase.

The trick is that a pull needs almost no new machinery, because **a pull is
just a throw from the team that is not on offence**. The receiving side is
already `game.offense`, so they catch it at `CATCH_R` and a catch is simply a
catch — no interception wording, no possession flip. Three small things were
genuinely new:

- `PULL_RANGE` (62 m, a slider). A pull is thrown far harder than anything in
  open play, so the aiming clamp uses it instead of `MAX_THROW`.
- `groundPull` — a pull that lands untouched does *not* change possession. It
  was always theirs; they just have to walk to it.
- The stall does not run until they have it. `game.pulling` stays set from the
  setup until the disc is collected, and `endTurn` skips the stall while it is.
  Being stalled out for letting a good pull land would be absurd.

`controlledTeam` gives the pull to the pulling side under the same rule as the
defence: theirs unless the AI has that side. With AI defence on you press
**Pull ▸** and `planPull` sends it deep down the middle; with it off you drag
the puller and aim it yourself.

Measured: the default pull travels 62 m and hangs **5.77 s — 2.88 turns** —
which is about right for a real one. It flies through turns 1 and 2 and is
caught in turn 3, with the stall sitting at 1 the whole way and starting
properly on the catch. A full AI game from the opening pull finished 3–2 in 135
turns with the 1.7 m contact floor never breached.

Under make-it-take-it there is exactly one pull per game, which is what makes
it worth doing properly rather than skipping.

---

## 22. No dice — done

Blocks were a roll: `skill × (1 − (miss/reach)^1.6)`, with `MARK_PENALTY`,
`INTERCEPT_SHARE`, a seeded stream, and an attempts map to hold one try per body
per flight. Gone, all of it, along with `CATCH_SKILL`, `BLOCK_SKILL`, and four
sliders. If the disc is contested, geometry decides it.

The rule: a claim is **how deep into your own reach the disc got** —
`closest / reach`, nought dead on it and one at fingertips. Best claim takes it;
a defender's claim is a block, a receiver's is a catch. `CATCH_R` (2.4 m)
against `BLOCK_R` (1.5 m) is now the entire contest model, and a catch radius
slider was added since it does half the work.

Two things had to be right, and both were wrong first — each measured, not
argued:

**Resolving on first contact hands the disc to whoever stands nearer the
thrower.** The frame somebody first comes into reach is decided by who the disc
passes first, not by who is better placed. With the defender alongside, the
receiver won 40 of 40 with the throw led 4 m either way; with the defender in
the lane, they won 40 of 40. So a claim is now held open until the disc is past
that player and their closest approach is known, and only then compared.

**Comparing raw metres is not comparing claims.** A receiver reaching 2.4 m
would beat a defender who was physically closer to the disc. Depth normalises
that, and it is why the two radii mean something.

Two positional consequences fell out of the same measurements:

- **The mark cannot block.** It stands in the throwing lane by definition, so
  under geometry alone it blocked *every throw ever made* — measured, all of
  them, and B0 was the blocker every time. You pivot around your mark; it does
  not get to play that disc. `MARK_RANGE` is what makes someone the mark.
- **Cover is off the shoulder.** There are only two stable places to stand and
  both are degenerate: on the flight line blocks everything, behind the receiver
  blocks nothing. Alongside, on the side the disc is coming from, is the one
  place where which shoulder you throw to is the whole question.

Measured over real driven turns: **7 throws, 6 caught, 1 blocked**, a score,
no console errors. Preview still equals the simulation to 0.0000 m on a clear
lane and on a hard cut, and the 1.7 m contact floor held at 1.892 m.

---

## Known limits

- A defender planted directly in front of a cutter stops them dead at contact.
  That is the honest physical outcome, but there is no contact/foul concept, so
  it never resolves the way it would on a real field.
- The drawn token is 2.0 m and a body is 0.85 m, so two players in contact
  still show overlapping discs. The token is sized to hold its label at this
  scale; a ring drawn at the true body radius came out 8 px across and read as
  noise, so it was reverted.
- The AI defence never contests a loose disc; it only ever defends.
- The AI defence cannot be faked — it ignores the tell.
