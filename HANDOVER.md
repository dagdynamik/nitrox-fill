# Handover: Nitrox Fill Planner (PWA)

## What this is
A nitrox gas-blending calculator for a non-profit diving club's fill station (internal use, not commercial). It plans fills that use pure O₂ partial-pressure blending, topped up either with air or with nitrox from a continuous blender on the compressor. It takes into account the gas already in the cylinder.

Owner: Dag. Code and hosting: GitHub repo `dagdynamik/nitrox-fill`, served by GitHub Pages at https://dagdynamik.github.io/nitrox-fill/.

## Current state
- Plain static PWA, no framework. The app lives in `site/`.
- Deployed to GitHub Pages by the Release workflow when a `v*` tag is pushed (see README).
- A preview version also exists as a Claude artifact: https://claude.ai/artifact/9du2pya7gxtGZCbAHjKxvK

## Files
| File | Purpose |
|---|---|
| `site/index.html` | The whole app: HTML, CSS, JS inline. Fonts loaded locally via `@font-face`. |
| `site/manifest.webmanifest` | PWA manifest (name, colours, icons, standalone display). |
| `site/sw.js` | Service worker. Caches all files for offline use. Network-first for the page, cache-first for assets. |
| `site/fonts/` | Barlow + Barlow Condensed (latin woff2, from @fontsource). |
| `site/icons/` | 192, 512, maskable 512 and apple-touch icons (cylinder with nitrox band). |
| `scripts/` | `check.mjs` (static PWA checks) and `build.mjs` (stamps the release version). |
| `test/` | Unit tests for `plan()`, run against the code in `site/index.html`. |

The service worker's `VERSION` is stamped from the release tag by `scripts/build.mjs`, so it no longer needs a manual bump. **New files under `site/` must be added to `FILES` in `sw.js`** (CI checks this), otherwise they are not available offline.

## Deploy
Push a tag: `git tag v1.1.0 && git push origin v1.1.0`. The Release workflow checks, tests, builds, deploys to Pages and creates a GitHub Release. GitHub Pages was chosen over Netlify: free, no extra account, and the repo and hosting live in one place.

## How the calculation works (`plan()` in index.html)
Ideal gas, bar, fractions. Air = 20.9 % O₂, O₂ = 100 %.

Inputs: start pressure `Ps` and O₂ fraction `Fs`; target `Pt`, `Ft`; max top-gas fraction `Fmax` (40 % with continuous blending, 20.9 % without).

1. If `Ps > Pt`, bleed to `Pt` first.
2. Needed top-gas fraction with no O₂: `need = (Pt·Ft − Ps·Fs) / (Pt − Ps)`.
3. If `20.9 % ≤ need ≤ Fmax`: no O₂. Top with nitrox at `need` (set the blender to that %).
4. If `need > Fmax`: add O₂ `x = (Pt·Ft − Ps·Fs − (Pt−Ps)·Fmax) / (1 − Fmax)`, then top with `Fmax`.
   If `Ps + x > Pt`, bleed to `Pb = Pt·(1 − Ft)/(1 − Fs)` and fill with O₂ only.
5. If `need < 20.9 %` (leftover gas too rich): bleed to `Pb = Pt·(Ft − 0.209)/(Fs − 0.209)`, top with air.

Also shown: final mix check, MOD at ppO₂ 1.4 and 1.6, O₂ bank pressure warning (bank must exceed the gauge reading after the O₂ step), and a comparison of O₂ used with an air top vs a continuous top.

Example: 50 bar of 32 % → 200 bar of 50 %. With a 40 % top: 40 bar O₂ then 110 bar of 40 %. With an air top: about 67 bar O₂.

## Safety notes kept in the UI
- Ideal gas law only. Real fills land slightly off at high pressure: cool, top up, always analyse.
- Pure O₂ needs an O₂-clean cylinder and valve.
- Warns if the continuous max is set above 40 % (typical intake limit).

## Ideas not yet built
- psi as an alternative unit.
- Cascading from several O₂ banks (track pressure per bank).
- Real-gas (compressibility) correction.
- Fill log per cylinder.
