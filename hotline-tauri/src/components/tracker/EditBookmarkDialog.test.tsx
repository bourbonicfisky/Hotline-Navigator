import { it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, screen } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { deletePassword, savePassword } from '../../utils/passwordVault';
import EditBookmarkDialog from './EditBookmarkDialog';
vi.mock('../../utils/passwordVault', () => ({ savePassword: vi.fn(), deletePassword: vi.fn() }));
beforeEach(() => { vi.clearAllMocks(); vi.mocked(invoke).mockResolvedValue(undefined); });
function dialog() {
  return render(<EditBookmarkDialog bookmark={{ id: 'test', name: 'Test', address: 'example.test', port: 5500,
    login: 'guest', hasPassword: true, type: 'server' }} onClose={() => {}} />);
}
it('preserves the stored credential when saving an unrelated edit', async () => {
  const { container } = dialog();
  fireEvent.submit(container.querySelector('form')!);
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('save_bookmark', { bookmark: expect.objectContaining({ hasPassword: true }) }));
  expect(deletePassword).not.toHaveBeenCalled();
  expect(savePassword).not.toHaveBeenCalled();
});
it('only deletes a credential after explicit removal', async () => {
  const { container } = dialog();
  fireEvent.click(screen.getByLabelText('Remove saved password'));
  fireEvent.submit(container.querySelector('form')!);
  await waitFor(() => expect(deletePassword).toHaveBeenCalledWith('test'));
  expect(invoke).toHaveBeenCalledWith('save_bookmark', { bookmark: expect.objectContaining({ hasPassword: false }) });
});
