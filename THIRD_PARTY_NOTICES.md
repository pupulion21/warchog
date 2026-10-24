# Asset and dependency notices

## CHOG roster

The original Yot reference was supplied through the user's existing Metropolis project:

- Local source: `Metropolis/game/chog-clash/assets/chog/reference/yot.png`
- Original reference URL recorded by that project: https://www.chog.xyz/team/yot.png
- Original reference retained at `public/assets/reference/yot.png`.

CHOG characters remain the property of their respective owners. This sandbox does not assert an additional commercial license or official affiliation. The code license of the earlier game does not grant rights to third-party character artwork.

The neutral Yot pose, generated 3D mesh, rig and motion applications were produced through the user's Meshy account with authorization to create this testing sandbox. Their task provenance is in `assets-source/yot/provenance.json`. Meshy account terms and the underlying character rights continue to apply.

The other 11 character references were copied from the same project's `assets/chog/reference/` folder into `assets-source/<character-id>/reference.png`. Neutral references, meshes, rigs and motion applications were generated through the same Meshy account under the user's instruction to create the full roster. Their individual provenance and the aggregate `assets-source/roster-provenance.json` record task IDs and credits. Mamio Awakened is an authored appearance derived from its base body; the toy-horse mount and rigid handheld props are separately authored runtime geometry. The ZIP export contains the body GLBs and manifests, with these same rights and scope notes.

The interface, sign geometry, reconstructed stage geometry, scene dressing, runtime effects and synthesized foley were authored for this prototype. No third-party audio sample or recorded person's voice is shipped.

## CWO Alley

The reference painting comes from the user's existing `Metropolis/game/chog-clash/assets/chog/source-art/cwo-alley.png`. Its original project records it as generated with the built-in image generation tool. A local copy is retained at `assets-source/alley/reference.png`; the extracted mural and three poster textures retain that artwork. Brick and pavement textures are procedural, and the arena/prop geometry is authored in this project. The source hash and derived texture hashes are recorded in `public/assets/alley/manifest.json`. No new remote image or Meshy generation was used for the stage.

## Arcade menu artwork

`public/assets/menu/city.webp` and `crew.webp` are unchanged copies of `comic-city.webp` and `comic-heroes.webp` from the original Metropolis game's `assets/chog/landing/`. That project's `THIRD_PARTY_NOTICES.md` and `tools/comic-generation.json` record their earlier production with built-in image generation. Those older menu illustrations remain available in the asset folder. The current hub and picker use the generated game bodies rendered live in the authored CWO Alley, with authored podium geometry; the small thumbnails are captures of the actual models. Their capture provenance is in `public/assets/portraits3d/provenance.json`. The original House Cup identity and Bangers heading font remain. No additional generation request or Meshy charge was made for this menu. File hashes and source paths are in `public/assets/menu/provenance.json`.

## Bangers

Bangers Regular was copied with its SIL Open Font License from the same local landing asset directory. The license is at `public/assets/fonts/bangers-OFL.txt`.

## Barlow

The Barlow Regular and Bold font files were reused from the user's existing project. Their SIL Open Font License is included at `public/assets/fonts/barlow-OFL.txt`.

## Runtime libraries

The project uses Babylon.js, the Babylon glTF loader, Rapier, Vite and their dependencies. Package versions are pinned in `package.json` and `package-lock.json`; their upstream licenses remain in the installed package distributions. Research-only citations and references are recorded in `research/`.

The wallet/contract binding uses viem (MIT), and the authoritative Node server uses ws (MIT) and Node's built-in SQLite module. Their dependency licenses remain in the installed distributions. The imported WARCHOG Solidity sources and ABI retain the upstream MIT license in the repository's `LICENSE`; their OpenZeppelin imports retain the upstream notices. No third-party game-server service or hosted database is bundled.

Raw generation responses, task downloads and original source archives under `assets-source/` and `exports/` are retained only in the local authoring workspace. They are excluded from the GitHub repository. The playable runtime assets and available public provenance manifests are included under `public/assets/`.

## Additional Metropolis arenas and ambience

Ray J’s House, House Cup Hall, Neon CWO Street and CWO Rally reuse the user's original `Metropolis/game/chog-clash/assets/chog/arenas/*.webp` paintings as references. The architecture, furniture, trophy, city, canal/bridge, truss/speakers/crowd, podiums, procedural floor textures and runtime light/water motion are authored in this local 3D project. Small posters, signs, banners and LED artwork are extracted from those references. An earlier sunset crop remains in the source assets; the current complete sky domes are authored procedural panoramas with clouds, sun/moon, stars and festival flashes. Source copies and hashes are retained in `assets-source/stages/`; extraction metadata is in `public/assets/stages/provenance.json`. Arena picker thumbnails are actual browser renders of the reconstructed geometry, recorded in `public/assets/stages/preview-provenance.json`.

The five `ambience-<stage>.mp3` recordings are unchanged copies from the same user's original `assets/chog/audio/` directory. That project's notices identify its ambience as locally composed with `tools/build_music.py`, without borrowed samples. No third-party recording, voice clone or newly billed audio generation was added for these maps. Existing CHOG character/artwork ownership and source-project notices continue to apply.

## Complete arena surroundings

The expanded neighborhood terrain, roads, sidewalks, residential/city buildings, roofs, trees, hills, benches, lamps, festival stalls, indoor ceilings, chandelier and sky panoramas are authored runtime geometry and canvas textures in `src/environment.ts`. The facade sign/window/louver/door atlas, cornices, gables and front/rear/side service details are also authored geometry and canvas artwork, with no additional image generation. They introduce no third-party asset download or newly billed generation. Unseen surroundings are interpretations extending the original single-view Metropolis paintings.
