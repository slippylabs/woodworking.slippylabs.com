/* tests/run.js — run with: node tests/run.js [--dir <path>]
 *
 * Everything here runs against the shipped files, not a copy of the logic, so
 * `node tests/run.js --dir /var/www/woodworking.slippylabs.com` checks what is
 * actually deployed. Pass a directory of files fetched from the live URL and
 * it checks what the browser really downloads.
 */
'use strict';

const path = require('path');

const argDir = (() => {
  const i = process.argv.indexOf('--dir');
  return i >= 0 ? path.resolve(process.argv[i + 1]) : path.resolve(__dirname, '..');
})();

const L = require(path.join(argDir, 'lumber.js'));
const G = require(path.join(argDir, 'geometry.js'));
const O = require(path.join(argDir, 'optimizer.js'));
const P = require(path.join(argDir, 'plans.js'));
const D = require(path.join(argDir, 'drawing.js'));

let checks = 0, failures = 0;
const fails = [];
function ok(cond, msg) {
  checks++;
  if (!cond) { failures++; if (fails.length < 25) fails.push(msg); }
}
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
/* "22-3/4" is well formed; "5-16/16" and "4-2/16" are not. */
function properFraction(s) {
  const m = /^-?(?:(\d+)-)?(\d+)\/(\d+)$/.exec(s);
  if (!m) return /^-?\d+$/.test(s);
  const num = Number(m[2]), den = Number(m[3]);
  return num > 0 && num < den && den <= 16 && gcd(num, den) === 1;
}
let mark = 0;
function section(name) { mark = failures; process.stdout.write(`\n${name}\n`); }
function done(name, n) {
  const bad = failures - mark;
  process.stdout.write(`  ${bad ? 'FAIL' : 'pass'}  ${name} (${n})${bad ? `  ${bad} failed` : ''}\n`);
}

/* ---- 1. fractions ---------------------------------------------------- */
section('fractions');
{
  let n = 0;
  for (let i = 0; i <= 48 * 16; i++) {
    const x = i / 16;
    const s = L.toFraction(x);
    ok(Math.abs(L.parseFraction(s) - x) < 1e-12, `round-trip ${x} -> "${s}"`);
    ok(properFraction(s), `not in lowest terms: ${x} -> ${s}`);
    n += 2;
  }
  const cases = [[16, '16'], [5.5, '5-1/2'], [22.75, '22-3/4'], [0.75, '3/4'],
    [0.5, '1/2'], [0.0625, '1/16'], [0.125, '1/8'], [3.1875, '3-3/16'], [0, '0']];
  for (const [x, want] of cases) { ok(L.toFraction(x) === want, `toFraction(${x}) = "${L.toFraction(x)}" want "${want}"`); n++; }
  // Rounding must never print an improper fraction like "5-16/16".
  for (let i = 0; i < 5000; i++) {
    const x = Math.random() * 60;
    const s = L.toFraction(x);
    ok(properFraction(s), `improper or unreduced: ${x} -> ${s}`);
    ok(Math.abs(L.parseFraction(s) - x) <= 1 / 32 + 1e-12, `within 1/32: ${x} -> ${s}`);
    n += 2;
  }
  done('fraction formatting', n);
}

