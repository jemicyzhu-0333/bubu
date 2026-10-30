/** Measurements in model units. Observes the native state without changing it.
 * Kinetic + gravitational energy excludes elastic/contact/actuator work and
 * therefore is not a total-energy conservation certificate. */
export function createClothStabilityMeasure(rest, cells, masses) {
  if (!rest?.length || rest.length % 3 || rest.length / 3 > 2048 ||
      !cells?.length || cells.length % 4 || cells.length / 4 > 4096 ||
      masses?.length !== rest.length / 3 || !rest.every(Number.isFinite) ||
      !masses.every(m => Number.isFinite(m) && m > 0))
    throw Error('Bounded finite cloth state required');
  const count = masses.length;
  if (!cells.every(i => Number.isSafeInteger(i) && i >= 0 && i < count))
    throw Error('Invalid material cell');
  const topology = Uint32Array.from(cells), initial = Float64Array.from(rest);
  const mass = Float64Array.from(masses);
  function signedVolume(values, offset) {
    const a = topology[offset] * 3, b = topology[offset + 1] * 3;
    const c = topology[offset + 2] * 3, d = topology[offset + 3] * 3;
    const ux = values[b]-values[a], uy = values[b+1]-values[a+1], uz = values[b+2]-values[a+2];
    const vx = values[c]-values[a], vy = values[c+1]-values[a+1], vz = values[c+2]-values[a+2];
    const wx = values[d]-values[a], wy = values[d+1]-values[a+1], wz = values[d+2]-values[a+2];
    return (ux*(vy*wz-vz*wy) + uy*(vz*wx-vx*wz) + uz*(vx*wy-vy*wx)) / 6;
  }
  const volumes = Float64Array.from({length: topology.length / 4}, (_, i) => signedVolume(initial, i*4));
  if (!volumes.every(v => v > 0)) throw Error('Positive rest cells required');
  return ({positions, velocities, gravity}) => {
    if (positions?.length !== initial.length || velocities?.length !== initial.length ||
        !positions.every(Number.isFinite) || !velocities.every(Number.isFinite) ||
        !gravity || !['x','y','z'].every(k => Number.isFinite(gravity[k])))
      throw Error('Finite matching position and velocity state required');
    let kineticEnergy = 0, gravitationalDelta = 0, maximumSpeed = 0;
    for (let i = 0; i < count; i++) {
      const k = i*3, speed = Math.hypot(velocities[k], velocities[k+1], velocities[k+2]);
      kineticEnergy += .5*mass[i]*speed*speed;
      gravitationalDelta -= mass[i]*(gravity.x*(positions[k]-initial[k]) +
        gravity.y*(positions[k+1]-initial[k+1]) + gravity.z*(positions[k+2]-initial[k+2]));
      maximumSpeed = Math.max(maximumSpeed, speed);
    }
    let invertedCells = 0, collapsedCells = 0, minimumRatio = Infinity, maximumRatio = -Infinity, worstCell = -1;
    for (let i = 0; i < volumes.length; i++) {
      const volume = signedVolume(positions, i*4), ratio = volume / volumes[i];
      if (volume < 0) invertedCells++;
      if (volume === 0) collapsedCells++;
      if (ratio < minimumRatio) { minimumRatio = ratio; worstCell = i; }
      maximumRatio = Math.max(maximumRatio, ratio);
    }
    return {kineticEnergy, gravitationalDelta, kineticPlusGravity: kineticEnergy + gravitationalDelta,
      maximumSpeed, invertedCells, collapsedCells, minimumSignedVolumeRatio: minimumRatio,
      maximumSignedVolumeRatio: maximumRatio, worstCell,
      worstParticleIds: Array.from(topology.subarray(worstCell*4, worstCell*4+4))};
  };
}
