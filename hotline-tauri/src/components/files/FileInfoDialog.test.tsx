import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import FileInfoDialog from './FileInfoDialog';
it('shows the extended size and decoded dates returned by the server', async () => {
  vi.mocked(invoke).mockResolvedValue({ file_size: 2 ** 40, create_date: '1/1/2026 12:00 AM', modify_date: '2/1/2026 12:00 AM', comment: 'Archive' });
  render(<FileInfoDialog serverId="server" fileName="archive.bin" fileSize={0} isFolder={false} path={[]} onClose={() => {}} />);
  expect(await screen.findByText('1/1/2026 12:00 AM')).toBeInTheDocument();
  expect(screen.getByText('2/1/2026 12:00 AM')).toBeInTheDocument();
  expect(screen.getByText(/1.0 TB/)).toBeInTheDocument();
});