/* ---- 2. the S4S table ------------------------------------------------- */
section('lumber');
{
  // Independently transcribed from the published S4S dressed sizes.
  const REF = {
    '1x2': [0.75, 1.5], '1x3': [0.75, 2.5], '1x4': [0.75, 3.5], '1x6': [0.75, 5.5],
    '1x8': [0.75, 7.25], '1x10': [0.75, 9.25], '1x12': [0.75, 11.25],
    '2x2': [1.5, 1.5], '2x3': [1.5, 2.5], '2x4': [1.5, 3.5], '2x6': [1.5, 5.5],
    '2x8': [1.5, 7.25], '2x10': [1.5, 9.25], '2x12': [1.5, 11.25], '4x4': [3.5, 3.5],
  };
  let n = 0;
  for (const k of Object.keys(REF)) {
    const a = L.actual(k);
    ok(a.t === REF[k][0] && a.w === REF[k][1], `${k} actual ${a.t}x${a.w} want ${REF[k].join('x')}`);
    n++;
  }
  ok(Object.keys(REF).length === Object.keys(L.S4S).length, 'S4S table has no extra entries');
  // Anything 8" nominal and over loses 3/4", not 1/2 — the classic slip.
  for (const k of ['1x8', '1x10', '1x12', '2x8', '2x10', '2x12']) {
    ok(L.nominal(k).w - L.actual(k).w === 0.75, `${k} loses 3/4" of width`);
    n++;
  }
  for (const k of ['1x2', '1x3', '1x4', '1x6', '2x2', '2x3', '2x4', '2x6']) {
    ok(L.nominal(k).w - L.actual(k).w === 0.5, `${k} loses 1/2" of width`);
    n++;
  }
  // Board feet are billed on nominal, which is the whole point of the unit.
  const bf = L.boardFeet({ stock: '2x4', length: 96, qty: 1, width: 3.5 });
  ok(Math.abs(bf - (2 * 4 * 96) / 144) < 1e-12, `board feet of an 8ft 2x4 = ${bf}, want 5.333`);
  n++;
  done('S4S table + board feet', n);
}

/* ---- 3. compound angles ----------------------------------------------- */
section('compound angles');
{
  let n = 0;
  for (let ax = 0; ax <= 30; ax += 1) {
    for (let ay = 0; ay <= 30; ay += 1) {
      for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        const leg = G.splayedLeg(ax, ay, 30, sx, sy, 1.5, 3.5);
        // Forward: rebuild the cut plane from ONLY the two saw settings. If the
        // settings are right the plane is horizontal and the horse sits flat.
        const m = G.cutPlaneNormal(leg.frame, leg.miter, leg.bevel);
        ok(Math.abs(Math.abs(m[2]) - 1) < 1e-12,
          `${ax}/${ay} (${sx},${sy}): rebuilt plane is not level, nz=${m[2]}`);
        // A leaning leg is always longer than the height it reaches.
        ok(leg.axialLength >= 30 - 1e-12, `${ax}/${ay}: axial length shorter than the rise`);
        ok(leg.length >= leg.axialLength - 1e-12, `${ax}/${ay}: blank shorter than the axis`);
        n += 3;
      }
    }
  }
  // Degenerate cases must degenerate cleanly.
  const sq = G.splayedLeg(0, 0, 30, 1, 1, 1.5, 3.5);
  ok(sq.miterDeg < 1e-12 && sq.bevelDeg < 1e-12, 'no splay must give a square cut');
  ok(Math.abs(sq.length - 30) < 1e-12, 'no splay must give a leg exactly as long as the rise');
  const only1 = G.splayedLeg(20, 0, 30, 1, 1, 1.5, 3.5);
  ok(Math.abs(only1.miterDeg - 20) < 1e-9 && only1.bevelDeg < 1e-9,
    'splay in one plane only is a plain miter');
  const only2 = G.splayedLeg(0, 20, 30, 1, 1, 1.5, 3.5);
  ok(only2.miterDeg < 1e-9 && Math.abs(only2.bevelDeg - 20) < 1e-9,
    'splay in the other plane only is a plain bevel');
  // Compound: with both splays live, both settings are off square and neither
  // equals the splay that produced it. (The bevel comes out BELOW its splay,
  // because the miter has already swung the cut — the same reason published
  // crown-moulding tables are not symmetric.)
  const both = G.splayedLeg(12, 15, 30, 1, 1, 1.5, 3.5);
  ok(both.miterDeg > 12 && both.bevelDeg < 15 && both.bevelDeg > 0,
    `compound: got ${both.miterDeg}/${both.bevelDeg}`);
  n += 5;

  /* An algebraically independent check on the whole solver. Rebuilding the
     frame from scratch gives closed forms for the two settings:
        N     = sqrt(tx^2 ty^2 + (tx^2+1)^2 + ty^2)
        miter = atan( tx (tx^2 + ty^2 + 1) / N )
        bevel = asin( ty / N )
     which share no code with frameFrom/solveCut. If both agree to 1e-12 over
     the whole range, the vector plumbing is right and not just self-consistent. */
  for (let ax = 0; ax <= 30; ax += 0.5) {
    for (let ay = 0; ay <= 30; ay += 0.5) {
      const tx = Math.tan(ax / G.DEG), ty = Math.tan(ay / G.DEG);
      const N = Math.sqrt(tx * tx * ty * ty + (tx * tx + 1) * (tx * tx + 1) + ty * ty);
      const wantM = Math.atan((tx * (tx * tx + ty * ty + 1)) / N) * G.DEG;
      const wantV = Math.asin(ty / N) * G.DEG;
      const leg = G.splayedLeg(ax, ay, 30, 1, 1, 1.5, 3.5);
      ok(Math.abs(leg.miterDeg - wantM) < 1e-12 && Math.abs(leg.bevelDeg - wantV) < 1e-12,
        `${ax}/${ay}: solver ${leg.miterDeg}/${leg.bevelDeg} vs closed form ${wantM}/${wantV}`);
      // And the leg axis leans off vertical by exactly atan(sqrt(tx^2+ty^2)).
      const lean = Math.acos(leg.frame.u[2]) * G.DEG;
      ok(Math.abs(lean - Math.atan(Math.hypot(tx, ty)) * G.DEG) < 1e-12, `${ax}/${ay}: lean ${lean}`);
      n += 2;
    }
  }
  // solveCut inverts cutPlaneNormal over the whole useful range.
  const frame = G.frameFrom([0.2, 0.1, 1], [0, 1, 0]);
  for (let M = -60; M <= 60; M += 3) {
    for (let V = -60; V <= 60; V += 3) {
      const nrm = G.cutPlaneNormal(frame, M / G.DEG, V / G.DEG);
      const back = G.solveCut(frame, nrm);
      ok(Math.abs(back.miter * G.DEG - M) < 1e-9 && Math.abs(back.bevel * G.DEG - V) < 1e-9,
        `solveCut did not invert ${M}/${V}`);
      n++;
    }
  }
  done('saw settings <-> geometry', n);
}

