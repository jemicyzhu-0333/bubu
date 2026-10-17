# Sip-tea first capability checkpoint

## Result
Cup asset prototype delivered and independently checkpointed by the parent. No sip-tea action migration is complete. Current body, face, drag, petting and host are unchanged.

## Evidence
- `actual-cup-reach-gap.png`: actual D2 with ungrasped cup at low and rim-touch heights; front, quarter, side. Blender rendering of actual CPU geometry, not WebGL or OS validation.
- `cup-reach.json`: upright normal cup at mouth contact requires grip radii 1.184712/1.274846 from right/left shoulders; measured hand radii .389900/.389900. Necessary residuals .794812/.884946 before collision testing.
- `failed-carrier-fourposes.png`: first isolated offline derivative, rest/prepare/grip/rim and front/quarter/side/back. Original connected mesh/weights, no production actor writes. Shoulder root develops severe dents.
- `experiment-metrics.json`: rest exact, feet unchanged; preparation max edge ratio3.140722 and rim11.102671 fail proposed1.35. Normal reversals are descriptive only, not a verified self-intersection/inversion count.
- Independent `../bubu-action-rig-review-20261017/patch-reach-bound.json` and `.py`: proposed bounded reweight patch cannot realize the same target while preserving1.35 edge stretch. At final pose necessary max stretch lower bounds are left5.437/right4.894; even25% preparation needs1.973/1.834. Therefore a same-target smoothstep reweight is not attempted.

## Stopped scope
No enlarged shoulder cap, new runtime profile, source whitelist bypass, detached hand, torso-wide weight expansion, second owner/clock or scene integration. Full self-intersection, signed cup volume, swept path contact, interruption and resource lifecycle scene checks were not reached. They must not be reported passed.

## Next design gate
Reconsider the short-fin action and cup contact as a pair, rather than chasing the generated illustration's relocated hand roots. Any broader articulation requires a separately reviewed explicit patch/rig design and rest/face/feet identity checks. The current cup can be reused independently. V1 #1/#2 and #27 all remain unmigrated; #27 was selected only as the first representative capability experiment.

## Publication
Only `overlay/research/animation-0.1.0/sip-tea-prototype-v1/` is the cup checkpoint. Root reports verified commit23ea28a620f74cdebd8492fdbba96e8514ce891b. Do not publish raw large frame JSON, images/videos, node_modules or rejected rig as production assets. This report and the small reproduction scripts can be archived as failed research evidence.
