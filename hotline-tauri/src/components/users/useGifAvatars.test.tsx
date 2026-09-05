import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useGifAvatars } from './useGifAvatars';
import { useAvatarStore } from '../../stores/avatarStore';

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), listeners: new Map<string, (event: { payload: { userId: number } }) => void>(), unlisten: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async (name, callback) => { mocks.listeners.set(name, callback); return mocks.unlisten; }) }));
beforeEach(() => { mocks.invoke.mockReset(); mocks.listeners.clear(); mocks.unlisten.mockClear(); useAvatarStore.setState({ icons: {} }); });

it('does not let an initial list overwrite an avatar cleared during loading', async () => {
  let finishList!: (icons: { userId: number; url: string }[]) => void;
  mocks.invoke.mockImplementation(command => command === 'get_gif_icons'
    ? new Promise(resolve => { finishList = resolve; }) : Promise.resolve({ userId: 42, url: null }));
  const hook = renderHook(() => useGifAvatars('a', true));
  await waitFor(() => expect(finishList).toBeDefined());
  await act(async () => { mocks.listeners.get('gif-icon-changed-a')!({ payload: { userId: 42 } }); });
  await act(async () => { finishList([{ userId: 42, url: 'old' }]); });
  expect(useAvatarStore.getState().icons.a?.[42]).toBeUndefined();
  hook.unmount();
});

it('clears the connection cache and ignores late responses on disconnect', async () => {
  let finish!: (icons: { userId: number; url: string }[]) => void;
  mocks.invoke.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const hook = renderHook(({ connected }) => useGifAvatars('a', connected), { initialProps: { connected: true } });
  await waitFor(() => expect(finish).toBeDefined());
  act(() => useAvatarStore.getState().put('b', 42, 'other-server'));
  hook.rerender({ connected: false });
  await act(async () => { finish([{ userId: 42, url: 'old' }]); });
  expect(useAvatarStore.getState().icons.a).toBeUndefined();
  expect(useAvatarStore.getState().icons.b[42]).toBe('other-server');
  hook.unmount();
});

it('removes a departed user without accepting a late avatar fetch', async () => {
  let finish!: (icon: { userId: number; url: string }) => void;
  mocks.invoke.mockImplementation(command => command === 'get_gif_icons'
    ? Promise.resolve([]) : new Promise(resolve => { finish = resolve; }));
  const hook = renderHook(() => useGifAvatars('a', true));
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('get_gif_icons', { serverId: 'a' }));
  act(() => { mocks.listeners.get('gif-icon-changed-a')!({ payload: { userId: 42 } }); });
  act(() => { mocks.listeners.get('user-left-a')!({ payload: { userId: 42 } }); });
  await act(async () => { finish({ userId: 42, url: 'old' }); });
  expect(useAvatarStore.getState().icons.a?.[42]).toBeUndefined();
  hook.unmount();
});
