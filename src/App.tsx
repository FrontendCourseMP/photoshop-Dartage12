import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Box, Snackbar } from '@mui/material';
import { Toolbar, type SaveFormat } from './Toolbar';
import { ImageCanvas } from './ImageCanvas';
import { StatusBar } from './StatusBar';
import { SidePanel } from './SidePanel';
import { LevelsDialog } from './LevelsDialog';
import { ResizeDialog } from './ResizeDialog';
import type { PixelImage, PixelSample, ToolMode } from './types';
import { encodeToBlob, loadImageFile, triggerDownload } from './imageIO';
import { defaultMask, type ChannelMask } from './channels';
import {
  type AllLevels,
  applyAllLevels,
  defaultAllLevels,
  isAllIdentity,
} from './levels';
import { resampleImage, type ResampleAlgorithm } from './resample';

const ZOOM_MIN = 0.12;
const ZOOM_MAX = 3.0;
const FIT_PADDING = 50;

function baseName(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

function clampZoom(z: number): number {
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
}

function computeFitZoom(
  imgW: number,
  imgH: number,
  contW: number,
  contH: number,
): number {
  if (contW <= 0 || contH <= 0 || imgW <= 0 || imgH <= 0) return 1;
  const availW = Math.max(1, contW - FIT_PADDING * 2);
  const availH = Math.max(1, contH - FIT_PADDING * 2);
  const fit = Math.min(availW / imgW, availH / imgH, 1);
  return clampZoom(fit);
}

export default function App() {
  const [image, setImage] = useState<PixelImage | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mask, setMask] = useState<ChannelMask>(defaultMask);
  const [tool, setTool] = useState<ToolMode>('hand');
  const [sample, setSample] = useState<PixelSample | null>(null);
  const [zoom, setZoom] = useState<number>(1);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const fitOnNextRef = useRef(false);

  const [levelsOpen, setLevelsOpen] = useState(false);
  const [levels, setLevels] = useState<AllLevels>(defaultAllLevels);
  const [livePreview, setLivePreview] = useState(true);
  const [previewImage, setPreviewImage] = useState<PixelImage | null>(null);
  const rafRef = useRef<number | null>(null);

  const [resizeOpen, setResizeOpen] = useState(false);

  useEffect(() => {
    if (!image || !levelsOpen || !livePreview || isAllIdentity(levels)) {
      setPreviewImage(null);
      return;
    }
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
    }
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      setPreviewImage(applyAllLevels(image, levels));
    });
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [image, levels, levelsOpen, livePreview]);

  useEffect(() => {
    if (!image || !fitOnNextRef.current) return;
    if (containerSize.width === 0 || containerSize.height === 0) return;
    const z = computeFitZoom(image.width, image.height, containerSize.width, containerSize.height);
    setZoom(z);
    fitOnNextRef.current = false;
  }, [image, containerSize]);

  const displayImage = useMemo(() => {
    if (!image) return null;
    if (levelsOpen && livePreview && previewImage) return previewImage;
    return image;
  }, [image, previewImage, levelsOpen, livePreview]);

  const handleContainerSize = useCallback((s: { width: number; height: number }) => {
    setContainerSize(s);
  }, []);

  const handleFit = () => {
    if (!image) return;
    const z = computeFitZoom(image.width, image.height, containerSize.width, containerSize.height);
    setZoom(z);
  };

  const handleLoad = async (file: File) => {
    try {
      const loaded = await loadImageFile(file);
      fitOnNextRef.current = true;
      setImage(loaded);
      setFileName(file.name);
      setMask(defaultMask());
      setSample(null);
      setLevels(defaultAllLevels());
      setPreviewImage(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить файл');
    }
  };

  const handleSave = async (format: SaveFormat) => {
    if (!image) return;
    try {
      const blob = await encodeToBlob(image, format);
      const ext = format === 'jpeg' ? 'jpg' : format;
      const name = `${fileName ? baseName(fileName) : 'image'}.${ext}`;
      triggerDownload(blob, name);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить файл');
    }
  };

  const openLevels = () => {
    if (!image) return;
    setLevels(defaultAllLevels());
    setLivePreview(true);
    setLevelsOpen(true);
  };

  const closeLevels = () => {
    setLevelsOpen(false);
    setLevels(defaultAllLevels());
    setPreviewImage(null);
  };

  const resetLevels = () => {
    setLevels(defaultAllLevels());
  };

  const applyLevels = () => {
    if (image) {
      const next = applyAllLevels(image, levels);
      setImage(next);
      setSample(null);
    }
    setLevelsOpen(false);
    setLevels(defaultAllLevels());
    setPreviewImage(null);
  };

  const openResize = () => {
    if (!image) return;
    setResizeOpen(true);
  };

  const handleResizeApply = (width: number, height: number, algorithm: ResampleAlgorithm) => {
    if (!image) return;
    try {
      const next = resampleImage(image, width, height, algorithm);
      fitOnNextRef.current = true;
      setImage(next);
      setSample(null);
      setMask(defaultMask());
      setResizeOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось изменить размер');
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <Toolbar
        onLoad={handleLoad}
        onSave={handleSave}
        canSave={Boolean(image)}
        tool={tool}
        onToolChange={setTool}
        onOpenLevels={openLevels}
        onOpenResize={openResize}
      />
      <Box sx={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <ImageCanvas
          image={displayImage}
          mask={mask}
          tool={tool}
          onPick={setSample}
          zoom={zoom}
          onContainerSize={handleContainerSize}
        />
        <SidePanel
          image={image}
          mask={mask}
          onMaskChange={setMask}
          sample={sample}
          toolActive={tool === 'eyedropper'}
        />
      </Box>
      <StatusBar
        image={image}
        fileName={fileName}
        zoom={zoom}
        onZoomChange={(z) => setZoom(clampZoom(z))}
        onFit={handleFit}
        zoomMin={ZOOM_MIN}
        zoomMax={ZOOM_MAX}
      />
      {image && (
        <LevelsDialog
          open={levelsOpen}
          image={image}
          preview={livePreview}
          levels={levels}
          onPreviewChange={setLivePreview}
          onLevelsChange={setLevels}
          onApply={applyLevels}
          onCancel={closeLevels}
          onReset={resetLevels}
        />
      )}
      {image && (
        <ResizeDialog
          open={resizeOpen}
          image={image}
          onApply={handleResizeApply}
          onCancel={() => setResizeOpen(false)}
        />
      )}
      <Snackbar
        open={Boolean(error)}
        autoHideDuration={5000}
        onClose={() => setError(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="error" onClose={() => setError(null)} variant="filled">
          {error}
        </Alert>
      </Snackbar>
    </Box>
  );
}
