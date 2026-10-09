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

Links target the existing `v0.0.1-dev-r3` Windows x64 and macOS Apple silicon release assets from commit `8b53043`. They predate the bubu rename and still contain the former I'm ADHDer branding and exact historical filenames. Do not invent bubu-named downloads or relabel those binaries. Repository URLs use `/bubu/` after the repository rename; verify the resulting release links before publishing. The app's internal version remains `0.0.1-dev`; r3 identifies this release revision. These are test builds with manual downloads, not a stable release or an in-app update channel. Windows is unsigned and may trigger SmartScreen.

The Mac r3 bundle is ad-hoc signed and not notarized. Its signature integrity and direct-launch checks passed in macOS CI, but Gatekeeper assessment with security policy enabled still rejects it. Keep the prominent bilingual restricted-test warning: direct launch validation does not establish normal downloaded-app installation. The original release is retained as history; its damaged-app report does not establish the status of r3.

## Content and licensing

The supplied campaign JPEGs embed the former I'm ADHDer name in their top 100 pixels. The active page keeps these original files byte-identical and frames that header out with CSS, adding live bubu / 小步 text above the preserved artwork. The illustration and campaign copy remain visible. These are illustrations, not app UI; do not present them as recaptured or redrawn assets. Three app screenshots show a Chinese-language interface with clean test data captured on Linux before the rename; they remain unedited and do not establish Windows/macOS installation verification.

Project code is source-available under PolyForm Noncommercial 1.0.0; see `LICENSE` and the repository's `LICENSE-SCOPE.md`. It is not OSI-approved open source. Artwork and other third-party materials retain their separate rights. GSAP 3.14.2 is covered by its own Standard License: https://gsap.com/standard-license/ . Preserve bundled notices and verify artwork permissions before reuse.

GitHub Pages workflow reference: https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages
