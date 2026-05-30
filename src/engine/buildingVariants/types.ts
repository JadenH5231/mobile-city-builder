import type { BufferGeometry } from 'three';

/** A positioned geometry + flat colour, ready to merge into a buildings mesh. */
export interface VariantPart {
  geom: BufferGeometry;
  color: number;
}
