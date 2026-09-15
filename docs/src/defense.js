import { BODY_R, FIELD } from './constants.js';
import { add, clamp, mag, mul, sub } from './vec.js';

export const defaultCoverage = () => ({ force: 'right', priority: 'under', bite: false });
export const BITE_TIME = 0.65;

export const bounded = (p) => ({
  x: clamp(p.x, BODY_R, FIELD.width - BODY_R),
  y: clamp(p.y, BODY_R, FIELD.length - BODY_R),
});

/** Left/right are from the attacker's perspective, facing the scoring end.
 * A force invites that side; the defender protects the opposite shoulder.
 * Under/deep fixes the other axis, even when the cutter changes direction.
 */
export function coverageOffset(policy, dir, carrying = false, biting = false) {
  if (policy.offset) {
    return {
      x: policy.offset.x,
      y: policy.offset.y + (biting && !carrying ? dir * (policy.priority === 'deep' ? 1 : -1) * 2 : 0),
    };
  }
  return {
    x: (policy.force === 'left' ? -dir : dir) * (carrying ? 2.2 : 1.65),
    // Deep needs a cushion: a reacting defender cannot recover a lost stride
    // from a cutter already at the same top speed. Under plays tighter.
    y: carrying ? dir * 1.7 : dir * (policy.priority === 'deep' ? 1 : -1) * (biting ? 4 : policy.priority === 'deep' ? 2.6 : 1.4),
  };
}

/** A moving position to defend, not an endpoint to stop at. No routes or
 * unreleased throw targets enter this calculation: only a body's current read.
 */
export function coverageIntent(policy, mark, dir, carrying = false, biting = false) {
  const velocity = carrying ? { x: 0, y: 0 } : { ...mark.vel };
  const offset = coverageOffset(policy, dir, carrying, biting);
  const target = bounded(add(mark.pos, offset));
  // Stop feeding velocity into the boundary once the protected spot is there.
  if ((target.x <= BODY_R && velocity.x < 0) || (target.x >= FIELD.width - BODY_R && velocity.x > 0)) velocity.x = 0;
  if ((target.y <= BODY_R && velocity.y < 0) || (target.y >= FIELD.length - BODY_R && velocity.y > 0)) velocity.y = 0;
  return { target, velocity };
}

/** A hard bite follows the initial read for a short commitment window. */
export function committedIntent(read, elapsed) {
  return { target: bounded(add(read.target, mul(read.velocity, elapsed))), velocity: read.velocity };
}

/** Read acceleration from observed motion, never from a cutter's future route.
 * Smooth frame-to-frame contact noise and forget stale reads when time resets
 * or the matchup changes. Re-reading the same frame does not advance memory.
 */
export function readMomentum(previous, mark, t) {
  const fresh = { id: mark.id, at: t, velocity: { ...mark.vel }, acceleration: { x: 0, y: 0 } };
  if (!previous || previous.id !== mark.id || t < previous.at || t - previous.at > 0.1) return fresh;
  if (t === previous.at) return previous;
  const dt = t - previous.at;
  let acceleration = mul(sub(mark.vel, previous.velocity), 1 / dt);
  const limit = Math.max(mark.spec.accel, mark.spec.brake, mark.spec.agility);
  const size = mag(acceleration);
  if (size > limit) acceleration = mul(acceleration, limit / size);
  const blend = 1 - Math.exp(-dt / 0.08);
  fresh.acceleration = add(mul(previous.acceleration, 1 - blend), mul(acceleration, blend));
  return fresh;
}

/** Match momentum, allowing enough distance to shed our closing speed.
 * A short extrapolation of observed braking anticipates the cutter pulling up.
 * The speed envelope is based on this defender's braking/agility, so a fast
 * approach slows before the protected shoulder instead of overshooting it.
 */
export function coverageVelocity(player, intent) {
  const brake = 0.8 * Math.min(player.spec.brake, player.spec.agility);
  const relative = sub(intent.velocity, player.vel);
  const horizon = clamp(mag(relative) / brake, 0.12, 0.3);
  const acceleration = intent.acceleration ?? { x: 0, y: 0 };
  const speed = mag(intent.velocity);
  let look = horizon;
  // Braking predicts a stop, not an invented reversal after the stop.
  const decel = speed > 0.05 ? -(acceleration.x * intent.velocity.x + acceleration.y * intent.velocity.y) / speed : 0;
  if (decel > 0) look = Math.min(look, speed / decel);
  if (speed <= 0.05) look = 0;
  const velocity = add(intent.velocity, mul(acceleration, look));
  const error = add(sub(intent.target, player.pos), add(mul(relative, horizon), mul(acceleration, 0.5 * look * look)));
  const correction = (distance) => Math.sign(distance) * Math.min(3 * Math.abs(distance), Math.sqrt(2 * brake * Math.abs(distance)));
  const desired = add(velocity, { x: correction(error.x), y: correction(error.y) });
  const want = mag(desired);
  return want > player.spec.maxSpeed ? mul(desired, player.spec.maxSpeed / want) : desired;
}
