import { beforeEach, expect, it, vi } from 'vitest';
import { getPassword } from './passwordVault';
import { withBookmarkPassword } from './bookmarkCredentials';
import { useAppStore } from '../stores/appStore';
import { invoke } from '@tauri-apps/api/core';
import type { Bookmark } from '../types';

vi.mock('./passwordVault', () => ({ getPassword: vi.fn() }));
const bookmark: Bookmark = { id: 'saved', name: 'Server', address: 'localhost', port: 5500, login: 'admin', hasPassword: true };
beforeEach(() => vi.clearAllMocks());

it('loads saved credentials without adding plaintext to the stored bookmark', async () => {
  vi.mocked(getPassword).mockResolvedValue('admin');
  expect(await withBookmarkPassword(bookmark)).toEqual({ ...bookmark, password: 'admin' });
  expect(bookmark.password).toBeUndefined();
});
it('keeps explicit credentials and guest connections independent of the vault', async () => {
  for (const password of ['typed', '']) {
    expect((await withBookmarkPassword({ ...bookmark, password })).password).toBe(password);
  }
  expect((await withBookmarkPassword({ ...bookmark, hasPassword: false })).password).toBeUndefined();
  expect(getPassword).not.toHaveBeenCalled();
});
it('does not silently send a blank password when the saved credential is missing or locked', async () => {
  vi.mocked(getPassword).mockResolvedValue(null);
  await expect(withBookmarkPassword(bookmark)).rejects.toThrow('Saved password was not found');
  vi.mocked(getPassword).mockRejectedValue(new Error('Saved passwords remain locked.'));
  await expect(withBookmarkPassword(bookmark)).rejects.toThrow('remain locked');
});
it('restores the password for manual reconnects', async () => {
  vi.mocked(getPassword).mockResolvedValue('saved-secret');
  vi.mocked(invoke).mockResolvedValue(undefined);
  useAppStore.setState({ bookmarks: [bookmark], serverInfo: new Map([['saved', {
    id: 'saved', name: 'Server', address: 'localhost', port: 5500,
  }]]) });
  await useAppStore.getState().reconnectServer('saved');
  expect(invoke).toHaveBeenCalledWith('connect_to_server', expect.objectContaining({
    bookmark: { ...bookmark, password: 'saved-secret' },
  }));
  expect(useAppStore.getState().bookmarks[0].password).toBeUndefined();
});
