// 설치된 `three` 패키지는 선언 파일 없이 JavaScript만 제공한다.
// 이 앱이 쓰는 심볼과, globe.gl 타입 정의가 가져오는 심볼만 적는다.

declare module "three" {
  export class Vector2 {}

  export class Vector3 {
    set(x: number, y: number, z: number): this;
  }

  export class Object3D {}

  export class Camera {}

  export class Scene {}

  export class Light {}

  export class Texture {
    colorSpace: string;
    anisotropy: number;
    needsUpdate: boolean;
    dispose(): void;
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
    customProgramCacheKey: () => string;
    onBeforeCompile: (shader: {
      uniforms: Record<string, { value: unknown }>;
      fragmentShader: string;
    }) => void;
  }

  export class MeshPhongMaterial extends Material {
    color: { setHex(hex: number): void };
    emissive: { setHex(hex: number): void };
    emissiveIntensity: number;
    map: Texture | null;
    emissiveMap: Texture | null;
    bumpMap: Texture | null;
    bumpScale: number;
    specularMap: Texture | null;
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

  export const ShaderLib: {
    phong: {
      fragmentShader: string;
    };
  };
}
