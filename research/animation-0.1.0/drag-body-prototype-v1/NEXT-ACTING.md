# Readability finding and next bounded iteration

Current functional checkpoint is not artistic acceptance. Fixed 52-degree quarter view, span 5, 384px rendering gives approximately 138px body height. Actual limb centroid displacement, after removing the whole actor transform, peaks at 2.01–2.20px. The motion is genuinely skeletal, but much smaller than pointer-induced whole-character translation.

Measured maxima in this trajectory: shoulder L/R 0.1383/0.1514rad; hip L/R 0.1105/0.1035rad. None saturates the audited .20/.14 caps. Therefore the present result alone does NOT prove that the rig range is insufficient.

A small next comparison, before any asset change:
1. Keep identical input and limits; render front/10-degree vs current52-degree quarter at the same fixed scale. This reveals whether far-side occlusion and projection cancel the shoulder/hip axes.
2. Give hover a longer stationary section, separate hand and foot phase by roughly a quarter cycle, and hold directional extrema slightly longer. The present hover diagnostic also contains the N3-to-01 facial transition, which competes with tiny limb signals.
3. Use more of the available audited rotation envelope with the established parent-space axes, without exceeding the combined quaternion caps. Compare actual tip and centroid displacement, not only angle values or whole-body movement.
4. For stop/reversal, compare limb-local trajectory against pointer velocity and whole-body translation. Keep the lag long enough to be readable at normal speed, without repeatedly restarting the track on each pointer sample.

If those bounded comparisons still cannot produce readable independent limbs, the next change is a NEW body-capability revision: reviewed pivot/weight distribution or limb deformation envelope, with rest-shape parity, seam/root deformation tests and new continuous visual approval. Do not silently increase caps to .33rad; that historical stress level is known to fold the geometry. No asset or envelope revision is included in this checkpoint.
