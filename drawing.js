/* drawing.js — every view is a projection of the same 3D assembly.
 *
 * There is no per-plan drawing code anywhere on this site. Front, side, top
 * and the exploded isometric are four projections of the identical vertex
 * data the cut list was checked against, which is the only reason a drawing
 * here cannot quietly disagree with the numbers beside it.
 *
 * Units are inches all the way through. The viewBox is in inches too, and
 * anything that should be a fixed number of pixels on screen — line weights,
 * text, arrowheads — is divided by the scale so it stays put whether you are
 * looking at a 10" birdhouse or a 6-foot bookshelf.
 */
(function (root) {
  'use strict';

  const L = root.Lumber;
  const G = root.Geom;

  const VIEWS = {
    front: { label: 'Front elevation', axes: [0, 2], depth: 1, dir: 1 },
    side:  { label: 'Side elevation',  axes: [1, 2], depth: 0, dir: -1 },
    top:   { label: 'Plan view',       axes: [0, 1], depth: 2, dir: -1 },
  };

  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const f2 = (n) => (Math.round(n * 1000) / 1000);

  /* Andrew's monotone chain. The silhouette of a convex box under any
     parallel projection is the hull of its projected corners, so this is
     exact rather than an approximation. */
  function hull(pts) {
    if (pts.length < 3) return pts.slice();
    const p = pts.slice().sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [];
    for (const q of p) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 1e-12) lower.pop();
      lower.push(q);
    }
    const upper = [];
    for (let i = p.length - 1; i >= 0; i--) {
      const q = p[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 1e-12) upper.pop();
      upper.push(q);
    }
    lower.pop(); upper.pop();
    return lower.concat(upper);
  }

  const ISO_C = Math.cos(Math.PI / 6), ISO_S = Math.sin(Math.PI / 6);
  const isoPt = (v) => [(v[0] - v[1]) * ISO_C, v[2] - (v[0] + v[1]) * ISO_S];

  function project(verts, view) {
    if (view === 'iso') return verts.map(isoPt);
    const [a, b] = VIEWS[view].axes;
    return verts.map((v) => [v[a], v[b]]);
  }

  /* ---- svg primitives (screen y is flipped, so v is negated) ---- */
  const poly = (pts, cls, extra) =>
    `<polygon class="${cls}" points="${pts.map((p) => `${f2(p[0])},${f2(-p[1])}`).join(' ')}"${extra || ''}/>`;
  const line = (a, b, cls) =>
    `<line class="${cls}" x1="${f2(a[0])}" y1="${f2(-a[1])}" x2="${f2(b[0])}" y2="${f2(-b[1])}"/>`;
  const text = (p, s, cls, size, anchor) =>
    `<text class="${cls}" x="${f2(p[0])}" y="${f2(-p[1])}" font-size="${f2(size)}" ` +
    `text-anchor="${anchor || 'middle'}">${esc(s)}</text>`;

  /* A dimension line the way a drawing has one: witness lines out to the
     measurement, arrowheads turned in, and the figure sitting on the line. */
  function dimension(from, to, off, label, u) {
    const horiz = Math.abs(to[0] - from[0]) >= Math.abs(to[1] - from[1]);
    const a = horiz ? [from[0], off] : [off, from[1]];
    const b = horiz ? [to[0], off] : [off, to[1]];
    const arrow = u.arrow;
    const parts = [
      line(from, horiz ? [from[0], off + Math.sign(off - from[1]) * u.tick] : [off + Math.sign(off - from[0]) * u.tick, from[1]], 'dwg-wit'),
      line(to, horiz ? [to[0], off + Math.sign(off - to[1]) * u.tick] : [off + Math.sign(off - to[0]) * u.tick, to[1]], 'dwg-wit'),
      line(a, b, 'dwg-dim'),
    ];
    const head = (p, dir) => (horiz
      ? poly([[p[0], p[1]], [p[0] + dir * arrow, p[1] + arrow * 0.36], [p[0] + dir * arrow, p[1] - arrow * 0.36]], 'dwg-arrow')
      : poly([[p[0], p[1]], [p[0] + arrow * 0.36, p[1] + dir * arrow], [p[0] - arrow * 0.36, p[1] + dir * arrow]], 'dwg-arrow'));
    const s = horiz ? Math.sign(b[0] - a[0]) : Math.sign(b[1] - a[1]);
    parts.push(head(a, s), head(b, -s));
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if (horiz) {
      parts.push(`<rect class="dwg-label-bg" x="${f2(mid[0] - u.font * label.length * 0.32)}" ` +
        `y="${f2(-mid[1] - u.font * 0.62)}" width="${f2(u.font * label.length * 0.64)}" height="${f2(u.font * 1.24)}"/>`);
      parts.push(text([mid[0], mid[1] - u.font * 0.34], label, 'dwg-text', u.font));
    } else {
      parts.push(`<g transform="translate(${f2(mid[0])},${f2(-mid[1])}) rotate(-90)">` +
        `<rect class="dwg-label-bg" x="${f2(-u.font * label.length * 0.32)}" y="${f2(-u.font * 0.62)}" ` +
        `width="${f2(u.font * label.length * 0.64)}" height="${f2(u.font * 1.24)}"/>` +
        `<text class="dwg-text" x="0" y="${f2(u.font * 0.36)}" font-size="${f2(u.font)}" text-anchor="middle">${esc(label)}</text></g>`);
    }
    return parts.join('');
  }

  /* ---- the exploded isometric ---------------------------------------- */
  function explode(item, centre, factor) {
    if (factor === 0) return item;
    const box = G.aabbOf(item);
    const mid = [0, 1, 2].map((i) => (box.lo[i] + box.hi[i]) / 2);
    const d = [0, 1, 2].map((i) => (mid[i] - centre[i]) * factor);
    const moved = Object.assign({}, item);
    if (item.verts) moved.verts = item.verts.map((v) => G.add(v, d));
    else if (item.profile) {
      const off = item.axis === 'x' ? [d[1], d[2]] : item.axis === 'z' ? [d[0], d[1]] : [d[0], d[2]];
      moved.profile = item.profile.map((q) => [q[0] + off[0], q[1] + off[1]]);
      const e = item.axis === 'x' ? d[0] : item.axis === 'z' ? d[2] : d[1];
      moved.from = item.from + e; moved.to = item.to + e;
    } else moved.pos = G.add(item.pos, d);
    return moved;
  }

  function isoBody(built, opts) {
    const bb = G.bboxOf(built.assembly);
    const centre = [0, 1, 2].map((i) => (bb.lo[i] + bb.hi[i]) / 2);
    const factor = opts.explode || 0;
    const faces = [];
    for (const item of built.assembly) {
      const moved = explode(item, centre, factor);
      const solid = G.solidOf(moved);
      for (const idx of solid.faces) {
        const vs = idx.map((i) => solid.verts[i]);
        // Depth for the painter's ordering: distance along the view direction.
        const depth = vs.reduce((s, v) => s + v[0] + v[1] + v[2], 0) / vs.length;
        // Shade by which way the face points, so the solid reads as a solid.
        const e1 = G.sub(vs[1], vs[0]), e2 = G.sub(vs[2], vs[0]);
        const nrm = G.cross(e1, e2);
        const len = G.norm(nrm) || 1;
        const up = Math.abs(nrm[2] / len);
        const shade = up > 0.85 ? 'a' : Math.abs(nrm[0] / len) > Math.abs(nrm[1] / len) ? 'b' : 'c';
        faces.push({ depth, pts: vs.map(isoPt), shade });
      }
    }
    faces.sort((a, b) => a.depth - b.depth);
    return faces;
  }

  /* ---- main entry ------------------------------------------------------ */
  function render(built, view, opts) {
    opts = opts || {};
    const targetPx = opts.width || 520;
    const metric = !!opts.metric;
    const body = [];
    let pts = [];

    if (view === 'iso') {
      const faces = isoBody(built, opts);
      for (const fc of faces) { pts = pts.concat(fc.pts); }
      const bb2 = bounds(pts);
      const u = units(bb2, targetPx, 0.06);
      for (const fc of faces) body.push(poly(fc.pts, 'dwg-iso dwg-iso-' + fc.shade));
      return svg(bb2, u, body.join(''), VIEWS.front && 'iso', opts);
    }

    const V = VIEWS[view];
    if (!V) throw new Error('unknown view: ' + view);
    const shapes = built.assembly.map((item) => {
      const solid = G.solidOf(item);
      const flat = hull(project(solid.verts, view));
      const box = G.aabbOf(item);
      return { flat, depth: V.dir * (box.lo[V.depth] + box.hi[V.depth]) / 2 };
    });
    shapes.sort((a, b) => b.depth - a.depth);      // far parts first
    for (const s of shapes) pts = pts.concat(s.flat);

    const bb = bounds(pts);
    const u = units(bb, targetPx, 0.16);
    for (const s of shapes) body.push(poly(s.flat, 'dwg-part'));

    for (const feat of built.features || []) {
      if (feat.view !== view) continue;
      if (feat.kind === 'hole') {
        body.push(`<circle class="dwg-hole" cx="${f2(feat.x)}" cy="${f2(-feat.y)}" r="${f2(feat.d / 2)}"/>`);
        body.push(line([feat.x - feat.d, feat.y], [feat.x + feat.d, feat.y], 'dwg-centre'));
        body.push(line([feat.x, feat.y - feat.d], [feat.x, feat.y + feat.d], 'dwg-centre'));
        body.push(text([feat.x, feat.y - feat.d - u.font * 0.9], feat.label, 'dwg-text', u.font));
      } else if (feat.kind === 'note') {
        body.push(text([feat.x, feat.y], feat.label, 'dwg-text dwg-note', u.font));
      }
    }

    // Overall dimensions: the two this view can actually show.
    const wLabel = L.len(bb.w, metric);
    const hLabel = L.len(bb.h, metric);
    body.push(dimension([bb.x0, bb.y0], [bb.x1, bb.y0], bb.y0 - u.gap, wLabel, u));
    body.push(dimension([bb.x1, bb.y0], [bb.x1, bb.y1], bb.x1 + u.gap, hLabel, u));
    body.push(text([bb.x0, bb.y1 + u.gap * 0.55], V.label.toUpperCase(),
      'dwg-text dwg-view-label', u.font, 'start'));

    return svg(bb, u, body.join(''), view, opts);
  }

  function bounds(pts) {
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    const y0 = Math.min(...ys), y1 = Math.max(...ys);
    return { x0, x1, y0, y1, w: x1 - x0, h: y1 - y0 };
  }

  /* Fixed-pixel sizes converted into inches, so nothing shrinks to a hair on
     a big object or turns into a slab on a small one.
     The divisor is the LONGER side, not the width: a 30x48 bookshelf is fitted
     into the frame by its height, so scaling text off the width alone rendered
     the dimension figures too small to read on every tall plan. */
  function units(bb, targetPx, padFrac) {
    const span = Math.max(bb.w, bb.h, 1);
    const pad = span * padFrac + span * 0.06;
    const scale = targetPx / (span + 2 * pad);
    const px = (n) => n / scale;
    return { pad, scale, px, font: px(11), arrow: px(7), tick: px(4), gap: px(26), stroke: px(1) };
  }

  function svg(bb, u, body, view, opts) {
    const pad = Math.max(u.gap * 1.5, u.pad);
    const x = bb.x0 - pad, y = -(bb.y1 + pad);
    const w = bb.w + 2 * pad, h = bb.h + 2 * pad;
    const title = view === 'iso' ? 'Exploded view' : (VIEWS[view] ? VIEWS[view].label : view);
    return `<svg class="dwg" viewBox="${f2(x)} ${f2(y)} ${f2(w)} ${f2(h)}" ` +
      `role="img" aria-label="${esc(title)}" preserveAspectRatio="xMidYMid meet" ` +
      `style="--dwg-stroke:${f2(u.stroke)}">${body}</svg>`;
  }

  const api = { render, VIEWS, hull, isoPt };
  root.Drawing = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
