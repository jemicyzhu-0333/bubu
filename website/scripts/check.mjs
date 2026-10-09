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
assert.equal(version, '0.0.2-dev.1');
for(const platform of ['windows','mac']){
 const tag=[...html.matchAll(/<a\b[^>]*>/g)].map(m=>m[0]).find(t=>t.includes(`data-platform="${platform}"`));
 assert(tag,`Missing ${platform} release status`);
 assert(tag.includes('data-release-state="pending"') && tag.includes('aria-disabled="true"'), 'Unpublished candidate must stay pending');
 assert(!tag.includes('href='), 'Pending installer must not have a guessed download URL');
}
assert(html.includes('id="mac-warning"'),'Mac restricted-test warning must remain.');
assert(html.includes('without notarization') && html.includes('not passed distribution acceptance'),'Missing Mac distribution limitation');
assert(html.includes('Unsigned; Windows may show SmartScreen warnings.'),'Missing Windows signing disclosure');
assert(html.includes('https://github.com/jemicyzhu-0333/bubu/releases'),'Missing verified release listing');
assert(!html.includes('/releases/download/'),'Do not publish new or superseded primary installer URLs before release verification');
assert(!/libfile_|appgprj_|appgver_|sediment:|workspace\/scratch/.test(html),'Internal authoring identity in public page');
assert(!/0\.4\.0|TODO|placeholder/.test(html),'Stale release or placeholder text');
assert(html.includes('<title>bubu · 小步 —'),'Missing current bilingual product title');
assert.equal([...html.matchAll(/class="poster-brand"/g)].length,5,'Each supplied poster needs a live bubu header');
assert.equal([...html.matchAll(/class="art-frame"/g)].length,5,'Each supplied poster needs former-name header framing');
assert(html.includes('Candidate source: 0.0.2-dev.1.'),'Current source version must be disclosed');
assert(!html.includes('/v0.0.1-dev-r3/')&&!html.includes('r3 pre-rename test build'),'Outdated primary download revision');
assert(!html.includes('github.io/im-adhder/')&&!html.includes('github.com/jemicyzhu-0333/im-adhder'),'Public links must use the renamed repository');
const css=fs.readFileSync(path.join(dist,'style.css'),'utf8');
assert(css.includes('aspect-ratio:1086/1348')&&css.includes('translateY(-6.9060773481%)'),'Retain exact top-header framing without editing supplied artwork');
// ScrollTrigger can restore an inline smooth-scroll style when its animations revert.
assert(css.includes('@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto!important}}'),'System reduced motion must override inline smooth scrolling');
assert(css.includes('html[data-reduced-motion="true"]{scroll-behavior:auto!important}'),'Manual reduced motion must override inline smooth scrolling');
const app=fs.readFileSync(path.join(dist,'app.js'),'utf8');
assert(app.includes("window.matchMedia('(prefers-reduced-motion: reduce)')")&&app.includes('media.revert()'),'Retain GSAP reduced-motion handling');
console.log('PASS: script syntax, assets, /bubu/ project base, current brand, poster framing, local-only runtime, pending 0.0.2-dev.1 downloads and truthful platform cautions.');
