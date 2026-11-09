# Nitrox Fill Planner (PWA)

Nitrox gas-blending calculator for the club fill station: partial-pressure O₂ blending,
topped up with air or with nitrox from a continuous blender. It accounts for the gas
already in the cylinder.

**Live:** https://dagdynamik.github.io/nitrox-fill/

Static files only, no framework. See [HANDOVER.md](HANDOVER.md) for the math and background.

## Install on a phone
Open the link above, then:
- iPhone (Safari): Share → Add to Home Screen
- Android (Chrome): menu → Install app

After the first visit it works fully offline. New releases are picked up the next time
the app is opened with a connection.

## Layout
| Path | Purpose |
|---|---|
| `site/` | The app as served: `index.html` (HTML, CSS, JS inline), `manifest.webmanifest`, `sw.js`, `fonts/`, `icons/` |
| `scripts/check.mjs` | Static checks: every file is precached by the service worker, manifest is valid, no broken references |
| `scripts/build.mjs` | Copies `site/` to `_site/` and stamps the release version into `sw.js` and the UI |
| `test/` | Unit tests for the fill calculation (`node --test`) |
| `.github/workflows/` | `ci.yml` checks every push and PR; `release.yml` publishes a release |

## Run locally
```bash
node scripts/build.mjs && python3 -m http.server -d _site 8080
```

## Releasing
Merge to `main`, then tag:
```bash
git tag v1.1.0 && git push origin v1.1.0
```
The Release workflow runs the checks and tests, builds the site with the tag as its
version, deploys it to GitHub Pages, and creates a GitHub Release with the site as a zip.
The service worker's cache name comes from the tag, so installed phones update
automatically; there is no manual version bump.

A new file under `site/` must also be added to `FILES` in `site/sw.js`, or CI fails.

### One-time repository setup (required before the first release)
- Settings → Pages → Source: GitHub Actions.
- Settings → Environments → `github-pages` → deployment branches and tags: allow tag
  pattern `v*` (by default it only allows the default branch, which rejects tag deploys).

```bash
gh api -X POST repos/dagdynamik/nitrox-fill/pages -f build_type=workflow
gh api -X PUT repos/dagdynamik/nitrox-fill/environments/github-pages --input - <<<'{"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}'
gh api -X POST repos/dagdynamik/nitrox-fill/environments/github-pages/deployment-branch-policies -f name='main' -f type=branch
gh api -X POST repos/dagdynamik/nitrox-fill/environments/github-pages/deployment-branch-policies -f name='v*' -f type=tag
```
