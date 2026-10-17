/** Face-only scalar clock. No skeleton, interaction, legacy controller, or Three dependency. */
export const FACE_TIMELINE_LIMITS = Object.freeze({
  minFadeSec: .04, maxFadeSec: 2, maxBrakeSec: .04, maxTime: 1e9,
  maxQueue: 128, maxPaths: 128
});
const L = FACE_TIMELINE_LIMITS;
const FACE_KEYS = new Set(['type', 'time', 'id', 'amount', 'fadeOutSec', 'fadeInSec']);
const CANCEL_KEYS = new Set(['type', 'time', 'fadeOutSec']);
const finite = (value, min, max, name) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    throw new RangeError(`${name} must be finite in [${min}, ${max}]`);
  return value;
};
const fade = (value, name) => finite(value, L.minFadeSec, L.maxFadeSec, name);
const clock = value => finite(value, 0, L.maxTime, 'time');

export class FaceTimeline {
  #allowed; #apply; #queue = []; #time = 0; #generation = 0; #lastCancel = -Infinity;
  #path = null; #value = 0; #velocity = 0; #phase = 'idle';
  #kind = null; #start = 0; #end = 0; #from = 0; #to = 0;
  #brakeFrom = 0; #brakeTo = 0; #brakeU = 0; #brakeRatio = 0; #brakeVelocity = 0;
  #withdrawAfterBrake = false; #withdrawSec = .1;
  #intentId = null; #intentAmount = 0; #intentIn = .1; #intentOut = .1;
  #requestedAt = null; #arrivalTime = 0; #actualArrival = 0; #holdSince = 0;
  #neutralAt = 0; #brakingSec = 0; #brakeEndsAt = null;
  #sentPath = null; #sentValue = 0; #changed = false; #advancing = false;

