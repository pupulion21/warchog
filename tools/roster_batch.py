"""Run a bounded production polling batch, closing each finite MCP connection.

No service, scheduler, login hook or persistent server is installed. Visual review
markers are supplied separately by the operator after viewing downloaded assets.
"""
from pathlib import Path
import argparse
import json
import os
import signal
import subprocess
import time

ROOT=Path(__file__).resolve().parent.parent


def command(args, timeout=190):
    process=subprocess.Popen(args,cwd=ROOT,start_new_session=True)
    try:
        return process.wait(timeout=timeout)
    except BaseException:
        os.killpg(process.pid,signal.SIGTERM)
        process.wait(timeout=10)
        raise


def run(minutes):
    end=time.monotonic()+minutes*60
    while time.monotonic()<end:
        if command(['node','tools/produce_roster.mjs'])!=0:
            raise SystemExit('Production tick stopped; inspect the saved state before resuming.')
        state=json.loads((ROOT/'.local/roster/production.json').read_text())
        complete=[]
        for character,record in state['characters'].items():
            if not all(record['tasks'].get(stage,{}).get('downloaded') for stage in ['reference','model','rig','motion-a','motion-b']):continue
            complete.append(character)
            if not (ROOT/f'public/assets/{character}/manifest.json').exists():
                if command(['python','tools/build_assets.py','--character',character],180)!=0:
                    raise SystemExit(f'Asset cleanup failed for {character}; raw outputs are retained.')
        if command(['python','tools/build_roster.py'])!=0:raise SystemExit('Catalog update failed.')
        if len(complete)==11:
            print('All 11 new bodies are built.',flush=True)
            return
        if time.monotonic()+20>=end:break
        time.sleep(20)


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--minutes',type=float,default=5)
    args=parser.parse_args()
    if not 0<args.minutes<=10:raise SystemExit('Use a finite batch between 0 and 10 minutes.')
    run(args.minutes)
