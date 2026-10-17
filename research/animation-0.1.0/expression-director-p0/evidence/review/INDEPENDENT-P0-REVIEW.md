# Independent Expression Director P0 review

Result: PASS within the fixed one-shot scalar scheduling contract. This is not approval of artistic parameters or a claim of production actor/input/render integration.

Reviewed director source SHA256: e692c55738e8837e12e25734d63ea8e97478d0e04d0423a38609b32a4d62a454.

## Evidence

- Independent adversarial probe: 20/20 groups passed (`independent-p0.mjs`, `independent-p0.json`).
- Complete implementation test suite independently rerun: 28/28 passed (`independent-full-suite.txt`).
- Budget 1/2/3/64 and 30/60/120 Hz runs preserve canonical records and final state against a large-jump run.
- Another 60 deterministic adversarial histories, each containing 32 event batches, match under budget-1 catch-up and budget-2 30 Hz advancement.
- Vendor FaceTimeline and approved-face-source modules compare byte-identical with facepath06. Profile digest matches the actual facepath06 profile file.

## Critical outcomes

Owner/request/lifetime identity blocks stale releases, including reused display labels. Same-time release and new request transfer ownership without cancel+face. Release at arrival suppresses the obsolete hold. Restart at arrival/hold expiry uses the current logical request rather than stale low-level actualArrival. Keep at hold expiry does not extend it. A different owner gets a new logical hold.

Cross-face braking is included in actual arrival before hold. Safe same-face return during exit remains on the same path. Gap is measured after Basis; releasing during gap terminates with Infinity deadline. Large-jump budget exhaustion retains events and target, rejects mutation during catch-up, and does not duplicate lifecycle records.

Global reset wins regardless of batch order, clears future time admissions, but cannot recycle lifetime identities. Cross-owner lifetime reuse, nonintegers, unsafe integers, coercion, rollback and wrap reject. Invalid mixed batches do not consume lifetime serials. Losing and cleared future requests still consume identity highwater. This is O(1) retained identity state, not an unbounded history Set.

## Findings fixed during review

1. Request priority initially used property-key coercion. A priority object could execute toString and remain mutable after admission. Fixed by exact primitive-string validation before enum lookup; independently verified zero coercion calls.
2. Initial identity contract did not make repeated requestId labels distinguishable from stale releases. A globally monotonic positive safe-integer lifetime is now required in requests and matching releases, independent of internal scheduling tokens. Reset does not rewind it.

## Scope and limits

The P0 scope is suitably small: strict policy validation, fixed request/arrival/hold/exit/gap lifecycle, input arbitration, bounded catch-up and unified deadlines. Whole same-time batches must be submitted before the timestamp is sealed. It cannot retroactively arbitrate late same-time input.

Random weighting, nonuniform distributions, contexts/conditions/cooldowns, automatic idle repetition, hidden/resume clock mapping, reduced-motion behavior, time-map curves and drag/long-press are explicitly not implemented. The numeric policy values are mechanical fixtures, not approved acting parameters. The trusted scalar sink does not itself prove ActorPool or all-eight-layer production integration. Rendering and facepath06 were not changed by this review.
