export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a, k) => ({ x: a.x * k, y: a.y * k });
export const mag = (a) => Math.hypot(a.x, a.y);
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const clone = (a) => ({ x: a.x, y: a.y });

export function norm(a) {
  const m = Math.hypot(a.x, a.y);
  return m < 1e-9 ? { x: 0, y: 0 } : { x: a.x / m, y: a.y / m };
}

export function lerp(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Left-hand normal of a vector. */
export const perp = (a) => ({ x: -a.y, y: a.x });

/**
 * A throw's flight line: a quadratic Bézier from a to b whose apex sits `bow`
 * metres to the left of the straight line (negative bends the other way).
 * Sampled into a polyline so flight, blocks and drawing all share one path.
 */
export function arcPoints(a, b, bow, samples) {
  if (!bow) return [clone(a), clone(b)];
  const mid = lerp(a, b, 0.5);
  const n = perp(norm(sub(b, a)));
  const c = add(mid, mul(n, 2 * bow));
  const out = new Array(samples + 1);
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const s = 1 - t;
    out[i] = {
      x: s * s * a.x + 2 * s * t * c.x + t * t * b.x,
      y: s * s * a.y + 2 * s * t * c.y + t * t * b.y,
    };
  }
  return out;
}

/** Apex of the same arc — where the drag handle lives. */
export const arcApex = (a, b, bow) => add(lerp(a, b, 0.5), mul(perp(norm(sub(b, a))), bow));

export function polylineLength(pts) {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += dist(pts[i - 1], pts[i]);
  return total;
}

/**
 * Uniform Catmull-Rom through `pts`, `steps` samples per segment. Anchor i
 * always lands on sample i*steps, which is what lets a grab on the drawn line
 * be mapped back to the segment it belongs to.
 */
export function spline(pts, steps) {
  if (pts.length < 2) return pts.map(clone);
  const out = [clone(pts[0])];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push({
        x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  return out;
}

/** Split a polyline at `distance` along it: the run so far, and what's left. */
export function splitPolyline(pts, distance) {
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = dist(pts[i - 1], pts[i]);
    if (acc + d >= distance) {
      const cut = lerp(pts[i - 1], pts[i], d < 1e-9 ? 0 : (distance - acc) / d);
      return { before: [...pts.slice(0, i), cut], after: [cut, ...pts.slice(i)] };
    }
    acc += d;
  }
  return { before: pts, after: [pts[pts.length - 1]] };
}

/** Nearest point on a polyline; `index` is the sample the segment starts at. */
export function closestOnPolyline(pts, p) {
  let best = { dist: Infinity, point: pts[0], index: 0 };
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 < 1e-9 ? 0 : clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0, 1);
    const q = { x: a.x + dx * t, y: a.y + dy * t };
    const d = dist(q, p);
    if (d < best.dist) best = { dist: d, point: q, index: i - 1 };
  }
  return best;
}

/** Walk `distance` along the polyline pos -> plan[0] -> plan[1] ... without mutating. */
export function projectAlong(pos, plan, distance) {
  let p = clone(pos);
  let left = distance;
  for (const wp of plan) {
    const d = dist(p, wp);
    if (d <= left) {
      p = clone(wp);
      left -= d;
    } else {
      return lerp(p, wp, left / d);
    }
  }
  return p;
}
