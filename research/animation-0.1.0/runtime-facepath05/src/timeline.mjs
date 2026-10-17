import {
  Quaternion
}
from 'three';
import {
  LIMITS, fail, num
}
from './contracts.mjs';
const ease=u=>u*u*(3-2*u), identity=new Float64Array([0, 0, 0, 1]);
function canonicalQuaternion(out,q) {
  const scale=(q[3]<0?-1:1)/Math.hypot(q[0],q[1],q[2],q[3]);
  for(let i=0;i<4;i++)out[i]=q[i]*scale;
}
// True shortest-arc spherical interpolation, including small admitted angles.
// Exact endpoints avoid changing a sampled pose merely by interrupting it.
function spherical(out,a,b,u) {
  if(u<=0){out.set(a);return;}
  if(u>=1){out.set(b);return;}
  let dot=a[0]*b[0]+a[1]*b[1]+a[2]*b[2]+a[3]*b[3];
  const sign=dot<0?-1:1;dot=Math.min(1,Math.abs(dot));
  const theta=Math.acos(dot),sin=Math.sin(theta);
  const wa=sin>1e-12?Math.sin((1-u)*theta)/sin:1-u;
  const wb=(sin>1e-12?Math.sin(u*theta)/sin:u)*sign;
  let norm=0;
  for(let i=0;i<4;i++){out[i]=a[i]*wa+b[i]*wb;norm+=out[i]*out[i];}
  norm=Math.sqrt(norm);
  for(let i=0;i<4;i++)out[i]/=norm;
}
export class QuaternionLane {
  constructor(node, rest) {
    this.node=node;
    this.rest=rest.clone();
    this.value=identity.slice();
    this.from=identity.slice();
    this.to=identity.slice();
    this.start=0;
    this.end=0;
    this.changed=true;
    this.clipTrack=null;
    this.keyA=new Float64Array(4);
    this.keyB=new Float64Array(4);
  }
  plan(t, q, duration) {
    this.sample(t);
    this.clipTrack=null;
    this.from.set(this.value);
    canonicalQuaternion(this.to,q);
    this.start=t;
    this.end=t+duration;
  }
  planClip(t,track,duration,entrySec) {
    this.sample(t);
    this.from.set(this.value);
    canonicalQuaternion(this.to,track.keys[0].rotation);
    this.start=t;
    this.clipStart=t+entrySec;
    this.clipDuration=duration;
    this.end=this.clipStart+duration;
    this.clipTrack=track;
  }
  sample(t) {
    if(this.clipTrack)return this.sampleClip(t);
    const u=this.end<=this.start?1:Math.min(1, Math.max(0, (t-this.start)/(this.end-this.start)));
    const a=this.value[0], b=this.value[1], c=this.value[2], d=this.value[3];
    if(u===0)this.value.set(this.from);
    else if(u===1)this.value.set(this.to);
    else Quaternion.slerpFlat(this.value, 0, this.from, 0, this.to, 0, ease(u));
    this.changed=a!==this.value[0]||b!==this.value[1]||c!==this.value[2]||d!==this.value[3];
    return this.changed;
  }
  sampleClip(t) {
    const a=this.value[0],b=this.value[1],c=this.value[2],d=this.value[3],track=this.clipTrack;
    if(t<this.clipStart) {
      const u=Math.max(0,(t-this.start)/(this.clipStart-this.start));
      spherical(this.value,this.from,this.to,u);
    } else {
      const keys=track.keys;
      let lo=0,hi=keys.length;
      // Compare canonical absolute key instants, not a phase round-trip. No
      // epsilon shifts a STEP edge or swallows an admitted short interval.
      while(lo+1<hi) {
        const mid=(lo+hi)>>1;
        if(t>=this.clipStart+keys[mid].at*this.clipDuration)lo=mid;else hi=mid;
      }
      canonicalQuaternion(this.keyA,keys[lo].rotation);
      if(track.interpolation==='STEP'||lo===keys.length-1)this.value.set(this.keyA);
      else {
        canonicalQuaternion(this.keyB,keys[lo+1].rotation);
        const t0=this.clipStart+keys[lo].at*this.clipDuration,t1=this.clipStart+keys[lo+1].at*this.clipDuration;
        spherical(this.value,this.keyA,this.keyB,Math.min(1,(t-t0)/(t1-t0)));
      }
      if(t>=this.end) {
        this.clipTrack=null;
        this.from.set(this.value);this.to.set(this.value);this.start=this.end;
      }
    }
    this.changed=a!==this.value[0]||b!==this.value[1]||c!==this.value[2]||d!==this.value[3];
    return this.changed;
  }
  apply() {
    this.node.quaternion.set(this.value[0], this.value[1], this.value[2], this.value[3]).multiply(this.rest);
  }
  active(t) {
    return t<this.end;
  }
}
/** Single semantic path, adjacent knots inside that path; exact-neutral bridge between paths. */
export class FaceLane {
  constructor() {
    this.path=null;
    this.value=0;
    this.phase='idle';
    this.from=0;
    this.to=0;
    this.start=0;
    this.end=0;
    this.queued=null;
    this.queuedAmount=0;
    this.inSec=.1;
    this.arrival=0;
  }
  plan(t, path, amount, outSec, inSec) {
    this.sample(t);
    this.inSec=inSec;
    if(amount===0) {
      this.queued=null;
      this.queuedAmount=0;
      if(this.phase!=='out')this.segment(t, 0, outSec, 'out');
      this.arrival=this.end;
      return this.arrival;
    }
    if(this.path===path&&this.phase!=='out') {
      this.segment(t, amount, inSec, 'in');
      this.arrival=this.end;
      return this.arrival;
    }
    this.queued=path;
    this.queuedAmount=amount;
    if(this.value===0) {
      this.path=path;
      this.queued=null;
      this.segment(t, amount, inSec, 'in');
      this.arrival=this.end;
    }
    else {
      if(this.phase!=='out')this.segment(t, 0, outSec, 'out');
      this.arrival=this.end+inSec;
    }
    return this.arrival;
  }
  segment(t, to, duration, phase) {
    this.from=this.value;
    this.to=to;
    this.start=t;
    this.end=t+duration;
    this.phase=phase;
  }
  sample(t) {
    if(this.phase==='idle')return false;
    const old=this.value, oldPath=this.path;
    let u=Math.min(1, Math.max(0, (t-this.start)/(this.end-this.start)));
    this.value=this.from+(this.to-this.from)*ease(u);
    if(u===1) {
      if(this.phase==='out') {
        this.value=0;
        const end=this.end;
        if(this.queued) {
          this.path=this.queued;
          const amount=this.queuedAmount;
          this.queued=null;
          this.segment(end, amount, this.inSec, 'in');
          u=Math.min(1, Math.max(0, (t-this.start)/(this.end-this.start)));
          this.value=amount*ease(u);
          if(u===1)this.phase='idle';
        }
        else {
          this.path=null;
          this.phase='idle';
        }
      }
      else this.phase='idle';
    }
    return old!==this.value||oldPath!==this.path;
  }
  active() {
    return this.phase!=='idle';
  }
}
/** Events are validated before enqueue, bounded and ordered by (time, cancel-before-play, sequence). */
export class Timeline {
  constructor(lanes, face, motions, applyFace, clips=[]) {
    this.lanes=lanes;
    this.face=face;
    this.motions=new Map(motions.map(s=>[s.id, s]));
    this.clips=new Map(clips.map(c=>[c.id,c]));
    this.applyFace=applyFace;
    this.time=0;
    this.events=[];
    this.seq=0;
    this.generation=0;
    this.stats= {
      ticks:0, eventEvaluations:0, laneSamples:0, queuedPeak:0
    };
  }
  enqueue(event) {
    if(!event||!['play', 'playClip', 'cancel'].includes(event.type))fail('EVENT', 'Unknown event type');
    const allowed=event.type==='play'?['time', 'type', 'segment']:event.type==='playClip'?['time','type','clip','entrySec']:['time', 'type'];
    if(Object.keys(event).some(k=>!allowed.includes(k)))fail('EVENT', 'Unknown event field');
    num(event.time, this.time, 1e9, 'Event cannot be in past');
    if(event.type==='play'&&!this.motions.has(event.segment))fail('REFERENCE', 'Unknown segment');
    if(event.type==='playClip') {
      if(!this.clips.has(event.clip))fail('REFERENCE','Unknown authored clip');
      num(event.entrySec,.02,1,'Explicit clip entry bridge');
      num(event.time+event.entrySec+this.clips.get(event.clip).durationSec,0,1e9,'Clip exceeds canonical clock');
    }
    if(this.events.length>=LIMITS.queue)fail('LIMIT', 'Event queue');
    this.events.push({
      ...event, sequence:this.seq++, generation:this.generation
    });
    this.events.sort((a, b)=>a.time-b.time||(a.type==='cancel'?0:1)-(b.type==='cancel'?0:1)||a.sequence-b.sequence);
    this.stats.queuedPeak=Math.max(this.stats.queuedPeak, this.events.length);
  }
  sample(t) {
    let changed=false;
    for(const lane of this.lanes.values()) {
      changed=lane.sample(t)||changed;
      lane.apply();
      this.stats.laneSamples++;
    }
    changed=this.face.sample(t)||changed;
    this.applyFace(this.face.path, this.face.value);
    return changed;
  }
  advance(t) {
    num(t, this.time, 1e9, 'Monotonic clock');
    let changed=false;
    while(this.events.length&&this.events[0].time<=t) {
      const e=this.events.shift();
      if(e.generation!==this.generation)continue;
      changed=this.sample(e.time)||changed;
      this.stats.eventEvaluations++;
      if(e.type==='cancel') {
        this.generation++;
        this.events.length=0;
        for(const lane of this.lanes.values())lane.plan(e.time, identity, .12);
        this.face.plan(e.time, null, 0, .12, .12);
      }
      else if(e.type==='playClip') {
        const clip=this.clips.get(e.clip);
        for(const track of clip.tracks)this.lanes.get(track.target).planClip(e.time,track,clip.durationSec,e.entrySec);
      }
      else {
        const s=this.motions.get(e.segment);
        for(const[id, q]of Object.entries(s.joints))this.lanes.get('joint:'+id).plan(e.time, q, s.durationSec);
        for(const[id, q]of Object.entries(s.accessories))this.lanes.get('accessory:'+id).plan(e.time, q, s.durationSec);
        if(s.expression) {
          const f=s.expression;
          this.face.plan(e.time, f.path, f.intensity, f.fadeOutSec, f.fadeInSec);
        }
      }
    }
    changed=this.sample(t)||changed;
    this.time=t;
    this.stats.ticks++;
    return changed;
  }
  isAnimating(t=this.time) {
    if(this.face.active())return true;
    for(const lane of this.lanes.values())if(lane.active(t))return true;
    return false;
  }
  nextDeadline() {
    return this.events.length?this.events[0].time:Infinity;
  }
}
