import { useEffect, useRef } from 'react';
import { Box, Typography } from '@mui/material';
import type { PixelImage, PixelSample, ToolMode } from './types';
import { applyChannelMask, type ChannelMask } from './channels';

interface Props {
  image: PixelImage | null;
  mask: ChannelMask;
  tool: ToolMode;
  onPick: (sample: PixelSample) => void;
}

export function ImageCanvas({ image, mask, tool, onPick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sourceRef = useRef<HTMLCanvasElement | null>(null);
  const displayRef = useRef({ w: 0, h: 0 });

  useEffect(() => {
    if (!image) {
      sourceRef.current = null;
      return;
    }
    const src = document.createElement('canvas');
    src.width = image.width;
    src.height = image.height;
    const sctx = src.getContext('2d');
    if (sctx) {
      sctx.putImageData(applyChannelMask(image, mask), 0, 0);
    }
    sourceRef.current = src;
  }, [image, mask]);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const draw = () => {
      const src = sourceRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const cw = container.clientWidth;
      const ch = container.clientHeight;
      if (!image || !src || cw === 0 || ch === 0) {
        canvas.width = 0;
        canvas.height = 0;
        displayRef.current = { w: 0, h: 0 };
        return;
      }

      const scale = Math.min(cw / image.width, ch / image.height, 1);
      const dispW = Math.max(1, Math.round(image.width * scale));
      const dispH = Math.max(1, Math.round(image.height * scale));
      const dpr = window.devicePixelRatio || 1;

      canvas.width = Math.round(dispW * dpr);
      canvas.height = Math.round(dispH * dpr);
      canvas.style.width = `${dispW}px`;
      canvas.style.height = `${dispH}px`;
      displayRef.current = { w: dispW, h: dispH };

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, dispW, dispH);
      drawCheckerboard(ctx, dispW, dispH);
      ctx.imageSmoothingEnabled = scale < 1;
      ctx.drawImage(src, 0, 0, image.width, image.height, 0, 0, dispW, dispH);
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(container);
    window.addEventListener('resize', draw);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', draw);
    };
  }, [image, mask]);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!image || tool !== 'eyedropper') return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const cssX = e.clientX - rect.left;
    const cssY = e.clientY - rect.top;
    const { w: dispW, h: dispH } = displayRef.current;
    if (dispW === 0 || dispH === 0) return;

    const ix = Math.floor((cssX / dispW) * image.width);
    const iy = Math.floor((cssY / dispH) * image.height);
    if (ix < 0 || iy < 0 || ix >= image.width || iy >= image.height) return;

    const o = (iy * image.width + ix) * 4;
    onPick({
      x: ix,
      y: iy,
      r: image.data[o],
      g: image.data[o + 1],
      b: image.data[o + 2],
      a: image.data[o + 3],
    });
  };

  const cursor = image && tool === 'eyedropper' ? 'crosshair' : 'default';

  return (
    <Box
      ref={containerRef}
      sx={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        p: 2,
        bgcolor: '#161616',
      }}
    >
      {image ? (
        <canvas
          ref={canvasRef}
          onClick={handleClick}
          style={{
            cursor,
            boxShadow: '0 0 0 1px #3a3a3a, 0 8px 24px rgba(0,0,0,0.5)',
          }}
        />
      ) : (
        <Typography color="text.secondary" sx={{ userSelect: 'none' }}>
          Загрузите изображение (PNG, JPG или GB7), чтобы начать
        </Typography>
      )}
    </Box>
  );
}

function drawCheckerboard(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const tile = 10;
  for (let y = 0; y < h; y += tile) {
    for (let x = 0; x < w; x += tile) {
      const even = ((x / tile) | 0) % 2 === ((y / tile) | 0) % 2;
      ctx.fillStyle = even ? '#3a3a3a' : '#2b2b2b';
      ctx.fillRect(x, y, tile, tile);
    }
  }
}
