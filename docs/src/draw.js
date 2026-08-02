/**
 * Flat drawing primitives. Everything is a clean stroke on a pixel grid —
 * no jitter, no double passes, no hand-drawn pastiche.
 */

export function polyline(ctx, pts, o) {
  if (!pts || pts.length < 2) return;
  ctx.save();
  ctx.strokeStyle = o.color;
  ctx.lineWidth = o.width ?? 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (o.alpha != null) ctx.globalAlpha = o.alpha;
  if (o.dash) ctx.setLineDash(o.dash);
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
  ctx.restore();
}

export const line = (ctx, a, b, o) => polyline(ctx, [a, b], o);

/** Two barbs at the tip, angled off the last bit of travel. */
export function arrowHead(ctx, pts, o) {
  const tip = pts[pts.length - 1];
  let from = pts[0];
  for (let i = pts.length - 2; i >= 0; i--) {
    from = pts[i];
    if (Math.hypot(tip.x - from.x, tip.y - from.y) > 6) break;
  }
  const dx = tip.x - from.x;
  const dy = tip.y - from.y;
  const m = Math.hypot(dx, dy);
  if (m < 0.5) return;
  const size = o.head ?? 9;
  const ux = -dx / m;
  const uy = -dy / m;
  const a = 0.42;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  ctx.save();
  ctx.fillStyle = o.color;
  if (o.alpha != null) ctx.globalAlpha = o.alpha;
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(tip.x + (ux * cos - uy * sin) * size, tip.y + (ux * sin + uy * cos) * size);
  ctx.lineTo(tip.x + (ux * cos + uy * sin) * size, tip.y + (-ux * sin + uy * cos) * size);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export function arrow(ctx, pts, o) {
  polyline(ctx, pts, o);
  arrowHead(ctx, pts, o);
}

export function circle(ctx, x, y, r, o) {
  ctx.save();
  if (o.alpha != null) ctx.globalAlpha = o.alpha;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  if (o.fill) {
    ctx.fillStyle = o.fill;
    ctx.fill();
  }
  if (o.color) {
    ctx.strokeStyle = o.color;
    ctx.lineWidth = o.width ?? 2;
    if (o.dash) ctx.setLineDash(o.dash);
    ctx.stroke();
  }
  ctx.restore();
}

export function roundedRect(ctx, x, y, w, h, r, o) {
  ctx.save();
  if (o.alpha != null) ctx.globalAlpha = o.alpha;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  if (o.fill) {
    ctx.fillStyle = o.fill;
    ctx.fill();
  }
  if (o.color) {
    ctx.strokeStyle = o.color;
    ctx.lineWidth = o.width ?? 2;
    if (o.dash) ctx.setLineDash(o.dash);
    ctx.stroke();
  }
  ctx.restore();
}

export function label(ctx, text, x, y, o) {
  ctx.save();
  ctx.fillStyle = o.color;
  ctx.font = o.font;
  ctx.textAlign = o.align ?? 'center';
  ctx.textBaseline = o.baseline ?? 'middle';
  if (o.alpha != null) ctx.globalAlpha = o.alpha;
  ctx.fillText(text, x, y);
  ctx.restore();
}
