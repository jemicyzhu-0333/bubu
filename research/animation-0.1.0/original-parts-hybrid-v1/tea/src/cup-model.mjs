import * as T from "three";
/** Model units match approved05. Cup origin is bottom center; +Y up.
 * Own geometry/material resources only. No character or expression writes. */
export function createTeaCup({ radius = 0.27, height = 0.33 } = {}) {
  if (
    !Number.isFinite(radius) ||
    !Number.isFinite(height) ||
    radius < 0.1 ||
    radius > 0.5 ||
    height < 0.15 ||
    height > 0.6
  )
    throw RangeError("Bounded cup dimensions required");
  const root = new T.Group();
  root.name = "Sip_cup";
  const ceramic = new T.MeshStandardMaterial({
    color: 0x9bcdbf,
    roughness: 0.52,
    metalness: 0,
  });
  const tea = new T.MeshStandardMaterial({
    color: 0x613220,
    roughness: 0.28,
    metalness: 0,
  });
  const profile = [
    [0, 0],
    [radius * 0.73, 0],
    [radius * 0.8, 0.025],
    [radius, height - 0.025],
    [radius * 0.99, height],
    [radius * 0.88, height],
    [radius * 0.86, height - 0.025],
    [radius * 0.7, 0.05],
    [0, 0.05],
  ].map(([x, y]) => new T.Vector2(x, y));
  const shell = new T.Mesh(new T.LatheGeometry(profile, 64), ceramic);
  shell.name = "Sip_cup_shell";
  root.add(shell);
  // C handle lies in the XY plane, with open end touching the vessel wall.
  const curve = new T.CatmullRomCurve3(
    [
      [radius * 0.88, height * 0.8, 0],
      [radius * 1.47, height * 0.85, 0],
      [radius * 1.65, height * 0.53, 0],
      [radius * 1.43, height * 0.23, 0],
      [radius * 0.82, height * 0.23, 0],
    ].map((p) => new T.Vector3(...p)),
  );
  const handle = new T.Mesh(
    new T.TubeGeometry(curve, 40, 0.032, 12, false),
    ceramic,
  );
  handle.name = "Sip_cup_handle";
  root.add(handle);
  const liquid = new T.Mesh(new T.CircleGeometry(radius * 0.84, 64), tea);
  liquid.name = "Sip_tea_surface";
  liquid.rotation.x = -Math.PI / 2;
  liquid.position.y = height - 0.045;
  root.add(liquid);
  const sockets = Object.freeze({
    rim: new T.Vector3(0, height, -radius * 0.95),
    handle: new T.Vector3(radius * 1.62, height * 0.53, 0),
    support: new T.Vector3(-radius * 0.82, height * 0.35, 0),
  });
  let disposed = false;
  return {
    root,
    sockets,
    dimensions: Object.freeze({ radius, height }),
    dispose() {
      if (disposed) return;
      disposed = true;
      root.removeFromParent();
      root.traverse((o) => {
        if (o.isMesh) o.geometry.dispose();
      });
      ceramic.dispose();
      tea.dispose();
      root.clear();
    },
  };
}
