import { paintVectorShapes } from './pet-vector-paint.mjs';

function drawVectorActionDetails(context, contact, palette, layer) {
  const shapes = [], phase = contact.phase * Math.PI * 2;
  const path = (d, stroke, width = 1, opacity = 1, fill = 'none') => shapes.push({ d, stroke, width, opacity, fill });
  const dot = (x, y, rx, ry, fill, opacity = 1) => shapes.push({
    d: `M${x-rx} ${y}a${rx} ${ry} 0 1 0 ${rx*2} 0a${rx} ${ry} 0 1 0 ${-rx*2} 0Z`, fill, opacity
  });
  for (const detail of contact.details) {
    if ((detail.layer || 'front') !== layer) continue;
    const [x, y] = detail.at, amount = detail.amount;
    switch (detail.type) {
      case 'steam': {
        const drift = Math.sin(phase * 2) * 1.7;
        path(`M${x} ${y+3} C${x-10} ${y+1} ${x-17} ${y+1} ${x-17} ${y-5} C${x-17} ${y-10} ${x-10} ${y-10} ${x-15} ${y-14} Q${x-18} ${y-17} ${x-15+drift} ${y-20}`, '#f0e5d9', 1.6, .78);
        break;
      }
      case 'energy-rays': case 'look-back': {
        const left = detail.type === 'energy-rays';
        if (left) {
          path(`M${x-17} ${y+1}l-3 -2 M${x-18} ${y+7}l-4 1`, '#ffdd81', 1.5, .5 + .5 * amount);
        }
        path(`M${x+(left?18:0)} ${y}l2 -5 M${x+(left?19:4)} ${y+4}l4 -2`, '#f0c474', 1.7, .55 + .45 * amount);
        break;
      }
      case 'run-dust': case 'soil': {
        const travel = (detail.cycle ?? contact.phase * 5) % 1;
        for (let i=0;i<3;i++) {
          const t=(travel+i/3)%1, spread=detail.type==='run-dust'?17:9;
          dot(x-t*spread, y-2-Math.sin(t*Math.PI)*4, 1.5+t*2.2, 1.1+t*1.5, '#d8c7b1', (1-t)*amount*.6);
        }
        break;
      }
      case 'plane-trail': path(`M${x-4} ${y+8}q-5 2 -10 1 M${x-18} ${y+8}l-4 -1`, '#dadbd2', .8, amount * .6); break;
      case 'star-glow': path(`M${x-12} ${y}h-3 M${x+12} ${y}h3 M${x} ${y-12}v-3`, '#f5d98e', .8, amount); break;
      case 'page': {
        if (amount < .02) break;
        const w = detail.width * Math.sin(amount * Math.PI);
        path(`M${x} ${y} Q${x-w*.5} ${y-5} ${x-w} ${y-amount*3} V${y+10} Q${x-w*.5} ${y+8} ${x} ${y+11} Z`, '#b9a68b', .65, 1, '#fff8e9');
        break;
      }
      case 'ink': path(`M${x} ${y}q${3+amount*5} -1 ${4+amount*13} 0`, '#788ca1', .7); break;
      case 'scroll': path(`M${x} ${y-Math.sin(phase)*2}h17 M${x} ${y+3-Math.sin(phase)*2}h12`, '#88a6b4', .9); break;
      case 'keypress': if(amount>.3) dot(x,y+3,1.2,.5,'#fff8e7',amount*.7); break;
      case 'water':
        for (let i=0;i<5;i++) {
          const t=((i/5+contact.phase*3)%1)*amount;
          dot(x+(detail.end[0]-x)*t, y+(detail.end[1]-y)*t+Math.sin(t*Math.PI)*2, .7, 1.1, '#9bd3df', amount);
        }
        break;
      case 'thread': {
        const rows = 4 + contact.phase * 6;
        path(`M${x-8} ${y-1}q5 -2 11 0v${rows}q-5 2 -11 0Z`, '#6d9f92', .6, 1, '#b5d9c6');
        for(let row=0;row<rows;row+=2)for(let col=0;col<5;col++)path(`M${x-7+col*2} ${y+row}l.7 1l.7 -1`, '#6d9f92', .35, .7);
        path(`M${x+3} ${y+4}Q${x+8} ${y+12} ${detail.end[0]} ${detail.end[1]}`, '#c68eac', .7);
        break;
      }
      case 'food':
        dot(x+3,y,3.6,1.7,'#ebc985');dot(x+2,y-1,1.4,1.1,'#c67965');
        break;
      case 'reflection': {
        dot(x+5,y+4,4,5,palette[2],.9);
        const blink=amount>.35&&amount<.41;
        dot(x+3.5,y+3.5,.7,blink?.25:1,palette[1]);dot(x+6.6,y+3.5,.7,blink?.25:1,palette[1]);
        path(`M${x+4.6} ${y+6}h1`,palette[1],.4);break;
      }
      case 'flash': if(amount) path(`M${x-4} ${y}h8 M${x} ${y-4}v8`,'#fff1c9',1.2); break;
      case 'hole': dot(x,y,27,3,'#5b535d',.7); break;
      case 'ellipsis': for(let i=0;i<3;i++)dot(x+i*4,y,1,1,'#dbd4e4'); break;
      case 'laser': dot(x,y,1.4,1.4,'#ee7790');dot(x-.3,y-.4,.5,.5,'#fff1e9'); break;
      case 'headband': path(`M${x} ${y}Q33 ${y+3} 57 ${y} M57 ${y}q5 -2 7 1`, '#b67f94', 2); break;
      case 'ribbon': path(`M${x} ${y}q9 -7 2 -11q-5 -7 8 -13`, '#d6a1b9', 1.7); break;
      default: break;
    }
  }
  return paintVectorShapes(context, shapes, palette);
}

export { drawVectorActionDetails };
