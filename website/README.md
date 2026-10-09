# I'm ADHDer website

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

For local inspection, serve `dist/` with an ordinary static HTTP server. HTML asset paths are relative and support the GitHub Pages project base `/im-adhder/`. No custom domain is configured.

## Directory layout

- `public/index.html`: content, real release URLs, and accessibility semantics
- `public/style.css`: responsive styles
- `public/app.js`: GSAP entry and scroll animation; reduced-motion support
- `public/assets/`: original supplied campaign art, app screenshots and icon
- `public/notices.txt`: public asset and license notices
- `scripts/build.mjs`: deterministic static packaging
- `scripts/check.mjs`: syntax, local resources, project-base and release-warning checks
- `package.json`, `package-lock.json`: pinned build dependency
- `../.github/workflows/deploy-website.yml`: GitHub Pages build and deployment

## Publishing

In the repository's Settings → Pages, select **GitHub Actions** as the source. The workflow runs for changes to `website/**`, its own workflow file, or manual dispatch. It builds with read-only repository permission; the deployment job alone gets `pages: write` and `id-token: write` and uses the `github-pages` environment. Restrict that environment to the default branch.

The published URL is the `page_url` returned by GitHub's deployment action. Confirm it after a successful deployment; do not infer success from the expected URL. Corporate access must be checked on the user's own network.

## Downloads and current caution

Links target the verified `v0.0.1-dev` Windows x64 and macOS Apple silicon release assets. They are unsigned test builds; the Mac build is not notarized. The site does not promise in-app updates or successful native installation.

A macOS launch report says the app is damaged. The visible bilingual warning asks visitors to wait before installing that build while it is investigated. Retain the warning until the issue has been resolved and verified. Updating the website does not change the binary or release tag.

## Content and licensing

Campaign images were supplied for the public project site and are presented as illustrations, not actual UI. Three app screenshots show a Chinese-language interface with clean test data captured on Linux; they do not establish Windows/macOS installation verification.

Project code is source-available under PolyForm Noncommercial 1.0.0; see `LICENSE` and the repository's `LICENSE-SCOPE.md`. It is not OSI-approved open source. Artwork and other third-party materials retain their separate rights. GSAP 3.14.2 is covered by its own Standard License: https://gsap.com/standard-license/ . Preserve bundled notices and verify artwork permissions before reuse.

GitHub Pages workflow reference: https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages
