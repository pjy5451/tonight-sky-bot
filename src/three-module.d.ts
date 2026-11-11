// 설치된 `three` 패키지는 선언 파일 없이 JavaScript만 제공한다.
// 이 앱이 쓰는 심볼과, globe.gl 타입 정의가 가져오는 심볼만 적는다.

declare module "three" {
  export class Vector2 {}

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
    getWorldQuaternion(target: Quaternion): Quaternion;
  }

  export class Camera {
    fov?: number;
  }

  export class Scene {}

  export class Light {}

  export class BufferGeometry {
    dispose(): void;
  }

  export class BoxGeometry extends BufferGeometry {
    constructor(width?: number, height?: number, depth?: number);
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

  export class WebGLRenderer {
    setPixelRatio(ratio: number): void;
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
