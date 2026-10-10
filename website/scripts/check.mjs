import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { Script } from 'node:vm';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dist=path.join(root,'dist');
const html=fs.readFileSync(path.join(dist,'index.html'),'utf8');
const page=new URL('https://example.invalid/bubu/');
for(const filename of ['app.js','assets/gsap.min.js','assets/ScrollTrigger.min.js']){
 new Script(fs.readFileSync(path.join(dist,filename),'utf8'),{filename});
}
for(const match of html.matchAll(/(?:src|href)="([^"]+)"/g)){
 const value=match[1];
 if(/^(?:https?:|#|data:)/.test(value))continue;
 assert(!value.startsWith('/'),'Local asset must be relative to the project base.');
 assert(fs.existsSync(path.join(dist,value)),`Missing local file: ${value}`);
 assert(new URL(value,page).pathname.startsWith('/bubu/'),'Project-base resolution failed.');
}
for(const tag of html.matchAll(/<(?:script|link|img)\b[^>]*>/g)){
 assert(!/(?:src|href)="https?:/.test(tag[0]),'Runtime resources must be self-hosted.');
}
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
assert.equal(version, '0.0.2-dev.3');
const releaseRoot = 'https://github.com/jemicyzhu-0333/bubu/releases';
const releaseTag = 'v0.0.2-dev.3';
const assets = {
 windows: 'bubu-0.0.2-dev.3-win-x64.exe',
 mac: 'bubu-0.0.2-dev.3-mac-arm64-adhoc-test.dmg',
};
const anchors = [...html.matchAll(/<a\b[^>]*>/g)].map(match => match[0]);
const attribute = (tag, name) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
for(const [platform, filename] of Object.entries(assets)){
 const tags=anchors.filter(tag=>attribute(tag, 'data-platform')===platform);
 assert.equal(tags.length, 1, `Require exactly one ${platform} download`);
 const tag=tags[0];
 assert.equal(attribute(tag, 'href'), `${releaseRoot}/download/${releaseTag}/${filename}`, `Incorrect ${platform} verified asset URL`);
 const url=new URL(attribute(tag, 'href'));
 assert.equal(url.protocol, 'https:');
 assert.equal(url.hostname, 'github.com');
 assert.equal(attribute(tag, 'data-release-state'), 'verified');
 assert.equal(attribute(tag, 'data-release-version'), version);
 assert(!/\s(?:aria-disabled|disabled|hidden)(?:=|\s|>)/.test(tag), 'Verified download must not be disabled or hidden');
 assert(!/tabindex="-\d+"/.test(tag), 'Verified download must remain keyboard reachable');
 if(platform==='mac')assert.equal(attribute(tag, 'aria-describedby'), 'mac-warning');
}
for(const [name, expected] of [
 ['data-release-notes', `${releaseRoot}/tag/${releaseTag}`],
 ['data-release-checksums', `${releaseRoot}/download/${releaseTag}/SHA256SUMS.txt`],
]){
 const tags=anchors.filter(tag=>attribute(tag, name)==='current');
 assert.equal(tags.length, 1, `Require exactly one ${name} link`);
 assert.equal(attribute(tags[0], 'href'), expected);
 assert(!/aria-disabled="true"|\sdisabled(?:=|\s|>)/.test(tags[0]), 'Release information must remain available');
}
const downloadUrls=anchors.map(tag=>attribute(tag,'href')).filter(url=>url?.includes('/releases/download/')).sort();
assert.deepEqual(downloadUrls, [...Object.values(assets), 'SHA256SUMS.txt'].map(filename=>`${releaseRoot}/download/${releaseTag}/${filename}`).sort(), 'Only the exact three verified release asset URLs may be published');
assert(!/data-release-state="pending"|aria-disabled="true"|build pending|pending validation|in preparation/.test(html), 'No stale pending download state');
assert(html.includes('id="mac-warning"'),'Mac restricted-test warning must remain.');
for(const caution of [
 'Unsigned; SmartScreen may warn or block installation.',
 'Ad-hoc signed, without Developer ID or notarization.',
 "Gatekeeper's local distribution assessment rejects this build.",
 'browser-download/Finder acceptance was not tested.',
 'Do not disable operating-system security protections or remove quarantine',
 'versions that only support schema18 cannot open schema19.',
 'new, nonexistent directory',
 'does not automatically roll back or switch the live profile.',
 'In-app updates remain unavailable.',
 'The separate testing-updates feature is not included; install and update manually.',
])assert(html.includes(caution), `Missing release limitation: ${caution}`);
for (const previous of ['v0.0.2-dev.2', 'v0.0.2-dev.1']) assert(html.includes(`${releaseRoot}/tag/${previous}`), 'Previous preview evidence must remain linked');
assert(html.includes(`${releaseRoot}/tag/v0.0.1-dev-r4`), 'Historical r4 release must remain linked');
assert(html.includes('Release tag: v0.0.2-dev.3.'), 'Exact published tag must be disclosed');
const releaseNote=html.match(/<div class="release-note">([\s\S]*?)<\/div>/)?.[1];
assert(releaseNote && (releaseNote.match(/<p>/g) || []).length <= 3, 'Keep the download introduction concise');
assert(!/libfile_|appgprj_|appgver_|sediment:|workspace\/scratch/.test(html),'Internal authoring identity in public page');
assert(!/0\.4\.0|TODO|placeholder/.test(html),'Stale release or placeholder text');
assert(html.includes('<title>bubu · 小步 —'),'Missing current bilingual product title');
assert.equal([...html.matchAll(/class="poster-brand"/g)].length,5,'Each supplied poster needs a live bubu header');
assert.equal([...html.matchAll(/class="art-frame"/g)].length,5,'Each supplied poster needs former-name header framing');
assert(html.includes('Testing preview: 0.0.2-dev.3.'),'Current testing version must be disclosed');
assert(!html.includes('/v0.0.1-dev-r3/')&&!html.includes('r3 pre-rename test build'),'Outdated primary download revision');
assert(!html.includes('github.io/im-adhder/')&&!html.includes('github.com/jemicyzhu-0333/im-adhder'),'Public links must use the renamed repository');
const css=fs.readFileSync(path.join(dist,'style.css'),'utf8');
assert(css.includes('aspect-ratio:1086/1348')&&css.includes('translateY(-6.9060773481%)'),'Retain exact top-header framing without editing supplied artwork');
// ScrollTrigger can restore an inline smooth-scroll style when its animations revert.
assert(css.includes('@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto!important}}'),'System reduced motion must override inline smooth scrolling');
assert(css.includes('html[data-reduced-motion="true"]{scroll-behavior:auto!important}'),'Manual reduced motion must override inline smooth scrolling');
const app=fs.readFileSync(path.join(dist,'app.js'),'utf8');
assert(app.includes("window.matchMedia('(prefers-reduced-motion: reduce)')")&&app.includes('media.revert()'),'Retain GSAP reduced-motion handling');
console.log('PASS: script syntax, assets, /bubu/ project base, current brand, poster framing, local-only runtime, verified v0.0.2-dev.3 asset URLs, accessible downloads and truthful release limitations.');
