import { useState } from 'react';
import { Alert, Box, Snackbar } from '@mui/material';
import { Toolbar, type SaveFormat } from './Toolbar';
import { ImageCanvas } from './ImageCanvas';
import { StatusBar } from './StatusBar';
import type { PixelImage } from './types';
import { encodeToBlob, loadImageFile, triggerDownload } from './imageIO';

function baseName(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

export default function App() {
  const [image, setImage] = useState<PixelImage | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleLoad = async (file: File) => {
    try {
      const loaded = await loadImageFile(file);
      setImage(loaded);
      setFileName(file.name);
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
      <Toolbar onLoad={handleLoad} onSave={handleSave} canSave={Boolean(image)} />
      <ImageCanvas image={image} />
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
