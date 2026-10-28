import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import FileInfoDialog from './FileInfoDialog';
import { formatHotlineDate } from '../../utils/formatHotlineDate';
it('shows the extended size and decoded dates returned by the server', async () => {
  vi.mocked(invoke).mockResolvedValue({ file_size: 2 ** 40, create_date: '2026-01-01T00:00:00Z', modify_date: '2026-02-01T00:00:00Z', comment: 'Archive' });
  render(<FileInfoDialog serverId="server" fileName="archive.bin" fileSize={0} isFolder={false} path={[]} onClose={() => {}} />);
  expect(await screen.findByText(formatHotlineDate('2026-01-01T00:00:00Z'))).toBeInTheDocument();
  expect(screen.getByText(formatHotlineDate('2026-02-01T00:00:00Z'))).toBeInTheDocument();
  expect(screen.getByText(/1.0 TB/)).toBeInTheDocument();
});
