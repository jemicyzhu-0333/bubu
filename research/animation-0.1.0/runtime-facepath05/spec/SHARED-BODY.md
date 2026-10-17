# Controlled body capability for shared full18 / D2

ActorPool accepts optional bodyProfile = approved05-four-limb-rotation-prototype-v1. The fixed capability is allowed only for createWeighted with exactly admitted full18 or D2 source/profile pairs. It never changes resource admission or source geometry preparation. create/createDirected and slice7 cannot use this capability.

Only Shoulder_L/Shoulder_R quaternion deviations up to .20 radians and Hip_L/Hip_R up to .14 radians are permitted from source rest. Quaternions must be finite and unit (existing tolerance). Every position/scale and every other quaternion remains strict source rest. The default face-only pool keeps all quaternion checks strict. This is trusted host capability, not an arbitrary animation/driver plugin or sandbox.

D2 binding/style creation, sole apply ordering, source cache, mask and private materials, decoded reservations and disposal remain unchanged. Style reset does not reset body; the host body writer resets its own four joints. Body reset does not alter N3 style. Lifecycle failure disposes both through shared host cleanup. No additional face timeline is introduced.
