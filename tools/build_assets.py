"""Merge the owned Meshy motion outputs into one GLB, remove root drift and ground poses.

Only animation accessors are copied from secondary files. The model, skin, texture and
joint hierarchy remain those of the first motion file. No generation/network request.
"""
from __future__ import annotations
from pathlib import Path
from copy import deepcopy
import json
import struct
import hashlib
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
SIZES = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
DTYPES = {5120: '<i1', 5121: '<u1', 5122: '<i2', 5123: '<u2', 5125: '<u4', 5126: '<f4'}


def load(path: Path):
    raw = path.read_bytes()
    assert raw[:4] == b'glTF'
    length = struct.unpack_from('<I', raw, 12)[0]
    return json.loads(raw[20:20 + length]), bytearray(raw[28 + length:])


def align(buffer):
    buffer.extend(b'\0' * (-len(buffer) % 4))


def array(doc, buffer, index):
    a = doc['accessors'][index]
    view = doc['bufferViews'][a['bufferView']]
    dtype = np.dtype(DTYPES[a['componentType']])
    size = SIZES[a['type']]
    offset = view.get('byteOffset', 0) + a.get('byteOffset', 0)
    stride = view.get('byteStride', size * dtype.itemsize)
    result = np.ndarray((a['count'], size), dtype=dtype, buffer=buffer,
                        offset=offset, strides=(stride, dtype.itemsize))
    if a.get('normalized'):
        return result.astype(float) / np.iinfo(dtype).max
    return result


def matrix(translation, rotation, scale):
    x, y, z, w = rotation
    result = np.array([
        [1 - 2*y*y - 2*z*z, 2*x*y - 2*z*w, 2*x*z + 2*y*w, translation[0]],
        [2*x*y + 2*z*w, 1 - 2*x*x - 2*z*z, 2*y*z - 2*x*w, translation[1]],
        [2*x*z - 2*y*w, 2*y*z + 2*x*w, 1 - 2*x*x - 2*y*y, translation[2]],
        [0, 0, 0, 1]], dtype=float)
    result[:3, :3] *= np.asarray(scale)[None, :]
    return result


