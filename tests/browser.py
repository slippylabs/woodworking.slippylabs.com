#!/usr/bin/env python3
"""Browser checks for woodworking.slippylabs.com.

    <venv>/bin/python tests/browser.py [base-url] [--shots DIR]

Drives every plan through every view at desktop and phone widths and asserts
the things a Node test cannot see: that nothing throws in a real browser, that
the page never scrolls sideways on a phone, that every control is big enough to
hit with a thumb, and that moving a slider actually moves the drawing and the
numbers together.
"""
import sys
import re
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith('-') else 'http://127.0.0.1:8099/'
SHOTS = None
if '--shots' in sys.argv:
    SHOTS = Path(sys.argv[sys.argv.index('--shots') + 1])
    SHOTS.mkdir(parents=True, exist_ok=True)

PLANS = ['planter-box', 'side-table', 'coffee-table', 'floating-shelf',
         'bookshelf', 'potting-bench', 'sawhorse', 'birdhouse']
VIEWS = ['front', 'side', 'top', 'iso']

problems = []
checks = 0


def check(cond, msg):
    global checks
    checks += 1
    if not cond:
        problems.append(msg)


def watch(page, origin):
    """Console/network errors, minus Cloudflare's edge-injected beacon.

    That script is not in the served HTML — the edge adds it for real browsers
    only — and it fails with a local-address-space CORS error here. Filter it
    by URL against the page's own origin rather than by error text, or a real
    failure gets swallowed with it.
    """
    errs = []

    def on_console(m):
        if m.type != 'error':
            return
        # A console line carries no URL, so a third-party resource failure is
        # indistinguishable here from one of ours. Every such message is paired
        # with a requestfailed event below, which DOES have a URL and is
        # filtered by origin — so drop the generic message and keep the
        # authoritative signal. Real JS errors from our own code still land.
        if 'Failed to load resource' in m.text:
            return
        errs.append(f'console.{m.type}: {m.text}')

    page.on('console', on_console)
    page.on('pageerror', lambda e: errs.append(f'pageerror: {e}'))
    page.on('requestfailed', lambda r: errs.append(f'requestfailed: {r.url} {r.failure}')
            if r.url.startswith(origin) else None)
    return errs


TARGET_JS = """
() => {
  const bad = [];
  for (const el of document.querySelectorAll('button, a, select, input')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;          // hidden
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    // A checkbox is tapped via its wrapping label, so measure that instead.
    const lab = el.closest('label');
    if (lab) {
      const lr = lab.getBoundingClientRect();
      if (lr.height >= 40 && lr.width >= 40) continue;
    }
    // Inline prose links are not controls and must not be inflated.
    if (el.tagName === 'A' && el.closest('p, li') && !el.classList.contains('dl')) continue;
    if (r.height < 40 || r.width < 40) {
      bad.push(`${el.tagName}.${el.className || '(none)'}#${el.id || '-'} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
  }
  return bad;
}
"""

