"""Finite Chromium acceptance run; owns and closes only its browser contexts.

Use an already-installed Chromium. Start the app separately on port 5187.
This verifies browser behavior and mobile emulation, not physical-device FPS.
"""
from pathlib import Path
import json
import os
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / 'validation'
URL = os.environ.get('CHOG_QA_URL', 'http://127.0.0.1:5187')
CHROME = Path(os.environ.get('CHOG_QA_CHROMIUM', str(Path.home() / '.cache/ms-playwright/chromium-1243/chrome-linux64/chrome')))


def run():
    OUTPUT.mkdir(exist_ok=True)
    checks, errors, failures = [], [], []

    def check(name, condition, detail=None):
        item = {'name': name, 'pass': bool(condition)}
        if detail is not None:
            item['detail'] = detail
        checks.append(item)
        print(('PASS ' if condition else 'FAIL ') + name, flush=True)
        if not condition:
            failures.append(name)

    def open_page(browser, width, height, mobile=False):
        context = browser.new_context(viewport={'width': width, 'height': height},
                                      is_mobile=mobile, has_touch=mobile, device_scale_factor=1)
        page = context.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('response', lambda response: errors.append(f'HTTP {response.status} {response.url}') if response.status >= 400 else None)
        page.goto(URL + '/?qa', wait_until='networkidle', timeout=45000)
        page.wait_for_function('window.__arena?.ready === true', timeout=30000)
        page.locator('[data-play="training"]').click();page.locator('#start').click()
        page.evaluate('window.__arena.advance(0.5)')
        return context, page

    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=str(CHROME), headless=True, args=[
            '--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
            '--ignore-gpu-blocklist', '--disable-dev-shm-usage'])
        try:
            context, page = open_page(browser, 1440, 900)
            try:
                snapshot = page.evaluate('window.__arena.snapshot()')
                check('both fighter instances have a real independent 24-bone rig',
                      snapshot['independentRigs'] and all(a['ready'] and a['bones'] == 24 for a in snapshot['assets']))
                check('Play gesture unlocks audio', snapshot['audio'] == 'running', snapshot['audio'])
                page.screenshot(path=str(OUTPUT / 'desktop-idle.png'))

                before = snapshot['actors'][0]
                page.locator('#arena').focus()
                page.keyboard.down('w')
                page.evaluate('window.__arena.advanceControls(0.5)')
                page.keyboard.up('w')
                after = page.evaluate('window.__arena.snapshot().actors[0]')
                check('keyboard movement reaches the 3D simulation', abs(after['z'] - before['z']) > 0.7 and abs(after['x'] - before['x']) > 0.2)

                page.evaluate('window.__arena.reset();window.__arena.teleport(0,0,0.5)')
                page.keyboard.press('u')
                page.evaluate('window.__arena.advanceControls(0.45)')
                snapshot = page.evaluate('window.__arena.snapshot()')
                check('keyboard melee confirms exactly one hit', snapshot['actors'][1]['hp'] == 191 and snapshot['hits'] == 1)
                check('HUD follows simulation HP', page.locator('#hp-dummy').inner_text().startswith('191'))
                check('confirmed hit creates a visible effect', snapshot['effects'] > 0)
                page.screenshot(path=str(OUTPUT / 'desktop-hit.png'))

                page.evaluate('window.__arena.reset()')
                page.locator('#action-skill').click()
                page.evaluate('window.__arena.advanceControls(0.7)')
                snapshot = page.evaluate('window.__arena.snapshot()')
                check('skill button launches a projectile and confirms damage', snapshot['actors'][1]['hp'] == 182)
                check('skill cooldown disables its button', page.locator('#action-skill').is_disabled())

                page.locator('#game-menu').click();page.locator('#training-toggle').click()
                check('training panel opens with accessible expanded state', page.locator('#training-toggle').get_attribute('aria-expanded') == 'true')
                page.locator('[data-mode="spar"]').click()
                page.evaluate('window.__arena.reset();window.__arena.advance(5)')
                check('fight-back dummy attacks the player', page.evaluate('window.__arena.snapshot().actors[0].hp') < 200)

                page.evaluate('window.__arena.reset();window.__arena.setMode("idle")')
                page.locator('#test-down').click()
                check('debug knockdown enters down state', page.evaluate('window.__arena.snapshot().actors[0].state') == 'down')
                page.evaluate('window.__arena.advance(0.5)')
                page.screenshot(path=str(OUTPUT / 'desktop-knockdown.png'))
                page.evaluate('window.__arena.advance(1.5)')
                check('living fighter gets back up', page.evaluate('window.__arena.snapshot().actors[0].state') == 'idle')

                page.locator('#test-ko').click()
                page.evaluate('window.__arena.advance(1.4)')
                check('KO holds the final state and displays the result', page.evaluate('window.__arena.snapshot().actors[1].state') == 'ko' and page.locator('#result').is_visible())
                page.locator('#panel-close').click();page.locator('#resume').click()
                page.screenshot(path=str(OUTPUT / 'desktop-ko.png'))
                page.locator('#result-reset').click()
                check('Run it back clears result, restores HP and counters', page.evaluate('window.__arena.snapshot().actors.every(a=>a.hp===200) && window.__arena.snapshot().hits===0') and not page.locator('#result').is_visible())

                page.locator('#game-menu').click();page.locator('#training-toggle').click()
                page.locator('#hitbox-toggle').check()
                page.locator('#speed').select_option('0.5')
                page.locator('#animation').select_option('getup')
                check('animation inspector selects a real get-up clip', page.evaluate('window.__arena.snapshot().assets[0].ready'))
                page.screenshot(path=str(OUTPUT / 'desktop-training-panel.png'))
                page.locator('#animation').select_option('')
                page.locator('#panel-close').click();page.locator('#resume').click()

                overflow = page.evaluate('document.documentElement.scrollWidth > innerWidth')
                check('desktop layout has no horizontal overflow', not overflow)
            finally:
                context.close()

            context, page = open_page(browser, 390, 844, True)
            try:
                check('mobile portrait exposes joystick and attack controls', page.locator('#joystick').is_visible() and page.locator('#action-attack').is_visible())
                page.screenshot(path=str(OUTPUT / 'mobile-portrait.png'))
                # Dispatch actual multi-touch: left thumb holds movement while right taps a skill.
                cdp = context.new_cdp_session(page)
                joy = page.locator('#joystick').bounding_box()
                skill = page.locator('#action-skill').bounding_box()
                x, y = joy['x'] + joy['width']/2, joy['y'] + joy['height']/2
                s = {'x': skill['x'] + skill['width']/2, 'y': skill['y'] + skill['height']/2, 'id': 2}
                cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x, 'y': y, 'id': 1}]})
                cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': x + 26, 'y': y - 22, 'id': 1}]})
                page.evaluate('window.__arena.advanceControls(0.4)')
                moved = page.evaluate('window.__arena.snapshot().actors[0]')
                cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x + 26, 'y': y - 22, 'id': 1}, s]})
                page.evaluate('window.__arena.advanceControls(0.1)')
                check('two touch pointers move and trigger skill together', abs(moved['x']) > 0.3 and page.evaluate('window.__arena.snapshot().actors[0].skillCooldown') > 0)
                cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
                page.evaluate('window.__arena.advanceControls(0.5)')
                stop = page.evaluate('window.__arena.snapshot().actors[0]')
                check('touch release clears movement', stop['speed'] < 0.01)
                check('portrait layout has no horizontal overflow', page.evaluate('document.documentElement.scrollWidth <= innerWidth'))

                page.set_viewport_size({'width': 844, 'height': 390})
                page.evaluate('window.__arena.reset();window.__arena.advance(0.3)')
                page.screenshot(path=str(OUTPUT / 'mobile-landscape.png'))
                action_box = page.locator('#action-attack').bounding_box()
                joy_box = page.locator('#joystick').bounding_box()
                check('landscape controls remain inside viewport', action_box['y'] + action_box['height'] <= 391 and joy_box['y'] + joy_box['height'] <= 391, {'attack': action_box, 'joystick': joy_box})
                page.locator('#game-menu').tap();page.locator('#training-toggle').tap()
                page.screenshot(path=str(OUTPUT / 'mobile-landscape-panel.png'))
                check('landscape training panel can scroll within viewport', page.locator('#training-panel').is_visible())
                check('landscape layout has no horizontal overflow', page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
            finally:
                context.close()
        finally:
            browser.close()

    check('no browser JavaScript or HTTP errors', not errors, errors)
    report = {'status': 'PASS' if not failures else 'FAIL', 'checks': checks,
              'browser': 'installed Chromium 1243, headless, SwiftShader',
              'scope': 'Desktop browser + mobile touch/viewport emulation. No physical phone performance or Safari acceptance claimed.'}
    (OUTPUT / 'browser-report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'status': report['status'], 'checks': len(checks), 'failed': failures}), flush=True)
    if failures:
        raise SystemExit(1)


if __name__ == '__main__':
    run()
