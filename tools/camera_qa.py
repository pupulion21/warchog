"""Exercise real mouse, keyboard and touch camera inputs in a finite Chromium session."""
from pathlib import Path
import json
import math
import os

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / 'validation'
URL = os.environ.get('CHOG_QA_URL', 'http://127.0.0.1:5187')
CHROME = os.environ.get('CHOG_QA_CHROMIUM', str(Path.home() / '.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'))


def run():
    checks, errors = [], []
    OUTPUT.mkdir(exist_ok=True)

    def check(name, passed, detail=None):
        checks.append({'name': name, 'pass': bool(passed), 'detail': detail})
        print(('PASS ' if passed else 'FAIL ') + name, flush=True)

    def info(page):
        return page.evaluate('window.__arena.cameraInfo()')

    def settle(page):
        page.wait_for_function('''() => {
          const c=window.__arena.cameraInfo();return Math.abs(c.yaw-c.targetYaw)<.025 &&
            Math.abs(c.pitch-c.targetPitch)<.025 && Math.abs(c.zoom-c.targetZoom)<.07;
        }''', timeout=15000)

    def open_page(browser, mobile=False):
        context = browser.new_context(viewport={'width': 390 if mobile else 1440, 'height': 844 if mobile else 900},
                                      is_mobile=mobile, has_touch=mobile, device_scale_factor=1)
        page = context.new_page()
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('response', lambda r: errors.append(f'HTTP {r.status} {r.url}') if r.status >= 400 else None)
        page.goto(URL + '/?qa', wait_until='networkidle', timeout=60000)
        page.wait_for_function('window.__arena?.ready', timeout=30000)
        page.locator('[data-play="training"]').click();page.locator('#start').click()
        page.evaluate('window.__arena.advance(.3)')
        return context, page

    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=CHROME, headless=True, args=[
            '--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
            '--ignore-gpu-blocklist', '--disable-dev-shm-usage'])
        try:
            context, page = open_page(browser)
            try:
                check('free orbit works with camera settings hidden during play', not page.locator('#camera-right').is_visible() and page.locator('#game-menu').is_visible() and info(page)['mode']=='orbit')
                page.screenshot(path=str(OUTPUT / 'camera-desktop.png'))
                initial = info(page)
                # Repeated real drags exceed a full turn, without using the scene-placement API.
                for _ in range(3):
                    page.mouse.move(1120, 460)
                    page.mouse.down()
                    page.mouse.move(420, 460, steps=10)
                    page.mouse.up()
                settle(page)
                rotated = info(page)
                check('mouse drag rotates continuously through more than 360 degrees and releases capture',
                      rotated['yaw'] - initial['yaw'] > math.tau and rotated['pointers'] == 0, rotated)
                page.screenshot(path=str(OUTPUT / 'camera-full-orbit.png'))

                page.mouse.move(730, 650)
                page.mouse.down()
                page.mouse.move(730, 90, steps=8)
                page.mouse.up()
                settle(page)
                low = info(page)
                page.screenshot(path=str(OUTPUT / 'camera-low-angle.png'))
                page.mouse.move(730, 340)
                page.mouse.down()
                page.mouse.move(730, 810, steps=8)
                page.mouse.up()
                settle(page)
                high = info(page)
                check('drag can look upward and overhead while staying above ground',
                      low['pitch'] < -.5 and high['pitch'] > 1.15 and page.evaluate('window.__arena.stageInfo().camera[1]') > 1.5,
                      {'low': low['pitch'], 'high': high['pitch']})
                page.screenshot(path=str(OUTPUT / 'camera-high-angle.png'))

                page.mouse.move(730, 440)
                before = info(page)['zoom']
                page.mouse.wheel(0, 500)
                page.wait_for_function('(before) => window.__arena.cameraInfo().targetZoom > before + 2', arg=before)
                settle(page)
                check('mouse wheel changes zoom smoothly', info(page)['zoom'] > before + 2)

                page.keyboard.press('Escape');page.locator('#camera-mode').click();page.locator('#resume').click()
                page.evaluate('window.__arena.advance(.5,{x:1,z:0})')
                page.wait_for_function('''() => {const c=window.__arena.cameraInfo(),a=window.__arena.snapshot().actors[0];
                  return Math.abs(Math.atan2(Math.sin(c.yaw-a.yaw+.52),Math.cos(c.yaw-a.yaw+.52)))<.08}''', timeout=15000)
                check('Follow tracks the fighter heading across wrapped orbit angles', info(page)['mode'] == 'follow' and page.locator('#camera-mode').get_attribute('aria-pressed') == 'true')
                page.mouse.move(730, 440)
                page.mouse.down()
                page.mouse.move(550, 440, steps=8)
                page.mouse.up()
                settle(page)
                check('drag interrupts Follow and returns to free orbit', info(page)['mode'] == 'orbit' and page.locator('#camera-mode').get_attribute('aria-pressed') == 'false')

                page.keyboard.press('c')
                settle(page)
                centered = info(page)
                heading = page.evaluate('window.__arena.snapshot().actors[0].yaw')
                error = math.atan2(math.sin(centered['yaw'] - heading + .52), math.cos(centered['yaw'] - heading + .52))
                check('C recenters angle, pitch and zoom without moving or resetting combat', abs(error) < .04 and abs(centered['pitch'] - .24) < .025 and abs(centered['zoom'] - 9.5) < .07)

                before = info(page)['targetYaw']
                page.keyboard.press('Escape');page.locator('#camera-right').click();page.locator('#resume').click()
                settle(page)
                check('pause-menu rotate button turns the camera and releases its hold', info(page)['targetYaw'] > before + .45 and info(page)['holds'] == 0)
                before = info(page)['targetYaw']
                page.locator('#arena').focus()
                page.keyboard.down('x')
                page.wait_for_function('(before) => window.__arena.cameraInfo().targetYaw > before + .35', arg=before, timeout=12000)
                page.keyboard.up('x')
                settle(page)
                check('holding X rotates independently of fighter movement', info(page)['targetYaw'] > before + .35)

                page.evaluate('window.__arena.reset();window.__arena.orbit(Math.PI/2,.3);window.__arena.advance(0)')
                before = page.evaluate('window.__arena.snapshot().actors[0]')
                page.keyboard.down('d')
                page.evaluate('window.__arena.advanceControls(.45)')
                page.keyboard.up('d')
                after = page.evaluate('window.__arena.snapshot().actors[0]')
                check('movement follows the rotated camera basis', after['z'] > before['z'] + .8 and abs(after['x'] - before['x']) < .05)
            finally:
                context.close()

            context, page = open_page(browser, True)
            try:
                cdp = context.new_cdp_session(page)

                def touch(kind, points):
                    cdp.send('Input.dispatchTouchEvent', {'type': kind, 'touchPoints': points})

                before = info(page)
                original_camera = page.evaluate('window.__arena.stageInfo().camera')
                touch('touchStart', [{'x': 100, 'y': 400, 'id': 1}, {'x': 280, 'y': 400, 'id': 2}])
                touch('touchMove', [{'x': 155, 'y': 400, 'id': 1}, {'x': 225, 'y': 400, 'id': 2}])
                touch('touchEnd', [])
                settle(page)
                after = info(page)
                zoomed_camera = page.evaluate('window.__arena.stageInfo().camera')
                check('two-finger pinch zooms the actual 3D camera without zooming the page',
                      after['zoom'] > before['zoom'] + 5 and abs(zoomed_camera[2]) > abs(original_camera[2]) + 3 and page.evaluate('visualViewport.scale') == 1,
                      {'before': before['zoom'], 'after': after['zoom']})
                check('pinch release clears both camera pointers', after['pointers'] == 0)

                page.locator('#game-menu').tap();page.locator('#camera-reset').tap();page.locator('#resume').tap()
                settle(page)
                page.screenshot(path=str(OUTPUT / 'camera-mobile-portrait.png'))
                joy = page.locator('#joystick').bounding_box()
                x, y = joy['x'] + joy['width']/2, joy['y'] + joy['height']/2
                joy_point = {'x': x + 23, 'y': y - 19, 'id': 11}
                touch('touchStart', [{'x': x, 'y': y, 'id': 11}])
                touch('touchMove', [joy_point])
                touch('touchStart', [joy_point, {'x': 280, 'y': 400, 'id': 12}])
                old_yaw = info(page)['targetYaw']
                old_actor = page.evaluate('window.__arena.snapshot().actors[0]')
                touch('touchMove', [joy_point, {'x': 205, 'y': 375, 'id': 12}])
                # Chromium may coalesce touch moves until its next rendering frame.
                page.wait_for_function('(before) => Math.abs(window.__arena.cameraInfo().targetYaw-before) > .35', arg=old_yaw)
                page.evaluate('window.__arena.advanceControls(.4)')
                moved_actor = page.evaluate('window.__arena.snapshot().actors[0]')
                check('left joystick and right camera swipe work at the same time',
                      abs(info(page)['targetYaw'] - old_yaw) > .35 and math.hypot(moved_actor['x'] - old_actor['x'], moved_actor['z'] - old_actor['z']) > .4 and info(page)['pointers'] == 1)
                # CDP touchEnd lists the contact to release, not the surviving contact.
                touch('touchEnd', [{'x': 205, 'y': 375, 'id': 12}])
                page.wait_for_function('window.__arena.cameraInfo().pointers === 0')
                page.evaluate('window.__arena.advanceControls(.25)')
                check('releasing camera finger preserves the other thumb movement', info(page)['pointers'] == 0 and page.evaluate('window.__arena.snapshot().actors[0].speed') > .1)
                touch('touchCancel', [])
                page.evaluate('window.__arena.advanceControls(.4)')
                check('touch cancellation clears movement and camera captures', info(page)['pointers'] == 0 and page.evaluate('window.__arena.snapshot().actors[0].speed') < .01)

                page.set_viewport_size({'width': 844, 'height': 390})
                page.evaluate('window.__arena.reset();window.__arena.advance(0)')
                toolbar = page.locator('#game-menu').bounding_box()
                check('pause target fits landscape while orbit toolbar stays off the arena', toolbar['x'] >= 0 and toolbar['x'] + toolbar['width'] <= 844 and toolbar['y'] + toolbar['height'] < 100 and not page.locator('.camera-toolbar').is_visible() and page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
                page.screenshot(path=str(OUTPUT / 'camera-mobile-landscape.png'))
            finally:
                context.close()
        finally:
            browser.close()
    check('no camera JavaScript or HTTP errors', not errors, errors)
    report = {'status': 'PASS' if all(c['pass'] for c in checks) else 'FAIL', 'checks': checks,
              'scope': 'Actual mouse, keyboard and CDP multi-touch input in installed Chromium/SwiftShader. Mobile viewport emulation; no physical-phone FPS claim.'}
    (OUTPUT / 'camera-report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'status': report['status'], 'checks': len(checks)}), flush=True)
    if report['status'] != 'PASS':
        raise SystemExit(1)


if __name__ == '__main__':
    run()
