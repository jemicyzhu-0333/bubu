import * as T from "three";
export const setWorld = (root, world) => {
  root.parent?.updateWorldMatrix(true, false);
  root.matrix.copy(
    root.parent
      ? root.parent.matrixWorld.clone().invert().multiply(world)
      : world,
  );
  root.matrixAutoUpdate = false;
  root.updateMatrixWorld(true);
};
export function sampler(previous, current, start, end) {
  const aP = new T.Vector3(),
    bP = new T.Vector3(),
    aQ = new T.Quaternion(),
    bQ = new T.Quaternion(),
    aS = new T.Vector3(),
    bS = new T.Vector3();
  previous.decompose(aP, aQ, aS);
  current.decompose(bP, bQ, bS);
  return (time, root) => {
    const u =
      end > start ? T.MathUtils.clamp((time - start) / (end - start), 0, 1) : 1;
    setWorld(
      root,
      new T.Matrix4().compose(
        aP.clone().lerp(bP, u),
        aQ.clone().slerp(bQ, u),
        aS.clone().lerp(bS, u),
      ),
    );
  };
}