  constructor(allowedIds, apply) {
    if (!Array.isArray(allowedIds) && !(allowedIds instanceof Set))
      throw new TypeError('allowedIds must be an array or Set');
    const ids = Array.from(allowedIds);
    if (!ids.length || ids.length > L.maxPaths || ids.some(id => typeof id !== 'string' || !id.length || id.length > 128))
      throw new RangeError('allowedIds must contain 1..128 nonempty identifiers of at most 128 characters');
    this.#allowed = new Set(ids);
    if (this.#allowed.size !== ids.length) throw new RangeError('allowedIds must be unique');
    if (typeof apply !== 'function') throw new TypeError('apply must be a function');
    this.#apply = apply;
    apply(null, 0);
  }

  get time() { return this.#time; }
  get path() { return this.#path; }
  get value() { return this.#value; }
  get velocity() { return this.#velocity; }
  get phase() { return this.#phase; }
  get arrivalTime() { return this.#arrivalTime; }
  get actualArrival() { return this.#actualArrival; }
  get holdSince() { return this.#holdSince; }
  get state() { return this.snapshot(); }

  /** Explicit diagnostics allocate; steady advance/isAnimating/nextDeadline do not. */
  snapshot() {
    return Object.freeze({
      time: this.#time, path: this.#path, value: this.#value, velocity: this.#velocity,
      phase: this.#phase, targetPath: this.#intentId, targetAmount: this.#intentAmount,
      requestedAt: this.#requestedAt, requestedFadeOutSec: this.#intentOut,
      requestedFadeInSec: this.#intentIn, brakingSec: this.#brakingSec,
      brakeEndsAt: this.#brakeEndsAt, neutralAt: this.#neutralAt,
      arrivalTime: this.#arrivalTime, actualArrival: this.#actualArrival,
      holdSince: this.#holdSince, segmentEndsAt: this.#kind ? this.#end : null,
      queued: this.#queue.length, generation: this.#generation
    });
  }

  enqueue(cue) {
    if (this.#advancing) throw new Error('enqueue from apply is not supported');
    if (!cue || typeof cue !== 'object' ||
        (Object.getPrototypeOf(cue) !== Object.prototype && Object.getPrototypeOf(cue) !== null))
      throw new TypeError('cue must be a plain record');
    const descriptors = Object.getOwnPropertyDescriptors(cue);
    const type = descriptors.type?.value;
    if (type !== 'face' && type !== 'cancel') throw new TypeError('cue.type must be face or cancel');
    const keys = type === 'face' ? FACE_KEYS : CANCEL_KEYS;
    const ownKeys = Reflect.ownKeys(cue);
    if (ownKeys.length !== keys.size || ownKeys.some(key =>
      !keys.has(key) || !Object.hasOwn(descriptors[key], 'value')))
      throw new TypeError('cue must have exactly the documented data fields');
    const time = clock(cue.time);
    if (time < this.#time) throw new RangeError('cannot enqueue in the sampled past');
    const outSec = fade(cue.fadeOutSec, 'fadeOutSec');
    let id = null, amount = 0, inSec = 0;
    if (cue.type === 'face') {
      if (!this.#allowed.has(cue.id)) throw new RangeError('unknown semantic face id');
      amount = finite(cue.amount, 0, 1, 'amount');
      inSec = fade(cue.fadeInSec, 'fadeInSec');
      if (amount !== 0) id = cue.id;
    }
    // A replacement may inherit an existing withdrawal up to maxFadeSec,
    // even if it requests a shorter new fade. Reserve that full horizon.
    if (time + L.maxBrakeSec + L.maxFadeSec + inSec > L.maxTime)
      throw new RangeError('cue lacks completion headroom before maxTime');
    if (this.#queue.length >= L.maxQueue) throw new RangeError('face queue capacity exceeded');
    const event = Object.freeze({ type: cue.type, time, id, amount, outSec, inSec });
    // Stable insertion: equal-priority face and cancel cues retain insertion order.
    let index = this.#queue.length;
    while (index > 0 && this.#queue[index - 1].time > time) index--;
    this.#queue.splice(index, 0, event);
    return this;
  }

  isAnimating() { return this.#kind !== null; }
  nextDeadline() { return this.#queue.length ? this.#queue[0].time : Infinity; }

  advance(time) {
    clock(time);
    if (time < this.#time) throw new RangeError('clock must be monotonic');
    if (this.#advancing) throw new Error('reentrant advance is not supported');
    this.#advancing = true;
    this.#changed = false;
    try {
      while (this.#queue.length && this.#queue[0].time <= time) {
        const at = this.#queue[0].time;
        this.#sampleTo(at);
        this.#time = at;
        // Cancel dominates an entire timestamp. Last inserted cancel supplies
        // its fade; no same-time face is transiently applied before cancellation.
        let count = 0, cancel = null;
        while (count < this.#queue.length && this.#queue[count].time === at) {
          if (this.#queue[count].type === 'cancel') cancel = this.#queue[count];
          count++;
        }
        if (cancel) {
          this.#queue.length = 0; // All already-enqueued cues belong to this generation.
          this.#generation++;
          this.#lastCancel = at;
          this.#accept(cancel);
        } else {
          for (let i = 0; i < count; i++) {
            const event = this.#queue.shift();
            if (at !== this.#lastCancel) this.#accept(event);
          }
        }
      }
      this.#sampleTo(time);
      this.#time = time;
      return this.#changed;
    } finally { this.#advancing = false; }
  }

  #emit() {
    if (this.#path === this.#sentPath && this.#value === this.#sentValue) return;
    this.#sentPath = this.#path;
    this.#sentValue = this.#value;
    this.#changed = true;
    this.#apply(this.#path, this.#value);
  }

  #accept(cue) {
    const same = cue.id === this.#intentId && cue.amount === this.#intentAmount;
    // Idempotent destination cues do not restart a fade or a settled hold.
    if (same && cue.type !== 'cancel') return;
    this.#intentId = cue.id;
    this.#intentAmount = cue.amount;
    this.#intentIn = cue.inSec;
    this.#intentOut = cue.outSec;
    this.#requestedAt = cue.time;
    this.#actualArrival = null;
    this.#holdSince = null;
    this.#brakingSec = 0;
    this.#brakeEndsAt = null;
    if (this.#phase === 'withdraw') {
      // Returning to the still-active semantic can reverse on that same path.
      // Brake inherited velocity first; never snap or visit an unrelated face.
      if (cue.id !== null && cue.id === this.#path) {
        this.#neutralAt = null;
        if (this.#velocity !== 0) this.#beginBrake(cue.time, false);
        else if (this.#value === cue.amount) this.#hold(cue.time);
        else this.#smooth(cue.time, cue.amount, cue.inSec, 'adjust');
      }
      this.#forecast();
      return;
    }
    if (this.#phase === 'brake') {
      const withdraw = cue.id === null || cue.id !== this.#path;
      if (withdraw && !this.#withdrawAfterBrake) this.#withdrawSec = cue.outSec;
      this.#withdrawAfterBrake = withdraw;
      this.#brakingSec = this.#end - cue.time;
      this.#brakeEndsAt = this.#end;
      this.#forecast();
      return;
    }
    this.#neutralAt = null;
    const withdraw = cue.id !== this.#path || cue.id === null;
    if (this.#velocity !== 0) {
      this.#withdrawSec = cue.outSec;
      this.#beginBrake(cue.time, withdraw);
    } else if (withdraw) {
      this.#withdrawSec = cue.outSec;
      this.#beginWithdraw(cue.time);
    } else if (this.#value === cue.amount) {
      this.#hold(cue.time);
    } else {
      this.#smooth(cue.time, cue.amount, cue.inSec, this.#value === 0 ? 'enter' : 'adjust');
    }
    this.#forecast();
  }

  #smooth(time, to, duration, phase) {
    this.#from = this.#value;
    this.#to = to;
    this.#start = time;
    this.#end = time + duration;
    this.#phase = phase;
    this.#kind = 'smooth';
    this.#velocity = 0;
  }

  #beginBrake(time, withdraw) {
    const oldEnd = this.#end;
    this.#brakeFrom = this.#from;
    this.#brakeTo = this.#to;
    this.#brakeU = (time - this.#start) / (oldEnd - this.#start);
    this.#brakeVelocity = this.#velocity;
    this.#start = time;
    this.#end = Math.min(oldEnd, time + L.maxBrakeSec);
    this.#brakeRatio = (this.#end - time) / (oldEnd - time);
    this.#from = this.#value;
    this.#to = this.#brakeValueAt(1);
    this.#kind = 'brake';
    this.#phase = 'brake';
    this.#withdrawAfterBrake = withdraw;
    this.#brakingSec = this.#end - time;
    this.#brakeEndsAt = this.#end;
    this.#forecast();
  }

  // A convex position formula for constant-deceleration braking. It avoids
  // subtracting nearly equal endpoint values near 0/1, and never clamps.
  #brakeValueAt(z) {
    const u = this.#brakeU, remain = 1 - u;
    const weightFrom = remain * remain * (1 + 2 * u - 3 * u * this.#brakeRatio * z * (2 - z));
    return this.#brakeFrom * weightFrom + this.#brakeTo * (1 - weightFrom);
  }

  #beginWithdraw(time) {
    if (this.#value === 0) {
      this.#neutral(time);
      this.#beginEntry(time);
    } else this.#smooth(time, 0, this.#withdrawSec, 'withdraw');
  }

  #neutral(time) {
    this.#value = 0;
    this.#velocity = 0;
    this.#emit(); // Explicit original path zero before changing the semantic ID.
    this.#path = null;
    this.#kind = null;
    this.#phase = 'idle';
    this.#neutralAt = time;
    this.#emit(); // Explicit adapter Basis restoration, even on a large time jump.
  }

  #beginEntry(time) {
    if (this.#intentId === null) { this.#hold(time); return; }
    this.#path = this.#intentId;
    this.#emit();
    this.#smooth(time, this.#intentAmount, this.#intentIn, 'enter');
  }

  #hold(time) {
    this.#kind = null;
    this.#velocity = 0;
    this.#phase = this.#path === null ? 'idle' : 'hold';
    this.#arrivalTime = time;
    this.#actualArrival = time;
    this.#holdSince = time;
  }

  #forecast() {
    if (!this.#kind) return;
    if (this.#phase === 'brake') {
      if (this.#withdrawAfterBrake) {
        this.#neutralAt = this.#to === 0 ? this.#end : this.#end + this.#withdrawSec;
        this.#arrivalTime = this.#intentId === null ? this.#neutralAt : this.#neutralAt + this.#intentIn;
      } else {
        this.#neutralAt = null;
        this.#arrivalTime = this.#to === this.#intentAmount ? this.#end : this.#end + this.#intentIn;
      }
    } else if (this.#phase === 'withdraw') {
      this.#neutralAt = this.#end;
      this.#arrivalTime = this.#intentId === null ? this.#end : this.#end + this.#intentIn;
    } else {
      this.#arrivalTime = this.#end;
    }
  }

  #sampleTo(time) {
    while (this.#kind && this.#end <= time) {
      const end = this.#end, phase = this.#phase;
      this.#time = end;
      this.#value = this.#to;
      this.#velocity = 0;
      this.#emit();
      if (phase === 'brake') {
        if (this.#withdrawAfterBrake) this.#beginWithdraw(end);
        else if (this.#value === this.#intentAmount) this.#hold(end);
        else this.#smooth(end, this.#intentAmount, this.#intentIn, 'adjust');
      } else if (phase === 'withdraw') {
        this.#neutral(end);
        this.#beginEntry(end);
      } else this.#hold(end);
      this.#forecast();
    }
    this.#time = time;
    if (this.#kind) {
      const u = (time - this.#start) / (this.#end - this.#start);
      if (u === 0) {
        this.#value = this.#from;
        this.#velocity = this.#kind === 'brake' ? this.#brakeVelocity : 0;
      } else if (this.#kind === 'brake') {
        this.#value = this.#brakeValueAt(u);
        this.#velocity = this.#brakeVelocity * (1 - u);
      } else {
        // Symmetric endpoint weights stay inside [0,1] without a value clamp.
        const remain = 1 - u;
        const weightFrom = remain * remain * (1 + 2 * u);
        const weightTo = u * u * (3 - 2 * u);
        this.#value = u <= .5
          ? this.#from * (1 - weightTo) + this.#to * weightTo
          : this.#from * weightFrom + this.#to * (1 - weightFrom);
        this.#velocity = (this.#to - this.#from) * 6 * u * remain / (this.#end - this.#start);
      }
      this.#emit();
    }
  }
}
