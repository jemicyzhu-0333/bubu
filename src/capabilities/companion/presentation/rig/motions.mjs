'use strict';

import { resolveMotionProps, samplePropPoses, PROP_NAMES } from './props.mjs';

// Bone motions for a layered rig, keyed by the form's motion vocabulary
// (see `supportedMotions` in the form descriptor). Tracks are keyframes over a
// looped progress 0..1: `[t, value]`, eased with smoothstep. Bone names are a
// shared convention (docs/PET_RIG.md); a rig that lacks a bone simply ignores
// its track. `name@view` entries override single tracks for one view.
//
// Sign convention (canvas, y down): a positive `r` turns clockwise. A right
// arm (viewer's right) hanging down swings toward the body with +r and up and
// out with -r; the left arm mirrors that.
// Evenly spaced, eased keys keep authored gestures readable and periodic.
// Every cycle returns to its first pose; no discontinuity at a session loop.
const cycle = (...values) => values.map((value, index) => [index / (values.length - 1), value]);
const turn = (...values) => ({ r: cycle(...values) });
const lift = (...values) => ({ y: cycle(...values) });

const MOTIONS = Object.freeze({
  idle: {
    hold: 0,
    bones: {
      ear_l: { r: [[0, 0], [0.5, -0.05], [1, 0]] },
      ear_r: { r: [[0, 0], [0.5, 0.05], [1, 0]] },
      arm_l: { r: [[0, 0], [0.5, 0.04], [1, 0]] },
      arm_r: { r: [[0, 0], [0.5, -0.04], [1, 0]] },
      body: { sy: [[0, 1], [0.5, 1.015], [1, 1]] }
    }
  },
  curious: {
    hold: 0.3,
    bones: {
      ear_l: { r: [[0, 0], [0.3, -0.18], [0.7, -0.18], [1, 0]] },
      ear_r: { r: [[0, 0], [0.3, 0.32], [0.7, 0.28], [1, 0]] },
      arm_r: { r: [[0, 0], [0.3, 0.35], [0.7, 0.35], [1, 0]] }
    }
  },
  wave: {
    hold: 0.2,
    bones: {
      arm_r: { r: [[0, 0], [0.2, -2.3], [0.35, -1.85], [0.5, -2.4], [0.65, -1.85], [0.8, -2.3], [1, 0]] },
      ear_r: { r: [[0, 0], [0.35, 0.12], [0.65, -0.05], [1, 0]] }
    },
    views: { profile: { arm_r: { r: [[0, 0], [0.2, -2], [0.5, -2.3], [0.8, -2], [1, 0]] } } }
  },
  hop: {
    hold: 0.5,
    bones: {
      arm_l: { r: [[0, 0], [0.5, 0.7], [1, 0]] },
      arm_r: { r: [[0, 0], [0.5, -0.7], [1, 0]] },
      ear_l: { r: [[0, 0], [0.25, 0.2], [0.6, -0.15], [1, 0]] },
      ear_r: { r: [[0, 0], [0.25, -0.2], [0.6, 0.15], [1, 0]] },
      leg_l: { y: [[0, 0], [0.5, -2], [1, 0]] },
      leg_r: { y: [[0, 0], [0.5, -2], [1, 0]] }
    }
  },
  stretch: {
    hold: 0.5,
    bones: {
      arm_l: { r: [[0, 0], [0.5, 2.6], [1, 0]] },
      arm_r: { r: [[0, 0], [0.5, -2.6], [1, 0]] },
      body: { sy: [[0, 1], [0.5, 1.04], [1, 1]] },
      ear_l: { r: [[0, 0], [0.5, 0.08], [1, 0]] },
      ear_r: { r: [[0, 0], [0.5, -0.08], [1, 0]] }
    }
  },
  sleep: {
    hold: 0.5,
    bones: {
      ear_l: { r: [[0, -0.4], [0.5, -0.46], [1, -0.4]] },
      ear_r: { r: [[0, 0.4], [0.5, 0.46], [1, 0.4]] },
      arm_l: { r: [[0, -0.3], [1, -0.3]] },
      arm_r: { r: [[0, 0.3], [1, 0.3]] },
      body: { sy: [[0, 1], [0.5, 1.02], [1, 1]] }
    },
    props: ['blanket']
  },
  read: {
    hold: 0.5,
    bones: {
      arm_l: { r: [[0, -0.7], [1, -0.7]] },
      arm_r: { r: [[0, 0.7], [0.45, 0.7], [0.62, 1.08], [0.78, 0.7], [1, 0.7]] },
      hand_r: turn(0, 0, -0.22, 0, 0),
      ear_r: { r: [[0, 0], [0.5, 0.08], [1, 0]] }
    },
    props: ['book']
  },
  write: {
    hold: 0.5,
    bones: {
      arm_l: { r: [[0, -0.5], [1, -0.5]] },
      arm_r: { r: [[0, 0.55], [0.25, 0.7], [0.5, 0.55], [0.75, 0.7], [1, 0.55]] },
      hand_r: { r: [[0, -0.55], [0.25, -0.7], [0.5, -0.55], [0.75, -0.7], [1, -0.55]] }
    },
    props: ['paper', 'pen']
  },
  sip: {
    hold: 0.4,
    bones: {
      arm_r: { r: [[0, 0.2], [0.35, 2.1], [0.65, 2.1], [1, 0.2]] },
      // Keeps a held cup nearly upright while the arm lifts it.
      hand_r: { r: [[0, -0.2], [0.35, -1.85], [0.65, -1.85], [1, -0.2]] },
      ear_l: { r: [[0, 0], [0.5, -0.06], [1, 0]] }
    },
    views: {
      profile: {
        arm_r: { r: [[0, 0.2], [0.35, 1.5], [0.65, 1.5], [1, 0.2]] },
        hand_r: { r: [[0, -0.2], [0.35, -1.3], [0.65, -1.3], [1, -0.2]] }
      }
    },
    props: ['cup']
  },
  chew: {
    hold: 0.5,
    bones: {
      arm_l: { r: [[0, -0.9], [1, -0.9]] },
      arm_r: { r: [[0, 0.9], [1, 0.9]] },
      ear_l: { r: [[0, 0], [0.25, -0.1], [0.5, 0], [0.75, -0.1], [1, 0]] },
      ear_r: { r: [[0, 0], [0.25, 0.1], [0.5, 0], [0.75, 0.1], [1, 0]] }
    },
    props: ['snack']
  },
  dig: {
    hold: 0.75,
    bones: {
      arm_r: { r: [[0, -0.4], [0.3, 0.6], [0.5, 0.1], [0.8, 0.6], [1, -0.4]] },
      hand_r: { r: [[0, 0.3], [0.3, -0.2], [0.5, 0.1], [0.8, -0.2], [1, 0.3]] },
      arm_l: { r: [[0, -0.3], [0.5, -0.5], [1, -0.3]] }
    },
    props: ['shovel']
  },
  // Social gestures: prepare, make contact/reach, then return the paw.
  'high-five': {
    hold: 0.5,
    bones: {
      arm_r: turn(0, -0.45, -2.05, -2.28, -2.05, -0.45, 0),
      hand_r: turn(0, 0, 0.18, -0.12, 0.18, 0, 0),
      arm_l: turn(0, -0.12, -0.22, -0.18, -0.22, -0.12, 0),
      ear_r: turn(0, 0.08, 0.15, -0.08, 0.15, 0.08, 0)
    }, props: ['high-five']
  },
  reach: {
    hold: 0.5,
    bones: {
      arm_l: turn(-0.15, 0.4, 1.8, 2.35, 1.8, 0.4, -0.15),
      arm_r: turn(0.15, -0.6, -2.05, -2.5, -2.05, -0.6, 0.15),
      hand_r: turn(0, 0.08, 0.22, -0.18, 0.22, 0.08, 0),
      ear_l: turn(0, 0.12, -0.12, 0.12, 0),
      leg_l: lift(0, 0, -1.3, 0, 0)
    }, props: ['star']
  },
  pose: {
    hold: 0.5,
    bones: {
      arm_l: turn(0, 0.45, 1.15, 1.15, 0.45, 0),
      arm_r: turn(0, 0.18, 0.72, 0.72, 0.18, 0),
      ear_l: turn(0, -0.08, -0.24, -0.24, -0.08, 0),
      ear_r: turn(0, 0.06, 0.11, 0.11, 0.06, 0),
      leg_r: { r: cycle(0, -0.08, -0.2, -0.2, -0.08, 0), y: cycle(0, 0, -1, -1, 0, 0) }
    }, props: ['camera']
  },
  mirror: {
    hold: 0.35,
    bones: {
      arm_l: turn(0, 0.25, 0.9, 0.25, 0, 0),
      arm_r: turn(0.08, 0.25, 0.30, 0.25, 0.08),
      hand_r: turn(-0.08, -0.22, -0.27, -0.22, -0.08),
      ear_l: turn(0, -0.2, -0.12, 0.1, 0),
      ear_r: turn(0, -0.1, 0.12, 0.2, 0)
    }, props: ['mirror']
  },
  // Music and locomotion use distinct opposed feet/arms, not a shared hop.
  dance: {
    hold: 0.25,
    bones: {
      arm_l: turn(0.2, 1.05, 0.25, -0.25, 0.2),
      arm_r: turn(-0.2, 0.25, -0.25, -1.05, -0.2),
      hand_l: turn(0, -0.2, 0, 0.1, 0), hand_r: turn(0, -0.1, 0, 0.2, 0),
      leg_l: lift(0, -2, 0, 0, 0), leg_r: lift(0, 0, 0, -2, 0),
      ear_l: turn(0, -0.2, 0, 0.15, 0), ear_r: turn(0, -0.15, 0, 0.2, 0)
    }, props: ['music-notes']
  },
  sway: {
    hold: 0.5,
    bones: {
      arm_r: turn(1.1, 1.24, 1.1, 0.96, 1.1),
      hand_r: turn(-0.8, -0.94, -0.8, -0.66, -0.8),
      arm_l: turn(-0.2, 0.7, 0.15, -0.35, -0.2),
      ear_l: turn(0, -0.12, 0, 0.12, 0), ear_r: turn(0, -0.12, 0, 0.12, 0),
      leg_l: { r: cycle(0, 0.12, 0, -0.08, 0) }
    }, props: ['microphone']
  },
  spin: {
    hold: 0.5,
    bones: {
      arm_l: turn(0, 0.7, -0.5, -0.5, 0.7, 0),
      arm_r: turn(0, -0.7, 0.5, 0.5, -0.7, 0),
      leg_l: { r: cycle(0, 0.16, -0.16, 0.16, 0), y: cycle(0, -1.5, 0, -1.5, 0) },
      leg_r: { r: cycle(0, -0.16, 0.16, -0.16, 0), y: cycle(0, 0, -1.5, 0, 0) },
      ear_l: turn(0, 0.25, 0.08, -0.25, 0), ear_r: turn(0, 0.18, -0.08, -0.18, 0)
    }
  },
  dash: {
    hold: 0.25,
    bones: {
      arm_l: turn(0, 0.8, 0, -0.65, 0), arm_r: turn(0, 0.65, 0, -0.8, 0),
      leg_l: { r: cycle(0, 0.28, 0, -0.22, 0), y: cycle(0, -2.5, 0, 0, 0) },
      leg_r: { r: cycle(0, -0.22, 0, 0.28, 0), y: cycle(0, 0, 0, -2.5, 0) },
      ear_l: turn(0, -0.22, 0.08, -0.22, 0), ear_r: turn(0, -0.15, 0.12, -0.15, 0)
    }, props: ['butterfly']
  },
  glide: {
    hold: 0.4,
    bones: {
      arm_r: turn(0.2, 0.8, -1.25, -1.35, -0.45, 0.2),
      hand_r: turn(0, -0.25, 0.3, 0.3, 0.1, 0),
      arm_l: turn(-0.2, -0.45, 0.55, 0.3, -0.1, -0.2),
      ear_l: turn(0, 0.12, -0.1, 0), ear_r: turn(0, -0.08, 0.1, 0)
    }, props: ['plane']
  },
  moonwalk: {
    hold: 0.25,
    bones: {
      leg_l: { x: cycle(0, -2.5, 0, 2.5, 0), y: cycle(0, 0, -1.5, 0, 0), r: cycle(0, 0.2, 0, -0.12, 0) },
      leg_r: { x: cycle(0, 2.5, 0, -2.5, 0), y: cycle(0, -1.5, 0, 0, 0), r: cycle(0, -0.12, 0, 0.2, 0) },
      arm_l: turn(0.15, -0.2, 0.15, 0.4, 0.15), arm_r: turn(-0.15, -0.4, -0.15, 0.2, -0.15),
      ear_r: turn(0, 0.1, 0, -0.1, 0)
    }, props: ['sparkle-shoes']
  },
  carry: {
    hold: 0.5,
    bones: {
      arm_l: turn(-0.7, -0.85, -0.95, -0.85, -0.7), arm_r: turn(0.7, 0.85, 0.95, 0.85, 0.7),
      hand_r: turn(-0.7, -0.85, -0.95, -0.85, -0.7),
      leg_l: lift(0, -1.3, 0, 0, 0), leg_r: lift(0, 0, 0, -1.3, 0),
      ear_l: turn(-0.08, -0.2, -0.08, -0.2, -0.08)
    }, props: ['energy']
  },
  wag: {
    hold: 0.25,
    bones: {
      tail: turn(0, -0.35, 0, 0.35, 0),
      arm_l: turn(-0.1, 0.12, -0.1, 0.12, -0.1), arm_r: turn(0.1, -0.12, 0.1, -0.12, 0.1),
      ear_l: turn(0, -0.07, 0, -0.07, 0), ear_r: turn(0, 0.07, 0, 0.07, 0)
    }
  },
  // Quiet activities remain articulated; calm mode freezes one readable pose.
  breathe: {
    hold: 0.5,
    bones: {
      arm_l: turn(-0.3, -0.42, -0.3), arm_r: turn(0.3, 0.42, 0.3),
      ear_l: turn(-0.08, -0.16, -0.08), ear_r: turn(0.08, 0.16, 0.08),
      hand_l: turn(0.1, 0.18, 0.1), hand_r: turn(-0.1, -0.18, -0.1)
    }, props: ['cushion']
  },
  doze: {
    hold: 0.5,
    bones: {
      ear_l: turn(-0.2, -0.34, -0.43, -0.34, -0.2),
      ear_r: turn(0.15, 0.29, 0.38, 0.29, 0.15),
      arm_l: turn(-0.25, -0.35, -0.25), arm_r: turn(0.55, 0.7, 0.55),
      hand_r: turn(-0.3, -0.45, -0.3)
    }, props: ['pillow']
  },
  daydream: {
    hold: 0.5,
    bones: {
      arm_r: turn(0.25, 0.72, 0.8, 0.72, 0.25), arm_l: turn(-0.15, -0.23, -0.15),
      ear_l: turn(-0.12, -0.24, -0.12), ear_r: turn(0.06, 0.13, 0.06),
      leg_r: { r: cycle(0, 0.09, 0, -0.09, 0) }
    }
  },
  type: {
    hold: 0.5,
    bones: {
      arm_l: turn(-0.6, -0.86, -0.6, -0.76, -0.6), arm_r: turn(0.8, 0.58, 0.8, 0.66, 0.8),
      hand_l: lift(0, 1, 0, 0.8, 0), hand_r: lift(0.9, 0, 0.9, 0, 0.9),
      ear_l: turn(0, -0.05, 0), ear_r: turn(0, 0.07, 0)
    }, props: ['keyboard']
  },
  browse: {
    hold: 0.5,
    bones: {
      arm_l: turn(-0.6, -0.64, -0.6),
      arm_r: turn(0.6, 0.65, 0.9, 0.75, 0.6),
      hand_r: { r: cycle(-0.1, -0.1, 0.16, -0.1, -0.1), y: cycle(0, 0, 1.2, 0, 0) },
      ear_r: turn(0, 0.12, 0.04, 0.12, 0)
    }, props: ['laptop']
  },
  trade: {
    hold: 0.5,
    bones: {
      arm_l: turn(-0.5, -0.58, -0.5),
      arm_r: turn(0.25, 0.55, 1.1, 0.9, 0.55, 0.25),
      hand_r: turn(-0.15, -0.4, -0.8, -0.65, -0.4, -0.15),
      ear_l: turn(-0.03, -0.13, -0.03), ear_r: turn(0, 0.16, 0)
    }, props: ['chart']
  },
  organize: {
    hold: 0.5,
    bones: {
      arm_l: turn(-0.3, 0.15, -0.9, -0.6, -0.3),
      arm_r: turn(0.3, 0.6, 0.9, -0.15, 0.3),
      hand_l: turn(0, -0.15, 0.25, 0.1, 0), hand_r: turn(0, -0.1, -0.25, 0.15, 0),
      ear_l: turn(0, -0.08, 0, 0.08, 0)
    }, props: ['notes']
  },
  // Craft/tool work: grasp -> work stroke -> reset, with counter-rotated wrists.
  knit: {
    hold: 0.5,
    bones: {
      arm_l: turn(-0.65, -0.95, -0.78, -0.55, -0.65),
      arm_r: turn(0.78, 0.55, 0.65, 0.95, 0.78),
      hand_l: turn(0.18, -0.18, 0.18, 0.34, 0.18),
      hand_r: turn(-0.18, -0.34, -0.18, 0.18, -0.18),
      ear_r: turn(0, 0.08, 0)
    }, props: ['yarn', 'needle-l', 'needle-r']
  },
  drum: {
    hold: 0.5,
    bones: {
      arm_l: turn(-0.55, -1.1, -0.55, -0.25, -0.55),
      arm_r: turn(0.55, 0.25, 0.55, 1.1, 0.55),
      hand_l: turn(0, -0.3, 0, 0.2, 0), hand_r: turn(0, -0.2, 0, 0.3, 0),
      ear_l: turn(0, 0.12, 0, 0.12, 0), ear_r: turn(0, -0.12, 0, -0.12, 0)
    }, props: ['drum']
  },
  cook: {
    hold: 0.5,
    bones: {
      arm_r: turn(0.5, 0.7, 0.6, 0.95, 0.5), hand_r: turn(-0.5, -0.7, -0.6, -0.75, -0.5),
      arm_l: turn(-0.5, -0.8, -1.02, -0.7, -0.5),
      hand_l: { r: cycle(0.1, -0.2, 0.1, 0.25, 0.1), y: cycle(0, -0.8, 0, 0.8, 0) },
      ear_r: turn(0, 0.08, 0.02, 0.12, 0)
    }, props: ['pan']
  },
  picnic: {
    hold: 0.5,
    bones: {
      arm_l: turn(-0.3, -0.5, -0.7, -0.5, -0.3),
      arm_r: turn(0.4, 0.6, 1.55, 1.45, 0.6, 0.4),
      hand_r: turn(-0.2, -0.4, -1.25, -1.15, -0.4, -0.2),
      ear_l: turn(-0.04, -0.12, -0.04), ear_r: turn(0.04, 0.12, 0.04)
    }, props: ['picnic', 'snack']
  },
  build: {
    hold: 0.5,
    bones: {
      arm_l: turn(-0.2, 0.2, -0.9, -0.8, -0.2),
      arm_r: turn(0.2, 0.8, 0.9, -0.2, 0.2),
      hand_l: turn(0, -0.25, 0, 0.1, 0), hand_r: turn(0, -0.1, 0, 0.25, 0),
      ear_l: turn(0, -0.1, 0.04, -0.1, 0), ear_r: turn(0, 0.1, -0.04, 0.1, 0)
    }, props: ['blocks']
  },
  sweep: {
    hold: 0.5,
    bones: {
      arm_r: turn(0.15, -0.45, 0.65, -0.3, 0.15),
      hand_r: turn(-0.1, 0.1, -0.2, 0.1, -0.1),
      arm_l: turn(-0.25, -0.55, 0.35, -0.45, -0.25),
      ear_l: turn(0, -0.12, 0.12, -0.08, 0),
      leg_l: { r: cycle(0, 0.08, -0.08, 0, 0) }
    }, props: ['broom']
  },
  water: {
    hold: 0.5,
    bones: {
      arm_r: turn(0.25, 0.65, 0.85, 0.85, 0.65, 0.25),
      hand_r: turn(-0.25, -0.35, -0.1, -0.1, -0.35, -0.25),
      arm_l: turn(-0.25, -0.45, -0.6, -0.6, -0.45, -0.25),
      ear_l: turn(0, -0.1, -0.06, -0.1, 0)
    }, props: ['watering-can', 'plant']
  },
  telescope: {
    hold: 0.5,
    bones: {
      arm_r: turn(0.7, 1.35, 1.55, 1.35, 0.7),
      hand_r: turn(-0.6, -1.18, -1.48, -1.18, -0.6),
      arm_l: turn(-0.25, -0.65, -0.85, -0.65, -0.25),
      ear_l: turn(0, -0.18, -0.06, -0.18, 0), ear_r: turn(0, 0.13, 0.25, 0.13, 0)
    }, props: ['telescope']
  },
  look: {
    hold: 0.5,
    bones: {
      arm_l: turn(-0.6, -1.45, -1.6, -1.45, -0.6),
      arm_r: turn(0.6, 1.45, 1.6, 1.45, 0.6),
      ear_l: turn(0, -0.2, -0.05, 0.16, 0), ear_r: turn(0, -0.12, 0.05, 0.2, 0)
    },
    bare: { arm_l: turn(-0.1, -0.2, -0.1, 0.05, -0.1), arm_r: turn(0.1, -0.05, 0.1, 0.2, 0.1) },
    props: ['binoculars']
  },
  juggle: {
    hold: 0.5,
    bones: {
      arm_l: turn(-0.25, -1.05, -0.35, -0.65, -0.25),
      arm_r: turn(0.35, 0.65, 0.25, 1.05, 0.35),
      hand_l: turn(0.2, -0.35, 0.1, -0.15, 0.2), hand_r: turn(-0.1, 0.15, -0.2, 0.35, -0.1),
      ear_l: turn(0, -0.1, 0, 0.08, 0), ear_r: turn(0, -0.08, 0, 0.1, 0)
    }, props: ['balls']
  },
  magic: {
    hold: 0.6,
    bones: {
      arm_l: turn(-0.4, -0.6, -0.8, -0.2, -0.4),
      arm_r: turn(0.2, 0.85, 1.25, -1.3, 0.2),
      hand_r: turn(0, -0.3, -0.6, 0.3, 0),
      ear_l: turn(0, -0.12, 0.12, -0.1, 0), ear_r: turn(0, 0.08, -0.08, 0.2, 0)
    }, props: ['hat']
  },
  umbrella: {
    hold: 0.5,
    bones: {
      arm_r: turn(-0.28, -0.35, -0.28, -0.2, -0.28),
      hand_r: turn(0.28, 0.35, 0.28, 0.2, 0.28),
      arm_l: turn(0.1, 0.7, 0.1, -0.2, 0.1),
      leg_l: lift(0, -1, 0, 0, 0), leg_r: lift(0, 0, 0, -1, 0),
      ear_l: turn(0, -0.06, 0, 0.06, 0)
    }, props: ['umbrella']
  },
  float: {
    hold: 0.5,
    bones: {
      arm_r: turn(0.15, 0.65, 1.45, 1.45, 0.65, 0.15),
      hand_r: turn(-0.15, -0.5, -1.2, -1.2, -0.5, -0.15),
      arm_l: turn(-0.1, 0.15, 0.4, 0.4, 0.15, -0.1),
      ear_l: turn(0, -0.1, 0), ear_r: turn(0, 0.1, 0)
    }, props: ['bubble-wand']
  },
  // Anticipation and recoil are delayed between ears and paws, never one-frame jolts.
  pushup: {
    hold: 0.5,
    bones: {
      arm_l: { r: cycle(-0.1, -0.45, -0.1), y: cycle(0, 2.5, 0) },
      arm_r: { r: cycle(0.1, 0.45, 0.1), y: cycle(0, 2.5, 0) },
      leg_l: turn(0, -0.16, 0), leg_r: turn(0, 0.16, 0),
      ear_l: turn(0, -0.18, 0), ear_r: turn(0, 0.18, 0)
    }, props: ['headband']
  },
  box: {
    hold: 0.25,
    bones: {
      arm_l: { r: cycle(-0.55, -1.45, -0.55, -0.7, -0.55), x: cycle(0, 2, 0, 0, 0) },
      arm_r: { r: cycle(0.55, 0.7, 0.55, 1.45, 0.55), x: cycle(0, 0, 0, -2, 0) },
      hand_l: turn(0.1, -0.2, 0.1, 0.1, 0.1), hand_r: turn(-0.1, -0.1, -0.1, 0.2, -0.1),
      leg_l: lift(0, 0, -0.8, 0, 0), leg_r: lift(0, -0.8, 0, 0, 0),
      ear_l: turn(0, -0.1, 0, 0.1, 0)
    }, props: ['gloves-l', 'gloves-r']
  },
  hide: {
    hold: 0.5,
    bones: {
      arm_l: turn(-0.1, -0.7, -1.25, -1.25, -0.7, -0.1),
      arm_r: turn(0.1, 0.7, 1.25, 1.25, 0.7, 0.1),
      ear_l: turn(0, -0.3, -0.5, -0.5, -0.3, 0), ear_r: turn(0, 0.3, 0.5, 0.5, 0.3, 0)
    }, props: ['box']
  },
  fall: {
    hold: 0.65,
    bones: {
      arm_l: turn(0, -0.15, 0.9, 1.3, -0.6, 0),
      arm_r: turn(0, 0.15, -1.3, -0.9, 0.6, 0),
      ear_l: turn(0, 0.18, -0.28, -0.2, 0.1, 0), ear_r: turn(0, -0.18, 0.28, 0.2, -0.1, 0),
      leg_l: lift(0, 0, -3, -1, 0, 0), leg_r: lift(0, 0, -1, -3, 0, 0)
    }, props: ['hole']
  },
  hiccup: {
    hold: 0.5,
    bones: {
      arm_l: turn(-0.2, -0.3, -0.65, -0.25, -0.2),
      arm_r: turn(0.35, 0.35, 0.7, 0.45, 0.35),
      hand_r: turn(-0.35, -0.35, -0.7, -0.45, -0.35),
      ear_l: turn(0, -0.04, 0.25, -0.12, 0), ear_r: turn(0, 0.04, -0.25, 0.12, 0)
    }, props: ['cup']
  },
  recoil: {
    hold: 0.5,
    bones: {
      arm_r: turn(0.2, 0.7, 1.45, 0.5, 0.2),
      hand_r: turn(-0.1, -0.5, -1.2, -0.3, -0.1),
      arm_l: turn(-0.1, -0.4, -0.8, 0.45, -0.1),
      ear_l: turn(0, -0.15, 0.24, -0.1, 0), ear_r: turn(0, 0.15, -0.24, 0.1, 0)
    }, props: ['tissue']
  },
  squish: {
    hold: 0.5,
    bones: {
      arm_l: turn(0, -0.3, -0.6, -0.45, 0), arm_r: turn(0, 0.3, 0.6, 0.45, 0),
      ear_l: turn(0, -0.18, -0.38, -0.25, 0), ear_r: turn(0, 0.18, 0.38, 0.25, 0),
      leg_l: turn(0, -0.12, -0.24, -0.12, 0), leg_r: turn(0, 0.12, 0.24, 0.12, 0)
    }, props: ['ellipsis']
  }
});

