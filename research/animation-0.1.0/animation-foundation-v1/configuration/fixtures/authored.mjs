import { FIXTURES } from "./index.mjs";

export const AUTHORED_CLIP_LIBRARY = {
  format: "bubu-clips",
  version: "0.1.0",
  id: "foundation-accessory-clips",
  clips: [
    {
      id: "halo-tilt",
      durationSec: 1,
      endBehavior: "hold",
      tracks: [
        {
          target: "accessory:halo",
          interpolation: "LINEAR",
          keys: [
            { at: 0, rotation: [0, 0, 0, 1] },
            { at: 0.5, rotation: [0, 0, Math.sin(0.1), Math.cos(0.1)] },
            { at: 1, rotation: [0, 0, 0, 1] },
          ],
        },
      ],
    },
  ],
};
export const AUTHORED_HALO_FIXTURE = structuredClone(FIXTURES[4]);
AUTHORED_HALO_FIXTURE.id = "halo-authored-strategy";
AUTHORED_HALO_FIXTURE.actions.push({
  id: "halo-greeting",
  factKey: "greeting",
  priority: 20,
  resources: ["body.action", "accessory:halo"],
  body: "accessory-authored",
  bones: [
    {
      target: "accessory:halo",
      clipId: "halo-tilt",
      writer: "authored-quaternion-clips",
    },
  ],
  expressions: [],
  contactWindows: [],
  enterSec: 0.1,
  exitSec: 0.2,
  loop: "finite",
  interrupt: "sample-current-release-owner",
  durationSec: 1,
  maxLoops: 1,
  effectTracks: [
    { at: 0.25, effectId: "halo-local", event: "burst", count: 2 },
    { at: 0.75, effectId: "halo-local", event: "stop", count: 0 },
  ],
});

/** Five executable strategies. Body motion remains the approved pointer profile.
 * Soft assets own their existing secondary chains; authored clips never compete with them.
 */
export const AUTHORED_CASES = FIXTURES.map((fixture, index) => {
  const configuration = structuredClone(fixture);
  configuration.id = `${fixture.id}-authored`;
  const mountId =
    index === 0 ? "sakura" : index === 3 ? "book" : index === 4 ? "halo" : null;
  const target = mountId ? `accessory:${mountId}` : null;
  const clipId = mountId ? `${mountId}-acknowledge` : null;
  const action = {
    id: `${fixture.id}-acknowledge`,
    factKey: "acknowledge",
    priority: 20,
    resources: ["body.action", "face.semantic", ...(target ? [target] : [])],
    body: "accessory-authored",
    bones: target
      ? [{ target, clipId, writer: "authored-quaternion-clips" }]
      : [],
    expressions: [
      {
        at: 0.1,
        candidate: "P2",
        amount: 0.5,
        owner: "WeightedExpressionOwner",
      },
    ],
    contactWindows:
      index === 3
        ? [
            {
              mountId: "book",
              anchor: "palm.gripR",
              start: 0,
              end: 0.8,
              release: "synthetic-release",
            },
          ]
        : [],
    enterSec: 0.1,
    exitSec: 0.2,
    loop: "finite",
    interrupt: "sample-current-release-owner",
    durationSec: 1,
    maxLoops: 1,
    effectTracks: configuration.effects.length
      ? [
          {
            at: 0.25,
            effectId: configuration.effects[0].id,
            event: "burst",
            count: 2,
          },
        ]
      : [],
  };
  configuration.actions.push(action);
  const clipLibrary = target
    ? {
        format: "bubu-clips",
        version: "0.1.0",
        id: clipId,
        clips: [
          {
            id: clipId,
            durationSec: 1,
            endBehavior: "hold",
            tracks: [
              {
                target,
                interpolation: "LINEAR",
                keys: [
                  { at: 0, rotation: [0, 0, 0, 1] },
                  { at: 0.5, rotation: [0, 0, Math.sin(0.08), Math.cos(0.08)] },
                  { at: 1, rotation: [0, 0, 0, 1] },
                ],
              },
            ],
          },
        ],
      }
    : undefined;
  return {
    configuration,
    clipLibrary,
    authoredFaces: [
      { candidate: "P2", amount: 0.5, enterSec: 0.1, exitSec: 0.2 },
    ],
  };
});
