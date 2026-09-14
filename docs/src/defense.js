import { BODY_R, FIELD } from './constants.js';
import { add, clamp, mul } from './vec.js';

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
