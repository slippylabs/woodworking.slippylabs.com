# Woodworking Plans

Parametric plans for planters, tables, shelves and shop furniture. Dial in the size you actually want and get a dimensioned drawing, a cut list in real fractions, a board-by-board shopping list and printable steps.

**Live:** <https://woodworking.slippylabs.com/>

## What it does

- Eight parametric builds — planters, tables, shelves, a potting bench, sawhorses, a birdhouse.
- Set the dimensions you actually want; the drawings, cut list, shopping list and price all recompute together.
- Front, side and exploded views, exportable as SVG.
- Cut list in real fractions, downloadable as CSV, plus a printable step-by-step.

## How it works

Two things make the output trustworthy rather than decorative.

First, **nominal versus actual lumber**. A 2x4 is 1.5" x 3.5", and a plan that does its arithmetic in nominal inches produces a cut list that does not assemble. Every dimension here is computed in actual sizes and only labelled nominally.

Second, an **assembly oracle**. `tests/run.js` builds a 3D model of each plan from the generated cut list and checks that the parts actually meet — no gaps, no overlaps, no part floating in space — across the whole parameter space rather than at one example size. A cut list that cannot be assembled fails the test suite.

## Run it locally

A static site. No build step, no package manager, no dependencies:

```
git clone git@github.com:slippylabs/woodworking.slippylabs.com.git
cd woodworking.slippylabs.com
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

## Tests

    node tests/run.js

## Layout

| File | Purpose |
| --- | --- |
| `index.html` | Page shell and plan chooser |
| `plans.js` | The eight parametric plan definitions |
| `geometry.js` | Part placement and the compound-angle solver |
| `lumber.js` | Nominal-to-actual sizes, stock and pricing |
| `optimizer.js` | Fitting parts onto boards for the shopping list |
| `drawing.js` | SVG views — front, side, exploded |
| `app.js` | UI wiring |
| `tests/run.js` | Assembly oracle over the parameter space |
| `tests/browser.py` | Headless browser test driver |

---

Part of [Slippy Labs](https://slippylabs.com). Every tool is indexed at
[projects.slippylabs.com](https://projects.slippylabs.com).
