"""Publish the local roster catalog and small portraits; no remote calls."""
from pathlib import Path
from PIL import Image
import json

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT.parent / 'Hackathon/Metropolis/game/chog-clash/assets/chog/reference'


def build():
    config = json.loads((ROOT / 'assets-source/roster.json').read_text())
    out = ROOT / 'public/assets/portraits'
    out.mkdir(parents=True, exist_ok=True)
    roster = []
    for c in config:
        portrait = out / (c['id'] + '.webp')
        if not portrait.exists():
            image = Image.open(SOURCE / (c['id'] + '.png')).convert('RGBA')
            image.thumbnail((192, 224), Image.Resampling.LANCZOS)
            image.save(portrait, quality=88, method=6)
        manifest_path = ROOT / 'public/assets' / c['id'] / 'manifest.json'
        ready = manifest_path.exists()
        if ready:
            manifest = json.loads(manifest_path.read_text())
            ready = (ROOT / 'public' / manifest['model'].lstrip('/')).exists()
            manifest.update({'id': c['id'], 'characterId': c['id'], 'name': c['name'],
                             'form': 'base', 'prop': c['prop'], 'height': c['height']})
            manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
        roster.append({k: c[k] for k in ['id', 'name', 'role', 'color', 'prop', 'height']} | {
            'characterId': c['id'], 'form': 'base', 'ready': ready,
            'manifest': f'/assets/{c["id"]}/manifest.json',
            'portrait': f'/assets/portraits/{c["id"]}.webp',
        })
        if c['id'] == 'mamio':
            empowered = dict(roster[-1], id='mamio-empowered', name='Mamio · Awakened',
                             form='empowered', color='#edca64',
                             manifest='/assets/mamio/empowered.json')
            roster.append(empowered)
            if ready:
                variant = dict(manifest, id='mamio-empowered', name=empowered['name'], form='empowered',
                               appearance='golden', derivedFrom='mamio')
                variant['notes'] = manifest['notes'] + ['Awakened appearance shares Mamio body, skin and clips; golden costume tint and mount/aura are applied by the client.']
                (manifest_path.parent / 'empowered.json').write_text(json.dumps(variant, indent=2) + '\n')
    data = {'version': 1, 'fighters': 12, 'forms': 13, 'entries': roster}
    (ROOT / 'public/assets/roster.json').write_text(json.dumps(data, indent=2) + '\n')
    print(json.dumps({'readyForms': sum(c['ready'] for c in roster), 'totalForms': len(roster)}))


if __name__ == '__main__':
    build()