/* ---- 4. the assembly oracle, swept ------------------------------------ */
section('plans');
function axisValues(q) {
  if (q.type === 'bool') return [false, true];
  if (q.type === 'select') return q.options.map((o) => (typeof o === 'object' ? o.value : o));
  const out = new Set([q.min, q.max, q.def]);
  const mid = q.min + (q.max - q.min) / 2;
  out.add(Math.round(mid / q.step) * q.step);
  out.add(Math.min(q.max, q.min + q.step));
  out.add(Math.max(q.min, q.max - q.step));
  return [...out].sort((a, b) => a - b);
}
function randomParams(plan, rnd) {
  const p = {};
  for (const q of plan.params) {
    if (q.type === 'bool') p[q.key] = rnd() < 0.5;
    else if (q.type === 'select') {
      const o = q.options[Math.floor(rnd() * q.options.length)];
      p[q.key] = typeof o === 'object' ? o.value : o;
    } else {
      const steps = Math.round((q.max - q.min) / q.step);
      p[q.key] = Math.round((q.min + Math.floor(rnd() * (steps + 1)) * q.step) * 1000) / 1000;
    }
  }
  return p;
}
// Deterministic PRNG so a failure is reproducible.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
{
  let n = 0, nRefused = 0;
  const firstFail = new Map();
  for (const plan of P.PLANS) {
    const axes = plan.params.map(axisValues);
    const configs = [];
    (function rec(i, acc) {
      if (i === plan.params.length) { configs.push(acc); return; }
      for (const v of axes[i]) rec(i + 1, Object.assign({}, acc, { [plan.params[i].key]: v }));
    })(0, {});
    const rnd = mulberry32(0x5eed);
    for (let i = 0; i < 4000; i++) configs.push(randomParams(plan, rnd));

    let bad = 0;
    for (const cfg of configs) {
      n++;
      let built;
      try { built = plan.build(cfg); } catch (e) {
        bad++; failures++; checks++;
        if (!firstFail.has(plan.id)) firstFail.set(plan.id, { cfg, msg: 'THREW ' + e.message });
        continue;
      }
      // A plan may refuse a combination outright; it owes the user a reason.
      if (built.error) {
        ok(typeof built.error === 'string' && built.error.length > 40,
          `${plan.id}: refused a config without explaining why`);
        checks++;
        nRefused++;
        continue;
      }
      const probs = G.checkAssembly(built);
      checks++;
      if (probs.length) {
        bad++; failures++;
        if (!firstFail.has(plan.id)) firstFail.set(plan.id, { cfg, msg: probs.join(' | ') });
      }
      // Every plan must produce something buildable and describable.
      ok(built.parts.length > 0, `${plan.id}: empty cut list`);
      ok(built.steps.length >= 5, `${plan.id}: too few steps`);
      ok(built.actual.x > 0 && built.actual.y > 0 && built.actual.z > 0, `${plan.id}: degenerate size`);
      checks += 3;
    }
    process.stdout.write(`  ${bad ? 'FAIL' : 'pass'}  ${plan.id.padEnd(16)} ${configs.length} configs` +
      (bad ? `  (${bad} bad)` : '') + '\n');
    if (firstFail.has(plan.id)) {
      const f = firstFail.get(plan.id);
      process.stdout.write(`        ${JSON.stringify(f.cfg)}\n        ${f.msg}\n`);
    }
  }
  process.stdout.write(`  ${n} configurations checked against their 3D assemblies` +
    ` (${nRefused} refused as unbuildable, with a reason)\n`);
}

