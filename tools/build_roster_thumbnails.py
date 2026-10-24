"""Create small selection thumbnails from verified local renders of the actual GLBs."""
from pathlib import Path
import hashlib,json,shutil
from PIL import Image
ROOT=Path(__file__).resolve().parent.parent
OUT=ROOT/'public/assets/portraits3d'
OUT.mkdir(exist_ok=True)
entries=json.loads((ROOT/'public/assets/roster.json').read_text())['entries']
files=[]
archive=ROOT/'assets-source/portraits3d';archive.mkdir(parents=True,exist_ok=True)
for entry in entries:
    source=ROOT/'validation'/f'showcase-{entry["id"]}.png'
    saved=archive/f'{entry["id"]}.png';shutil.copy2(source,saved);source=saved
    with Image.open(source) as image:
        image.crop((round(image.width*.11),round(image.height*.08),round(image.width*.89),round(image.height*.76))).resize((160,160),Image.Resampling.LANCZOS).convert('RGB').save(OUT/f'{entry["id"]}.webp',quality=86)
    files.append({'id':entry['id'],'source':str(source.relative_to(ROOT)),'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest()})
(OUT/'provenance.json').write_text(json.dumps({'source':'Verified Babylon renders of the rigged game bodies. Live selection uses those GLBs directly.','newGeneration':False,'files':files},indent=2)+'\n')
print('Created',len(files),'rendered 3D thumbnails; no remote generation.')
