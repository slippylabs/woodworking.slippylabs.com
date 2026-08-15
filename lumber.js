/* lumber.js — the boring facts about wood, in one place.
 *
 * Everything downstream depends on one distinction: a "1x6" is not 1" by 6".
 * It is 3/4" by 5-1/2", because it was 1x6 when it was rough-sawn and then it
 * got planed on all four sides (S4S). Four 1x6 slats stacked make a 22" wall,
 * not 24". Get that wrong and every drawing on this site is a lie that looks
 * completely reasonable.
 *
 * So: ACTUAL dimensions drive all geometry. NOMINAL dimensions drive only the
 * shopping list and the board-foot price, because that is the convention the
 * lumberyard bills you in.
 */
(function (root) {
  'use strict';

  /* ---- surfaced-four-sides softwood/hardwood, actual dimensions in inches ---- */
  const S4S = {
    '1x2':  { t: 0.75, w: 1.5   },
    '1x3':  { t: 0.75, w: 2.5   },
    '1x4':  { t: 0.75, w: 3.5   },
    '1x6':  { t: 0.75, w: 5.5   },
    '1x8':  { t: 0.75, w: 7.25  },
    '1x10': { t: 0.75, w: 9.25  },
    '1x12': { t: 0.75, w: 11.25 },
    '2x2':  { t: 1.5,  w: 1.5   },
    '2x3':  { t: 1.5,  w: 2.5   },
    '2x4':  { t: 1.5,  w: 3.5   },
    '2x6':  { t: 1.5,  w: 5.5   },
    '2x8':  { t: 1.5,  w: 7.25  },
    '2x10': { t: 1.5,  w: 9.25  },
    '2x12': { t: 1.5,  w: 11.25 },
    '4x4':  { t: 3.5,  w: 3.5   },
  };

  /* Sheet goods are sold by the sheet, not the board foot, and their actual
     caliper is under the nominal too — "3/4 inch" plywood is 23/32". */
  const SHEET = {
    'ply1/4': { t: 0.219, label: '1/4" plywood', sheetW: 48, sheetL: 96 },
    'ply1/2': { t: 0.469, label: '1/2" plywood', sheetW: 48, sheetL: 96 },
    'ply3/4': { t: 0.719, label: '3/4" plywood', sheetW: 48, sheetL: 96 },
  };

  /* Rough US retail, mid-2026. Deliberately editable in the UI — this is a
     starting point for a ballpark, not a quote. */
  const SPECIES = {
    pine:    { label: 'Pine / SPF',  bf: 4.20,  sheet: 46 },
    cedar:   { label: 'Cedar',       bf: 8.50,  sheet: 78 },
    poplar:  { label: 'Poplar',      bf: 6.40,  sheet: 58 },
    oak:     { label: 'Red Oak',     bf: 10.50, sheet: 92 },
    maple:   { label: 'Hard Maple',  bf: 11.00, sheet: 98 },
  };

  /* What the yard actually stocks, in inches. */
  const STOCK_LENGTHS = [72, 96, 120, 144];

  const isSheet = (stock) => Object.prototype.hasOwnProperty.call(SHEET, stock);

  function actual(stock) {
    if (S4S[stock]) return { t: S4S[stock].t, w: S4S[stock].w };
    if (SHEET[stock]) return { t: SHEET[stock].t, w: null };  // width is whatever you rip
    throw new Error('unknown stock: ' + stock);
  }

  /* Nominal is parsed straight out of the name; that is the whole point of the
     name. Sheet goods have no nominal width — they are priced by area. */
  function nominal(stock) {
    if (isSheet(stock)) return null;
    const m = /^(\d+)x(\d+)$/.exec(stock);
    if (!m) throw new Error('unknown stock: ' + stock);
    return { t: Number(m[1]), w: Number(m[2]) };
  }

  /* ---- fractions ----
   * A shop reads 22-3/4, not 22.75. Everything numeric on the page goes
   * through here so there is exactly one place that can be wrong.
   * Sixteenths, reduced, whole numbers printed bare.
   */
  function toFraction(x, den) {
    den = den || 16;
    const neg = x < 0;
    x = Math.abs(x);
    let whole = Math.floor(x + 1e-9);
    let num = Math.round((x - whole) * den);
    if (num >= den) { whole += 1; num -= den; }
    let d = den;
    while (num > 0 && num % 2 === 0 && d % 2 === 0) { num /= 2; d /= 2; }
    let s;
    if (num === 0) s = String(whole);
    else if (whole === 0) s = num + '/' + d;
    else s = whole + '-' + num + '/' + d;
    return (neg ? '-' : '') + s;
  }

  /* Inverse of toFraction, for round-trip testing and for typed input. */
  function parseFraction(s) {
    s = String(s).trim().replace(/"$/, '').trim();
    const neg = /^-/.test(s);
    s = s.replace(/^-/, '');
    let m = /^(\d+)[-\s]+(\d+)\/(\d+)$/.exec(s);
    if (m) return (neg ? -1 : 1) * (Number(m[1]) + Number(m[2]) / Number(m[3]));
    m = /^(\d+)\/(\d+)$/.exec(s);
    if (m) return (neg ? -1 : 1) * (Number(m[1]) / Number(m[2]));
    m = /^(\d+(?:\.\d+)?)$/.exec(s);
    if (m) return (neg ? -1 : 1) * Number(m[1]);
    return NaN;
  }

  const MM_PER_IN = 25.4;

  /* One display entry point, so the metric toggle cannot miss a readout. */
  function len(x, metric) {
    if (metric) return Math.round(x * MM_PER_IN) + ' mm';
    return toFraction(x) + '"';
  }

  /* ---- money ----
   * Board feet use NOMINAL thickness and width. That is not an approximation,
   * it is how lumber is sold: you pay for the wood that was there before the
   * planer took it off.
   */
  function boardFeet(part) {
    if (isSheet(part.stock)) return 0;
    const n = nominal(part.stock);
    return (n.t * n.w * part.length * (part.qty || 1)) / 144;
  }

  /* Sheet goods: charge by area consumed against a 4x8 sheet, rounded up to
     whole sheets at the end by cost(). */
  function sheetArea(part) {
    if (!isSheet(part.stock)) return 0;
    return part.width * part.length * (part.qty || 1);
  }

  function cost(parts, speciesKey, rate) {
    const sp = SPECIES[speciesKey] || SPECIES.pine;
    const bfRate = (rate && rate.bf) || sp.bf;
    const sheetRate = (rate && rate.sheet) || sp.sheet;
    let bf = 0, area = 0;
    for (const p of parts) { bf += boardFeet(p); area += sheetArea(p); }
    const sheetArea48x96 = 48 * 96;
    // Ripping waste is real; nobody gets 100% of a sheet. 85% is a fair yield.
    const sheets = area > 0 ? Math.ceil(area / (sheetArea48x96 * 0.85)) : 0;
    return {
      boardFeet: bf,
      sheets: sheets,
      lumberCost: bf * bfRate,
      sheetCost: sheets * sheetRate,
      total: bf * bfRate + sheets * sheetRate,
    };
  }

  const api = {
    S4S, SHEET, SPECIES, STOCK_LENGTHS, MM_PER_IN,
    isSheet, actual, nominal,
    toFraction, parseFraction, len,
    boardFeet, sheetArea, cost,
  };

  root.Lumber = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
