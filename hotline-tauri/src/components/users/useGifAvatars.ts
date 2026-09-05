import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useAvatarStore } from '../../stores/avatarStore';

interface GifIcon { userId: number; url: string | null }

export function useGifAvatars(serverId: string, connected: boolean) {
  useEffect(() => {
    const store = useAvatarStore.getState();
    store.clear(serverId);
    if (!connected) return;
    let active = true;
    const changed = new Set<number>();
    const departed = new Set<number>();
    const queued = new Set<number>();
    const fetching = new Set<number>();
    const refresh = async (userId: number) => {
      if (!active || !Number.isInteger(userId) || userId < 0 || userId > 65535) return;
      changed.add(userId);
      queued.add(userId);
      if (fetching.has(userId) || fetching.size >= 4) return;
      fetching.add(userId);
      try {
        do {
          queued.delete(userId);
          const icon = await invoke<GifIcon>('get_gif_icon', { serverId, userId });
          if (active && !departed.has(userId) && !queued.has(userId)) store.put(serverId, userId, icon.url);
        } while (active && queued.has(userId) && !departed.has(userId));
      } catch { if (active) store.put(serverId, userId, null); }
      finally {
        fetching.delete(userId);
        queued.delete(userId);
        if (active) {
          const next = [...queued].find(id => !fetching.has(id));
          if (next !== undefined) void refresh(next);
        }
      }
    };
    const subscriptions = [
      listen<{ userId: number }>(`gif-icon-changed-${serverId}`, event => { void refresh(event.payload.userId); }),
      listen<{ userId: number }>(`user-left-${serverId}`, event => {
        const id = event.payload.userId;
        changed.add(id); departed.add(id); queued.delete(id); store.put(serverId, id, null);
      }),
      listen<{ userId: number }>(`user-joined-${serverId}`, event => {
        const id = event.payload.userId;
        if (departed.delete(id)) void refresh(id);
      }),
    ];
    // Install notifications before loading the initial list so a late list cannot
    // overwrite a changed or cleared avatar.
    void Promise.all(subscriptions).then(() => active ? invoke<GifIcon[]>('get_gif_icons', { serverId }) : [])
      .then(icons => { if (active) for (const icon of icons) if (!changed.has(icon.userId)) store.put(serverId, icon.userId, icon.url); })
      .catch(() => { /* Classic servers need no extension support. */ });
    return () => {
      active = false; queued.clear(); store.clear(serverId);
      subscriptions.forEach(p => { void p.then(unlisten => unlisten()).catch(() => {}); });
    };
  }, [serverId, connected]);
}