// The short round paws need to reach each tool's authored working surface.
// These are local arm offsets, not body movement. Profile grips narrow to
// the near-side workspace instead of stretching the silhouette horizontally.
const GRIPS = Object.freeze({
  read: [7, 0, -7, 0], write: [8, 3, -8, 4],
  type: [9, 6, -9, 6], browse: [8, 8, -8, 8],
  trade: [8, 5, -6, 4], organize: [8, 4, -8, 4],
  knit: [9, 2, -9, 2], drum: [10, 4, -10, 4],
  cook: [12, 2, -4, 3], build: [7, 5, -7, 5],
  look: [7, -10, -7, -10], sip: [0, 0, -9, -3],
  chew: [9, -6, -10, -8], picnic: [4, 0, -8, -4],
  sway: [0, 0, -8, -4], float: [0, 0, -8, -4],
  telescope: [6, -3, -3, -9], umbrella: [0, 0, 10, 0]
});
const PROFILE_GRIPS = Object.freeze({
  look: [15, -10, 5, -10], sip: [0, 0, 16, -8],
  chew: [9, -6, 14, -8], picnic: [4, 0, 12, -4],
  sway: [0, 0, 12, -4], float: [0, 0, 12, -4],
  telescope: [6, -3, 12, -9], umbrella: [0, 0, 20, 0]
});
const TURNED_GRIPS = Object.freeze({
  look: [13, -10, 0, -10], sip: [0, 0, 3, -3],
  chew: [9, -6, 2, -8], picnic: [4, 0, 4, -4],
  sway: [0, 0, 4, -4], float: [0, 0, 4, -4],
  telescope: [6, -3, 5, -9], umbrella: [0, 0, 17, 0]
});

