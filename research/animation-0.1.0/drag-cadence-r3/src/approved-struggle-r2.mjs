const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
export const APPROVED_STRUGGLE_R2 = freeze({
  "beat_A": {
    "body": {
      "x": 0,
      "y": 0,
      "z": 0
    },
    "joints": {
      "Shoulder_L": {
        "x": 0,
        "y": -0.08,
        "z": -0.18
      },
      "Shoulder_R": {
        "x": 0,
        "y": -0.08,
        "z": -0.18
      },
      "Hip_L": {
        "x": -0.135,
        "y": 0,
        "z": -0.025
      },
      "Hip_R": {
        "x": 0.135,
        "y": 0,
        "z": 0.025
      }
    }
  },
  "beat_B": {
    "body": {
      "x": 0,
      "y": 0,
      "z": 0
    },
    "joints": {
      "Shoulder_L": {
        "x": 0,
        "y": 0.08,
        "z": 0.18
      },
      "Shoulder_R": {
        "x": 0,
        "y": 0.08,
        "z": 0.18
      },
      "Hip_L": {
        "x": 0.135,
        "y": 0,
        "z": 0.025
      },
      "Hip_R": {
        "x": -0.135,
        "y": 0,
        "z": -0.025
      }
    }
  }
});
