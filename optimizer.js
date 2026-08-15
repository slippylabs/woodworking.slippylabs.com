/* optimizer.js — cut list in, shopping list out.
 *
 * This is one-dimensional bin packing: the pieces are lengths, the bins are
 * whatever the yard sells. First-fit-decreasing, which is not optimal but is
 * within 11/9 of optimal and is the thing a person would actually do at the
 * chop saw: cut the longest pieces first, out of whatever board still has room.
 *
 * The kerf is not a rounding detail. A 1/8" blade across forty cuts eats five
 * inches. Every piece placed here is charged its own kerf, which is at most one
 * kerf per board pessimistic (the last piece may run off the end and need no
 * cut) — erring toward buying one extra board rather than one too few.
 */
(function (root) {
  'use strict';

  const Lumber = root.Lumber;

  function expand(parts) {
    const out = [];
    for (const p of parts) {
      if (Lumber.isSheet(p.stock)) continue;      // sheet goods are priced by area
      for (let i = 0; i < (p.qty || 1); i++) {
        out.push({ name: p.name, stock: p.stock, length: p.length, width: p.width });
      }
    }
    return out;
  }

  function packInto(pieces, boardLen, kerf) {
    const boards = [];
    for (const piece of pieces) {
      let placed = false;
      for (const b of boards) {
        if (b.used + piece.length + kerf <= boardLen + 1e-9) {
          b.pieces.push(piece);
          b.used += piece.length + kerf;
          placed = true;
          break;
        }
      }
      if (!placed) {
        boards.push({ length: boardLen, pieces: [piece], used: piece.length + kerf });
      }
    }
    for (const b of boards) b.waste = boardLen - b.used;
    return boards;
  }

  /* Try every stock length the yard carries and keep whichever wastes least.
     A 96" board is not automatically the right answer — six 26" legs fit a
     twelve-footer with 6" left over and waste 22" out of two eight-footers. */
  function bestPack(pieces, kerf) {
    const lengths = Lumber.STOCK_LENGTHS;
    let best = null;
    for (const L of lengths) {
      if (pieces.some((p) => p.length + kerf > L + 1e-9)) continue;
      const boards = packInto(pieces, L, kerf);
      const bought = boards.length * L;
      const waste = bought - pieces.reduce((s, p) => s + p.length, 0);
      if (!best || waste < best.waste - 1e-9) best = { boardLen: L, boards, bought, waste };
    }
    return best;
  }

  function optimize(parts, opts) {
    opts = opts || {};
    const kerf = opts.kerf === undefined ? 0.125 : opts.kerf;
    const pieces = expand(parts);

    const byStock = new Map();
    for (const p of pieces) {
      if (!byStock.has(p.stock)) byStock.set(p.stock, []);
      byStock.get(p.stock).push(p);
    }

    const groups = [];
    const tooLong = [];
    let boughtTotal = 0, neededTotal = 0;

    for (const [stock, list] of byStock) {
      list.sort((a, b) => b.length - a.length);        // decreasing — the "FD" half
      const packed = bestPack(list, kerf);
      if (!packed) {
        tooLong.push(stock);
        continue;
      }
      groups.push({
        stock,
        boardLen: packed.boardLen,
        boardCount: packed.boards.length,
        boards: packed.boards,
        bought: packed.bought,
        needed: list.reduce((s, p) => s + p.length, 0),
      });
      boughtTotal += packed.bought;
      neededTotal += list.reduce((s, p) => s + p.length, 0);
    }

    groups.sort((a, b) => a.stock.localeCompare(b.stock));

    return {
      kerf,
      groups,
      tooLong,
      bought: boughtTotal,
      needed: neededTotal,
      wastePct: boughtTotal > 0 ? (100 * (boughtTotal - neededTotal)) / boughtTotal : 0,
    };
  }

  const api = { optimize, packInto, bestPack, expand };
  root.Optimizer = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
