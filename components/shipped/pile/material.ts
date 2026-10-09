// Thermal paper for the pile: MeshStandardMaterial with the crumple injected (onBeforeCompile), plus depth and
// distance materials that displace the sheet the same way, so shadows fall from the shape that is drawn.
//   * one instanced variant (per-instance seed, crumple, atlas tile and length as attributes) and one single
//     variant (the same values as uniforms) for the receipt in the hand and the one held up to read;
//   * facets: the macro normal is bent by the exact gradient of the crease field per fragment, so every
//     crease is a sharp straight line whatever the mesh resolution;
//   * the coated (printed) face is cool white and satin; the back is uncoated, a touch greyer and rougher,
//     with the print showing through faintly, mirrored and soft; grain and fibres are a few percent of
//     albedo, faded out where they'd be smaller than a pixel;
//   * the short edges are torn on the serrated bar (discarded, in the shadow pass too).
import * as THREE from 'three';
import { CRUMPLE_GLSL } from './crumple';

export const PAPER_HEX = '#f2eee6';
export const BACK_HEX = '#e5e1d9';
export const INK_HEX = '#1d1b19';
/** The counter's albedo: lit only by the fill at the edge of the frame it comes out as the page (#121316). */
export const COUNTER_HEX = '#13171e';
export const PAGE_HEX = '#121316';

/** Which channel of the ink texture holds coverage: the atlas is R8, a burned canvas is RGBA ink. */
export const MASK_RED = new THREE.Vector4(1, 0, 0, 0);
export const MASK_ALPHA = new THREE.Vector4(0, 0, 0, 1);

export type SheetUniforms = {
  aSeed: { value: THREE.Vector4 };
  aCrumple: { value: number };
  aTile: { value: THREE.Vector4 };
  aLength: { value: number };
};

export type PaperUniforms = {
  uInk: { value: THREE.Texture | null };
  uInkMask: { value: THREE.Vector4 };
  uPaper: { value: THREE.Color };
  uBack: { value: THREE.Color };
  uInkColor: { value: THREE.Color };
};

const SHEET_PARS = /* glsl */ `
#ifdef PILE_INSTANCED
  attribute vec4 aSeed;
  attribute float aCrumple;
  attribute vec4 aTile;
  attribute float aLength;
#else
  uniform vec4 aSeed;
  uniform float aCrumple;
  uniform vec4 aTile;
  uniform float aLength;
#endif
`;

const VARYINGS = /* glsl */ `
varying vec4 vPileSheet;   // xy sheet coords, zw crease gradient scale
varying vec4 vPileGrad;    // xy smooth surface gradient, zw uv
varying vec3 vPileTx;
varying vec3 vPileTy;
flat varying vec4 vPileSeed;
flat varying vec4 vPileTile;
flat varying float vPileLength;
`;

const GRAIN = /* glsl */ `
float pileValue(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = pileHash(i);
  float b = pileHash(i + vec2(1.0, 0.0));
  float c = pileHash(i + vec2(0.0, 1.0));
  float d = pileHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// About -1..1: fibres along the web, fine tooth, slow blotches in the coating.
float pileGrain(vec2 mm) {
  float px = max(length(fwidth(mm)), 1e-4);
  float fib = pileValue(vec2(mm.x * 2.4, mm.y * 0.42)) - 0.5;
  float fine = pileValue(mm * 6.0 + 17.0) - 0.5;
  float blotch = pileValue(mm * 0.07 + 3.0) - 0.5;
  float aFib = clamp(1.4 - px * 2.4, 0.0, 1.0);
  float aFine = clamp(1.4 - px * 6.0, 0.0, 1.0);
  return fib * 1.3 * aFib + fine * 0.9 * aFine + blotch * 0.9;
}
`;

