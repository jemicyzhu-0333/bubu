import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { Script } from 'node:vm';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dist=path.join(root,'dist');
const html=fs.readFileSync(path.join(dist,'index.html'),'utf8');
const page=new URL('https://example.invalid/im-adhder/');
for(const filename of ['app.js','assets/gsap.min.js','assets/ScrollTrigger.min.js']){
 new Script(fs.readFileSync(path.join(dist,filename),'utf8'),{filename});
}
for(const match of html.matchAll(/(?:src|href)="([^"]+)"/g)){
 const value=match[1];
 if(/^(?:https?:|#|data:)/.test(value))continue;
 assert(!value.startsWith('/'),'Local asset must be relative to the project base.');
 assert(fs.existsSync(path.join(dist,value)),`Missing local file: ${value}`);
 assert(new URL(value,page).pathname.startsWith('/im-adhder/'),'Project-base resolution failed.');
}
for(const tag of html.matchAll(/<(?:script|link|img)\b[^>]*>/g)){
 assert(!/(?:src|href)="https?:/.test(tag[0]),'Runtime resources must be self-hosted.');
}
const downloads={
  "windows": "https://github.com/jemicyzhu-0333/im-adhder/releases/download/v0.0.1-dev-r2/I.m.ADHDer.Setup.0.0.1-dev.exe",
  "mac": "https://github.com/jemicyzhu-0333/im-adhder/releases/download/v0.0.1-dev-r2/I.m.ADHDer-0.0.1-dev-mac-arm64-adhoc-test.dmg"
};
for(const platform of ['windows','mac']){
 const tag=[...html.matchAll(/<a\b[^>]*>/g)].map(m=>m[0]).find(t=>t.includes(`data-platform="${platform}"`));
 assert(tag,`Missing ${platform} download`);
 const url=tag.match(/href="([^"]+)"/)?.[1];
 assert.equal(url,downloads[platform],`Unexpected ${platform} release link`);
}
assert(html.includes('id="mac-warning"'),'Mac restricted-test warning must remain.');
assert(html.includes('Gatekeeper currently blocks normal installation.'),'Missing Gatekeeper limitation');
assert(html.includes('Ad-hoc signed, not notarized'),'Missing Mac signing disclosure');
assert(html.includes('Unsigned; Windows may show SmartScreen warnings.'),'Missing Windows signing disclosure');
assert(html.includes('https://github.com/jemicyzhu-0333/im-adhder/releases/tag/v0.0.1-dev-r2'),'Missing current release notes');
assert(html.includes('https://github.com/jemicyzhu-0333/im-adhder/releases/download/v0.0.1-dev-r2/SHA256SUMS.downloads.txt'),'Missing current checksums');
assert(!html.includes('/v0.0.1-dev/'),'Outdated download link');
assert(!/libfile_|appgprj_|appgver_|sediment:|workspace\/scratch/.test(html),'Internal authoring identity in public page');
assert(!/0\.4\.0|TODO|placeholder/.test(html),'Stale release or placeholder text');
console.log('PASS: script syntax, assets, project base, local-only runtime, fixed downloads and Mac caution.');
