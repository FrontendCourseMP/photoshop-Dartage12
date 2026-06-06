import { useState } from 'react';
import { Alert, Box, Snackbar } from '@mui/material';
import { Toolbar, type SaveFormat } from './Toolbar';
import { ImageCanvas } from './ImageCanvas';
import { StatusBar } from './StatusBar';
import { SidePanel } from './SidePanel';
import type { PixelImage, PixelSample, ToolMode } from './types';
import { encodeToBlob, loadImageFile, triggerDownload } from './imageIO';
import { defaultMask, type ChannelMask } from './channels';

function baseName(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

export default function App() {
  const [image, setImage] = useState<PixelImage | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mask, setMask] = useState<ChannelMask>(defaultMask);
  const [tool, setTool] = useState<ToolMode>('hand');
  const [sample, setSample] = useState<PixelSample | null>(null);

  const handleLoad = async (file: File) => {
    try {
      const loaded = await loadImageFile(file);
      setImage(loaded);
      setFileName(file.name);
      setMask(defaultMask());
      setSample(null);
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

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <Toolbar
        onLoad={handleLoad}
        onSave={handleSave}
        canSave={Boolean(image)}
        tool={tool}
        onToolChange={setTool}
      />
      <Box sx={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <ImageCanvas image={image} mask={mask} tool={tool} onPick={setSample} />
        <SidePanel
          image={image}
          mask={mask}
          onMaskChange={setMask}
          sample={sample}
          toolActive={tool === 'eyedropper'}
        />
      </Box>
      <StatusBar image={image} fileName={fileName} />
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
