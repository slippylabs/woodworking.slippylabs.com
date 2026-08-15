/* plans.js — the eight builds.
 *
 * Every plan is a pure function of its parameters. It returns:
 *
 *   parts     the cut list, in ACTUAL inches
 *   assembly  every one of those parts, placed in 3D
 *   actual    the finished outside size, stated independently
 *   steps / hardware / warnings / features
 *
 * `assembly` is not decoration. It is what the drawings are projected from
 * and what the test suite checks the cut list against, so a plan cannot claim
 * a part length in the table that disagrees with where the part actually
 * goes. Three rules keep the numbers honest:
 *
 *   - Nothing here uses a nominal dimension for geometry. A 1x6 is 5-1/2".
 *   - Anything built from slats snaps to whole boards, and `actual` reports
 *     what you get, not what you asked for.
 *   - A joint that buries material (a dado tongue) declares `embed`, so the
 *     extra length is visible instead of being folded into a magic number.
 */
(function (root) {
  'use strict';

  const L = root.Lumber;
  const G = root.Geom;
  const DEG = Math.PI / 180;

  /* ---- shared helpers ------------------------------------------------- */

  function part(name, stock, thick, width, length, qty, note) {
    return { name, stock, thick, width, length, qty: qty || 1, note: note || '' };
  }

  /* Fill a span with boards of one width.
     Without `rip`, the span snaps to a whole number of boards and the caller
     reports the snapped size. With `rip`, the last board is ripped to close
     the gap — unless the offcut would be a sliver, in which case dropping a
     board and living with the shorter result beats ripping a 3/8" strip. */
  function slatRun(total, bw, rip) {
    if (!rip) {
      const n = Math.max(1, Math.round(total / bw));
      return { rows: new Array(n).fill(bw), achieved: n * bw, ripped: 0 };
    }
    let n = Math.max(1, Math.ceil(total / bw - 1e-9));
    const rem = total - (n - 1) * bw;
    if (rem > bw - 1e-9) return { rows: new Array(n).fill(bw), achieved: n * bw, ripped: 0 };
    if (rem < 0.5) {
      n = Math.max(1, n - 1);
      return { rows: new Array(n).fill(bw), achieved: n * bw, ripped: 0 };
    }
    const rows = new Array(n - 1).fill(bw);
    rows.push(rem);
    return { rows, achieved: total, ripped: rem };
  }

  /* Boards spread across a span with even gaps between them — slatted
     bottoms, open shelves, anywhere water or light needs to get through. */
  function gapRun(span, bw) {
    const n = Math.max(1, Math.floor(span / bw + 1e-9));
    const gap = n > 1 ? (span - n * bw) / (n - 1) : 0;
    const start = n > 1 ? 0 : (span - bw) / 2;
    return { n, bw, gap, at: (i) => start + i * (bw + gap) };
  }

  const ONE_BY = ['1x2', '1x3', '1x4', '1x6', '1x8', '1x10', '1x12'];
  /* Narrowest board you can rip the piece out of. */
  function fitStock(width) {
    for (const s of ONE_BY) if (L.S4S[s].w >= width - 1e-9) return s;
    return null;
  }

  const cum = (rows) => {
    const out = []; let z = 0;
    for (const r of rows) { out.push(z); z += r; }
    return out;
  };

  /* ---- 1. planter box -------------------------------------------------- */

  const planterBox = {
    id: 'planter-box',
    title: 'Slatted Planter Box',
    icon: '🪴',
    category: 'garden',
    difficulty: 'Beginner',
    time: '2–3 hours',
    joinery: 'Butt joints into four inside corner posts. The long sides lap over the ends, so the ends are cut short by two board thicknesses.',
    blurb: 'Four posts, slatted walls, a slatted bottom that drains. Cedar if it lives outside.',
    dimLabels: ['Length', 'Width', 'Height'],
    params: [
      { key: 'len', label: 'Length', type: 'range', min: 18, max: 48, step: 1, def: 36, unit: 'in' },
      { key: 'wid', label: 'Width', type: 'range', min: 10, max: 24, step: 1, def: 14, unit: 'in' },
      { key: 'hgt', label: 'Height', type: 'range', min: 10, max: 24, step: 1, def: 16, unit: 'in' },
      { key: 'stock', label: 'Slat stock', type: 'select', options: ['1x4', '1x6'], def: '1x6' },
      { key: 'rip', label: 'Rip the top slat to hit the exact height', type: 'bool', def: false },
    ],
    build(p) {
      const A = L.actual(p.stock);
      const t = A.t, bw = A.w;
      const post = 1.5;                       // 2x2 actual
      const Lx = p.len, Wy = p.wid;
      const run = slatRun(p.hgt, bw, p.rip);
      const H = run.achieved;
      const zs = cum(run.rows);
      const nFull = run.rows.filter((r) => Math.abs(r - bw) < 1e-9).length;
      const nRip = run.rows.length - nFull;

      const endLen = Wy - 2 * t;
      const cleatLen = Lx - 2 * t - 2 * post;
      const bottom = gapRun(cleatLen, bw);

      const parts = [
        part('Side slat', p.stock, t, bw, Lx, 2 * nFull),
        part('End slat', p.stock, t, bw, endLen, 2 * nFull),
      ];
      if (nRip) {
        parts.push(part('Side slat (ripped)', p.stock, t, run.ripped, Lx, 2,
          `ripped to ${L.toFraction(run.ripped)}" wide`));
        parts.push(part('End slat (ripped)', p.stock, t, run.ripped, endLen, 2,
          `ripped to ${L.toFraction(run.ripped)}" wide`));
      }
      parts.push(part('Corner post', '2x2', post, post, H, 4));
      parts.push(part('Bottom cleat', '1x2', 0.75, 1.5, cleatLen, 2));
      parts.push(part('Bottom board', p.stock, t, bw, endLen, bottom.n));

      const asm = [];
      const rowName = (r, base) => (Math.abs(r - bw) < 1e-9 ? base : base + ' (ripped)');
      for (const y of [0, Wy - t]) {
        run.rows.forEach((r, i) => {
          asm.push({ part: rowName(r, 'Side slat'), pos: [0, y, zs[i]], size: [Lx, t, r] });
        });
      }
      for (const x of [0, Lx - t]) {
        run.rows.forEach((r, i) => {
          asm.push({ part: rowName(r, 'End slat'), pos: [x, t, zs[i]], size: [t, endLen, r] });
        });
      }
      for (const x of [t, Lx - t - post]) {
        for (const y of [t, Wy - t - post]) {
          asm.push({ part: 'Corner post', pos: [x, y, 0], size: [post, post, H] });
        }
      }
      for (const y of [t, Wy - t - 0.75]) {
        asm.push({ part: 'Bottom cleat', pos: [t + post, y, 0], size: [cleatLen, 0.75, 1.5] });
      }
      for (let i = 0; i < bottom.n; i++) {
        asm.push({ part: 'Bottom board', pos: [t + post + bottom.at(i), t, 1.5], size: [bw, endLen, 0.75] });
      }

      const warnings = [];
      if (Math.abs(H - p.hgt) > 1e-6) {
        warnings.push(`You asked for ${L.toFraction(p.hgt)}" tall. Whole ${p.stock} boards give ` +
          `${L.toFraction(H)}" — turn on the rip option to hit the number exactly.`);
      }
      if (run.ripped) {
        warnings.push(`The top course is ripped to ${L.toFraction(run.ripped)}" wide. Rip all four ` +
          'of those pieces from one board so the grain matches around the box.');
      }
      warnings.push('If this holds soil, line it with landscape fabric — not solid plastic. ' +
        'The gaps in the bottom are the drainage; sealing them rots the box from the inside.');

      const screws = 4 * run.rows.length * 4 + bottom.n * 4 + 16;
      return {
        parts, assembly: asm, warnings,
        actual: { x: Lx, y: Wy, z: H },
        hardware: [
          { item: '1-5/8" exterior screws', qty: `~${screws}` },
          { item: 'Landscape fabric', qty: `${Math.ceil((Lx * 2 + Wy * 2) * H / 144)} sq ft` },
          { item: 'Exterior wood glue', qty: 'optional' },
        ],
        features: [],
        steps: [
          `Cut the four corner posts to ${L.toFraction(H)}". Cut all the side slats to ${L.toFraction(Lx)}" and all the end slats to ${L.toFraction(endLen)}".`,
          `The end slats are short on purpose: ${L.toFraction(Wy)}" less two ${L.toFraction(t)}" side thicknesses = ${L.toFraction(endLen)}". The sides lap over the ends and hide the end grain.`,
          'Build the two ends first. Lay two posts on the bench, spaced by an end slat, and screw the end slats across them from the outside. Two screws per slat per post.',
          `Stand the ends up and connect them with the side slats, again screwing from the outside into the posts. Keep the bottom edges flush; any error should end up at the top rim.`,
          `Screw the two bottom cleats to the inside faces of the long sides, flush with the bottom of the lowest slat, running between the posts (${L.toFraction(cleatLen)}" long).`,
          `Drop the ${bottom.n} bottom boards onto the cleats. Leave the ${L.toFraction(bottom.gap)}" gaps — that is the drainage.`,
          'Ease every edge with sandpaper or a block plane. Sharp arrises on an outdoor box splinter within a season.',
          'Finish, or do not. Cedar and redwood weather to grey and last for years bare; pine wants a penetrating exterior oil, reapplied yearly.',
        ],
      };
    },
  };

  /* ---- shared table frame (side table + coffee table) ------------------ */

  /* Leg options are deliberately square stock only (2x2, 4x4). A 2x3 leg is
     1-1/2" by 2-1/2", so the apron lengths would differ between the two axes
     and the frame would only be right in one direction — the assembly check
     caught exactly that when 2x3 was on the list. */
  function tableFrame(p, cfg, Lx, Wy) {
    const legA = L.actual(p.legStock);
    const lw = legA.w;
    const topA = L.actual(p.topStock);
    const tt = topA.t, tw = topA.w;
    const apronA = L.actual(cfg.apronStock);
    const apronH = apronA.w, apronT = apronA.t;
    const legH = p.hgt - tt;
    /* The overhang has to give way before the frame does. On a narrow top with
       heavy legs the nominal overhang would leave the two aprons closer
       together than their own thickness — which the assembly check caught as
       two shelf cleats occupying the same space. Pull the legs out toward the
       edge rather than letting the frame collapse. */
    const room = Math.min(Lx, Wy) - 2 * lw - MIN_APRON;
    const oh = Math.max(0.5, Math.min(cfg.overhang, room / 2));
    return { legA, lw, topA, tt, tw, oh, apronH, apronT, legH };
  }

  /* Shorter than this and there is no glue surface worth having, and no room
     for a shelf cleat on each side. */
  const MIN_APRON = 4;

  function tableTooSmall(p, cfg, Lx, Wy, f) {
    const longLen = Lx - 2 * f.oh - 2 * f.lw;
    const shortLen = Wy - 2 * f.oh - 2 * f.lw;
    if (Math.min(longLen, shortLen) >= MIN_APRON) return null;
    const need = Math.ceil(2 * f.lw + MIN_APRON + 1);
    return {
      error: `A ${p.legStock} leg is ${L.toFraction(f.lw)}" square, and four of them plus a usable ` +
        `apron need at least about ${need}" in each direction. At ${L.toFraction(Lx)}" x ` +
        `${L.toFraction(Wy)}" the aprons come out ${L.toFraction(Math.min(longLen, shortLen))}" long, ` +
        'which is not a joint. Use 2x2 legs or make the top bigger.',
    };
  }

  function legsAndAprons(f, Lx, Wy, cfg) {
    const { lw, oh, apronH, apronT, legH } = f;
    const longLen = Lx - 2 * oh - 2 * lw;
    const shortLen = Wy - 2 * oh - 2 * lw;
    const asm = [];
    for (const x of [oh, Lx - oh - lw]) {
      for (const y of [oh, Wy - oh - lw]) {
        asm.push({ part: 'Leg', pos: [x, y, 0], size: [lw, lw, legH] });
      }
    }
    for (const y of [oh, Wy - oh - apronT]) {
      asm.push({ part: 'Long apron', pos: [oh + lw, y, legH - apronH], size: [longLen, apronT, apronH] });
    }
    for (const x of [oh, Lx - oh - apronT]) {
      asm.push({ part: 'Short apron', pos: [x, oh + lw, legH - apronH], size: [apronT, shortLen, apronH] });
    }
    return { longLen, shortLen, asm };
  }

  /* ---- 2. side table --------------------------------------------------- */

  const sideTable = {
    id: 'side-table',
    title: 'Side Table',
    icon: '🪑',
    category: 'tables',
    difficulty: 'Intermediate',
    time: '4–6 hours',
    joinery: 'Aprons set flush to the outside of the legs, pocket-screwed or dowelled. The top overhangs the leg faces all round.',
    blurb: 'Four legs, an apron frame, a slatted top and an optional lower shelf. The one everybody builds first.',
    dimLabels: ['Length', 'Width', 'Height'],
    params: [
      { key: 'len', label: 'Length', type: 'range', min: 14, max: 30, step: 1, def: 20, unit: 'in' },
      { key: 'wid', label: 'Width', type: 'range', min: 12, max: 24, step: 1, def: 16, unit: 'in' },
      { key: 'hgt', label: 'Height', type: 'range', min: 18, max: 30, step: 1, def: 24, unit: 'in' },
      { key: 'legStock', label: 'Leg stock', type: 'select', options: ['2x2', '4x4'], def: '2x2' },
      { key: 'topStock', label: 'Top stock', type: 'select', options: ['1x4', '1x6'], def: '1x6' },
      { key: 'shelf', label: 'Lower shelf', type: 'bool', def: true },
      { key: 'rip', label: 'Rip the last top board to hit the exact width', type: 'bool', def: false },
    ],
    build(p) {
      const cfg = { overhang: 1.5, apronStock: '1x4', legStock: p.legStock };
      const Lx = p.len;
      const topA = L.actual(p.topStock);
      const topRun = slatRun(p.wid, topA.w, p.rip);
      const Wy = topRun.achieved;
      const ys = cum(topRun.rows);
      const f = tableFrame(p, cfg, Lx, Wy);
      const tooSmall = tableTooSmall(p, cfg, Lx, Wy, f);
      if (tooSmall) return tooSmall;

      const { longLen, shortLen, asm } = legsAndAprons(f, Lx, Wy, cfg);
      const nFull = topRun.rows.filter((r) => Math.abs(r - f.tw) < 1e-9).length;

      const parts = [
        part('Leg', p.legStock, f.legA.t, f.legA.w, f.legH, 4),
        part('Long apron', cfg.apronStock, f.apronT, f.apronH, longLen, 2),
        part('Short apron', cfg.apronStock, f.apronT, f.apronH, shortLen, 2),
        part('Top board', p.topStock, f.tt, f.tw, Lx, nFull),
      ];
      if (topRun.ripped) {
        parts.push(part('Top board (ripped)', p.topStock, f.tt, topRun.ripped, Lx, 1,
          `ripped to ${L.toFraction(topRun.ripped)}" wide`));
      }
      topRun.rows.forEach((r, i) => {
        const nm = Math.abs(r - f.tw) < 1e-9 ? 'Top board' : 'Top board (ripped)';
        asm.push({ part: nm, pos: [0, ys[i], f.legH], size: [Lx, r, f.tt] });
      });

      let shelfZ = 0, shelfRun = null;
      if (p.shelf) {
        shelfZ = Math.max(4, Math.round(f.legH * 0.28));
        shelfRun = gapRun(longLen, f.tw);
        parts.push(part('Shelf cleat', '1x2', 0.75, 1.5, longLen, 2));
        parts.push(part('Shelf slat', p.topStock, f.tt, f.tw, shortLen, shelfRun.n));
        for (const y of [f.oh + f.lw, Wy - f.oh - f.lw - 0.75]) {
          asm.push({ part: 'Shelf cleat', pos: [f.oh + f.lw, y, shelfZ], size: [longLen, 0.75, 1.5] });
        }
        for (let i = 0; i < shelfRun.n; i++) {
          asm.push({
            part: 'Shelf slat',
            pos: [f.oh + f.lw + shelfRun.at(i), f.oh + f.lw, shelfZ + 1.5],
            size: [f.tw, shortLen, f.tt],
          });
        }
      }

      const warnings = [];
      if (Math.abs(Wy - p.wid) > 1e-6) {
        warnings.push(`You asked for ${L.toFraction(p.wid)}" wide. ${topRun.rows.length} whole ` +
          `${p.topStock} boards give ${L.toFraction(Wy)}" — turn on the rip option to hit it exactly.`);
      }
      if (shortLen < 7) {
        warnings.push(`The short aprons come out only ${L.toFraction(shortLen)}" long. That is a short ` +
          'glue surface for a leg joint — pocket screws or dowels rather than glue alone.');
      }
      if (f.oh < cfg.overhang - 1e-9) {
        warnings.push(`The top overhang was pulled in to ${L.toFraction(f.oh)}" (from ` +
          `${L.toFraction(cfg.overhang)}") so the ${p.legStock} legs still leave a usable apron.`);
      }
      warnings.push('Glue the top boards to each other but fasten the whole top to the aprons with ' +
        'slotted holes or figure-8 fasteners. A solid top moves across the grain with the seasons; ' +
        'screwing it down tight is how tops split.');

      return {
        parts, assembly: asm, warnings,
        actual: { x: Lx, y: Wy, z: p.hgt },
        hardware: [
          { item: '1-1/4" pocket screws', qty: '16' },
          { item: '2-1/2" screws (legs to aprons)', qty: '8' },
          { item: 'Figure-8 tabletop fasteners', qty: '6–8' },
          { item: 'Wood glue', qty: '—' },
        ],
        features: [],
        steps: [
          `Cut four legs to ${L.toFraction(f.legH)}". That is the finished height ${L.toFraction(p.hgt)}" less the ${L.toFraction(f.tt)}" top — the top sits on the legs, it does not sit beside them.`,
          `Cut the aprons: two at ${L.toFraction(longLen)}" and two at ${L.toFraction(shortLen)}". Each is the outside dimension less two ${L.toFraction(f.oh)}" overhangs and two ${L.toFraction(f.lw)}" legs.`,
          'Drill pocket holes in both ends of all four aprons, and along the top edge of the long aprons if you are not using figure-8 fasteners.',
          'Assemble the two short ends first: leg, short apron, leg, with the apron faces flush to the outside of the legs. Check for square across the diagonals before the glue grabs.',
          'Join the two ends with the long aprons. Now check the diagonals of the whole frame. This is the last moment you can fix a rack.',
          p.shelf
            ? `Screw the shelf cleats to the inside faces of the long aprons, ${L.toFraction(shelfZ)}" up from the floor, then drop the ${shelfRun.n} shelf slats across them.`
            : 'Skip the shelf; the apron frame is doing all the structural work.',
          `Glue up the top from ${topRun.rows.length} boards, plane or sand it flat, then trim to ${L.toFraction(Lx)}" x ${L.toFraction(Wy)}".`,
          'Centre the top on the frame — the overhang should be equal all round — and fasten it so it can still move.',
        ],
      };
    },
  };

  /* ---- 3. coffee table ------------------------------------------------- */

  const coffeeTable = {
    id: 'coffee-table',
    title: 'Coffee Table',
    icon: '☕',
    category: 'tables',
    difficulty: 'Intermediate',
    time: '6–8 hours',
    joinery: 'Same apron frame as the side table, plus breadboard end caps that cover the top’s end grain, and a slatted lower shelf.',
    blurb: 'Longer, lower, with breadboard ends on the top and a shelf underneath for the things that live on coffee tables.',
    dimLabels: ['Length', 'Width', 'Height'],
    params: [
      { key: 'len', label: 'Length', type: 'range', min: 30, max: 60, step: 1, def: 44, unit: 'in' },
      { key: 'wid', label: 'Width', type: 'range', min: 16, max: 30, step: 1, def: 22, unit: 'in' },
      { key: 'hgt', label: 'Height', type: 'range', min: 14, max: 20, step: 1, def: 17, unit: 'in' },
      { key: 'legStock', label: 'Leg stock', type: 'select', options: ['2x2', '4x4'], def: '2x2' },
      { key: 'topStock', label: 'Top stock', type: 'select', options: ['1x4', '1x6'], def: '1x6' },
      { key: 'rip', label: 'Rip the last top board to hit the exact width', type: 'bool', def: false },
    ],
    build(p) {
      const cfg = { overhang: 2, apronStock: '1x6', legStock: p.legStock };
      const Lx = p.len;
      const capW = 2.5;                                   // 1x3 breadboard end
      const topA = L.actual(p.topStock);
      const topRun = slatRun(p.wid, topA.w, p.rip);
      const Wy = topRun.achieved;
      const ys = cum(topRun.rows);
      const fieldLen = Lx - 2 * capW;
      const f = tableFrame(p, cfg, Lx, Wy);
      const tooSmall = tableTooSmall(p, cfg, Lx, Wy, f);
      if (tooSmall) return tooSmall;

      const { longLen, shortLen, asm } = legsAndAprons(f, Lx, Wy, cfg);
      const nFull = topRun.rows.filter((r) => Math.abs(r - f.tw) < 1e-9).length;
      const shelfZ = Math.max(4, Math.round(f.legH * 0.24));
      const shelfRun = gapRun(longLen, f.tw);

      const parts = [
        part('Leg', p.legStock, f.legA.t, f.legA.w, f.legH, 4),
        part('Long apron', cfg.apronStock, f.apronT, f.apronH, longLen, 2),
        part('Short apron', cfg.apronStock, f.apronT, f.apronH, shortLen, 2),
        part('Top board', p.topStock, f.tt, f.tw, fieldLen, nFull),
      ];
      if (topRun.ripped) {
        parts.push(part('Top board (ripped)', p.topStock, f.tt, topRun.ripped, fieldLen, 1,
          `ripped to ${L.toFraction(topRun.ripped)}" wide`));
      }
      parts.push(part('Breadboard end', '1x3', 0.75, capW, Wy, 2));
      parts.push(part('Shelf cleat', '1x2', 0.75, 1.5, longLen, 2));
      parts.push(part('Shelf slat', p.topStock, f.tt, f.tw, shortLen, shelfRun.n));

      topRun.rows.forEach((r, i) => {
        const nm = Math.abs(r - f.tw) < 1e-9 ? 'Top board' : 'Top board (ripped)';
        asm.push({ part: nm, pos: [capW, ys[i], f.legH], size: [fieldLen, r, f.tt] });
      });
      for (const x of [0, Lx - capW]) {
        asm.push({ part: 'Breadboard end', pos: [x, 0, f.legH], size: [capW, Wy, f.tt] });
      }
      for (const y of [f.oh + f.lw, Wy - f.oh - f.lw - 0.75]) {
        asm.push({ part: 'Shelf cleat', pos: [f.oh + f.lw, y, shelfZ], size: [longLen, 0.75, 1.5] });
      }
      for (let i = 0; i < shelfRun.n; i++) {
        asm.push({
          part: 'Shelf slat',
          pos: [f.oh + f.lw + shelfRun.at(i), f.oh + f.lw, shelfZ + 1.5],
          size: [f.tw, shortLen, f.tt],
        });
      }

      const warnings = [];
      if (Math.abs(Wy - p.wid) > 1e-6) {
        warnings.push(`You asked for ${L.toFraction(p.wid)}" wide. ${topRun.rows.length} whole ` +
          `${p.topStock} boards give ${L.toFraction(Wy)}" — turn on the rip option to hit it exactly.`);
      }
      warnings.push('Breadboard ends run cross-grain to the top. Glue only the middle few inches and ' +
        'let the outer fasteners sit in slots — glued solid, the end cap will split or the top will cup.');

      return {
        parts, assembly: asm, warnings,
        actual: { x: Lx, y: Wy, z: p.hgt },
        hardware: [
          { item: '1-1/4" pocket screws', qty: '16' },
          { item: '2-1/2" screws', qty: '8' },
          { item: 'Figure-8 tabletop fasteners', qty: '8' },
          { item: '3/8" dowel (breadboard pins)', qty: '6' },
        ],
        features: [],
        steps: [
          `Cut four legs to ${L.toFraction(f.legH)}", two long aprons to ${L.toFraction(longLen)}" and two short aprons to ${L.toFraction(shortLen)}".`,
          'Build the two ends, then join them with the long aprons. Check both diagonals of the assembled frame.',
          `Glue up the top field from ${topRun.rows.length} boards, each ${L.toFraction(fieldLen)}" long — shorter than the table, because the two ${L.toFraction(capW)}" breadboard ends make up the difference.`,
          `Cut the two breadboard ends to ${L.toFraction(Wy)}", the full width of the top, and fit them to the ends of the field.`,
          'Glue the centre of each breadboard end only. Pin the outer ends through elongated holes so the top can move.',
          `Screw the shelf cleats to the long aprons ${L.toFraction(shelfZ)}" off the floor and drop in the ${shelfRun.n} shelf slats.`,
          'Sand to 180, break every edge, and finish. A wiping varnish takes mugs better than oil alone.',
        ],
      };
    },
  };

  /* ---- 4. floating shelf ----------------------------------------------- */

  const floatingShelf = {
    id: 'floating-shelf',
    title: 'Floating Shelf',
    icon: '📚',
    category: 'storage',
    difficulty: 'Intermediate',
    time: '3–4 hours',
    joinery: 'A hollow torsion box that slides over a comb-shaped cleat screwed to the studs. No visible brackets.',
    blurb: 'The thick shelf with no brackets. It works because there is a wooden comb bolted to the wall inside it.',
    dimLabels: ['Length', 'Depth', 'Thickness'],
    params: [
      { key: 'len', label: 'Length', type: 'range', min: 18, max: 60, step: 1, def: 36, unit: 'in' },
      { key: 'depth', label: 'Depth', type: 'range', min: 6, max: 14, step: 1, def: 9, unit: 'in' },
      { key: 'thick', label: 'Thickness', type: 'range', min: 2, max: 4, step: 0.25, def: 2.5, unit: 'in' },
    ],
    build(p) {
      const st = L.SHEET['ply1/2'].t;
      const Lx = p.len, D = p.depth, T = p.thick;
      const edgeW = T - 2 * st;                    // solid edging fills between the skins
      const clear = 0.125;                         // slip fit over the cleat
      const cleatH = edgeW - clear;
      const nArms = Math.max(2, Math.round(Lx / 16));
      const armLen = D - 1.5 - 0.75;
      const railLen = Lx - 1.5;
      const armSpan = Lx - 1.5 - 1.5;
      const armAt = (i) => 0.75 + (nArms > 1 ? (i * armSpan) / (nArms - 1) : armSpan / 2);

      const parts = [
        part('Skin', 'ply1/2', st, D, Lx, 2, 'top and bottom'),
        part('Front edge', '1x4', 0.75, edgeW, Lx, 1, `ripped to ${L.toFraction(edgeW)}" wide`),
        part('End cap', '1x4', 0.75, edgeW, D - 0.75, 2, `ripped to ${L.toFraction(edgeW)}" wide`),
        part('Cleat back rail', '2x4', 1.5, cleatH, railLen, 1, `ripped to ${L.toFraction(cleatH)}" wide`),
        part('Cleat arm', '2x4', 1.5, cleatH, armLen, nArms, `ripped to ${L.toFraction(cleatH)}" wide`),
      ];

      const asm = [
        { part: 'Skin', pos: [0, 0, 0], size: [Lx, D, st] },
        { part: 'Skin', pos: [0, 0, T - st], size: [Lx, D, st] },
        { part: 'Front edge', pos: [0, D - 0.75, st], size: [Lx, 0.75, edgeW] },
        { part: 'End cap', pos: [0, 0, st], size: [0.75, D - 0.75, edgeW] },
        { part: 'End cap', pos: [Lx - 0.75, 0, st], size: [0.75, D - 0.75, edgeW] },
        { part: 'Cleat back rail', pos: [0.75, 0, st + clear / 2], size: [railLen, 1.5, cleatH] },
      ];
      for (let i = 0; i < nArms; i++) {
        asm.push({ part: 'Cleat arm', pos: [armAt(i), 1.5, st + clear / 2], size: [1.5, armLen, cleatH] });
      }

      const spanPerArm = Lx / (nArms - 1 || 1);
      const warnings = [
        'This shelf is only as strong as what the cleat is screwed into. Find the studs and use ' +
        '3" structural screws into solid wood. Drywall anchors will hold the shelf and not the books.',
      ];
      if (spanPerArm > 20) {
        warnings.push(`The arms end up about ${L.toFraction(spanPerArm)}" apart. Add one more so the ` +
          'top skin has something under it every 16" or so.');
      }
      if (D > 11) {
        warnings.push(`At ${L.toFraction(D)}" deep the leverage on the cleat is significant. Keep the ` +
          'load close to the wall, and do not stand on it.');
      }

      return {
        parts, assembly: asm, warnings,
        actual: { x: Lx, y: D, z: T },
        hardware: [
          { item: '3" structural screws (into studs)', qty: `${nArms + 2}` },
          { item: '1-1/4" brads or 18ga pins', qty: '~40' },
          { item: 'Wood glue', qty: '—' },
        ],
        features: [],
        steps: [
          `Rip the cleat stock. A 2x4 cut down to ${L.toFraction(cleatH)}" wide is ${L.toFraction(clear)}" under the ${L.toFraction(edgeW)}" cavity — that gap is what lets the finished box slide on.`,
          `Cut the back rail to ${L.toFraction(railLen)}" and ${nArms} arms to ${L.toFraction(armLen)}". Screw and glue the arms to the rail to make a comb.`,
          'Mark your stud centres on the wall, hold the comb up, level it, and drive a 3" screw through the back rail into every stud you can reach.',
          `Cut both plywood skins to ${L.toFraction(Lx)}" x ${L.toFraction(D)}".`,
          `Rip the edging to ${L.toFraction(edgeW)}" and cut one front edge at ${L.toFraction(Lx)}" and two end caps at ${L.toFraction(D - 0.75)}". The end caps are short because the front edge runs past them.`,
          'Glue and pin the bottom skin, the front edge and the two end caps into a tray. Leave the back open — that is where the comb goes in.',
          'Test-fit the tray over the comb before the top goes on. Now is when you can still plane the cavity.',
          'Glue and pin the top skin on. Fill the pin holes, sand the edging flush, finish, then slide it home and drive one screw up through the underside into an arm so it cannot be lifted off.',
        ],
      };
    },
  };

  /* ---- 5. bookshelf ---------------------------------------------------- */

  const bookshelf = {
    id: 'bookshelf',
    title: 'Bookshelf',
    icon: '📖',
    category: 'storage',
    difficulty: 'Intermediate',
    time: '5–8 hours',
    joinery: 'Dadoed or cleated shelves in a plywood or solid carcass, with a 1/4" back that squares the whole thing up.',
    blurb: 'Pick a height, a width and a shelf count; the bays space themselves evenly and it tells you when the span will sag.',
    dimLabels: ['Width', 'Depth', 'Height'],
    params: [
      { key: 'wid', label: 'Width', type: 'range', min: 18, max: 48, step: 1, def: 30, unit: 'in' },
      { key: 'hgt', label: 'Height', type: 'range', min: 30, max: 72, step: 1, def: 48, unit: 'in' },
      { key: 'depth', label: 'Depth', type: 'range', min: 8, max: 14, step: 1, def: 11, unit: 'in' },
      { key: 'shelves', label: 'Fixed shelves', type: 'range', min: 1, max: 6, step: 1, def: 4, unit: '' },
      { key: 'material', label: 'Carcass', type: 'select', options: ['solid', 'plywood'], def: 'plywood' },
      { key: 'joint', label: 'Shelf joint', type: 'select', options: ['dado', 'cleat'], def: 'dado' },
    ],
    build(p) {
      const warnings = [];
      let material = p.material;
      let carcassStock = fitStock(p.depth);
      if (material === 'solid' && !carcassStock) {
        material = 'plywood';
        warnings.push(`At ${L.toFraction(p.depth)}" deep there is no solid 1x board wide enough ` +
          '(a 1x12 finishes at 11-1/4"). Switched to 3/4" plywood.');
      }
      const st = material === 'solid' ? 0.75 : L.SHEET['ply3/4'].t;
      const stock = material === 'solid' ? carcassStock : 'ply3/4';
      const backT = L.SHEET['ply1/4'].t;
      const dado = p.joint === 'dado' ? 0.25 : 0;
      const wid = p.wid, hgt = p.hgt, D = p.depth;
      const n = p.shelves;

      const span = wid - 2 * st;
      const shelfLen = span + 2 * dado;
      const clear = hgt - 2 * st - n * st;
      const bay = clear / (n + 1);
      const zAt = (i) => st + (i + 1) * bay + i * st;

      const parts = [
        part('Side', stock, st, D, hgt, 2, material === 'solid' ? `ripped to ${L.toFraction(D)}" wide` : ''),
        part('Top / bottom', stock, st, D, shelfLen, 2, dado ? 'includes two 1/4" dado tongues' : ''),
        part('Shelf', stock, st, D, shelfLen, n, dado ? 'includes two 1/4" dado tongues' : ''),
        part('Back panel', 'ply1/4', backT, wid, hgt, 1),
      ];
      if (!dado) parts.push(part('Shelf cleat', '1x2', 0.75, 1.5, D, 2 * n));

      const asm = [
        { part: 'Side', pos: [0, 0, 0], size: [st, D, hgt] },
        { part: 'Side', pos: [wid - st, 0, 0], size: [st, D, hgt] },
        { part: 'Top / bottom', pos: [st, 0, 0], size: [span, D, st], embed: 2 * dado },
        { part: 'Top / bottom', pos: [st, 0, hgt - st], size: [span, D, st], embed: 2 * dado },
        { part: 'Back panel', pos: [0, D, 0], size: [wid, backT, hgt] },
      ];
      for (let i = 0; i < n; i++) {
        asm.push({ part: 'Shelf', pos: [st, 0, zAt(i)], size: [span, D, st], embed: 2 * dado });
        if (!dado) {
          for (const x of [st, wid - st - 0.75]) {
            asm.push({ part: 'Shelf cleat', pos: [x, 0, zAt(i) - 1.5], size: [0.75, D, 1.5] });
          }
        }
      }

      if (span > 32) {
        warnings.push(`A ${L.toFraction(span)}" unsupported span in ${L.toFraction(st)}" stock will sag ` +
          'visibly under books within a year. Add a centre divider, glue a 1x2 stiffener under the front ' +
          'edge of each shelf, or drop the width below 32".');
      }
      if (bay < 9) {
        warnings.push(`The bays come out ${L.toFraction(bay)}" clear. A hardback needs about 10". ` +
          'Use fewer shelves or more height.');
      }
      if (dado) {
        warnings.push('Cut the dados 1/4" deep and size them to the actual sheet thickness, not to ' +
          '3/4". Nominal 3/4" plywood measures about 23/32", and a dado cut at a true 3/4" will be sloppy.');
      }

      return {
        parts, assembly: asm, warnings,
        actual: { x: wid, y: D + backT, z: hgt },
        hardware: [
          { item: dado ? '1-1/4" screws' : '1-1/4" screws (cleats)', qty: dado ? '12' : `${8 * n + 12}` },
          { item: '5/8" brads (back panel)', qty: '~40' },
          { item: 'Wood glue', qty: '—' },
          { item: 'Anti-tip wall strap', qty: '1' },
        ],
        features: [],
        steps: [
          `Cut two sides to ${L.toFraction(hgt)}" x ${L.toFraction(D)}".`,
          `Cut the top, bottom and ${n} shelves to ${L.toFraction(shelfLen)}" x ${L.toFraction(D)}".` +
            (dado ? ` That length is the ${L.toFraction(span)}" clear span plus 1/4" of tongue at each end.` : ''),
          dado
            ? `Lay the two sides edge to edge and mark all the dados across both at once, so they cannot end up at different heights. Bays are ${L.toFraction(bay)}" clear.`
            : `Mark cleat positions on both sides at once. Bays are ${L.toFraction(bay)}" clear.`,
          dado
            ? 'Rout or saw the dados 1/4" deep, sized to the real thickness of your stock. Test the fit on an offcut first.'
            : `Screw the ${2 * n} cleats to the inside faces, ${L.toFraction(D)}" long, flush to the front edge.`,
          'Dry-fit the whole carcass. Every shelf should slide home without a mallet and without a gap.',
          'Glue up on a flat floor, clamp across the shelves, and check the diagonals.',
          `Cut the back to ${L.toFraction(wid)}" x ${L.toFraction(hgt)}", square it against the carcass, and nail it on. The back is what stops the bookshelf racking — do not leave it off.`,
          'Strap it to a wall. A tall shelf full of books tips forward, and that is the only part of this plan that is a safety issue.',
        ],
      };
    },
  };

  /* ---- 6. potting bench ------------------------------------------------ */

  const pottingBench = {
    id: 'potting-bench',
    title: 'Potting Bench',
    icon: '🌱',
    category: 'garden',
    difficulty: 'Intermediate',
    time: '6–8 hours',
    joinery: 'A 2x4 leg-and-rail frame with slatted surfaces, so soil and water fall through instead of sitting.',
    blurb: 'Work height, a lower shelf for pots, and a backsplash so the soil ends up on the bench and not the floor.',
    dimLabels: ['Length', 'Depth', 'Height'],
    params: [
      { key: 'len', label: 'Length', type: 'range', min: 36, max: 72, step: 1, def: 48, unit: 'in' },
      { key: 'depth', label: 'Depth', type: 'range', min: 18, max: 28, step: 1, def: 22, unit: 'in' },
      { key: 'hgt', label: 'Work height', type: 'range', min: 32, max: 40, step: 1, def: 36, unit: 'in' },
      { key: 'splash', label: 'Backsplash height', type: 'range', min: 0, max: 24, step: 1, def: 12, unit: 'in' },
      { key: 'topStock', label: 'Slat stock', type: 'select', options: ['1x4', '1x6'], def: '1x6' },
      { key: 'shelf', label: 'Lower shelf', type: 'bool', def: true },
      { key: 'rip', label: 'Rip the last top slat to hit the exact depth', type: 'bool', def: false },
    ],
    build(p) {
      const A = L.actual(p.topStock);
      const tt = A.t, tw = A.w;
      const legT = 1.5, legW = 3.5;               // 2x4
      const Lx = p.len;
      const topRun = slatRun(p.depth, tw, p.rip);
      const D = topRun.achieved;
      const ys = cum(topRun.rows);
      const nFull = topRun.rows.filter((r) => Math.abs(r - tw) < 1e-9).length;
      const legH = p.hgt - tt;
      const railH = 3.5, railT = 0.75;            // 1x4 on edge
      const railZ = legH - railH;
      const longRail = Lx - 2 * legT;
      const sideRail = D - 2 * legW;
      const shelfZ = 8;

      const splashRun = p.splash > 0 ? slatRun(p.splash, tw, false) : null;
      const BS = splashRun ? splashRun.achieved : 0;
      const bzs = splashRun ? cum(splashRun.rows) : [];

      const parts = [
        part('Leg', '2x4', legT, legW, legH, 4),
        part('Long rail', '1x4', railT, railH, longRail, p.shelf ? 4 : 2),
        part('Side rail', '1x4', railT, railH, sideRail, 2),
        part('Top slat', p.topStock, tt, tw, Lx, nFull),
      ];
      if (topRun.ripped) {
        parts.push(part('Top slat (ripped)', p.topStock, tt, topRun.ripped, Lx, 1,
          `ripped to ${L.toFraction(topRun.ripped)}" wide`));
      }

      const asm = [];
      for (const x of [0, Lx - legT]) {
        for (const y of [0, D - legW]) {
          asm.push({ part: 'Leg', pos: [x, y, 0], size: [legT, legW, legH] });
        }
      }
      for (const y of [0, D - railT]) {
        asm.push({ part: 'Long rail', pos: [legT, y, railZ], size: [longRail, railT, railH] });
      }
      for (const x of [0, Lx - railT]) {
        asm.push({ part: 'Side rail', pos: [x, legW, railZ], size: [railT, sideRail, railH] });
      }
      topRun.rows.forEach((r, i) => {
        const nm = Math.abs(r - tw) < 1e-9 ? 'Top slat' : 'Top slat (ripped)';
        asm.push({ part: nm, pos: [0, ys[i], legH], size: [Lx, r, tt] });
      });

      let shelfRun = null;
      if (p.shelf) {
        shelfRun = gapRun(longRail, tw);
        parts.push(part('Shelf slat', p.topStock, tt, tw, D, shelfRun.n));
        for (const y of [0, D - railT]) {
          asm.push({ part: 'Long rail', pos: [legT, y, shelfZ], size: [longRail, railT, railH] });
        }
        for (let i = 0; i < shelfRun.n; i++) {
          asm.push({
            part: 'Shelf slat',
            pos: [legT + shelfRun.at(i), 0, shelfZ + railH],
            size: [tw, D, tt],
          });
        }
      }
      if (splashRun) {
        parts.push(part('Backsplash post', '2x2', 1.5, 1.5, BS, 2));
        parts.push(part('Backsplash slat', p.topStock, tt, tw, Lx, splashRun.rows.length));
        for (const x of [0, Lx - 1.5]) {
          asm.push({ part: 'Backsplash post', pos: [x, D - 1.5, p.hgt], size: [1.5, 1.5, BS] });
        }
        splashRun.rows.forEach((r, i) => {
          asm.push({ part: 'Backsplash slat', pos: [0, D - 1.5 - tt, p.hgt + bzs[i]], size: [Lx, tt, r] });
        });
      }

      const warnings = [];
      if (Math.abs(D - p.depth) > 1e-6) {
        warnings.push(`You asked for ${L.toFraction(p.depth)}" deep. ${topRun.rows.length} whole ` +
          `${p.topStock} boards give ${L.toFraction(D)}" — turn on the rip option to hit it exactly.`);
      }
      if (splashRun && Math.abs(BS - p.splash) > 1e-6) {
        warnings.push(`The backsplash snaps to whole boards: ${L.toFraction(BS)}" rather than ` +
          `${L.toFraction(p.splash)}".`);
      }
      if (Lx > 60) {
        warnings.push(`At ${L.toFraction(Lx)}" long the top slats will flex in the middle. Add a fifth ` +
          'leg and a centre rail, or accept the bounce.');
      }
      warnings.push('Leave the gaps between the top slats. A potting bench that sheds soil and water ' +
        'through the top is the entire point; a sealed top becomes a puddle.');

      return {
        parts, assembly: asm, warnings,
        actual: { x: Lx, y: D, z: p.hgt + BS },
        hardware: [
          { item: '2-1/2" exterior screws', qty: '~40' },
          { item: '1-5/8" exterior screws', qty: '~60' },
          { item: 'Galvanised hooks (tool rail)', qty: '4–6' },
        ],
        features: [],
        steps: [
          `Cut four legs to ${L.toFraction(legH)}". The top slats add ${L.toFraction(tt)}" to reach the ${L.toFraction(p.hgt)}" work height.`,
          `Cut the upper rails: two long at ${L.toFraction(longRail)}" and two side at ${L.toFraction(sideRail)}". The side rails are short because they land between the legs, not across them.`,
          'Build the two end frames — leg, side rail, leg — then connect them with the long rails. Screw from the outside; this is a bench, not a heirloom.',
          p.shelf
            ? `Add the second pair of long rails ${L.toFraction(shelfZ)}" off the floor and lay the ${shelfRun.n} shelf slats across them.`
            : 'Skip the lower shelf if you want to slide bins underneath.',
          `Lay the ${topRun.rows.length} top slats across the frame with even gaps and screw two per rail.`,
          splashRun
            ? `Stand the two backsplash posts on the back corners and screw the ${splashRun.rows.length} backsplash slats to their front faces, ${L.toFraction(BS)}" total.`
            : 'No backsplash on this configuration — keep it away from a wall you mind about.',
          'Check it sits flat. Shim or trim one leg if it rocks; an outdoor bench on soft ground will need it anyway.',
          'Finish with an exterior oil, or build it from cedar and leave it alone.',
        ],
      };
    },
  };

  /* ---- 7. sawhorses ---------------------------------------------------- */

  const sawhorse = {
    id: 'sawhorse',
    title: 'Sawhorses',
    icon: '🪚',
    category: 'shop',
    difficulty: 'Intermediate',
    time: '3–4 hours',
    joinery: 'Legs splayed in two directions at once, which makes the foot and top cuts a compound miter and bevel.',
    blurb: 'The plan where the naive number is visibly wrong. Splay the legs two ways and neither the leg length nor the cut angles are what you would guess.',
    dimLabels: ['Footprint', 'Depth', 'Height'],
    params: [
      { key: 'hgt', label: 'Beam height', type: 'range', min: 24, max: 36, step: 1, def: 30, unit: 'in' },
      { key: 'beam', label: 'Beam length', type: 'range', min: 30, max: 48, step: 1, def: 36, unit: 'in' },
      { key: 'splayX', label: 'Splay along the beam', type: 'range', min: 0, max: 20, step: 1, def: 10, unit: '°' },
      { key: 'splayY', label: 'Splay across the beam', type: 'range', min: 0, max: 20, step: 1, def: 14, unit: '°' },
      { key: 'count', label: 'How many', type: 'select', options: ['1', '2'], def: '2' },
    ],
    build(p) {
      const beamT = 1.5, beamW = 3.5;            // 2x4 on edge
      const legT = 1.5, legW = 3.5;
      const hgt = p.hgt, BL = p.beam;
      const inset = 3;                            // leg centre in from the beam end

      const legs = [];
      const asm = [
        { part: 'Beam', pos: [-BL / 2, -beamT / 2, hgt - beamW], size: [BL, beamT, beamW] },
        { part: 'Sacrificial cap', pos: [-BL / 2, -1.75, hgt], size: [BL, 3.5, 0.75] },
      ];

      let legLen = 0, miter = 0, bevel = 0;
      for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
          const leg = G.splayedLeg(p.splayX, p.splayY, hgt, sx, sy, legT, legW);
          legLen = leg.length; miter = leg.miterDeg; bevel = leg.bevelDeg;
          const pTop = [sx * (BL / 2 - inset), sy * (beamT / 2 + legT / 2), hgt];
          const { u, w, n } = leg.frame;
          const verts = [];
          for (const su of [-1, 1]) {
            for (const sw of [-1, 1]) {
              for (const sn of [-1, 1]) {
                const c = G.add(G.scale(w, (sw * legW) / 2), G.scale(n, (sn * legT) / 2));
                const target = su < 0 ? 0 : hgt;     // floor, or the underside of the beam top
                const s = (target - pTop[2] - c[2]) / u[2];
                verts.push(G.add(G.add(pTop, c), G.scale(u, s)));
              }
            }
          }
          asm.push({ part: 'Leg', verts, frame: leg.frame });
          legs.push(leg);
        }
      }

      G.recenter(asm);
      const bb = G.bboxOf(asm);

      const parts = [
        part('Beam', '2x4', beamT, beamW, BL, 1),
        part('Sacrificial cap', '1x4', 0.75, 3.5, BL, 1),
        part('Leg', '2x4', legT, legW, legLen, 4,
          `compound cut: ${miter.toFixed(1)}° miter, ${bevel.toFixed(1)}° bevel, both ends`),
      ];

      const naive = hgt;
      const warnings = [
        `Cut the legs at ${L.toFraction(legLen)}", not ${L.toFraction(naive)}". A leg that leans is ` +
        `longer than the height it reaches, and the compound cut eats more still — this one is ` +
        `${L.toFraction(legLen - naive)}" longer than the beam height.`,
        `Both ends of every leg are cut at the same setting: ${miter.toFixed(1)}° miter and ` +
        `${bevel.toFixed(1)}° bevel. Neither number equals either splay angle you dialled in, ` +
        'and that is the whole reason this page exists.',
      ];
      if (p.splayX === 0 && p.splayY === 0) {
        warnings.push('With no splay at all this is a table with four legs and it will rack. ' +
          'Ten degrees along and fourteen across is a good place to start.');
      }

      return {
        parts, assembly: asm, warnings,
        actual: { x: bb.size[0], y: bb.size[1], z: bb.size[2] },
        derivedActual: true,
        multiplier: Number(p.count),
        angles: [
          { label: 'Foot / top miter', value: `${miter.toFixed(1)}°` },
          { label: 'Foot / top bevel', value: `${bevel.toFixed(1)}°` },
          { label: 'Leg length', value: `${L.toFraction(legLen)}"` },
          { label: 'Beam height', value: `${L.toFraction(hgt)}"` },
        ],
        hardware: [
          { item: '3" structural screws', qty: '16 per horse' },
          { item: '1-1/4" screws (cap)', qty: '6 per horse' },
        ],
        features: [],
        steps: [
          `Cut the beam to ${L.toFraction(BL)}" and the sacrificial cap to match.`,
          `Set the miter saw to ${miter.toFixed(1)}° and tilt the blade to ${bevel.toFixed(1)}°. Cut one end of a leg, measure ${L.toFraction(legLen)}" along the long edge, and cut the other end at the same setting without touching the saw.`,
          'Cut a test leg first and stand it against the beam before you cut the other three. A compound setting that is a degree out is obvious on the floor and invisible on the saw.',
          `Mark the leg positions ${L.toFraction(inset)}" in from each end of the beam.`,
          'Clamp each leg to the side of the beam with its top cut flush to the beam top, check that the foot sits flat on the floor, and drive four screws.',
          'Do the other three, then set the horse on a flat floor. If it rocks, one leg is long — scribe and trim rather than shimming.',
          'Screw the sacrificial cap on last, from below if you can. You will saw into it, and it is meant to be replaced.',
          Number(p.count) === 2
            ? 'Build the second one to the same settings while the saw is still set up. That is why the cut list is doubled.'
            : 'One horse is half a pair. Build the second while the saw is still set.',
        ],
      };
    },
  };

  /* ---- 8. birdhouse ---------------------------------------------------- */

  /* Cavity dimensions and entrance-hole sizes are the standard published
     figures (NestWatch / state extension guidance). The hole diameter is not
     a style choice: it is what excludes starlings and house sparrows from a
     box meant for something else. */
  const BIRDS = {
    wren:      { label: 'House Wren',       iw: 4, id: 4, ih: 7,  hole: 1.125, holeH: 5,  note: 'Hang 5–10 ft up, in or near cover.' },
    chickadee: { label: 'Chickadee',        iw: 4, id: 4, ih: 9,  hole: 1.125, holeH: 7,  note: 'Add an inch of wood shavings in the bottom.' },
    bluebird:  { label: 'Eastern Bluebird', iw: 5, id: 5, ih: 10, hole: 1.5,   holeH: 7,  note: 'Mount 4–6 ft up on a pole, facing open ground.' },
    swallow:   { label: 'Tree Swallow',     iw: 5, id: 5, ih: 8,  hole: 1.5,   holeH: 5,  note: 'Open field, near water, 100 ft from the next box.' },
    flicker:   { label: 'Northern Flicker', iw: 7, id: 7, ih: 17, hole: 2.5,   holeH: 15, note: 'Pack it full of wood chips — flickers excavate.' },
  };

  const birdhouse = {
    id: 'birdhouse',
    title: 'Birdhouse',
    icon: '🐦',
    category: 'garden',
    difficulty: 'Beginner',
    time: '2 hours',
    joinery: 'Butt-jointed box with a gabled roof. The two roof panels are bevel-ripped at the ridge so they meet without a gap.',
    blurb: 'Cavity size and hole diameter come from the bird, not from you. Pick the species and the box sizes itself.',
    dimLabels: ['Width', 'Depth', 'Height'],
    params: [
      { key: 'bird', label: 'Occupant', type: 'select',
        options: Object.keys(BIRDS).map((k) => ({ value: k, label: BIRDS[k].label })), def: 'bluebird' },
      { key: 'pitch', label: 'Roof pitch', type: 'range', min: 15, max: 45, step: 1, def: 30, unit: '°' },
      { key: 'overhang', label: 'Roof overhang (sides)', type: 'range', min: 1, max: 3, step: 0.25, def: 1.5, unit: 'in' },
      { key: 'eave', label: 'Roof overhang (front/back)', type: 'range', min: 0.5, max: 2, step: 0.25, def: 1, unit: 'in' },
    ],
    build(p) {
      const b = BIRDS[p.bird] || BIRDS.bluebird;
      const iw = b.iw, id = b.id;
      const pr = p.pitch * DEG;
      const tanP = Math.tan(pr), cosP = Math.cos(pr), sinP = Math.sin(pr);
      const warnings = [];

      /* Board thickness and box size feed each other: the outside width is the
         cavity plus two wall thicknesses, and the wall thickness depends on
         which stock the widest piece fits in. So size it, choose the stock,
         and if that changed the thickness, size it again. Two passes converge
         because 3/4" solid and 23/32" plywood differ by a thirty-second. */
      function sized(th) {
        const W = iw + 2 * th;                     // outside width
        const D = id + 2 * th;                     // outside depth
        const wallH = th + b.ih;                   // the floor sits inside, on the bottom
        const ridgeZ = wallH + (W / 2) * tanP;
        const a = W / 2 + p.overhang;              // horizontal run of one roof slope
        const panelW = a / cosP + th * tanP;       // blank width, after the ridge bevel
        const panelL = D + 2 * p.eave;
        // Each piece needs a board at least as wide as its narrower dimension.
        const need = Math.max(
          Math.min(W, ridgeZ), Math.min(id, wallH), Math.min(iw, id), Math.min(panelW, panelL));
        return { th, W, D, wallH, ridgeZ, a, panelW, panelL, need, gableH: ridgeZ };
      }

      let g = sized(0.75);
      let stock = fitStock(g.need);
      if (!stock) {
        stock = 'ply3/4';
        g = sized(L.SHEET['ply3/4'].t);
        warnings.push('The widest piece here is wider than any solid 1x board, so the walls are ' +
          'cut from 3/4" exterior plywood. Use exterior grade and seal the edges — interior ' +
          'ply delaminates in one wet season.');
      }
      const th = g.th, wallT = g.th;
      const W = g.W, D = g.D, wallH = g.wallH, ridgeZ = g.ridgeZ;
      const a = g.a, panelW = g.panelW, panelL = g.panelL, gableH = g.gableH;

      // Shift so the leftmost/frontmost roof corner lands on the origin.
      const sx = p.overhang + th * sinP;
      const sy = p.eave;
      const ridgeX = sx + W / 2;

      const gable = [
        [sx + 0, 0], [sx + W, 0], [sx + W, wallH], [ridgeX, ridgeZ], [sx + 0, wallH],
      ];

      const parts = [
        part('Front (gable)', stock, wallT, W, gableH, 1, `cut the peak at ${p.pitch}° each side`),
        part('Back (gable)', stock, wallT, W, gableH, 1, `cut the peak at ${p.pitch}° each side`),
        part('Side', stock, wallT, id, wallH, 2),
        part('Floor', stock, wallT, id, iw, 1, 'drill four 1/4" drain holes'),
        part('Roof panel', stock, wallT, panelW, panelL, 2,
          `bevel-rip the ridge edge at ${p.pitch}°`),
      ];

      const asm = [
        { part: 'Front (gable)', profile: gable, axis: 'y', from: sy + 0, to: sy + th },
        { part: 'Back (gable)', profile: gable, axis: 'y', from: sy + D - th, to: sy + D },
        { part: 'Side', pos: [sx, sy + th, 0], size: [th, id, wallH] },
        { part: 'Side', pos: [sx + W - th, sy + th, 0], size: [th, id, wallH] },
        { part: 'Floor', pos: [sx + th, sy + th, 0], size: [iw, id, th] },
      ];

      /* Each roof panel is a bevel-ripped board, so its cross-section is a
         parallelogram and not a rectangle. Both of its ridge corners sit on
         the vertical plane through the peak, which is exactly what a
         bevel-ripped edge gives you and why the two panels meet with no gap. */
      for (const side of [-1, 1]) {
        const d = [side * cosP, 0, -sinP];             // down-slope
        const nrm = [side * sinP, 0, cosP];            // out of the panel
        const u = [0, 1, 0];
        const A = [ridgeX, 0, ridgeZ];
        const B = [ridgeX + side * a, 0, ridgeZ - a * tanP];
        const C = G.add(B, G.scale(nrm, th));
        const Dd = [ridgeX, 0, ridgeZ + th / cosP];
        const corners = { '-1,-1': A, '1,-1': B, '1,1': C, '-1,1': Dd };
        const verts = [];
        for (const su of [-1, 1]) {
          for (const sw of [-1, 1]) {
            for (const sn of [-1, 1]) {
              const c = corners[`${sw},${sn}`];
              const y = su < 0 ? sy - p.eave : sy - p.eave + panelL;
              verts.push([c[0], y, c[2]]);
            }
          }
        }
        asm.push({ part: 'Roof panel', verts, frame: { u, w: d, n: nrm } });
      }

      const holeZ = th + b.holeH;
      const features = [
        { view: 'front', kind: 'hole', x: ridgeX, y: holeZ, d: b.hole,
          label: `${L.toFraction(b.hole)}" entrance` },
        { view: 'front', kind: 'note', x: ridgeX, y: wallH + 0.4,
          label: `${p.pitch}° pitch` },
      ];

      warnings.push('No perch. A dowel under the hole gives a starling or a house sparrow ' +
        'something to hang onto while it raids the nest; cavity birds do not need one.');
      warnings.push(`Keep the hole at exactly ${L.toFraction(b.hole)}". A sixteenth over and you have ` +
        'built a box for a species you did not intend.');
      warnings.push('One side should pivot on two screws so you can clean the box out every autumn. ' +
        'An uncleaned box is not used a second year.');

      return {
        parts, assembly: asm, warnings,
        actual: { x: W + 2 * p.overhang + 2 * th * sinP, y: panelL, z: ridgeZ + th / cosP },
        angles: [
          { label: 'Roof pitch', value: `${p.pitch}°` },
          { label: 'Ridge bevel (rip)', value: `${p.pitch}°` },
          { label: 'Gable peak cut', value: `${p.pitch}° from horizontal` },
          { label: 'Entrance hole', value: `${L.toFraction(b.hole)}"` },
        ],
        hardware: [
          { item: '1-1/4" exterior screws', qty: '~24' },
          { item: 'Exterior wood glue', qty: '—' },
          { item: 'Mounting plate or post bracket', qty: '1' },
        ],
        features,
        steps: [
          `Cut the two gable ends to ${L.toFraction(W)}" wide by ${L.toFraction(gableH)}" tall, then cut the peak: mark the centre, mark ${L.toFraction(wallH)}" up each side, and saw both slopes at ${p.pitch}°.`,
          `Cut the two sides to ${L.toFraction(id)}" by ${L.toFraction(wallH)}" and the floor to ${L.toFraction(iw)}" by ${L.toFraction(id)}".`,
          `Bore the entrance hole in the front, centred, ${L.toFraction(b.holeH)}" up from the floor, at exactly ${L.toFraction(b.hole)}". Use a spade or Forstner bit and back the cut with scrap so it does not blow out.`,
          'Drill four 1/4" drain holes in the floor and a pair of 1/4" vents high on each side, just under the roof line.',
          'Glue and screw the box: sides between the front and back, floor dropped in from below. Leave one side fixed with two screws through its top corners only, so it can pivot open.',
          `Rip both roof panels to ${L.toFraction(panelW)}" with the blade tilted to ${p.pitch}° on the ridge edge. That bevel is what closes the ridge — square-cut edges leave a gap the width of the roof thickness.`,
          `Cut both panels to ${L.toFraction(panelL)}" long and fasten them to the gables. The overhang is ${L.toFraction(p.overhang)}" at the sides and ${L.toFraction(p.eave)}" front and back.`,
          `Leave the inside bare. ${b.note} Paint or oil the outside only, in a light colour if it will sit in the sun.`,
        ],
      };
    },
  };

  const PLANS = [planterBox, sideTable, coffeeTable, floatingShelf, bookshelf, pottingBench, sawhorse, birdhouse];

  const CATEGORIES = [
    { key: 'all', label: 'All' },
    { key: 'garden', label: 'Garden' },
    { key: 'tables', label: 'Tables' },
    { key: 'storage', label: 'Storage' },
    { key: 'shop', label: 'Shop' },
  ];

  function defaults(plan) {
    const out = {};
    for (const q of plan.params) {
      out[q.key] = q.def;
    }
    return out;
  }

  function byId(id) { return PLANS.find((p) => p.id === id) || null; }

  const api = { PLANS, CATEGORIES, BIRDS, defaults, byId, slatRun, gapRun, fitStock };
  root.Plans = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
