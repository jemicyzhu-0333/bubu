export function offlinePage({ playerSource, manifest, videoBase64, posterBase64, report }) {
  const json = JSON.stringify({ manifest, report }).replaceAll('<', '\\u003c');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Dango run: authored sequence / current rig</title>
<style>body{margin:0;background:#eef3f3;color:#25404e;font:16px system-ui,sans-serif}main{max-width:980px;margin:auto;padding:28px}h1{font-size:24px;margin:0 0 10px}p{line-height:1.5}video{width:100%;background:#eef3f3;border:1px solid #ccd8da;border-radius:12px}button,input{font:inherit}button{padding:8px 14px;border:1px solid #bacbce;border-radius:8px;background:white;margin-right:8px}.controls{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:16px 0}.controls input[type=range]{flex:1;min-width:200px}.demo{background:#eef3f3;border:1px solid #ccd8da;display:flex;justify-content:center;align-items:center;flex-wrap:wrap}.demo canvas:first-child{width:220px;height:220px}.demo canvas:last-child{width:440px;height:440px}small{color:#516d78}details{margin-top:20px}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style>
<main><h1>Dango: a genuinely authored eight-pose run</h1>
<p>Left: current production layered PNG rig. Right: eight independent image-authored poses from the same canonical character. Both use a 950 ms stride, a fixed canonical scale and camera, and the same slow horizontal translation. The upper row uses the app's 99 CSS px body design scale; the lower row is 2×. The canonical neutral's actual bounds are 105.6 × 96 CSS px.</p>
<video id="comparison" muted playsinline controls loop preload="metadata" poster="data:image/png;base64,${posterBase64}" src="data:video/mp4;base64,${videoBase64}"></video>
<p><small>This is local offscreen Skia evidence from the real production renderer, not a native Electron or GPU acceptance test. The right side is a candidate with modest face/volume drift, not approved animation. Its face and clothing are baked into these poses. The left retains its production body bob; the right's compression and flight come only from the authored frames.</small></p>
<h2>Inspect the eight authored poses</h2>
<div class="controls"><button id="play" disabled>Play sequence</button><label><input type="checkbox" id="reduce"> Hold pose</label><input id="phase" type="range" min="0" max="949.999" step="1" value="0" aria-label="Sequence phase"><span id="state">Loading all eight frames…</span></div>
<div class="demo"><canvas id="native" width="440" height="440"></canvas><canvas id="zoom" width="440" height="440"></canvas></div>
<p><small>Scrubbing and playback use absolute time. Hold pose freezes the declared phase. Every frame retains its common canvas, anchor and transform; no silhouette-based recentering or resizing is applied.</small></p>
<details><summary>Evidence and limits</summary><pre id="report"></pre></details>
</main><script type="module">
${playerSource.replaceAll('export ', '')}
const data=${json};
const player=createSequencePlayer(data.manifest,{loadImage:src=>new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('Frame decode failed'));image.src=src;})});
const small=document.querySelector('#native'),large=document.querySelector('#zoom'), slider=document.querySelector('#phase');
const play=document.querySelector('#play'),reduce=document.querySelector('#reduce'),status=document.querySelector('#state'),video=document.querySelector('#comparison');
document.querySelector('#report').textContent=JSON.stringify(data.report,null,2);
const media=matchMedia('(prefers-reduced-motion: reduce)');reduce.checked=media.matches;
const transform=sequenceTransform(player.manifest,{x:110,y:158.5,referenceHeight:96});
let playing=false,started=0,held=0,raf=0;
function render(at){for(const canvas of [small,large]){const ctx=canvas.getContext('2d');ctx.setTransform(2,0,0,2,0,0);ctx.clearRect(0,0,220,220);ctx.strokeStyle='#b9c8ce';ctx.lineWidth=.5;ctx.beginPath();ctx.moveTo(28,158.5);ctx.lineTo(192,158.5);ctx.stroke();const sample=player.draw(ctx,at,transform,{reducedMotion:reduce.checked});status.textContent=sample.painted?'Pose '+(sample.index+1)+' / 8':sample.status;}slider.value=at%data.manifest.loopMs;}
function tick(now){if(!playing)return;held=(now-started)%data.manifest.loopMs;render(held);raf=requestAnimationFrame(tick);}
play.onclick=()=>{playing=!playing;play.textContent=playing?'Pause sequence':'Play sequence';if(playing){started=performance.now()-held;raf=requestAnimationFrame(tick);}else cancelAnimationFrame(raf);};
slider.oninput=()=>{held=Number(slider.value);started=performance.now()-held;render(held);};
reduce.onchange=()=>{if(reduce.checked){video.pause();video.currentTime=.475;}render(held);};
media.addEventListener('change',event=>{reduce.checked=event.matches;if(event.matches)video.pause();render(held);});
const ready=await player.prepare();
if(ready.ready){play.disabled=false;render(0);}else{status.textContent='Failed to decode complete sequence';}
window.addEventListener('pagehide',()=>{playing=false;cancelAnimationFrame(raf);player.dispose();},{once:true});
</script></html>`;
}
