// Bakes a map's lightmap off the main thread. The worker rebuilds the map from its name, which is
// deterministic, so the face layout matches the one the renderer built.
import { CollisionWorld } from '../engine/trace';
import { MAPS } from '../maps';
import { bakeLightmap, lightParams } from './lightbake';
import { mapLayout } from './mapmesh';

self.onmessage = (e: MessageEvent<{ map: string; luxel: number }>) => {
  const map = MAPS[e.data.map]();
  const layout = mapLayout(map.brushes, e.data.luxel);
  const world = new CollisionWorld(map.brushes.filter((b) => !b.clip), { includeDetail: true });
  const t0 = performance.now();
  const data = bakeLightmap(layout, world, lightParams(map));
  (self as unknown as Worker).postMessage({ data, size: layout.size, ms: performance.now() - t0 }, [data.buffer]);
};