function sheetVertex(shader: { vertexShader: string }, withTangents: boolean) {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${SHEET_PARS}\n${withTangents ? VARYINGS : 'varying vec2 vPileUv;\nflat varying vec4 vPileSeed;\nflat varying float vPileLength;'}\n${CRUMPLE_GLSL}`)
    .replace(
      '#include <begin_vertex>',
      withTangents
        ? 'vec3 transformed = shp.p;'
        : 'PileShape shp = pileShape(uv, aSeed, aCrumple, aLength);\nvec3 transformed = shp.p;\nvPileUv = uv;\nvPileSeed = aSeed;\nvPileLength = aLength;',
    );
  if (withTangents) {
    shader.vertexShader = shader.vertexShader
      .replace('#include <beginnormal_vertex>', 'PileShape shp = pileShape(uv, aSeed, aCrumple, aLength);\nvec3 objectNormal = shp.n;')
      .replace(
        '#include <normal_vertex>',
        `#include <normal_vertex>
#ifdef USE_INSTANCING
  mat3 pileRot = mat3(instanceMatrix);
#else
  mat3 pileRot = mat3(1.0);
#endif
  vPileTx = normalMatrix * (pileRot * shp.tx);
  vPileTy = normalMatrix * (pileRot * shp.ty);
  vPileSheet = vec4(shp.sheet, shp.cs);
  vPileGrad = vec4(shp.sg, uv);
  vPileSeed = aSeed;
  vPileTile = aTile;
  vPileLength = aLength;`,
      );
  }
}

/** Torn edges in a depth or distance pass. */
function tornFragment(shader: { fragmentShader: string }) {
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\nvarying vec2 vPileUv;\nflat varying vec4 vPileSeed;\nflat varying float vPileLength;\n${CRUMPLE_GLSL}`)
    .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (pileTorn(vPileUv, vPileLength, vPileSeed)) discard;');
}

export type PaperSet = {
  material: THREE.MeshStandardMaterial;
  depth: THREE.MeshDepthMaterial;
  distance: THREE.MeshDistanceMaterial;
  paper: PaperUniforms;
  /** Present on the single (non-instanced) variant. */
  sheet: SheetUniforms | null;
  dispose(): void;
};

export function createPaper(instanced: boolean): PaperSet {
  const paper: PaperUniforms = {
    uInk: { value: null },
    uInkMask: { value: MASK_RED.clone() },
    uPaper: { value: new THREE.Color(PAPER_HEX) },
    uBack: { value: new THREE.Color(BACK_HEX) },
    uInkColor: { value: new THREE.Color(INK_HEX) },
  };
  const sheet: SheetUniforms | null = instanced
    ? null
    : {
        aSeed: { value: new THREE.Vector4(0.1, 0.2, 0.3, 0.9) },
        aCrumple: { value: 0 },
        aTile: { value: new THREE.Vector4(0, 0, 0, 0) },
        aLength: { value: 3 },
      };
  const defines: Record<string, string> = instanced ? { PILE_INSTANCED: '' } : {};

  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0, side: THREE.DoubleSide });
  material.defines = { ...defines };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, paper, sheet ?? {});
    sheetVertex(shader, true);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D uInk;
uniform vec4 uInkMask;
uniform vec3 uPaper;
uniform vec3 uBack;
uniform vec3 uInkColor;
${VARYINGS}
${CRUMPLE_GLSL}
${GRAIN}`,
      )
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (pileTorn(vPileGrad.zw, vPileLength, vPileSeed)) discard;')
      .replace(
        '#include <map_fragment>',
        `vec2 pileTuv = vPileTile.xy + vPileGrad.zw * vPileTile.zw;
