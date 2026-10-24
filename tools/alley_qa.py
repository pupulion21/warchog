"""Finite rendered acceptance for the reconstructed CWO Alley, using installed Chromium."""
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
    OUTPUT.mkdir(exist_ok=True)
    checks, errors = [], []

    def check(name, result, detail=None):
        checks.append({'name': name, 'pass': bool(result), 'detail': detail})
        print(('PASS ' if result else 'FAIL ') + name, flush=True)

    def open_page(browser, width, height, mobile=False):
        context = browser.new_context(viewport={'width': width, 'height': height},
                                      is_mobile=mobile, has_touch=mobile, device_scale_factor=1)
        page = context.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('response', lambda response: errors.append(f'HTTP {response.status} {response.url}') if response.status >= 400 else None)
        page.goto(URL + '/?qa', wait_until='networkidle', timeout=60000)
        page.wait_for_function('window.__arena?.ready', timeout=30000)
        page.locator('[data-play="training"]').click();page.locator('#start').click()
        page.evaluate('window.__arena.advance(0.3)')
        return context, page

    def actors_in_frame(info):
        return all(.035 < a['x'] < .965 and .15 < a['y'] < .86 and 0 < a['depth'] < 1 for a in info['fighters'])

    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=CHROME, headless=True, args=[
            '--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
            '--ignore-gpu-blocklist', '--disable-dev-shm-usage'])
        try:
            context, page = open_page(browser, 1440, 900)
            try:
                info = page.evaluate('window.__arena.stageInfo()')
                check('CWO Alley loads all six textures and identifies the Metropolis source',
                      info['id'] == 'cwo-alley' and info['texturesReady'] and info['reference'] == 'Metropolis CWO Alley')
                check('stage label shows CWO Alley', 'CWO ALLEY' in page.locator('.location').inner_text())
                check('courtyard stays below 100 groups and the complete district below 128', info['venueBatches'] < 100 and info['staticBatches'] < 128, {'venue':info['venueBatches'],'complete':info['staticBatches']})
                check('both fighters fit the initial desktop camera', actors_in_frame(info), info['fighters'])
                page.screenshot(path=str(OUTPUT / 'alley-desktop.png'))

                # Actual keyboard input, inspected in screen coordinates rather than world signs.
                before = info['fighters'][0]['x']
                page.locator('#arena').focus()
                page.keyboard.down('d')
                page.evaluate('window.__arena.advanceControls(0.45)')
                page.keyboard.up('d')
                after = page.evaluate('window.__arena.stageInfo().fighters[0].x')
                check('D moves the player toward screen-right in the right-handed camera', after > before + .03, {'before': before, 'after': after})

                for side, player, rival, yaw in [
                    ('back', [0, 7.1], [0, 5], math.pi),
                    ('left', [8.4, 0], [6.2, 0], -math.pi / 2),
                    ('front', [0, -7.1], [0, -5], 0),
                    ('right', [-8.4, 0], [-6.2, 0], math.pi / 2),
                ]:
                    page.evaluate('''([p,t,yaw]) => {
                      window.__arena.reset();window.__arena.teleport(0,...p);window.__arena.teleport(1,...t);
                      window.__arena.orbit(yaw,.35);window.__arena.advance(0);
                    }''', [player, rival, yaw])
                    page.wait_for_function('(side) => window.__arena.stageInfo().cutaway[side] < .02', arg=side, timeout=12000)
                    info = page.evaluate('window.__arena.stageInfo()')
                    check(f'{side} wall clears the view near the perimeter and both fighters remain framed', actors_in_frame(info), info)
                    page.screenshot(path=str(OUTPUT / f'alley-cutaway-{side}.png'))

                page.evaluate('window.__arena.reset();window.__arena.orbit(-.18,.3);window.__arena.advance(0)')
                page.wait_for_function('window.__arena.stageInfo().cutaway.right > .98', timeout=12000)
                check('wall restores after the camera returns inside the courtyard', page.evaluate('window.__arena.stageInfo().cutaway.right') > .98)
                page.add_style_tag(content='.topbar,.game-ui,.viewport-vignette{display:none!important}')
                page.evaluate('window.__arena.orbit(-.18,.2);window.__arena.advance(0)')
                page.screenshot(path=str(OUTPUT / 'alley-environment.png'))
                page.evaluate('window.__arena.orbit(1.7,.5);window.__arena.advance(0)')
                page.screenshot(path=str(OUTPUT / 'alley-environment-side.png'))
            finally:
                context.close()

            context, page = open_page(browser, 390, 844, True)
            try:
                check('portrait loads the stage and touch controls', page.evaluate('window.__arena.stageInfo().texturesReady') and page.locator('#joystick').is_visible())
                page.screenshot(path=str(OUTPUT / 'alley-mobile-portrait.png'))
                framed = []
                for yaw in [0, math.pi / 2, math.pi, math.pi * 1.5]:
                    page.evaluate('(yaw) => {window.__arena.orbit(yaw,.3);window.__arena.advance(0)}', yaw)
                    info = page.evaluate('window.__arena.stageInfo()')
                    framed.append({'yaw': yaw, 'pass': actors_in_frame(info), 'fighters': info['fighters']})
                check('portrait camera keeps both fighters in view across a full orbit', all(i['pass'] for i in framed), framed)
                page.screenshot(path=str(OUTPUT / 'alley-mobile-orbit.png'))
                page.set_viewport_size({'width': 844, 'height': 390})
                page.evaluate('window.__arena.orbit(-.18,.3);window.__arena.advance(0)')
                page.screenshot(path=str(OUTPUT / 'alley-mobile-landscape.png'))
                check('landscape camera adapts after resize with both fighters in view', actors_in_frame(page.evaluate('window.__arena.stageInfo()')))
                check('mobile layout has no horizontal overflow', page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
            finally:
                context.close()
        finally:
            browser.close()
    check('no map JavaScript or HTTP errors', not errors, errors)
    report = {'status': 'PASS' if all(i['pass'] for i in checks) else 'FAIL', 'checks': checks,
              'scope': 'Headless installed Chromium, SwiftShader, desktop and mobile viewport emulation; no physical-phone FPS claim.'}
    (OUTPUT / 'alley-report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'status': report['status'], 'checks': len(checks)}), flush=True)
    if report['status'] != 'PASS':
        raise SystemExit(1)


if __name__ == '__main__':
    run()
