import createModule from '../dist/renderer.mjs';

export async function createRenderer(options = {}) {
  const module = await createModule(options);
  const metadata = JSON.parse(module.UTF8ToString(module._hdsMetadata()));
  return Object.freeze({
    metadata: Object.freeze(metadata),
    render(snapshot) {
      const input = JSON.stringify(snapshot ?? {});
      if (new TextEncoder().encode(input).length > 16384) {
        throw new RangeError('Renderer snapshot exceeds 16384 bytes');
      }
      const pointer = module.ccall('hdsRender', 'number', ['string'], [input]);
      return module.HEAPU8.slice(pointer, pointer + 8192);
    },
  });
}
