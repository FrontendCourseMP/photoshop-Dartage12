export interface PixelImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  meta: ImageMeta;
}

export type ImageFormat = 'png' | 'jpeg' | 'gb7' | 'unknown';

export interface ImageMeta {
  format: ImageFormat;
  colorDepth: number;
  colorDepthLabel: string;
  hasAlpha: boolean;
}