const smooth = t => t * t * (3 - 2 * t);

function sampleTrack(keys, t) {
  if (!Array.isArray(keys) || !keys.length) return undefined;
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i += 1) {
    const [t1, v1] = keys[i];
    if (t <= t1) {
      const [t0, v0] = keys[i - 1];
      const span = t1 - t0;
      return span <= 0 ? v1 : v0 + (v1 - v0) * smooth((t - t0) / span);
    }
  }
  return keys[keys.length - 1][1];
}

function usesBarePose(motion, prop) {
  return Boolean(MOTIONS[motion]?.bare && typeof prop === 'string' && prop !== 'binoculars');
}

function tracksFor(motion, view, prop) {
  const definition = MOTIONS[motion];
  const bare = usesBarePose(motion, prop);
  const base = { ...definition?.bones, ...(bare ? definition?.bare : {}) };
  const grip = !bare && prop !== 'none' && ((view === 'profile' ? PROFILE_GRIPS[motion] : view === 'three-quarter' ? TURNED_GRIPS[motion] : null) || GRIPS[motion]);
  if (grip) {
    for (const [i, bone] of ['arm_l', 'arm_r'].entries()) {
      const scale = view === 'profile' && !PROFILE_GRIPS[motion] ? 0.65 : 1;
      base[bone] = { ...base[bone], x: cycle(grip[i * 2] * scale, grip[i * 2] * scale),
        y: cycle(grip[i * 2 + 1], grip[i * 2 + 1]) };
    }
  }
  if (prop === 'cup' && motion !== 'sip' && base.arm_r?.r) {
    base.hand_r = { ...base.hand_r, r: base.arm_r.r.map(([t, angle]) => [t, -angle]) };
  }
  const override = MOTIONS[motion]?.views?.[view];
  if (!override) return base;
  const merged = { ...base };
  for (const [bone, channels] of Object.entries(override)) merged[bone] = { ...(base[bone] || {}), ...channels };
  return merged;
}

