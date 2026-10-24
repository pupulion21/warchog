"""Finite browser acceptance for the arcade hub and separate match/training flows."""
from pathlib import Path
import json
import os
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'validation'
URL = os.environ.get('CHOG_QA_URL', 'http://127.0.0.1:5187')
CHROME = os.environ.get('CHOG_QA_CHROMIUM', str(Path.home() / '.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'))


def run():
    checks, errors = [], []
    OUT.mkdir(exist_ok=True)

    def check(name, passed, detail=None):
        checks.append({'name': name, 'pass': bool(passed), 'detail': detail})
        print(('PASS ' if passed else 'FAIL ') + name, flush=True)

    def menu(page):
        return page.evaluate('window.__arena.menuInfo()')

    def snapshot(page):
        return page.evaluate('window.__arena.snapshot()')

    def enter(page, mode):
        page.locator(f'[data-play="{mode}"]').click()
        page.locator('#start').click()

    def home(page):
        page.locator('#game-menu').click()
        page.locator('#pause-home').click()

    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=CHROME, headless=True, args=[
            '--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
            '--ignore-gpu-blocklist', '--disable-dev-shm-usage'])
        try:
            context = browser.new_context(viewport={'width': 1440, 'height': 900})
            try:
                page = context.new_page()
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.on('response', lambda r: errors.append(f'HTTP {r.status} {r.url}') if r.status >= 400 else None)
                page.goto(URL + '/?qa', wait_until='networkidle', timeout=60000)
                page.wait_for_function('window.__arena?.ready', timeout=45000)
                page.evaluate('window.__arena.manual(false)')
                check('fresh entry opens arcade hub with two working mode choices',
                      menu(page)['screen'] == 'home' and page.locator('[data-play]').count() == 2)
                check('home shows all 12 base fighters and its live 3D stage', page.locator('#hub-crew img').count() == 12 and
                      page.locator('#home-stage #arena').is_visible())
                tick = snapshot(page)['tick']
                page.keyboard.press('u'); page.keyboard.press('r'); page.wait_for_timeout(400)
                check('home blocks combat keys and idle simulation', snapshot(page)['tick'] == tick and not menu(page)['started'])
                check('arena controls cannot receive focus beneath the home screen',
                      page.locator('.game-ui').evaluate('(e)=>e.inert') and page.locator('.topbar').count()==0)
                page.screenshot(path=str(OUT / 'menu-home-desktop.png'))
                page.locator('#menu-help').click()
                check('home exposes an accessible how-to-play dialog', page.locator('#help-dialog').is_visible() and page.locator('#help-title').inner_text() == 'MAKE YOUR MOVE.')
                page.keyboard.press('Escape')
                check('Escape closes help and returns to the hub', not page.locator('#help-dialog').is_visible() and menu(page)['screen'] == 'home')
                page.locator('[data-play="versus"]').focus(); page.keyboard.press('Enter')
                check('keyboard can choose VS Computer and reveal fighter/stage setup', menu(page)['screen'] == 'setup' and page.locator('#setup-rules').inner_text() == 'CPU RIVAL · ONE BOUT · K.O. WINS')
                page.locator('[data-pick-seat="0"]').click(); page.locator('[data-fighter="benja"]').click();page.wait_for_function('window.__arena.rosterInfo().preview.id==="benja"&&window.__arena.rosterInfo().preview.ready');page.locator('#roster-confirm').click()
                page.wait_for_function('!window.__arena.rosterInfo().busy')
                page.locator('[data-pick-seat="1"]').click(); page.locator('[data-fighter="toad"]').click();page.wait_for_function('window.__arena.rosterInfo().preview.id==="toad"&&window.__arena.rosterInfo().preview.ready');page.locator('#roster-confirm').click()
                page.wait_for_function('!window.__arena.rosterInfo().busy')
                check('setup loads player and rival separately and updates both cards',
                      page.evaluate('window.__arena.rosterInfo().selected') == ['benja', 'toad'] and page.locator('#setup-player').inner_text() == 'Benja' and page.locator('#setup-rival').inner_text() == 'Toad')
                check('selection returns to setup without starting a match', menu(page)['screen'] == 'setup' and not menu(page)['started'])
                page.screenshot(path=str(OUT / 'menu-setup-desktop.png'))
                page.locator('#start').click()
                page.evaluate('window.__arena.manual(true);window.__arena.advance(.3)')
                check('VS Computer begins with an active CPU and the chosen models', snapshot(page)['mode'] == 'spar' and
                      [a['id'] for a in snapshot(page)['assets']] == ['benja', 'toad'])
                check('VS Computer hides training statistics, dummy settings, reset and fighter swap',
                      all(not page.locator(s).is_visible() for s in ['.session-card', '.training-tools', '#reset', '#roster-toggle', '.movement-help', '.camera-gesture-hint']))
                check('match keeps health and actions while camera settings stay inside pause', all(page.locator(s).is_visible() for s in ['.fight-hud','#action-attack','#game-menu']) and not page.locator('#camera-mode').is_visible())
                page.screenshot(path=str(OUT / 'menu-versus-desktop.png'))
                page.evaluate('window.__arena.advance(5)')
                check('CPU approaches and damages the player in a real bout', snapshot(page)['actors'][0]['hp'] < 200)
                before = snapshot(page)['actors'][0]['hp']
                page.locator('#arena').focus(); page.keyboard.press('r')
                check('training reset shortcut cannot reset a VS bout', snapshot(page)['actors'][0]['hp'] == before)
                page.evaluate('window.__arena.manual(false)'); page.keyboard.press('Escape')
                tick = snapshot(page)['tick']; page.keyboard.press('u'); page.wait_for_timeout(450)
                check('Escape pauses the CPU and blocks attack input', menu(page)['paused'] and snapshot(page)['tick'] == tick)
                page.screenshot(path=str(OUT / 'menu-pause-desktop.png'))
                page.keyboard.press('Escape'); page.wait_for_function('(tick)=>window.__arena.snapshot().tick>tick', arg=tick)
                check('native Escape resumes the same bout', not menu(page)['paused'] and snapshot(page)['tick'] > tick)
                page.locator('#game-menu').click();page.locator('#game-help').click(); tick = snapshot(page)['tick']; page.wait_for_timeout(400)
                check('in-game help pauses combat too', menu(page)['help'] and snapshot(page)['tick'] == tick)
                page.locator('#help-close').click();page.locator('#resume').click(); page.evaluate('window.__arena.manual(true)')
                page.evaluate('window.__arena.reset();window.__arena.hit(1,500,true);window.__arena.advance(1.4)')
                check('VS result declares a winner and offers rematch and hub', page.locator('#result-title').inner_text() == 'YOU WIN!' and page.locator('#result-home').is_visible())
                page.locator('#result-reset').click()
                check('rematch resets both HP bars and retains CPU mode and models', all(a['hp'] == 200 for a in snapshot(page)['actors']) and snapshot(page)['mode'] == 'spar' and page.evaluate('window.__arena.rosterInfo().selected') == ['benja', 'toad'])
                home(page); enter(page, 'training')
                check('Training starts passive and keeps its tools in pause', snapshot(page)['mode'] == 'idle' and not page.locator('#training-toggle').is_visible() and page.locator('#pause-training #training-toggle').count()==1)
                page.evaluate('window.__arena.advance(4)')
                check('passive training dummy does not attack', snapshot(page)['actors'][0]['hp'] == 200)
                page.locator('#game-menu').click();page.locator('#training-toggle').click(); page.locator('#speed').select_option('0.25'); page.locator('#hitbox-toggle').check(); page.locator('#animation').select_option('getup')
                check('slow motion, hitboxes and animation inspection remain functional in Training', menu(page)['timeScale'] == .25 and menu(page)['showHitboxes'] and menu(page)['inspectClip'] == 'getup')
                page.screenshot(path=str(OUT / 'menu-training-desktop.png'))
                page.keyboard.press('Escape')
                check('Escape resumes training with settings out of the arena', not page.locator('#training-panel').is_visible() and not menu(page)['paused'])
                page.keyboard.press('Escape'); page.locator('#pause-fighters').click()
                check('change fighters returns to the correct mode setup', menu(page)['screen'] == 'setup' and menu(page)['setupMode'] == 'training' and not menu(page)['started'])
                page.locator('#menu-back').click(); enter(page, 'versus')
                check('Training settings never leak into VS Computer', menu(page)['timeScale'] == 1 and not menu(page)['showHitboxes'] and menu(page)['inspectClip'] == '' and snapshot(page)['mode'] == 'spar')
                page.evaluate('window.__arena.reset();window.__arena.hit(0,500,true);window.__arena.advance(1.4)')
                check('defeat names the rival and offers another round', page.locator('#result-title').inner_text() == 'NEXT ROUND?' and 'Toad' in page.locator('#result-text').inner_text())
                page.locator('#result-home').click()
                page.evaluate('window.__arena.manual(false)'); tick = snapshot(page)['tick']; page.wait_for_timeout(350)
                check('result can return to the hub and stops the simulation', menu(page)['screen'] == 'home' and snapshot(page)['tick'] == tick)
            finally:
                context.close()

            for width, height in [(390, 844), (320, 640), (844, 390)]:
                context = browser.new_context(viewport={'width': width, 'height': height}, is_mobile=True, has_touch=True, device_scale_factor=1)
                try:
                    page = context.new_page(); page.on('pageerror', lambda e: errors.append(str(e)))
                    page.goto(URL + '/?qa', wait_until='networkidle', timeout=60000); page.wait_for_function('window.__arena?.ready', timeout=45000)
                    page.screenshot(path=str(OUT / f'menu-home-{width}.png'))
                    if width == 844:
                        check('landscape hub fits both mode buttons above the fold', page.locator('[data-play="training"]').evaluate('(e)=>e.getBoundingClientRect().bottom<=innerHeight'))
                    check(f'{width}px hub stays within width and both modes are touch reachable', page.locator('#front-menu').evaluate('(e)=>e.scrollWidth<=e.clientWidth') and page.locator('[data-play="training"]').is_visible())
                    page.locator('[data-play="training"]').tap()
                    page.screenshot(path=str(OUT / f'menu-setup-{width}.png'))
                    if width == 844:
                        check('landscape setup fits the enter button above the fold', page.locator('#start').evaluate('(e)=>e.getBoundingClientRect().bottom<=innerHeight'))
                    page.locator('[data-pick-seat="0"]').tap(); page.locator('[data-fighter="ping"]').tap();page.wait_for_function('window.__arena.rosterInfo().preview.id==="ping"&&window.__arena.rosterInfo().preview.ready');page.locator('#roster-confirm').click(); page.wait_for_function('!window.__arena.rosterInfo().busy')
                    check(f'{width}px touch fighter selection returns to the setup card', page.locator('#setup-player').inner_text() == 'PingPingPingPing' and not page.locator('#fighter-dialog').is_visible())
                    page.locator('#start').tap(); page.locator('#game-menu').tap(); page.locator('#pause-home').tap()
                    check(f'{width}px can enter training and navigate back without scroll or modal trapping', menu(page)['screen'] == 'home' and page.locator('#front-menu').evaluate('(e)=>e.scrollTop===0') and not menu(page)['paused'])
                finally:
                    context.close()
        finally:
            browser.close()
    check('no JavaScript or HTTP errors in arcade flows', not errors, errors)
    report = {'status': 'PASS' if all(c['pass'] for c in checks) else 'FAIL', 'checks': checks,
              'scope': 'Installed Chromium, software rendering; desktop and mobile touch/viewport emulation. No physical-device performance claim.'}
    (OUT / 'menu-report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'status': report['status'], 'checks': len(checks)}), flush=True)
    if report['status'] != 'PASS':
        raise SystemExit(1)


if __name__ == '__main__':
    run()
