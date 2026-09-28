/**
 * How easily bullets pass through a surface: max wall thickness = gun penetration power * factor.
 * With an AK (39): wood up to ~47u, plaster ~23u, metal ~16u, stone ~12u.
 */
export function penetrationFactor(tex: string): number {
  if (tex === 'wood' || tex === 'door') return 1.2;
  if (tex.startsWith('crate')) return 1;
  if (tex.startsWith('plaster') || tex === 'tile' || tex === 'snow' || tex.startsWith('ice')) return 0.6;
  if (tex.startsWith('metal') || tex.startsWith('container') || tex === 'glass') return 0.4;
  return 0.3;
}
