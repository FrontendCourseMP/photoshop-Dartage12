import { Box, Divider, Typography } from '@mui/material';
import type { PixelImage } from './types';

interface Props {
  image: PixelImage | null;
  fileName: string | null;
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'baseline' }}>
      <Typography variant="caption" color="text.secondary">
        {label}:
      </Typography>
      <Typography variant="caption" sx={{ fontWeight: 600 }}>
        {value}
      </Typography>
    </Box>
  );
}

export function StatusBar({ image, fileName }: Props) {
  return (
    <Box
      component="footer"
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        px: 2,
        height: 28,
        flexShrink: 0,
        bgcolor: '#007acc',
        color: '#fff',
        overflowX: 'auto',
        whiteSpace: 'nowrap',
      }}
    >
      {image ? (
        <>
          {fileName && <Item label="Файл" value={fileName} />}
          <Divider orientation="vertical" flexItem sx={{ borderColor: 'rgba(255,255,255,0.3)' }} />
          <Item label="Ширина" value={`${image.width} px`} />
          <Item label="Высота" value={`${image.height} px`} />
          <Item label="Глубина цвета" value={image.meta.colorDepthLabel} />
          <Item label="Формат" value={image.meta.format.toUpperCase()} />
        </>
      ) : (
        <Typography variant="caption">Изображение не загружено</Typography>
      )}
    </Box>
  );
}
