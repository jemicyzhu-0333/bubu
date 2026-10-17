/** Explicit CPU capability candidate; no GPU/interaction certification. */
const source={
  "sha256": "1100131118479ecb266c029082d311f18e5b2564ad0a1077182ac934e769d677",
  "approvalMessageID": "Sentinel_fa6cf24f4da88191b7c704f6355aa0a0",
  "slotIds": [
    "R0",
    "D1",
    "A7",
    "D4",
    "01",
    "N2",
    "N3",
    "T05",
    "07",
    "P2",
    "08",
    "A4",
    "04",
    "A8",
    "S2",
    "S3",
    "T5",
    "S5"
  ],
  "paths": {
    "R0": {
      "meaning": "quiet short-neutral",
      "targets": [
        "BasicR0_01",
        "BasicR0_02",
        "BasicR0_03",
        "BasicR0_04",
        "BasicR0_05",
        "BasicR0_06",
        "BasicR0_07",
        "BasicR0_08"
      ]
    },
    "D1": {
      "meaning": "tired but awake",
      "targets": [
        "BasicD1_01",
        "BasicD1_02",
        "BasicD1_03",
        "BasicD1_04",
        "BasicD1_05",
        "BasicD1_06",
        "BasicD1_07",
        "BasicD1_08"
      ]
    },
    "A7": {
      "meaning": "natural sleep",
      "targets": [
        "BasicA7_01",
        "BasicA7_02",
        "BasicA7_03",
        "BasicA7_04",
        "BasicA7_05",
        "BasicA7_06",
        "BasicA7_07",
        "BasicA7_08"
      ]
    },
    "D4": {
      "meaning": "yawn transition",
      "targets": [
        "BasicD4_01",
        "BasicD4_02",
        "BasicD4_03",
        "BasicD4_04",
        "BasicD4_05",
        "BasicD4_06",
        "BasicD4_07",
        "BasicD4_08"
      ]
    },
    "01": {
      "meaning": "curious/light startle",
      "targets": [
        "Face01_01",
        "Face01_02",
        "Face01_03",
        "Face01_04",
        "Face01_05",
        "Face01_06",
        "Face01_07",
        "Face01_08"
      ]
    },
    "N2": {
      "meaning": "puzzled",
      "targets": [
        "BasicN2_01",
        "BasicN2_02",
        "BasicN2_03",
        "BasicN2_04",
        "BasicN2_05",
        "BasicN2_06",
        "BasicN2_07",
        "BasicN2_08"
      ]
    },
    "N3": {
      "meaning": "strong surprise with small inner tongue",
      "targets": [
        "BasicN3_01",
        "BasicN3_02",
        "BasicN3_03",
        "BasicN3_04",
        "BasicN3_05",
        "BasicN3_06",
        "BasicN3_07",
        "BasicN3_08"
      ]
    },
    "T05": {
      "meaning": "mild uneasy/braced attention revised",
      "targets": [
        "BasicT05_01",
        "BasicT05_02",
        "BasicT05_03",
        "BasicT05_04",
        "BasicT05_05",
        "BasicT05_06",
        "BasicT05_07",
        "BasicT05_08"
      ]
    },
    "07": {
      "meaning": "open happy smile",
      "targets": [
        "Face07_01",
        "Face07_02",
        "Face07_03",
        "Face07_04",
        "Face07_05",
        "Face07_06",
        "Face07_07",
        "Face07_08"
      ]
    },
    "P2": {
      "meaning": "quiet contentment",
      "targets": [
        "BasicP2_01",
        "BasicP2_02",
        "BasicP2_03",
        "BasicP2_04",
        "BasicP2_05",
        "BasicP2_06",
        "BasicP2_07",
        "BasicP2_08"
      ]
    },
    "08": {
      "meaning": "relaxed half-lid smile",
      "targets": [
        "Face08_01",
        "Face08_02",
        "Face08_03",
        "Face08_04",
        "Face08_05",
        "Face08_06",
        "Face08_07",
        "Face08_08"
      ]
    },
    "A4": {
      "meaning": "serious focus",
      "targets": [
        "BasicA4_01",
        "BasicA4_02",
        "BasicA4_03",
        "BasicA4_04",
        "BasicA4_05",
        "BasicA4_06",
        "BasicA4_07",
        "BasicA4_08"
      ]
    },
    "04": {
      "meaning": "brief effort squeeze",
      "targets": [
        "Face04_01",
        "Face04_02",
        "Face04_03",
        "Face04_04",
        "Face04_05",
        "Face04_06",
        "Face04_07",
        "Face04_08"
      ]
    },
    "A8": {
      "meaning": "impatient",
      "targets": [
        "BasicA8_01",
        "BasicA8_02",
        "BasicA8_03",
        "BasicA8_04",
        "BasicA8_05",
        "BasicA8_06",
        "BasicA8_07",
        "BasicA8_08"
      ]
    },
    "S2": {
      "meaning": "friendly availability",
      "targets": [
        "BasicS2_01",
        "BasicS2_02",
        "BasicS2_03",
        "BasicS2_04",
        "BasicS2_05",
        "BasicS2_06",
        "BasicS2_07",
        "BasicS2_08"
      ]
    },
    "S3": {
      "meaning": "worried",
      "targets": [
        "BasicS3_01",
        "BasicS3_02",
        "BasicS3_03",
        "BasicS3_04",
        "BasicS3_05",
        "BasicS3_06",
        "BasicS3_07",
        "BasicS3_08"
      ]
    },
    "T5": {
      "meaning": "closed-eye setback/sadness",
      "targets": [
        "BasicT5_01",
        "BasicT5_02",
        "BasicT5_03",
        "BasicT5_04",
        "BasicT5_05",
        "BasicT5_06",
        "BasicT5_07",
        "BasicT5_08"
      ]
    },
    "S5": {
      "meaning": "open-eye sadness",
      "targets": [
        "BasicS5_01",
        "BasicS5_02",
        "BasicS5_03",
        "BasicS5_04",
        "BasicS5_05",
        "BasicS5_06",
        "BasicS5_07",
        "BasicS5_08"
      ]
    }
  }
};
for(const p of Object.values(source.paths)){Object.freeze(p.targets);Object.freeze(p);}
Object.freeze(source.paths);Object.freeze(source.slotIds);
export const APPROVED_FULL_FACE_SOURCE=Object.freeze(source);
export const FULL_FACE_PROFILE_SHA256="1d2a1de36a5f2ead25aa0b0d64d13f1c31011410a785cf963c84b6f28e631c45";
