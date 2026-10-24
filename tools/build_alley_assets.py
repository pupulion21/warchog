"""Build small runtime textures from the existing Metropolis CWO Alley artwork.

Offline and deterministic. No generation service, credentials, or credit use.
The painting is used as a mural decal, not as the arena's geometry.
"""
from pathlib import Path
import hashlib
import json
import random
import shutil

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'assets-source/alley/reference.png'
ORIGINAL = ROOT.parent / 'Hackathon/Metropolis/game/chog-clash/assets/chog/source-art/cwo-alley.png'
OUT = ROOT / 'public/assets/alley'
rng = random.Random(268)


def save(image, name):
    path = OUT / name
    image.save(path, quality=90, method=6)
    return {'file': '/assets/alley/' + name, 'bytes': path.stat().st_size,
            'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}


def grain(image, strength=3):
    data = np.array(image).astype(np.int16)
    noise = np.random.default_rng(23).normal(0, strength, (*data.shape[:2], 1))
    return Image.fromarray(np.clip(data + noise, 0, 255).astype(np.uint8))


def build():
    OUT.mkdir(parents=True, exist_ok=True)
    SOURCE.parent.mkdir(parents=True, exist_ok=True)
    if not SOURCE.exists():
        shutil.copyfile(ORIGINAL, SOURCE)
    reference = Image.open(SOURCE).convert('RGB')
    records = []

    # Feathered irregular paint edge leaves the surrounding 3D brick visible.
    mural = reference.crop((440, 211, 1380, 607)).convert('RGBA')
    mask = Image.new('L', mural.size)
    d = ImageDraw.Draw(mask)
    d.polygon([(8, 118), (87, 53), (258, 50), (371, 7), (451, 44),
               (541, 4), (701, 14), (865, 31), (921, 107), (890, 205),
               (869, 267), (785, 348), (681, 379), (501, 378),
               (349, 389), (143, 378), (13, 354)], fill=255)
    # Exclude the source's painted rubbish bag; the mural contains only wall paint.
    d.polygon([(800, 283), (940, 255), (940, 396), (775, 396), (790, 334)], fill=0)
    mural.putalpha(mask.filter(ImageFilter.GaussianBlur(7)))
    records.append(save(mural, 'mural.webp'))

    # Hand-varied brick courses. The texture repeats at brick boundaries.
    brick = Image.new('RGB', (1024, 512), '#9b7a70')
    d = ImageDraw.Draw(brick)
    colors = ['#bb7760', '#b96c54', '#c78064', '#d38c6a', '#b87c69', '#c18a74', '#a96a58']
    for row in range(8):
        for column in range(-1, 9):
            x, y = column * 128 + (64 if row % 2 else 0), row * 64
            c = rng.choice(colors)
            d.rounded_rectangle((x + 3, y + 3, x + 125, y + 61), radius=4, fill=c)
            d.line((x + 9, y + 7, x + 118, y + 7), fill='#dba080', width=2)
            d.line((x + 9, y + 58, x + 120, y + 58), fill='#985e53', width=2)
            for _ in range(7):
                bx, by = x + rng.randrange(10, 118), y + rng.randrange(12, 52)
                d.line((bx, by, bx + rng.randrange(3, 13), by - 1), fill=rng.choice(['#c98d71', '#a96b58']), width=1)
    records.append(save(grain(brick), 'brick.webp'))

    pavement = Image.new('RGB', (1024, 1024), '#a497a5')
    d = ImageDraw.Draw(pavement)
    for _ in range(175):
        x, y = rng.randrange(1024), rng.randrange(1024)
        radius = rng.randrange(8, 74)
        points = [(x + np.cos(i / 7 * np.pi * 2) * radius * rng.uniform(.5, 1),
                   y + np.sin(i / 7 * np.pi * 2) * radius * rng.uniform(.25, .7)) for i in range(7)]
        d.polygon(points, fill=rng.choice(['#a99aa8', '#9d909f', '#b2a0aa', '#978c9c', '#ac9ea9']))
    for row in range(4):
        y = row * 256
        d.line((0, y + 2, 1024, y + 2), fill='#807585', width=3)
        d.line((0, y + 6, 1024, y + 6), fill='#bbaeb4', width=2)
        for column in range(-1, 3):
            x = column * 512 + (256 if row % 2 else 0)
            d.line((x, y, x + 12, y + 256), fill='#837786', width=3)
            d.line((x + 5, y, x + 17, y + 255), fill='#b4a5af', width=1)
    for _ in range(16):
        x, y = rng.randrange(70, 950), rng.randrange(70, 950)
        points = [(x, y)]
        for step in range(4):
            x += rng.randrange(-18, 19)
            y += rng.randrange(8, 21)
            points.append((x, y))
        d.line(points, fill='#857a89', width=2)
    records.append(save(grain(pavement, 2.5), 'pavement.webp'))

    # Small original wall posters, retained from the same source painting.
    for name, crop in [('skull', (444, 234, 499, 303)), ('crown', (1440, 270, 1532, 365)),
                       ('doodle', (1366, 321, 1437, 411))]:
        poster = reference.crop(crop).resize((128, 160), Image.Resampling.LANCZOS)
        records.append(save(poster, name + '.webp'))

    manifest = {
        'id': 'cwo-alley', 'name': 'CWO Alley',
        'reference': 'Metropolis/game/chog-clash/assets/chog/source-art/cwo-alley.png',
        'referenceSha256': hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
        'method': 'Offline mural/poster extraction and procedural tiling surfaces; arena and props are authored 3D geometry.',
        'creditsConsumed': 0, 'textures': records,
    }
    (OUT / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps({'textures': len(records), 'runtimeTextureBytes': sum(r['bytes'] for r in records),
                      'referenceSha256': manifest['referenceSha256']}))


if __name__ == '__main__':
    build()
