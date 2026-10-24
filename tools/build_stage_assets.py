"""Finite offline reference extraction for the Metropolis arena reconstructions."""
from pathlib import Path
from PIL import Image
import json,hashlib,shutil
ROOT=Path(__file__).resolve().parent.parent
SOURCE=Path('/home/haikaru/Archverse/Lab/Hackathon/Metropolis/game/chog-clash/assets/chog')
CROPS={
 'rayj-house':{'poster':(975,29,1101,220),'drawing':(111,95,203,182),'sunset':(481,60,790,207)},
 'house-cup':{'banner':(76,0,211,290)},
 'neon-street':{'store-sign':(13,89,366,235),'noodle-sign':(1158,232,1280,302),'billboard':(519,122,601,308)},
 'cwo-rally':{'led-wall':(436,177,845,390),'banner':(251,141,352,321)},
}
records=[]
for id in ['rayj-house','cwo-alley','house-cup','neon-street','cwo-rally']:
 out=ROOT/'public/assets/stages'/id;out.mkdir(parents=True,exist_ok=True)
 archive=ROOT/'assets-source/stages'/id;archive.mkdir(parents=True,exist_ok=True)
 source=SOURCE/'arenas'/f'{id}.webp';shutil.copy2(source,archive/'reference.webp')
 # A later browser capture replaces preview.webp with the actual reconstructed scene.
 if not (out/'preview.webp').exists():shutil.copy2(source,out/'preview.webp')
 shutil.copy2(SOURCE/'audio'/f'ambience-{id}.mp3',out/'ambience.mp3')
 textures=[]
 with Image.open(source) as image:
  for name,box in CROPS.get(id,{}).items():
   crop=image.crop(box);crop.thumbnail((512,512));crop.convert('RGB').save(out/f'{name}.webp',quality=90)
   textures.append({'file':f'{name}.webp','crop':box,'bytes':(out/f'{name}.webp').stat().st_size})
 rec={'id':id,'source':str(source),'referenceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'method':'Authored 3D architecture and props, with small reference-art sign/poster crops. Original synthesized ambience is reused.','newGeneration':False,'meshyCredits':0,'textures':textures,'ambience':{'source':str(SOURCE/'audio'/f'ambience-{id}.mp3'),'file':'ambience.mp3','sha256':hashlib.sha256((out/'ambience.mp3').read_bytes()).hexdigest(),'bytes':(out/'ambience.mp3').stat().st_size}}
 (archive/'provenance.json').write_text(json.dumps(rec,indent=2)+'\n');records.append(rec)
(ROOT/'public/assets/stages/provenance.json').write_text(json.dumps(records,indent=2)+'\n')
print('Prepared five references, nine small reference crops and five ambience files offline.')
