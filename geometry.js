/* geometry.js — 3D bookkeeping and the compound-angle solver.
 *
 * Two jobs:
 *
 * 1. Assembly checking. Every plan hands back both a cut list and a 3D
 *    placement of every part. Those two can disagree — that is precisely the
 *    bug ("this apron is two leg-widths too long") that looks completely
 *    plausible in a table of numbers and completely wrong in a pile of wood.
 *    Here we make them prove they agree.
 *
 * 2. Compound cuts. A leg that splays two ways does not meet the floor at any
 *    angle you can guess. solveCut() goes geometry -> saw settings and
 *    cutPlaneNormal() goes saw settings -> geometry by an independent path;
 *    running one into the other is the test.
 *
 * A part is placed in one of three forms:
 *   box      axis-aligned      { pos:[x,y,z], size:[dx,dy,dz] }
 *   oriented tilted rectangle  { center, frame:{u,w,n}, dims:{L,W,T} }
 *   prism    2D profile        { profile:[[a,b]...], axis:'x'|'y'|'z', from, to }
 * Everything downstream — the checker and every drawing — works off the
 * vertices and faces that solidOf() produces, so there is one geometry and not
 * one per view.
 */
(function (root) {
  'use strict';

  const EPS = 1e-9;
  const DEG = 180 / Math.PI;

  /* ---- small vector helpers (arrays of 3) ---- */
  const add   = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub   = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const dot   = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const norm = (a) => Math.sqrt(dot(a, a));
  function unit(a) {
    const n = norm(a);
    if (n < EPS) throw new Error('cannot normalise a zero vector');
    return scale(a, 1 / n);
  }

  /* ---- compound cuts --------------------------------------------------
   *
   * A board has an orthonormal frame: u along its length, w across its width
   * (in the wide face), n out through the wide face. A saw setting is two
   * numbers:
   *
   *   miter M — swing the cut within the wide face, about n
   *   bevel V — tilt the blade out of the wide face
   *
   * Applying them in that order to a square crosscut gives the cut plane
   * normal m = cos(V)(cos(M)u + sin(M)w) + sin(V)n. cutPlaneNormal() is that
   * formula and solveCut() inverts it. What the test actually proves is not
   * that these two agree with each other, but that feeding a real leg's
   * geometry through solveCut() and the answer back through cutPlaneNormal()
   * reproduces a horizontal plane — i.e. the sawhorse sits flat on the floor.
   */
  function cutPlaneNormal(frame, miter, bevel) {
    const { u, w, n } = frame;
    const inFace = add(scale(u, Math.cos(miter)), scale(w, Math.sin(miter)));
    return add(scale(inFace, Math.cos(bevel)), scale(n, Math.sin(bevel)));
  }

  function solveCut(frame, planeNormal) {
    const m = unit(planeNormal);
    const a = dot(frame.u, m);
    const b = dot(frame.w, m);
    const c = dot(frame.n, m);
    // Orient toward the board axis so a square cut reads 0/0, not 180/0.
    const s = a < 0 ? -1 : 1;
    return {
      miter: Math.atan2(s * b, s * a),
      bevel: Math.asin(Math.max(-1, Math.min(1, s * c))),
    };
  }

  /* Build a board frame from its axis and a preferred face direction. The
     face normal is that direction with any component along the axis removed,
     which is what "lay the wide face against the beam" means once the leg has
     been tilted away from it. */
  function frameFrom(axis, faceHint) {
    const u = unit(axis);
    let n = sub(faceHint, scale(u, dot(faceHint, u)));
    if (norm(n) < 1e-7) throw new Error('face hint is parallel to the board axis');
    n = unit(n);
    const w = cross(n, u);          // makes (u, w, n) right-handed: u x w = n
    return { u, w, n };
  }

  /* A leg splayed two ways, described the way you would build it: the beam
     runs along X, the leg's wide face lies against the beam's side (so the
     face points along Y), and the foot kicks out by splayX along the beam and
     splayY across it.
     `sx`/`sy` are +/-1 for which corner this leg is.  */
  function splayedLeg(splayXdeg, splayYdeg, rise, sx, sy, thick, width) {
    sx = sx === undefined ? 1 : sx;
    sy = sy === undefined ? 1 : sy;
    const tx = Math.tan(splayXdeg / DEG);
    const ty = Math.tan(splayYdeg / DEG);
    // foot -> top: the foot sits out at (sx*tx, sy*ty) per unit of rise.
    const frame = frameFrom([-sx * tx, -sy * ty, 1], [0, sy, 0]);
    const cut = solveCut(frame, [0, 0, 1]);       // floor and beam are both level

    // The board must be long enough that its *corners* still reach both
    // horizontal planes, not just its centreline. This is the overhang that
    // naive plans lose: the wider the leg and the steeper the splay, the more
    // stock the compound cut eats.
    const uz = frame.u[2];
    const overhang = (width / 2) * Math.abs(frame.w[2]) + (thick / 2) * Math.abs(frame.n[2]);
    return {
      frame,
      miter: cut.miter,
      bevel: cut.bevel,
      miterDeg: Math.abs(cut.miter * DEG),
      bevelDeg: Math.abs(cut.bevel * DEG),
      axialLength: rise / uz,
      length: (rise + 2 * overhang) / uz,
      runX: rise * tx,
      runY: rise * ty,
    };
  }

  /* ---- solids ---------------------------------------------------------- */

  const BOX_FACES = [
    [0, 1, 2, 3], [4, 5, 6, 7],   // -n / +n
    [0, 1, 5, 4], [3, 2, 6, 7],
    [0, 3, 7, 4], [1, 2, 6, 5],
  ];

  function solidOf(item) {
    if (item.verts) return { verts: item.verts, faces: BOX_FACES };
    if (item.profile) {
      const p = item.profile, axis = item.axis || 'y';
      const verts = [];
      const put = (a, b, e) => {
        if (axis === 'x') return [e, a, b];
        if (axis === 'z') return [a, b, e];
        return [a, e, b];                       // 'y': profile is (x, z)
      };
      for (const [a, b] of p) verts.push(put(a, b, item.from));
      for (const [a, b] of p) verts.push(put(a, b, item.to));
      const n = p.length;
      const faces = [];
      faces.push(p.map((_, i) => i));
      faces.push(p.map((_, i) => n + n - 1 - i));
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        faces.push([i, j, n + j, n + i]);
      }
      return { verts, faces };
    }
    if (item.frame) {
      const { u, w, n } = item.frame;
      const { L, W, T } = item.dims;
      const verts = [];
      for (const su of [-1, 1]) for (const sw of [-1, 1]) for (const sn of [-1, 1]) {
        verts.push(add(item.center,
          add(scale(u, su * L / 2), add(scale(w, sw * W / 2), scale(n, sn * T / 2)))));
      }
      // vertex order above is (su, sw, sn) little-endian on sn
      const faces = [
        [0, 2, 6, 4], [1, 3, 7, 5],
        [0, 1, 3, 2], [4, 5, 7, 6],
        [0, 1, 5, 4], [2, 3, 7, 6],
      ];
      return { verts, faces };
    }
    const [x, y, z] = item.pos, [dx, dy, dz] = item.size;
    const verts = [
      [x, y, z], [x + dx, y, z], [x + dx, y + dy, z], [x, y + dy, z],
      [x, y, z + dz], [x + dx, y, z + dz], [x + dx, y + dy, z + dz], [x, y + dy, z + dz],
    ];
    return { verts, faces: BOX_FACES };
  }

  function aabbOf(item) {
    const { verts } = solidOf(item);
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const v of verts) for (let i = 0; i < 3; i++) {
      lo[i] = Math.min(lo[i], v[i]); hi[i] = Math.max(hi[i], v[i]);
    }
    return { lo, hi, size: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]] };
  }

  /* The three numbers a part must have been cut to, in whatever order.
   *
   * When an item carries a frame, the answer is measured in the board's own
   * axes rather than the world's. That is the whole trick for angled parts: a
   * compound-cut sawhorse leg and a bevel-ripped roof panel are not boxes and
   * their world-space extents are not their blank, but their extents along
   * (u, w, n) are exactly the length, width and thickness you cut. So those
   * parts get a real dimension check too, not a declared one. */
  function frameExtents(item) {
    const { verts } = solidOf(item);
    const { u, w, n } = item.frame;
    const out = [];
    for (const ax of [u, w, n]) {
      let lo = Infinity, hi = -Infinity;
      for (const v of verts) { const d = dot(v, ax); lo = Math.min(lo, d); hi = Math.max(hi, d); }
      out.push(hi - lo);
    }
    return out;
  }

  function placedDims(item) {
    if (item.frame && item.dims && !item.verts && !item.profile) {
      return [item.dims.L, item.dims.W, item.dims.T];
    }
    if (item.frame) return frameExtents(item);
    if (item.profile) {
      const a = item.profile.map((p) => p[0]), b = item.profile.map((p) => p[1]);
      return [
        Math.max(...a) - Math.min(...a),
        Math.max(...b) - Math.min(...b),
        Math.abs(item.to - item.from),
      ];
    }
    return item.size.slice();
  }

  function boxesOverlap(a, b, eps) {
    eps = eps === undefined ? 1e-6 : eps;
    const A = aabbOf(a), B = aabbOf(b);
    for (let i = 0; i < 3; i++) {
      // Touching faces are how furniture works; only interpenetration counts.
      if (A.hi[i] - B.lo[i] <= eps || B.hi[i] - A.lo[i] <= eps) return false;
    }
    return true;
  }

  function bboxOf(items) {
    if (!items.length) return null;
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const it of items) {
      const a = aabbOf(it);
      for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], a.lo[i]); hi[i] = Math.max(hi[i], a.hi[i]); }
    }
    return { lo, hi, size: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]] };
  }

  /* Slide a whole assembly so its bounding box starts at the origin. Plans
     that are natural to lay out around a centreline (anything symmetrical)
     build that way and then call this. */
  function recenter(items) {
    const bb = bboxOf(items);
    if (!bb) return items;
    const d = bb.lo;
    for (const it of items) {
      if (it.verts) {
        it.verts = it.verts.map((v) => sub(v, d));
      } else if (it.profile) {
        const off = it.axis === 'x' ? [d[1], d[2]] : it.axis === 'z' ? [d[0], d[1]] : [d[0], d[2]];
        it.profile = it.profile.map((p) => [p[0] - off[0], p[1] - off[1]]);
        const e = it.axis === 'x' ? d[0] : it.axis === 'z' ? d[2] : d[1];
        it.from -= e; it.to -= e;
      } else if (it.frame) {
        it.center = sub(it.center, d);
      } else {
        it.pos = sub(it.pos, d);
      }
    }
    return items;
  }

  const r3 = (x) => Math.round(x * 1000) / 1000;

  /* ---- the oracle -----------------------------------------------------
   *
   * Returns an array of human-readable problems; empty means the cut list and
   * the 3D model describe the same object.
   *
   * `embed` on an assembly item is material buried in a joint — a dado
   * tongue, a tenon. The part is cut that much longer than the space it
   * occupies, and having to state it is the point: every joint that eats
   * length gets declared instead of being quietly absorbed into a number.
   *
   * The pairwise overlap test only runs between axis-aligned parts. A tilted
   * or shaped part's bounding box is not the part, so testing it would report
   * a gable roof as a collision. Those parts are still checked for blank size,
   * count and envelope.
   */
  function checkAssembly(built, opts) {
    opts = opts || {};
    const tol = opts.tol || 1e-6;
    const problems = [];
    const parts = built.parts || [];
    const asm = built.assembly || [];

    const wanted = new Map();
    for (const p of parts) {
      if (!(p.length > 0) || !(p.width > 0) || !(p.thick > 0)) {
        problems.push(`part "${p.name}" has a non-positive dimension ` +
          `(${r3(p.thick)} x ${r3(p.width)} x ${r3(p.length)})`);
      }
      if (p.length > 144.001) {
        problems.push(`part "${p.name}" is ${r3(p.length)}" long, past the longest stock sold (144")`);
      }
      if (p.width > 48.001) {
        problems.push(`part "${p.name}" is ${r3(p.width)}" wide, past a 48" sheet`);
      }
      wanted.set(p.name, (wanted.get(p.name) || 0) + (p.qty || 1));
    }

    const seen = new Map();
    for (const it of asm) {
      seen.set(it.part, (seen.get(it.part) || 0) + 1);
      const p = parts.find((q) => q.name === it.part);
      if (!p) { problems.push(`assembly references unknown part "${it.part}"`); continue; }
      const embed = it.embed || 0;
      const want = [p.thick, p.width, p.length - embed].sort((a, b) => a - b);
      const got = placedDims(it).sort((a, b) => a - b);
      if (got.some((s) => !(s > 0))) {
        problems.push(`"${it.part}" is placed with a non-positive extent`);
        continue;
      }
      for (let i = 0; i < 3; i++) {
        if (Math.abs(want[i] - got[i]) > tol) {
          problems.push(
            `"${it.part}" placed as ${got.map(r3).join(' x ')} but cut as ` +
            `${want.map(r3).join(' x ')}` + (embed ? ` (after ${r3(embed)}" embedded)` : ''));
          break;
        }
      }
    }

    for (const [name, qty] of wanted) {
      const got = seen.get(name) || 0;
      if (got !== qty) problems.push(`cut list says ${qty} x "${name}" but ${got} are placed`);
    }
    for (const [name] of seen) {
      if (!wanted.has(name)) problems.push(`"${name}" is placed but is not in the cut list`);
    }

    const plain = asm.filter((it) => !it.frame && !it.profile && !it.verts);
    for (let i = 0; i < plain.length; i++) {
      for (let j = i + 1; j < plain.length; j++) {
        if (boxesOverlap(plain[i], plain[j])) {
          problems.push(`"${plain[i].part}" and "${plain[j].part}" occupy the same space`);
        }
      }
    }

    if (built.actual && asm.length) {
      const bb = bboxOf(asm);
      const claim = [built.actual.x, built.actual.y, built.actual.z];
      for (let i = 0; i < 3; i++) {
        if (Math.abs(claim[i] - bb.size[i]) > 1e-4) {
          problems.push(
            `stated size ${claim.map(r3).join(' x ')} but the model measures ` +
            `${bb.size.map(r3).join(' x ')}`);
          break;
        }
      }
      if (Math.min(...bb.lo) < -1e-6) {
        problems.push(`assembly extends to ${bb.lo.map(r3).join(', ')}, not anchored at the origin`);
      }
    }

    return problems;
  }

  const api = {
    add, sub, scale, dot, cross, norm, unit, DEG, EPS,
    cutPlaneNormal, solveCut, frameFrom, splayedLeg,
    solidOf, aabbOf, placedDims, boxesOverlap, bboxOf, recenter, checkAssembly,
  };

  root.Geom = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
