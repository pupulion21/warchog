"""Write the sanitized production ledger, import guide and a portable body-GLB bundle."""
from pathlib import Path
from datetime import datetime, timezone
import csv
import json
import zipfile

ROOT=Path(__file__).resolve().parent.parent


def data(path):return json.loads((ROOT/path).read_text())


def run():
    state=data('.local/roster/production.json')
    before=data('.local/roster/balance-before.json')['structuredContent']
    after=data('.local/roster/balance-after.json')['structuredContent']
    catalog=data('public/assets/roster.json')
    validation=data('validation/roster-assets.json')
    config=data('assets-source/roster.json')
    costs={name:sum(t.get('credits',0) for t in record['tasks'].values()) for name,record in state['characters'].items()}
    assert all(t.get('downloaded') and t['status']=='SUCCEEDED' for r in state['characters'].values() for t in r['tasks'].values())
    assert sum(costs.values())==before['balance']-after['balance']==910
    records=[]
    for c in config:
        provenance=data(f'assets-source/{c["id"]}/provenance.json')
        records.append({'id':c['id'],'character':c['name'],'batchCredits':costs.get(c['id'],0),
                        'totalCharacterCredits':provenance['total_credits'],'tasks':provenance['tasks']})
    report={'finishedAt':datetime.now(timezone.utc).isoformat(),'provider':'Meshy official MCP 0.6.5 via the existing local OpenCode credential',
            'fighters':12,'forms':13,'newBodies':11,'totalBodyModels':12,'newBatchCredits':sum(costs.values()),
            'earlierYotCredits':80,'balanceBefore':before['balance'],'balanceAfter':after['balance'],
            'monthlyCreditsAfter':after['monthly_credits'],'permanentCreditsAfter':after['permanent_credits'],
            'corrections':[{'character':'mamio','extraCredits':30,'reason':'The first reference was a turn-around sheet and produced multiple bodies. The corrected model used one cropped front view. Rejected output retained under assets-source/mamio.'}],
            'awakenedMamio':'A selectable appearance using the same Mamio body/rig/clips, with a warmer tint, golden mount and aura; no extra generation credits.',
            'animationScope':'14 Meshy source clips per body. Prototype shared test moves; character-specific kits are subsequent work.',
            'propScope':'Rigid handheld props and the procedural toy-horse mount are authored in src/props.ts and remain separate from body GLBs.',
            'characters':records,'secrets':'API credentials and signed download URLs excluded.'}
    (ROOT/'assets-source/roster-provenance.json').write_text(json.dumps(report,indent=2)+'\n')
    with (ROOT/'assets-source/ROSTER_STATUS.csv').open('w',newline='') as f:
        writer=csv.writer(f);writer.writerow(['id','character','form','model','joints','clips','triangles','bytes','new_batch_credits'])
        for entry,model in zip(catalog['entries'],validation['models']):
            writer.writerow([entry['id'],entry['name'],entry['form'],model['model'],model['joints'],len(model['clips']),model['triangles'],model['bytes'],costs.get(entry['id'],0)])
    lines=['# CHOG Clash 3D roster','',
           '12 independently generated, skinned body GLBs; 13 selectable appearances including Mamio Awakened. Each body embeds 24 joints, a 1024px base-color map and 14 animation clips. No Meshy key is needed to import or play these files.','',
           'The body files are ready to import as glTF 2.0. World XZ movement is removed from clips; gameplay owns root motion. Mamio Awakened shares the base body file and applies its appearance in the game.','',
           '**Props:** handheld items and the animated toy-horse mount are separate runtime geometry authored in `src/props.ts`. They are not baked into the body GLBs. The mount gait is procedural. Final weapon grips, mounted motion and per-character combat animation remain production polish.','',
           '**Moves:** the sandbox uses a shared test combo, projectile and slam. The distinct Metropolis skill kits are not implemented by selecting a model.','',
           '| Fighter | Body GLB | Joints | Source clips | Size |','|---|---|---:|---:|---:|']
    for c in config:
        m=next(m for m in validation['models'] if m['id']==c['id'])
        lines.append(f'| {c["name"]} | [Download](../public{m["model"]}) | {m["joints"]} | {len(m["clips"])} | {m["bytes"]/1_000_000:.2f} MB |')
    lines.extend(['',f'Unique body files total {validation["totalUniqueModelBytes"]/1_000_000:.2f} MB. The browser loads selected bodies on demand and retains at most three source containers.','',
                  'The new batch consumed **910 credits** (including one 30-credit Mamio correction); verified remaining balance **360 credits**. The earlier Yot pilot used 80 credits. See `roster-provenance.json` and `ROSTER_STATUS.csv` for current evidence.','',
                  'All 13 manifests passed glTF validation with zero errors. An inherited skinned-mesh hierarchy warning is retained in the validation report. Actual imports, clip bindings, selection, mobile touch and repeated resource cleanup were exercised in Chromium; physical-device FPS and final animation art direction are not certified.',''])
    (ROOT/'assets-source/ROSTER_ASSETS.md').write_text('\n'.join(lines))
    out=ROOT/'exports';out.mkdir(exist_ok=True)
    readme='''CHOG Clash — rigged body roster

12 body GLBs, with embedded skins, base-color textures and 14 clips each.
Mamio Awakened uses the same base file and a separate appearance manifest.
Character selection and rendered props are available in the accompanying game.

Rigid handheld props and the procedural Mamio mount are not baked into these body
files. Their runtime source is src/props.ts in the project. Shared test moves are
provided; final per-character kits and weapon choreography are separate work.

See ROSTER_ASSETS.md, provenance.json and THIRD_PARTY_NOTICES.md for scope,
production costs and the original CHOG character rights.
'''
    with zipfile.ZipFile(out/'chog-clash-rigged-roster.zip','w',zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
        archive.writestr('README.txt',readme)
        archive.write(ROOT/'THIRD_PARTY_NOTICES.md','THIRD_PARTY_NOTICES.md')
        archive.writestr('ROSTER_ASSETS.md',(ROOT/'assets-source/ROSTER_ASSETS.md').read_text().replace('(../public/assets/','(assets/'))
        archive.write(ROOT/'assets-source/roster-provenance.json','provenance.json')
        archive.write(ROOT/'public/assets/roster.json','assets/roster.json')
        seen=set()
        for entry in catalog['entries']:
            for uri in [entry['manifest'],entry['portrait']]:
                if uri not in seen:archive.write(ROOT/'public'/uri.lstrip('/'),uri.lstrip('/'));seen.add(uri)
            uri=next(m['model'] for m in validation['models'] if m['id']==entry['id'])
            if uri not in seen:archive.write(ROOT/'public'/uri.lstrip('/'),uri.lstrip('/'));seen.add(uri)
    print(json.dumps({'newBatchCredits':910,'balanceAfter':after['balance'],'zipBytes':(out/'chog-clash-rigged-roster.zip').stat().st_size}))


if __name__=='__main__':run()
