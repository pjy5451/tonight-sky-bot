// 설치된 `three` 패키지는 선언 파일 없이 JavaScript만 제공한다.
// 이 앱이 쓰는 심볼과, globe.gl 타입 정의가 가져오는 심볼만 적는다.

declare module "three" {
  export class Vector2 {
    x: number;
    y: number;
    constructor(x?: number, y?: number);
    set(x: number, y: number): this;
  }

  export class Matrix4 {
    elements: number[];
    makeBasis(xAxis: Vector3, yAxis: Vector3, zAxis: Vector3): this;
    makeRotationX(theta: number): this;
    makeTranslation(x: number, y: number, z: number): this;
    compose(position: Vector3, quaternion: Quaternion, scale: Vector3): this;
    multiplyMatrices(a: Matrix4, b: Matrix4): this;
  }

  export class Quaternion {
    setFromRotationMatrix(matrix: Matrix4): this;
    copy(quaternion: Quaternion): this;
    identity(): this;
  }

  export class Vector3 {
    x: number;
    y: number;
    z: number;
    constructor(x?: number, y?: number, z?: number);
    set(x: number, y: number, z: number): this;
    copy(vector: Vector3): this;
    applyQuaternion(quaternion: Quaternion): this;
  }

  export class Euler {
    x: number;
    y: number;
    z: number;
  }

  export class Color {
    r: number;
    g: number;
    b: number;
    constructor(color?: number | string);
    set(color: number | string): this;
    setHex(hex: number): this;
    setRGB(red: number, green: number, blue: number): this;
    getHex(): number;
  }

  export class Object3D {
    name: string;
    visible: boolean;
    frustumCulled: boolean;
    userData: Record<string, unknown>;
    children: Object3D[];
    position: Vector3;
    rotation: Euler;
    quaternion: Quaternion;
    scale: Vector3;
    parent: Object3D | null;
    add(...objects: Object3D[]): this;
    remove(...objects: Object3D[]): this;
    traverse(callback: (child: Object3D) => void): void;
    updateWorldMatrix(updateParents: boolean, updateChildren: boolean): void;
    updateMatrixWorld(force?: boolean): void;
    getWorldQuaternion(target: Quaternion): Quaternion;
    type: string;
    renderOrder: number;
  }

  export class Camera extends Object3D {
    fov?: number;
    aspect?: number;
    near?: number;
    far?: number;
    matrixWorldInverse: Matrix4;
    projectionMatrix: Matrix4;
    updateProjectionMatrix(): void;
    lookAt(x: number, y: number, z: number): void;
  }

  export class PerspectiveCamera extends Camera {
    constructor(fov?: number, aspect?: number, near?: number, far?: number);
  }

  export class Scene {}

  export class Light {}

  export class BufferAttribute {
    needsUpdate: boolean;
    constructor(array: Float32Array, itemSize: number);
    setXYZ(index: number, x: number, y: number, z: number): void;
    setX(index: number, x: number): void;
    getX(index: number): number;
    getY(index: number): number;
    getZ(index: number): number;
  }

  export class BufferGeometry {
    dispose(): void;
    setAttribute(name: string, attribute: BufferAttribute): void;
    getAttribute(name: string): BufferAttribute;
    setDrawRange(start: number, count: number): void;
  }

  export class BoxGeometry extends BufferGeometry {
    constructor(width?: number, height?: number, depth?: number);
  }

  export class SphereGeometry extends BufferGeometry {
    constructor(radius?: number, widthSegments?: number, heightSegments?: number);
  }

  export class CylinderGeometry extends BufferGeometry {
    constructor(
      radiusTop?: number,
      radiusBottom?: number,
      height?: number,
      radialSegments?: number,
    );
  }

  export class Texture {
    colorSpace: string;
    anisotropy: number;
    needsUpdate: boolean;
    dispose(): void;
  }

  export class CanvasTexture extends Texture {
    constructor(canvas: HTMLCanvasElement | OffscreenCanvas);
  }

  export class TextureLoader {
    load(
      url: string,
      onLoad?: (texture: Texture) => void,
      onProgress?: ((event: ProgressEvent) => void) | undefined,
      onError?: (error: unknown) => void,
    ): Texture;
  }

  export class Material {
    needsUpdate: boolean;
    side: number;
    customProgramCacheKey: () => string;
    onBeforeCompile: (shader: {
      uniforms: Record<string, { value: unknown }>;
      fragmentShader: string;
    }) => void;
    dispose(): void;
  }

  export class MeshBasicMaterial extends Material {
    color: Color;
    constructor(parameters?: { color?: number });
  }

  export class MeshPhongMaterial extends Material {
    color: Color;
    emissive: Color;
    specular: Color;
    emissiveIntensity: number;
    shininess: number;
    map: Texture | null;
    emissiveMap: Texture | null;
    bumpMap: Texture | null;
    bumpScale: number;
    specularMap: Texture | null;
  }

  export class Mesh extends Object3D {
    geometry: BufferGeometry;
    material: Material;
    constructor(geometry?: BufferGeometry, material?: Material);
  }

  export class Group extends Object3D {}

  export class ShaderMaterial extends Material {
    transparent: boolean;
    depthTest: boolean;
    depthWrite: boolean;
    vertexColors: boolean;
    uniforms: Record<string, { value: unknown }>;
    vertexShader: string;
    fragmentShader: string;
    constructor(parameters?: object);
  }

  export class Points extends Object3D {
    geometry: BufferGeometry;
    material: Material;
    constructor(geometry?: BufferGeometry, material?: Material);
  }

  export class InstancedMesh extends Mesh {
    count: number;
    isInstancedMesh: boolean;
    instanceMatrix: { needsUpdate: boolean };
    instanceColor: { needsUpdate: boolean } | null;
    constructor(geometry: BufferGeometry, material: Material, count: number);
    setMatrixAt(index: number, matrix: Matrix4): void;
    getMatrixAt(index: number, matrix: Matrix4): void;
    setColorAt(index: number, color: Color): void;
    getColorAt(index: number, color: Color): void;
    dispose(): void;
  }

  export class Raycaster {
    setFromCamera(pointer: Vector2, camera: Camera): void;
    intersectObject(
      object: Object3D,
      recursive?: boolean,
    ): Array<{ object: Object3D; instanceId?: number }>;
  }

  export class WebGLRenderer {
    setPixelRatio(ratio: number): void;
    getPixelRatio(): number;
    capabilities: {
      getMaxAnisotropy(): number;
      maxTextureSize: number;
    };
  }

  export interface WebGLRendererParameters {
    antialias?: boolean;
    alpha?: boolean;
    powerPreference?: string;
  }

  export const SRGBColorSpace: string;
  export const DoubleSide: number;

  export const ShaderLib: {
    phong: {
      fragmentShader: string;
    };
  };
}
