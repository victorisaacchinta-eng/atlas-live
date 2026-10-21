import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'draco3d.decoder': await draco3d.createDecoderModule(), 'draco3d.encoder': await draco3d.createEncoderModule() });
for (const f of process.argv.slice(2)) {
  const doc = await io.read(f); const root = doc.getRoot();
  const nodes = root.listNodes(); const meshNodes = nodes.filter(n => n.getMesh());
  let tris = 0; for (const m of root.listMeshes()) for (const p of m.listPrimitives()) { const i = p.getIndices(); tris += (i ? i.getCount() : p.getAttribute('POSITION').getCount()) / 3; }
  const names = meshNodes.map(n => n.getName()).slice(0, 40);
  console.log(f.split('/').pop(), 'nodes', nodes.length, 'meshNodes', meshNodes.length, 'tris', Math.round(tris), 'textures', root.listTextures().length, 'ext', root.listExtensionsUsed().map(e=>e.extensionName).join(','));
  console.log('  ', names.join(' | '));
}
