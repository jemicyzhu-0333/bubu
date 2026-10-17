# Archived pointer v3 initialization cleanup defect

The frozen pointer v3 implementation allocates its actor before registering DOM listeners and scheduling initial RAF. If registration or initial scheduling throws, the caller receives no host handle and cannot dispose retained actor/cache/listeners. The 22 archived CPU tests did not exercise this failure path.

The maintained implementation is research/animation-0.1.0/shared-input-workbench-v1. It supports original full18 and explicit D2 admission on one canonical runtime/P1 chain. It cleans admission/body construction, all post-admission initialization and runtime faults, and attempts all teardown stages even if one cleanup throws. Its tests include failure injection and actual-model resource-zero assertions. This archived source remains unchanged to preserve reproducibility, not as a recommended runtime dependency.

Neither entry constitutes production src integration, compiled GLSL/WebGL validation, actual browser/OS pointer acceptance or final artistic approval.