with sync_playwright() as pw:
    browser = pw.chromium.launch(args=['--no-sandbox'])
    origin = re.match(r'^[a-z]+://[^/]+', BASE).group(0)

    # ---------- desktop ----------
    ctx = browser.new_context(viewport={'width': 1280, 'height': 900})
    page = ctx.new_page()
    errs = watch(page, origin)
    page.goto(BASE, wait_until='networkidle')
    check(page.locator('#plan-grid .console-card').count() == len(PLANS),
          f'gallery shows {page.locator("#plan-grid .console-card").count()} cards, want {len(PLANS)}')
    check(page.locator('h1').inner_text().strip() == 'WOODWORKING PLANS', 'gallery h1')

    # category filter
    page.click('[data-cat="garden"]')
    visible = page.eval_on_selector_all(
        '#plan-grid .console-card', 'els => els.filter(e => !e.classList.contains("hidden")).length')
    check(visible == 3, f'garden filter shows {visible} cards, want 3')
    page.click('[data-cat="all"]')

    if SHOTS:
        page.screenshot(path=str(SHOTS / 'gallery.png'), full_page=False)

    for pid in PLANS:
        page.goto(f'{BASE}#/{pid}', wait_until='networkidle')
        page.wait_for_selector('#dwg-slot svg.dwg', timeout=5000)
        check(page.locator('#cut-slot tbody tr').count() > 0, f'{pid}: empty cut list')
        check(page.locator('#stat-slot .stat-tile').count() == 6, f'{pid}: wrong stat tile count')
        check(page.locator('#step-slot li').count() >= 5, f'{pid}: too few steps')
        # The oracle, run inside the browser against the page's own state.
        bad = page.evaluate('() => window.__wood.check()')
        check(bad == [], f'{pid}: assembly check in-browser: {bad}')
        for v in VIEWS:
            page.click(f'#view-bar [data-view="{v}"]')
            page.wait_for_timeout(120)
            box = page.locator('#dwg-slot svg.dwg').bounding_box()
            check(box and box['width'] > 100 and box['height'] > 60,
                  f'{pid}/{v}: drawing collapsed to {box}')
            vb = page.get_attribute('#dwg-slot svg.dwg', 'viewBox')
            check(vb and 'NaN' not in vb, f'{pid}/{v}: viewBox {vb}')
            check(page.locator('#dwg-slot svg.dwg polygon, #dwg-slot svg.dwg circle').count() > 0,
                  f'{pid}/{v}: nothing drawn')
        page.click('#view-bar [data-view="front"]')
        if SHOTS:
            page.locator('#dwg-slot').screenshot(path=str(SHOTS / f'dwg-{pid}.png'))

    # ---------- a slider must move everything at once ----------
    page.goto(f'{BASE}#/planter-box', wait_until='networkidle')
    before = {
        'svg': page.inner_html('#dwg-slot'),
        'cut': page.inner_text('#cut-slot'),
        'stat': page.inner_text('#stat-slot'),
        'hash': page.evaluate('() => location.hash'),
    }
    page.eval_on_selector('#p-len',
                          'el => { el.value = 46; el.dispatchEvent(new Event("input", {bubbles:true})); }')
    page.wait_for_timeout(250)
    after = {
        'svg': page.inner_html('#dwg-slot'),
        'cut': page.inner_text('#cut-slot'),
        'stat': page.inner_text('#stat-slot'),
        'hash': page.evaluate('() => location.hash'),
    }
    for k in before:
        check(before[k] != after[k], f'slider changed nothing in {k}')
    check('len=46' in after['hash'], f'hash did not follow the slider: {after["hash"]}')
    check('46' in page.inner_text('#stat-slot'), 'stat tiles did not pick up the new length')

    # deep link round trip
    page.goto(f'{BASE}#/bookshelf?wid=42&hgt=70&depth=12&shelves=5&material=solid&joint=cleat',
              wait_until='networkidle')
    check(page.input_value('#p-wid') == '42', 'deep link width lost')
    check(page.input_value('#p-joint') == 'cleat', 'deep link select lost')
    check('plywood' in page.inner_text('#warn-slot').lower(),
          '12in-deep solid should have warned about switching to plywood')

    # a refused combination explains itself and keeps the controls
    page.goto(f'{BASE}#/side-table?len=14&wid=12&hgt=18&legStock=4x4&topStock=1x4&shelf=true&rip=false',
              wait_until='networkidle')
    check(page.locator('.plan-error').count() == 1, 'no error box on an unbuildable combination')
    check(page.locator('#ctrl-slot input').count() > 0, 'controls vanished on error')
    check(page.locator('#result-block').is_hidden(), 'stale results left on screen after an error')
    page.select_option('#p-legStock', '2x2')
    page.wait_for_timeout(200)
    check(page.locator('.plan-error').count() == 0, 'error box did not clear once the config was fixed')

    # a mangled hash must not break the page
    page.goto(f'{BASE}#/planter-box?len=<script>&wid=99999&stock=nope&hgt=-4', wait_until='networkidle')
    check(page.locator('#dwg-slot svg.dwg').count() == 1, 'mangled hash broke the drawing')
    check(page.input_value('#p-len') == '36', f'garbage length not defaulted: {page.input_value("#p-len")}')
    check(page.input_value('#p-wid') == '24', f'over-max width not clamped: {page.input_value("#p-wid")}')
    check(page.input_value('#p-hgt') == '10', f'negative height not clamped: {page.input_value("#p-hgt")}')
    check(page.input_value('#p-stock') == '1x6', 'bad select not defaulted')
    check(page.locator('script:not([src])').count() == 1, 'hash injected a script tag')

    # print stylesheet
    page.goto(f'{BASE}#/birdhouse', wait_until='networkidle')
    page.emulate_media(media='print')
    page.wait_for_timeout(200)
    check(page.locator('#dwg-print svg.dwg').count() == 4, 'print sheet is missing views')
    check(page.locator('.comm-window').is_hidden(), 'comm window prints')
    check(page.locator('.hud-btn').is_hidden(), 'back button prints')
    bg = page.evaluate('() => getComputedStyle(document.body).backgroundColor')
    check('255, 255, 255' in bg, f'print background is {bg}, not white')
    if SHOTS:
        page.screenshot(path=str(SHOTS / 'print.png'), full_page=True)
    page.emulate_media(media='screen')

    desktop_errs = [e for e in errs]
    check(not desktop_errs, f'desktop console errors: {desktop_errs[:5]}')

    # desktop must not overflow either
    page.goto(f'{BASE}#/potting-bench?len=72&depth=28&hgt=40&splash=24', wait_until='networkidle')
    ov = page.evaluate('() => document.documentElement.scrollWidth - document.documentElement.clientWidth')
    check(ov <= 0, f'desktop overflows by {ov}px')
    ctx.close()

    # ---------- phone ----------
    ctx = browser.new_context(viewport={'width': 390, 'height': 844},
                              is_mobile=True, has_touch=True, device_scale_factor=2)
    page = ctx.new_page()
    perrs = watch(page, origin)
    page.goto(BASE, wait_until='networkidle')
    bad = page.evaluate(TARGET_JS)
    check(not bad, f'gallery touch targets under 40px: {bad}')
    ov = page.evaluate('() => document.documentElement.scrollWidth - document.documentElement.clientWidth')
    check(ov <= 0, f'gallery overflows by {ov}px on a phone')
    if SHOTS:
        page.screenshot(path=str(SHOTS / 'phone-gallery.png'), full_page=False)

    for pid in PLANS:
        page.goto(f'{BASE}#/{pid}', wait_until='networkidle')
        page.wait_for_selector('#dwg-slot svg.dwg')
        for v in VIEWS:
            page.click(f'#view-bar [data-view="{v}"]')
            page.wait_for_timeout(80)
            ov = page.evaluate(
                '() => document.documentElement.scrollWidth - document.documentElement.clientWidth')
            check(ov <= 0, f'{pid}/{v} overflows by {ov}px on a phone')
        bad = page.evaluate(TARGET_JS)
        check(not bad, f'{pid}: touch targets under 40px: {bad}')
    if SHOTS:
        page.goto(f'{BASE}#/birdhouse', wait_until='networkidle')
        page.screenshot(path=str(SHOTS / 'phone-plan.png'), full_page=False)

    check(not perrs, f'phone console errors: {perrs[:5]}')
    ctx.close()
    browser.close()

print(f'{checks - len(problems)}/{checks} browser checks passed')
for p in problems:
    print('  FAIL', p)
sys.exit(1 if problems else 0)