float pileHasInk = step(1e-5, vPileTile.z);
float pileInk = dot(texture2D(uInk, pileTuv), uInkMask) * pileHasInk;
float pileShow = dot(texture2D(uInk, pileTuv, 2.5), uInkMask) * pileHasInk;
float pileG = pileGrain(vPileSheet.xy * 100.0);
vec3 pileAlbedo = gl_FrontFacing ? mix(uPaper, uInkColor, pileInk * 0.95) : uBack * (1.0 - 0.075 * pileShow);
diffuseColor.rgb = pileAlbedo * (1.0 + 0.022 * pileG);`,
      )
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = (gl_FrontFacing ? mix(0.52, 0.6, pileInk) : 0.76) + 0.035 * pileG;')
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
{
  vec3 pileCr = pileCreases(vPileSheet.xy, vPileSeed);
  vec2 pileSg = vPileGrad.xy + vPileSheet.zw * pileCr.yz;
  normal = normalize(normalize(vNormal) - pileSg.x * normalize(vPileTx) - pileSg.y * normalize(vPileTy)) * faceDirection;
}`,
      );
  };

  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  depth.defines = { ...defines };
  depth.onBeforeCompile = (shader) => {
    if (sheet) Object.assign(shader.uniforms, sheet);
    sheetVertex(shader, false);
    tornFragment(shader);
  };

  const distance = new THREE.MeshDistanceMaterial({ side: THREE.DoubleSide });
  distance.defines = { ...defines };
  distance.onBeforeCompile = (shader) => {
    if (sheet) Object.assign(shader.uniforms, sheet);
    sheetVertex(shader, false);
    tornFragment(shader);
  };

  return {
    material,
    depth,
    distance,
    paper,
    sheet,
    dispose() {
      material.dispose();
      depth.dispose();
      distance.dispose();
    },
  };
}

/**
 * A sheet as a grid of (u, v) only: the shader computes every position. `position` holds the flat sheet at
 * unit length for anything that inspects the geometry (the instanced mesh isn't frustum culled).
 */
export function createSheetGeometry(across: number, along: number): THREE.BufferGeometry {
  const nu = across + 1;
  const nv = along + 1;
  const uv = new Float32Array(nu * nv * 2);
  const position = new Float32Array(nu * nv * 3);
  const normal = new Float32Array(nu * nv * 3);
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const k = j * nu + i;
      const u = i / across;
      const v = j / along;
      uv[k * 2] = u;
      uv[k * 2 + 1] = v;
      position[k * 3] = (u - 0.5) * 0.8;
      position[k * 3 + 1] = 0.5 - v;
      normal[k * 3 + 2] = 1;
    }
  }
  const index: number[] = [];
  for (let j = 0; j < along; j++) {
    for (let i = 0; i < across; i++) {
      const a = j * nu + i;
      const b = a + 1;
      const c = a + nu;
      const d = c + 1;
      // Counter-clockwise seen from the printed face (+z): v grows down the sheet (-y).
      index.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.setIndex(index);
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 10);
  return geometry;
}

/** The counter: dark laminate, matte, with a fine speckle and slow wear (no gradient: it's all in the albedo). */
export function createCounterMaterial(): THREE.MeshPhysicalMaterial {
  const material = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(COUNTER_HEX), roughness: 0.88, metalness: 0, specularIntensity: 0.3 });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vCounter;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCounter = (modelMatrix * vec4(transformed, 1.0)).xz * 100.0;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec2 vCounter;
float counterHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float counterValue(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(counterHash(i), counterHash(i + vec2(1.0, 0.0)), f.x), mix(counterHash(i + vec2(0.0, 1.0)), counterHash(i + vec2(1.0, 1.0)), f.x), f.y);
}`,
      )
      .replace(
        '#include <map_fragment>',
        `float counterPx = max(length(fwidth(vCounter)), 1e-4);
float counterSpeck = (counterValue(vCounter * 1.7) - 0.5) * clamp(1.4 - counterPx * 1.7, 0.0, 1.0);
float counterWear = counterValue(vCounter * 0.012 + 5.0) - 0.5;
diffuseColor.rgb *= 1.0 + 0.16 * counterSpeck + 0.12 * counterWear;`,
      )
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness + 0.06 * counterWear - 0.04 * counterSpeck;');
  };
  return material;
}

/** Contact shadows under the balls (the fill light can't get under a ball): one quad per ball, one draw. */
export function createContactMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {},
    vertexShader: /* glsl */ `
      attribute float aContact;
      varying vec2 vUv;
      varying float vContact;
      void main() {
        vUv = uv;
        vContact = aContact;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      varying float vContact;
      void main() {
        float r = length(vUv - 0.5) * 2.0;
        float a = 1.0 - smoothstep(0.0, 1.0, r);
        gl_FragColor = vec4(0.0, 0.0, 0.0, a * a * vContact);
      }`,
  });
}
