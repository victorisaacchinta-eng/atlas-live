// Prepares open 3D models for the web hologram renderer.
// Textures are dropped (the hologram shader ignores them, and this removes any logos),
// geometry is welded, lightly simplified where heavy, quantized and meshopt-compressed.
// Usage: node tools/optimize.mjs <in.glb> <out.glb> [simplifyRatio]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, prune, weld, simplify, quantize, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import draco3d from 'draco3dgltf';

const [input, output, ratioArg] = process.argv.slice(2);
const ratio = ratioArg ? Number(ratioArg) : 1;

await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    'draco3d.decoder': await draco3d.createDecoderModule(),
    'meshopt.encoder': MeshoptEncoder,
  });

const doc = await io.read(input);
const root = doc.getRoot();

// Drop every texture and material extension: the renderer draws its own hologram material.
for (const tex of root.listTextures()) tex.dispose();
for (const mat of root.listMaterials()) {
  for (const ext of mat.listExtensions()) mat.setExtension(ext.extensionName, null);
}
for (const ext of root.listExtensionsUsed()) {
  if (ext.extensionName !== 'EXT_meshopt_compression') ext.dispose();
}
// UVs and tangents are useless without textures.
for (const mesh of root.listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    for (const sem of prim.listSemantics()) {
      if (sem.startsWith('TEXCOORD') || sem === 'TANGENT' || sem.startsWith('COLOR')) prim.setAttribute(sem, null);
    }
  }
}

const transforms = [dedup(), weld()];
if (ratio < 1) transforms.push(simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.002 }));
transforms.push(prune(), quantize(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
await doc.transform(...transforms);

doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
await io.write(output, doc);
console.log('wrote', output);
