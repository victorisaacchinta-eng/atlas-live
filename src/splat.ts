import * as THREE from 'three';
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';

/**
 * Photo reconstructions: Gaussian splats trained from public photos of a landmark (see
 * tools/reconstruct.ipynb). Shown on the stage like any hologram: centred, standing on the pad.
 * Spark (World Labs, MIT) renders the splats inside the normal three.js
 * pipeline, so the lenses still apply.
 */

let spark: SparkRenderer | null = null;

export interface SplatInfo {
  url: string;
  /** Extra rotation to stand the reconstruction upright, in degrees (photo poses have no "up"). */
  rot?: [number, number, number];
}

export async function loadSplat(scene: THREE.Scene, renderer: THREE.WebGLRenderer, info: SplatInfo, fit = 2.1): Promise<THREE.Group> {
  if (!spark) {
    spark = new SparkRenderer({ renderer });
    scene.add(spark);
  }
  const mesh = new SplatMesh({ url: info.url });
  await mesh.initialized;
  // COLMAP / 3DGS output is in OpenCV axes (y down, z forward): flip to three.js, then apply the
  // per-landmark correction.
  const r = info.rot ?? [0, 0, 0];
  mesh.quaternion.setFromEuler(new THREE.Euler(Math.PI + r[0] * THREE.MathUtils.DEG2RAD, r[1] * THREE.MathUtils.DEG2RAD, r[2] * THREE.MathUtils.DEG2RAD));
  mesh.updateMatrixWorld(true);

  // Fit by the splat centres, ignoring the faint halo of large splats.
  const local = mesh.getBoundingBox(true);
  const box = local.clone().applyMatrix4(mesh.matrix);
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  const s = fit / Math.max(size.x, size.y, size.z, 1e-6);
  const holder = new THREE.Group();
  holder.add(mesh);
  holder.scale.setScalar(s);
  holder.position.set(-centre.x * s, -box.min.y * s, -centre.z * s);
  const root = new THREE.Group();
  root.add(holder);
  return root;
}

export function disposeSplat(root: THREE.Group | null) {
  if (!root) return;
  root.traverse((o) => { (o as unknown as { dispose?: () => void }).dispose?.(); });
  root.removeFromParent();
}