def build(character='yot'):
    roster = json.loads((ROOT / 'assets-source/roster.json').read_text())
    config = next(c for c in roster if c['id'] == character)
    SOURCE = ROOT / 'assets-source' / character
    OUTPUT = ROOT / 'public/assets' / character
    OUTPUT.mkdir(parents=True, exist_ok=True)
    doc, binary = load(SOURCE / 'motion-a.glb')
    names = {n['name']: i for i, n in enumerate(doc['nodes']) if 'name' in n}
    for filename in ['motion-b.glb', 'run.glb']:
        other, data = load(SOURCE / filename)
        copied_views, copied_accessors = {}, {}

        def copy_accessor(index):
            if index in copied_accessors:
                return copied_accessors[index]
            accessor = deepcopy(other['accessors'][index])
            original_view = accessor['bufferView']
            if original_view not in copied_views:
                view = deepcopy(other['bufferViews'][original_view])
                start = view.get('byteOffset', 0)
                align(binary)
                view['byteOffset'] = len(binary)
                view['buffer'] = 0
                binary.extend(data[start:start + view['byteLength']])
                copied_views[original_view] = len(doc['bufferViews'])
                doc['bufferViews'].append(view)
            accessor['bufferView'] = copied_views[original_view]
            copied_accessors[index] = len(doc['accessors'])
            doc['accessors'].append(accessor)
            return copied_accessors[index]

        for animation in other.get('animations', []):
            new = deepcopy(animation)
            for sampler in new['samplers']:
                sampler['input'] = copy_accessor(sampler['input'])
                sampler['output'] = copy_accessor(sampler['output'])
            for channel in new['channels']:
                source_name = other['nodes'][channel['target']['node']]['name']
                channel['target']['node'] = names[source_name]
            doc['animations'].append(new)

    hips = names['Hips']
    hips_rest = np.array(doc['nodes'][hips]['translation'], dtype=float)
    skin = doc['skins'][0]
    primitive = doc['meshes'][0]['primitives'][0]
    positions = array(doc, binary, primitive['attributes']['POSITION']).astype(float)
    vertices = np.column_stack([positions, np.ones(len(positions))])
    weights = array(doc, binary, primitive['attributes']['WEIGHTS_0']).astype(float)
    joints = array(doc, binary, primitive['attributes']['JOINTS_0']).astype(int)
    inverse_bind = array(doc, binary, skin['inverseBindMatrices']).reshape((-1, 4, 4)).transpose(0, 2, 1).copy()
    parents = {child: i for i, n in enumerate(doc['nodes']) for child in n.get('children', [])}
    height_corrections = {}
    for animation in doc['animations']:
        channels = {}
        for channel in animation['channels']:
            sampler = animation['samplers'][channel['sampler']]
            channels[(channel['target']['node'], channel['target']['path'])] = (
                array(doc, binary, sampler['input']).reshape(-1).copy(),
                array(doc, binary, sampler['output']))
        times, location = channels[(hips, 'translation')]
        # The locomotion collider owns world XZ, regardless of a motion provider's offset.
        location[:, 0] = hips_rest[0]
        location[:, 2] = hips_rest[2]
        if animation['name'] == 'Basic_Jump':
            # Physics owns jump height. Pose joints supply the airborne silhouette.
            location[:, 1] = hips_rest[1]
            continue
        corrections = []
        for frame, time in enumerate(times):
            world_cache = {}

            def sample(node, path, default):
                curve = channels.get((node, path))
                if curve is None:
                    return np.asarray(default)
                t, values = curve
                at = min(int(np.searchsorted(t, time)), len(t) - 1)
                if at == 0 or abs(t[at] - time) < 0.00001:
                    return values[at].astype(float)
                previous = at - 1
                alpha = (time - t[previous]) / max(t[at] - t[previous], 0.00001)
                left, right = values[previous].astype(float), values[at].astype(float)
                if path == 'rotation' and np.dot(left, right) < 0:
                    right = -right
                result = left * (1 - alpha) + right * alpha
                return result / max(np.linalg.norm(result), 1e-9) if path == 'rotation' else result

            def world(node):
                if node in world_cache:
                    return world_cache[node]
                n = doc['nodes'][node]
                local = matrix(sample(node, 'translation', n.get('translation', [0, 0, 0])),
                               sample(node, 'rotation', n.get('rotation', [0, 0, 0, 1])),
                               sample(node, 'scale', n.get('scale', [1, 1, 1])))
                result = world(parents[node]) @ local if node in parents else local
                world_cache[node] = result
                return result

            transforms = np.array([world(joint) @ inverse_bind[i] for i, joint in enumerate(skin['joints'])])
            # Compute actual skinned surface height, not only foot-bone height.
            y = np.zeros(len(vertices))
            for influence in range(joints.shape[1]):
                y += np.einsum('vi,vi->v', transforms[joints[:, influence], 1, :], vertices) * weights[:, influence]
            minimum = float(y.min())
            delta = -minimum + 0.012
            location[frame, 1] += delta / 0.01
            corrections.append(round(delta, 5))
        height_corrections[animation['name']] = {'min_m': min(corrections), 'max_m': max(corrections)}
        # Keep accessor metadata consistent with edited translation data.
        for channel in animation['channels']:
            if channel['target'] == {'node': hips, 'path': 'translation'}:
                acc = doc['accessors'][animation['samplers'][channel['sampler']]['output']]
                acc['min'] = location.min(axis=0).astype(float).tolist()
                acc['max'] = location.max(axis=0).astype(float).tolist()

    # Downsize the embedded base-color map for the browser while retaining the raw 2K source.
    from PIL import Image
    from io import BytesIO
    for image in doc.get('images', []):
        if 'bufferView' not in image:
            continue
        view = doc['bufferViews'][image['bufferView']]
        start = view.get('byteOffset', 0)
        raw = bytes(binary[start:start + view['byteLength']])
        picture = Image.open(BytesIO(raw)).convert('RGB')
        picture.thumbnail((1024, 1024), Image.Resampling.LANCZOS)
        compressed = BytesIO(); picture.save(compressed, format='JPEG', quality=92, optimize=True)
        align(binary); view['byteOffset'] = len(binary); view['byteLength'] = len(compressed.getvalue())
        binary.extend(compressed.getvalue()); image['mimeType'] = 'image/jpeg'

    # Repack referenced views to omit the replaced source texture bytes.
    packed = bytearray()
    for view in doc['bufferViews']:
        align(packed)
        start, count = view.get('byteOffset', 0), view['byteLength']
        view['byteOffset'] = len(packed)
        packed.extend(binary[start:start + count])
    binary = packed; align(binary)
    doc['buffers'] = [{'byteLength': len(binary)}]
    doc['asset']['generator'] = 'Meshy 0.6.5 + CHOG Arena Lab animation merge / root cleanup'
    doc['extras'] = {'character': character, 'source': 'Meshy user-authorized CHOG roster', 'rootMotion': 'in-place-XZ', 'runtimeTextureMax': 1024}
    json_bytes = json.dumps(doc, separators=(',', ':')).encode()
    json_bytes += b' ' * (-len(json_bytes) % 4)
    total = 12 + 8 + len(json_bytes) + 8 + len(binary)
    target = OUTPUT / (character + '.glb')
    target.write_bytes(struct.pack('<4sII', b'glTF', 2, total) + struct.pack('<I4s', len(json_bytes), b'JSON') + json_bytes + struct.pack('<I4s', len(binary), b'BIN\0') + binary)
    clips = {
        'idle': 'Combat_Stance', 'walk_forward': 'Walk_Fight_Forward_inplace',
        'walk_back': 'Walk_Fight_Back_inplace', 'walk_left': 'Walk_Left_with_Gun_inplace',
        'walk_right': 'Walk_Left_with_Gun_inplace', 'run': 'Armature|running|baselayer',
        'attack1': 'Left_Jab_from_Guard', 'attack2': 'Left_Jab_from_Guard', 'attack3': 'Left_Jab_from_Guard',
        'skill': 'Charged_Spell_Cast', 'stomp': 'Charged_Ground_Slam', 'hurt': 'Hit_Reaction',
        'down': 'Knock_Down', 'getup': 'Stand_Up1', 'ko': 'Dead', 'dodge': 'Stand_Dodge',
        'jump': 'Basic_Jump', 'fall': 'Basic_Jump',
    }
    manifest = {'id': character, 'characterId': character, 'name': config['name'], 'form': 'base', 'prop': config['prop'],
                'version': 1, 'model': f'/assets/{character}/{character}.glb', 'height': config['height'],
                'source': f'Meshy generated and rigged from the provided CHOG {config["name"]} reference',
                'clips': clips, 'skeleton': {'joints': len(skin['joints']), 'format': 'glTF2'},
                'notes': ['Independent rig instances for player and rival; shared prototype move set.',
                          'Three combo steps currently share one jab source; timings differ.',
                          'Right strafe uses reversed left-strafe playback.',
                          'Poses grounded from sampled skinned vertex heights; XZ root translation removed.'],
                'sha256': hashlib.sha256(target.read_bytes()).hexdigest()}
    (OUTPUT / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    report = {'model_bytes': target.stat().st_size, 'joint_count': len(skin['joints']),
              'animation_count': len(doc['animations']), 'clip_names': [a['name'] for a in doc['animations']],
              'triangle_count': sum(doc['accessors'][p['indices']]['count'] // 3 for m in doc['meshes'] for p in m['primitives']),
              'ground_corrections': height_corrections, 'sha256': manifest['sha256']}
    (OUTPUT / 'asset-report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({k: v for k, v in report.items() if k != 'ground_corrections'}, indent=2))


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--character', default='yot')
    build(parser.parse_args().character)
