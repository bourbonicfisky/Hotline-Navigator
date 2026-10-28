import { expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { getPassword } from '../../../utils/passwordVault';
import { useAppStore } from '../../../stores/appStore';
import { useAutoReconnect } from './useAutoReconnect';

vi.mock('../../../utils/passwordVault', () => ({ getPassword: vi.fn() }));

it('loads the saved password when retrying a disconnected server', async () => {
  const bookmark = { id: 'saved', name: 'Server', address: 'localhost', port: 5500, login: 'admin', hasPassword: true };
  useAppStore.setState({ bookmarks: [bookmark], serverInfo: new Map([['saved', {
    id: 'saved', name: 'Server', address: 'localhost', port: 5500,
  }]]) });
  vi.mocked(getPassword).mockResolvedValue('saved-secret');
  vi.mocked(invoke).mockResolvedValue(undefined);
  const { result } = renderHook(() => useAutoReconnect({
    serverId: 'saved', serverName: 'Server', connectionStatus: 'disconnected',
    disconnectMessage: null, setDisconnectMessage: vi.fn(),
  }));
  act(() => result.current.retryNow());
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('connect_to_server', expect.objectContaining({
    bookmark: { ...bookmark, password: 'saved-secret' },
  })));
  expect(bookmark).not.toHaveProperty('password');
});
