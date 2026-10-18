import { compileActionConfiguration, ConfigurationError } from "./index.mjs";

const POINTER_PROFILES = Object.freeze({
  "baseline-idle": {
    priority: 0,
    enterSec: 0.16,
    exitSec: 0.2,
    loop: "while-fact-active",
    resources: ["body.action"],
  },
  "pointer-longpress": {
    priority: 50,
    enterSec: 0.16,
    exitSec: 0.2,
    loop: "while-input-held",
    resources: ["body.action", "face.semantic"],
  },
  "pointer-drag": {
    priority: 100,
    enterSec: 0.22,
    exitSec: 1.5,
    loop: "while-input-held",
    resources: ["body.action", "face.semantic"],
  },
});

/** One schema, two admission stages: structure and the host's actual executable ports. */
export function compileRuntimeConfiguration(raw, context) {
  const plan = compileActionConfiguration(raw, context);
  for (const action of plan.configuration.actions) {
    const inherited = POINTER_PROFILES[action.body];
    if (inherited) {
      const unchanged = Object.entries(inherited).every(
        ([key, value]) => JSON.stringify(action[key]) === JSON.stringify(value),
      );
      if (
        !unchanged ||
        action.bones.length ||
        action.expressions.length ||
        action.contactWindows.length ||
        action.effectTracks.length ||
        action.durationSec !== 1 ||
        action.maxLoops !== 1
      ) {
        throw new ConfigurationError("INHERITED_POINTER_POLICY", action.id);
      }
    } else {
      if (!context.authoredActions) {
        throw new ConfigurationError(
          "AUTHORED_ACTION_PORT_REQUIRED",
          action.id,
        );
      }
      if (action.expressions.length && !context.facePort) {
        throw new ConfigurationError("FACE_BATCH_PORT_REQUIRED", action.id);
      }
      if (action.contactWindows.length && !context.contactPort) {
        throw new ConfigurationError("CONTACT_PORT_REQUIRED", action.id);
      }
      if (action.effectTracks.length && !context.effectPort) {
        throw new ConfigurationError("EFFECT_PORT_REQUIRED", action.id);
      }
      if (action.loop === "finite" && action.maxLoops !== 1) {
        throw new ConfigurationError("FINITE_LOOP_COUNT", action.id);
      }
      if (action.priority >= 50) {
        throw new ConfigurationError("POINTER_PRIORITY_RESERVED", action.id);
      }
      if (action.loop === "while-input-held") {
        throw new ConfigurationError(
          "AUTHORED_INPUT_LOOP_UNSUPPORTED",
          action.id,
        );
      }
    }
  }
  return plan;
}
