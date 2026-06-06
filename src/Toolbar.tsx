import { useRef, useState } from 'react';
import {
  AppBar,
  Box,
  Button,
  Divider,
  Menu,
  MenuItem,
  Toolbar as MuiToolbar,
  Typography,
} from '@mui/material';
import FileUploadIcon from '@mui/icons-material/FileUpload';
import DownloadIcon from '@mui/icons-material/Download';

export type SaveFormat = 'png' | 'jpeg' | 'gb7';

interface Props {
  onLoad: (file: File) => void;
  onSave: (format: SaveFormat) => void;
  canSave: boolean;
}

export function Toolbar({ onLoad, onSave, canSave }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [anchor, setAnchor] = useState<null | HTMLElement>(null);

  const handlePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onLoad(file);
    e.target.value = '';
  };

  const handleSave = (format: SaveFormat) => {
    setAnchor(null);
    onSave(format);
  };

  return (
    <AppBar position="static" color="default" elevation={0} sx={{ borderBottom: '1px solid #333' }}>
      <MuiToolbar variant="dense" sx={{ gap: 1 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, mr: 1 }}>
          GraphZ
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ mr: 2 }}>
          редактор растровых изображений
        </Typography>

        <Divider orientation="vertical" flexItem sx={{ mx: 1 }} />

        <input
          ref={inputRef}
          type="file"
          accept=".png,.jpg,.jpeg,.gb7,image/png,image/jpeg"
          hidden
          onChange={handlePick}
        />
        <Button
          variant="contained"
          startIcon={<FileUploadIcon />}
          onClick={() => inputRef.current?.click()}
        >
          Загрузить
        </Button>

        <Button
          variant="outlined"
          startIcon={<DownloadIcon />}
          disabled={!canSave}
          onClick={(e) => setAnchor(e.currentTarget)}
        >
          Скачать
        </Button>
        <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
          <MenuItem onClick={() => handleSave('png')}>PNG (.png)</MenuItem>
          <MenuItem onClick={() => handleSave('jpeg')}>JPEG (.jpg)</MenuItem>
          <MenuItem onClick={() => handleSave('gb7')}>GrayBit-7 (.gb7)</MenuItem>
        </Menu>

        <Box sx={{ flex: 1 }} />
      </MuiToolbar>
    </AppBar>
  );
}
