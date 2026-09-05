import { create } from 'zustand';

interface AvatarState {
  icons: Record<string, Record<number, string>>;
  put: (serverId: string, userId: number, url: string | null) => void;
  clear: (serverId: string) => void;
}
export const useAvatarStore = create<AvatarState>((set) => ({
  icons: {},
  put: (serverId, userId, url) => set(state => {
    const icons = { ...state.icons[serverId] };
    if (url) {
      if (!icons[userId] && Object.keys(icons).length >= 256) return state;
      icons[userId] = url;
    } else delete icons[userId];
    return { icons: { ...state.icons, [serverId]: icons } };
  }),
  clear: serverId => set(state => {
    const icons = { ...state.icons }; delete icons[serverId]; return { icons };
  }),
}));