/* ---- 5. the cut-list optimizer ---------------------------------------- */
section('optimizer');
{
  let n = 0;
  for (const plan of P.PLANS) {
    const rnd = mulberry32(0xc0ffee);
    for (let i = 0; i < 300; i++) {
      const built = plan.build(i === 0 ? P.defaults(plan) : randomParams(plan, rnd));
      if (built.error) continue;
      const mult = built.multiplier || 1;
      const parts = built.parts.map((p) => Object.assign({}, p, { qty: p.qty * mult }));
      const res = O.optimize(parts, { kerf: 0.125 });
      const expected = O.expand(parts).length;
      let placed = 0;
      for (const g of res.groups) {
        for (const b of g.boards) {
          placed += b.pieces.length;
          const used = b.pieces.reduce((s, q) => s + q.length, 0) + res.kerf * b.pieces.length;
          ok(used <= g.boardLen + 1e-9,
            `${plan.id}: board overfilled, ${used} > ${g.boardLen}`);
          ok(b.pieces.length > 0, `${plan.id}: empty board in the plan`);
          n += 2;
        }
        // Never fewer boards than the wood alone requires.
        const need = g.boards.reduce((s, b) => s + b.pieces.reduce((t, q) => t + q.length, 0), 0);
        ok(g.boardCount >= Math.ceil(need / g.boardLen - 1e-9),
          `${plan.id}: fewer boards than the total length needs`);
        ok(g.boardLen >= Math.max(...g.boards.flatMap((b) => b.pieces.map((q) => q.length))),
          `${plan.id}: a piece is longer than the board it is on`);
        n += 2;
      }
      ok(placed === expected && res.tooLong.length === 0,
        `${plan.id}: placed ${placed} of ${expected} pieces (${res.tooLong.length} too long)`);
      ok(res.wastePct >= -1e-9 && res.wastePct < 100, `${plan.id}: waste ${res.wastePct}%`);
      n += 2;
    }
  }
  // First-fit-decreasing on a known case: three 40" pieces cannot share a 96".
  const twoBoards = O.packInto([{ length: 40 }, { length: 40 }, { length: 40 }], 96, 0.125);
  ok(twoBoards.length === 2, `three 40" pieces should need 2 boards, got ${twoBoards.length}`);
  // Kerf must actually bite: 4 x 24" is 96" of wood but not 96" of board.
  const kerfed = O.packInto([{ length: 24 }, { length: 24 }, { length: 24 }, { length: 24 }], 96, 0.125);
  ok(kerfed.length === 2, `kerf ignored: 4 x 24" packed into ${kerfed.length} board(s)`);
  const noKerf = O.packInto([{ length: 24 }, { length: 24 }, { length: 24 }, { length: 24 }], 96, 0);
  ok(noKerf.length === 1, `without kerf 4 x 24" must fit one 96" board, got ${noKerf.length}`);
  done('packing invariants', n + 4);
}

