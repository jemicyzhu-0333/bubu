import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {readOptions} from './candidate-fixture.mjs';

const cli=readOptions(),scripts=path.dirname(fileURLToPath(import.meta.url));
if(fs.existsSync(cli.out)&&fs.readdirSync(cli.out).length)throw Error('Output must be absent or empty; review data is never silently overwritten.');
fs.mkdirSync(cli.out,{recursive:true});
const ranges=cli.smoke?[[0,0],[128,128],[256,256]]:Array.from({length:9},(_,i)=>[i*32,Math.min(i*32+31,256)]);
function run(command,args,logName){
  const fd=fs.openSync(path.join(cli.out,logName),'w');
  const result=spawnSync(command,args,{stdio:['ignore',fd,fd],encoding:'utf8'});fs.closeSync(fd);
  if(result.error||result.status!==0)throw Error(`${command} failed (${result.status??result.error}); inspect ${logName}`);
}
for(const [start,end]of ranges){
  run(process.execPath,['--expose-gc',path.join(scripts,'renderer-oracle.mjs'),`--repo=${cli.repo}`,`--out=${cli.out}`,`--start=${start}`,`--end=${end}`],`batch-${start}-${end}.log`);
  console.log(`Rendered phases ${start}–${end}.`);
}
run(process.execPath,['--expose-gc',path.join(scripts,'continuous-instance.mjs'),`--repo=${cli.repo}`,`--out=${cli.out}`],'continuous-instance.log');
const reports=ranges.map(([a,b])=>JSON.parse(fs.readFileSync(path.join(cli.out,`batch-${a}-${b}-report.json`))));
const rows=reports.flatMap(r=>r.rows),phaseRows=reports.flatMap(r=>r.phaseRows),first=reports[0];
const summary={};for(const key of Object.keys(first.summary)){
  if(key==='phases'||key==='dprs')continue;
  summary[key]=key.startsWith('max')?Math.max(...reports.map(r=>r.summary[key])):reports.reduce((n,r)=>n+r.summary[key],0);
}
summary.phases=phaseRows.length;summary.dprs=first.summary.dprs;
if(!cli.smoke)summary.maxCupTranslationStepArt=Math.max(...phaseRows.slice(1).map((r,i)=>Math.hypot(r.cup.x-phaseRows[i].cup.x,r.cup.y-phaseRows[i].cup.y)));
const {batch,...base}=first;
const merged={...base,status:cli.smoke?'Portable smoke reproduction: 3 selected phases, not a full 257-phase recheck':'Complete portable 257-phase review',summary,phaseRows,rows,
  batchExecution:{mode:cli.smoke?'Three serial single-phase smoke samples':'Nine serial processes of at most32 phases',continuousInstance:'A separate single-artist run renders all257 phases through one action instance.',exactDprScale:'Canvas allocation ceil(146*1.5*dpr); drawing scale exactly1.5*dpr.',resourceCaveat:'The historical monolithic multi-surface audit exited137. This bounded harness does not certify native-host process or GPU memory.'}};
fs.writeFileSync(path.join(cli.out,'full-renderer-report.json'),JSON.stringify(merged,null,2)+'\n');
const compact={...merged,phaseRows:phaseRows.length,rows:rows.length};
fs.writeFileSync(path.join(cli.out,'summary.json'),JSON.stringify(compact,null,2)+'\n');
if(!cli.smoke){
  run('ffmpeg',['-y','-hide_banner','-loglevel','error','-framerate','257/9','-i',path.join(cli.out,'frames/%03d.png'),'-c:v','libx264','-preset','medium','-crf','19','-pix_fmt','yuv420p','-r','30','-t','9','-movflags','+faststart',path.join(cli.out,'sip-front-v2-three-column-9s.mp4')],'video-encode.log');
  run('ffmpeg',['-v','error','-i',path.join(cli.out,'sip-front-v2-three-column-9s.mp4'),'-f','null','-'],'video-decode.log');
}
console.log(JSON.stringify({out:cli.out,smoke:cli.smoke,summary},null,2));