function motionKey(motion, view) {
  return MOTIONS[motion]?.views?.[view] ? `${motion}@${view}` : motion;
}

// Returns local bone poses plus the props this motion shows. Calm visuals
// get the motion's single held pose: legible, but with no oscillation.
function sampleMotion(motion, { view = 'front', progress = 0, calmVisual = false, prop } = {}) {
  const name = MOTIONS[motion] ? motion : 'idle';
  const definition = MOTIONS[name];
  const numeric = Number(progress);
  const t = calmVisual ? definition.hold : Number.isFinite(numeric) ? ((numeric % 1) + 1) % 1 : 0;
  const bones = {};
  for (const [bone, channels] of Object.entries(tracksFor(name, view, prop))) {
    const local = {};
    for (const [channel, keys] of Object.entries(channels)) {
      const value = sampleTrack(keys, t);
      if (Number.isFinite(value)) local[channel] = value;
    }
    bones[bone] = Object.freeze(local);
  }
  return Object.freeze({
    motion: name, key: `${motionKey(name, view)}${usesBarePose(name, prop) ? ':bare' : ''}`,
    bones: Object.freeze(bones),
    props: resolveMotionProps(definition.props, prop, name),
    propPoses: samplePropPoses(name, t, calmVisual)
  });
}

const IDLE_PERIOD_MS = 3200;
function idleProgress(elapsedMs) {
  const ms = Number(elapsedMs);
  return Number.isFinite(ms) ? (ms % IDLE_PERIOD_MS) / IDLE_PERIOD_MS : 0;
}

const MOTION_NAMES = Object.freeze(Object.keys(MOTIONS));
const BONE_NAMES = Object.freeze([...new Set(['root', 'body', 'head',
  ...Object.values(MOTIONS).flatMap(m => [
    ...Object.keys(m.bones), ...Object.values(m.views || {}).flatMap(Object.keys)
  ])])]);

export { MOTIONS, MOTION_NAMES, PROP_NAMES, BONE_NAMES, sampleTrack, sampleMotion, motionKey, idleProgress };
export default Object.freeze({
  MOTIONS, MOTION_NAMES, PROP_NAMES, BONE_NAMES, sampleTrack, sampleMotion, motionKey, idleProgress
});