/* ---- 6. the birdhouse ridge ------------------------------------------- */
section('birdhouse ridge');
{
  let n = 0;
  const plan = P.byId('birdhouse');
  for (const bird of Object.keys(P.BIRDS)) {
    for (let pitch = 15; pitch <= 45; pitch += 1) {
      const built = plan.build(Object.assign(P.defaults(plan), { bird, pitch }));
      const panels = built.assembly.filter((a) => a.part === 'Roof panel');
      ok(panels.length === 2, 'two roof panels');
      // The bevel-ripped ridge edge is what closes the roof: the four ridge
      // corners of BOTH panels have to land on one vertical plane, or the
      // finished roof has a gap the thickness of the stock.
      const xs = [];
      for (const panel of panels) {
        const byX = panel.verts.map((v) => v[0]);
        const ridgeX = panels.indexOf(panel) === 0 ? Math.max(...byX) : Math.min(...byX);
        const onRidge = panel.verts.filter((v) => Math.abs(v[0] - ridgeX) < 1e-9);
        ok(onRidge.length === 4, `${bird}/${pitch}: ${onRidge.length} corners on the ridge, want 4`);
        xs.push(ridgeX);
        n++;
      }
      ok(Math.abs(xs[0] - xs[1]) < 1e-9,
        `${bird}/${pitch}: the two panels meet at ${xs[0]} and ${xs[1]}`);
      // The stated ridge bevel is the pitch; check the panel really is at it.
      const angle = built.angles.find((a) => /ridge/i.test(a.label));
      ok(angle && angle.value === `${pitch}°`, `${bird}/${pitch}: ridge bevel reported as ${angle && angle.value}`);
      n += 2;
    }
  }
  done('ridge closes', n);
}

/* ---- 7. drawings ------------------------------------------------------ */
section('drawings');
{
  let n = 0;
  for (const plan of P.PLANS) {
    const rnd = mulberry32(0xd0d0);
    for (let i = 0; i < 60; i++) {
      const cfg = i === 0 ? P.defaults(plan) : randomParams(plan, rnd);
      const built = plan.build(cfg);
      if (built.error) continue;
      for (const view of ['front', 'side', 'top', 'iso']) {
        const svg = D.render(built, view, { width: 520 });
        ok(typeof svg === 'string' && svg.startsWith('<svg') && svg.endsWith('</svg>'),
          `${plan.id}/${view}: not an svg`);
        ok(!/NaN|Infinity|undefined/.test(svg), `${plan.id}/${view}: non-finite numbers in the path data`);
        ok((svg.match(/<(polygon|path|rect|circle)/g) || []).length >= built.assembly.length,
          `${plan.id}/${view}: fewer shapes than parts`);
        n += 3;
      }
    }
  }
  done('svg output', n);
}

/* ---- summary ---------------------------------------------------------- */
process.stdout.write(`\n${failures ? 'FAILED' : 'ALL PASS'}: ${checks - failures}/${checks} checks\n`);
for (const f of fails) process.stdout.write(`  - ${f}\n`);
process.exit(failures ? 1 : 0);
