// One texture for every receipt in the pile: 4096 x 2048, one byte per texel (ink coverage), 32 slots of
// 256 x 1024. 8 MB plus mipmaps (about 10.7 MB). A finished tile is copied straight into its slot on the GPU
// (one texSubImage2D) and kept in the CPU copy too, so a re-upload never loses it.
import * as THREE from 'three';
import { TILE_H, TILE_W, type Tile } from './rasters';

export const ATLAS_W = 4096;
export const ATLAS_H = 2048;
const COLS = ATLAS_W / TILE_W;
export const ATLAS_SLOTS = COLS * (ATLAS_H / TILE_H);

export class InkAtlas {
  readonly texture: THREE.DataTexture;
  private data: Uint8Array;
  private owners: (string | null)[] = new Array(ATLAS_SLOTS).fill(null);
  private refs: number[] = new Array(ATLAS_SLOTS).fill(0);
  private origin = new THREE.Vector2();

  constructor() {
    this.data = new Uint8Array(ATLAS_W * ATLAS_H);
    const texture = new THREE.DataTexture(this.data, ATLAS_W, ATLAS_H, THREE.RedFormat, THREE.UnsignedByteType);
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    texture.unpackAlignment = 1;
    texture.flipY = false;
    texture.colorSpace = THREE.NoColorSpace;
    texture.needsUpdate = true;
    this.texture = texture;
  }

  /** A slot for this receipt (its old one if it has one), or -1 when full. */
  allocate(id: string): number {
    const existing = this.owners.indexOf(id);
    if (existing >= 0) {
      this.refs[existing] += 1;
      return existing;
    }
    const free = this.owners.indexOf(null);
    if (free < 0) return -1;
    this.owners[free] = id;
    this.refs[free] = 1;
    return free;
  }

  release(slot: number) {
    if (slot < 0) return;
    this.refs[slot] = Math.max(0, this.refs[slot] - 1);
    if (this.refs[slot] === 0) this.owners[slot] = null;
  }

  /** Copy a tile into its slot; returns the uv rect (x, y, width, height). */
  write(renderer: THREE.WebGLRenderer, slot: number, tile: Tile, out: THREE.Vector4): THREE.Vector4 {
    const x = (slot % COLS) * TILE_W;
    const y = Math.floor(slot / COLS) * TILE_H;
    const w = Math.min(TILE_W, tile.width);
    const h = Math.min(TILE_H, tile.height);
    for (let row = 0; row < h; row++) {
      this.data.set(tile.data.subarray(row * tile.width, row * tile.width + w), (y + row) * ATLAS_W + x);
    }
    const source = new THREE.DataTexture(tile.data, tile.width, tile.height, THREE.RedFormat, THREE.UnsignedByteType);
    source.unpackAlignment = 1;
    source.flipY = false;
    this.origin.set(x, y);
    renderer.copyTextureToTexture(source, this.texture, new THREE.Box2(new THREE.Vector2(0, 0), new THREE.Vector2(w, h)), this.origin);
    source.dispose();
    return out.set(x / ATLAS_W, y / ATLAS_H, w / ATLAS_W, h / ATLAS_H);
  }

  dispose() {
    this.texture.dispose();
  }
}
