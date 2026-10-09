# bubu · 小步 website

Static public project showcase. All images, styles and animation scripts are served from the same origin. There is no runtime CDN, analytics service, login, backend, or API key.

## Build

Use Node.js 22.12.0 or newer and npm:

```sh
cd website
npm ci --ignore-scripts
npm run build
npm run check
```

The lockfile pins GSAP 3.14.2 and its integrity hash. The build copies its original minified browser files, including copyright/license headers, into `dist/assets/`. Do not commit `node_modules/` or generated `dist/`.

For local inspection, serve `dist/` with an ordinary static HTTP server. HTML asset paths are relative and support the GitHub Pages project base `/bubu/`. No custom domain is configured.

## Directory layout

- `public/index.html`: content, real release URLs, and accessibility semantics
- `public/style.css`: responsive styles
- `public/app.js`: GSAP entry and scroll animation; reduced-motion support
- `public/assets/`: app screenshots and icon; original supplied campaign art retained unedited for provenance
- `public/notices.txt`: public asset and license notices
- `scripts/build.mjs`: deterministic static packaging
- `scripts/check.mjs`: syntax, local resources, project-base and release-warning checks
- `package.json`, `package-lock.json`: pinned build dependency
- `../.github/workflows/deploy-website.yml`: GitHub Pages build and deployment

## Publishing

In the repository's Settings → Pages, select **GitHub Actions** as the source. The workflow runs for changes to `website/**`, its own workflow file, or manual dispatch. It builds with read-only repository permission; the deployment job alone gets `pages: write` and `id-token: write` and uses the `github-pages` environment. Restrict that environment to the default branch.

The intended project URL after renaming the repository is `https://jemicyzhu-0333.github.io/bubu/`. GitHub Pages project-site URLs do not redirect when a repository is renamed; update every public site link. The published URL is the `page_url` returned by GitHub's deployment action. Confirm it after a successful deployment; do not infer success from the expected URL. Corporate access must be checked on the user's own network.

## Downloads and current caution

The site package and current candidate source are `0.0.2-dev.1`. Both platform cards are explicitly pending and have no download URL until the actual release assets, hashes and native checks exist. The only release links point to the repository release listing and the preserved historical r4 notes. Do not guess future asset URLs or relabel historical binaries.

The candidate contains the Windows first-launch sentinel fix, General language/theme controls and explicitly confirmed bubu18→19 upgrade. Published r4 (`df3242a`, internal version `0.0.1-dev`) remains historical; its Windows first-launch failure is known. Its previous macOS signature/direct-launch results and Gatekeeper rejection are historical evidence, not proof for this candidate. Windows signing and macOS Developer ID/notarization are not claimed. In-app updater feature work remains separate.

After an actual release is verified, update both platform links and this check together with the precise published artifact names/checksums. Until then the release-pending state is intentional, not a broken download.

## Content and licensing

The supplied campaign JPEGs embed the former I'm ADHDer name in their top 100 pixels. The active page keeps these original files byte-identical and frames that header out with CSS, adding live bubu / 小步 text above the preserved artwork. The illustration and campaign copy remain visible. These are illustrations, not app UI; do not present them as recaptured or redrawn assets. Three app screenshots show a Chinese-language interface with clean test data captured on Linux before the rename; they remain unedited and do not establish Windows/macOS installation verification.

Project code is source-available under PolyForm Noncommercial 1.0.0; see `LICENSE` and the repository's `LICENSE-SCOPE.md`. It is not OSI-approved open source. Artwork and other third-party materials retain their separate rights. GSAP 3.14.2 is covered by its own Standard License: https://gsap.com/standard-license/ . Preserve bundled notices and verify artwork permissions before reuse.

GitHub Pages workflow reference: https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages
