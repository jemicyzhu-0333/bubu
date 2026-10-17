/** Static18 approval + exact-array/104-frame merged-source gate.
 * This registration permits only the reviewed seven-slot transition closure.
 * It does not approve transition appearance, skeletal interaction or WebGL. */
const source={
  "sha256": "a9ae09635658ac15c55cf1571db53e284bd463eaab9a84ff24e7836270a1808e",
  "approvalMessageID": "Sentinel_fa6cf24f4da88191b7c704f6355aa0a0",
  "paths": {
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
    },
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
    }
  }
};
for(const p of Object.values(source.paths)){Object.freeze(p.targets);Object.freeze(p);}
Object.freeze(source.paths);
export const APPROVED_FACE_SOURCE=Object.freeze(source);
