# CPU matrix evidence summary

Measured 10 generated workloads × 1/4 actors × 10 repeated within-process runs. Source unchanged: true.

Steady numbers below are medians of the per-run median batch-throughput means, in milliseconds per group tick. They are not individual-call latency. Individual latency is measured separately and retained in the JSON.

| Workload | Vertices / joints / nodes / morphs per actor | 1 actor steady ms | 4 actors steady ms | preparePack median ms |
| --- | --- | ---: | ---: | ---: |
| vertices-small | 1008 / 8 / 66 / 4 | 0.007744 | 0.033129 | 6.737 |
| vertices-medium | 12000 / 8 / 66 / 4 | 0.007993 | 0.032902 | 16.361 |
| vertices-large | 45000 / 8 / 66 / 4 | 0.005606 | 0.022573 | 37.150 |
| joints-low | 12000 / 4 / 66 / 4 | 0.004211 | 0.018979 | 14.890 |
| joints-high | 12000 / 48 / 66 / 4 | 0.016210 | 0.068236 | 12.716 |
| nodes-low | 12000 / 8 / 18 / 4 | 0.004001 | 0.016177 | 10.779 |
| nodes-high | 12000 / 8 / 114 / 4 | 0.007004 | 0.052973 | 8.485 |
| morph-low | 12000 / 8 / 66 / 2 | 0.007767 | 0.032798 | 8.213 |
| morph-high | 12000 / 8 / 66 / 16 | 0.004487 | 0.019155 | 12.324 |
| combined-large | 45000 / 48 / 114 / 8 | 0.012436 | 0.060689 | 28.300 |

All 500 direct runtime creations and 500 ActorPool creations reached zero owned cache references/live resources after disposal. All 200 pool groups deduplicated their one GLB source, rejected over-budget admission, and ended with zero actor/source reservations. This is ownership accounting, not proof of GC/VRAM reclamation.

Total observed canonical actor ticks: 7638000; event evaluations: 301000. Calls to instrumented SkinnedMesh.getVertexPosition: 0. This only counts that method and is not a zero-allocation/no-scan proof.

Interpretation: isolated joint/node sweeps visibly affect steady CPU work. A vertex-count increase primarily changes preparation/preflight in this CPU path. Full skinning/morph deformation and rendering are not measured. The morph-target sweep is not monotonic in this run; fixed workload order and shared-host/JIT/GC variation prevent a causal per-target cost estimate. No hardware frame-rate, GPU-memory, browser-input, art-quality, or allocation claim is made.

Node v24.19.0; Three.js 0.186.1; AMD EPYC 9V74 80-Core Processor; reported logical CPUs 9, available parallelism 9, cgroup cpu.max null.

Source fingerprint: 0ef73486404853218b395d9f933f94994ce1239bb69162616da7b7d61da9ff3d.

See tools/MEASUREMENT.md for commands, phase boundaries and limitations; evidence/cpu-matrix.json for full raw observations; evidence/measurement-tests.tap for five focused passing tests.
