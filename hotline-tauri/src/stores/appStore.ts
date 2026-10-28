import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { Bookmark, ConnectionStatus, MnemosyneBookmark, TrackerBookmark, Transfer } from '../types';
import { usePreferencesStore } from './preferencesStore';
import { withBookmarkPassword } from '../utils/bookmarkCredentials';

const MNEMOSYNE_BOOKMARKS_STORAGE_KEY = 'mnemosyne-bookmarks';
const HOTLINE_PREFERENCES_STORAGE_KEY = 'hotline-preferences';

const DEFAULT_MNEMOSYNE_BOOKMARK: MnemosyneBookmark = {
  id: 'default-mnemosyne-vespernet',
  name: 'vespernet.net',
  url: 'http://tracker.vespernet.net:8980',
};

function loadMnemosyneBookmarks(): MnemosyneBookmark[] {
  const stored = localStorage.getItem(MNEMOSYNE_BOOKMARKS_STORAGE_KEY);
  if (stored) {
    return JSON.parse(stored) as MnemosyneBookmark[];
  }

  const hasExistingInstall = localStorage.getItem(HOTLINE_PREFERENCES_STORAGE_KEY) !== null;

  if (hasExistingInstall) {
    localStorage.setItem(MNEMOSYNE_BOOKMARKS_STORAGE_KEY, JSON.stringify([]));
    return [];
  }

  const defaults: MnemosyneBookmark[] = [DEFAULT_MNEMOSYNE_BOOKMARK];
  localStorage.setItem(MNEMOSYNE_BOOKMARKS_STORAGE_KEY, JSON.stringify(defaults));
  return defaults;
}

interface ServerInfo {
  id: string;
  name: string;
  address: string;
  port: number;
  tls?: boolean;
}

interface FileItem {
  name: string;
  size: number;
  isFolder: boolean;
  fileType?: string;
  creator?: string;
}

// File cache key is the path joined with '/'
type FileCache = Map<string, FileItem[]>;

export interface Tab {
  id: string;
  type: 'tracker' | 'server' | 'mnemosyne';
  serverId?: string; // Only for server tabs
  mnemosyneId?: string; // Only for mnemosyne tabs
  title: string;
  unreadCount: number;
  initialFilePath?: string[]; // Navigate to this path in Files tab on connect
  connectionStatus?: ConnectionStatus; // Tracks server connection state for tab styling
}

interface AppState {
  // Tracker bookmarks
  bookmarks: Bookmark[];
  trackers: TrackerBookmark[];
  mnemosyneBookmarks: MnemosyneBookmark[];

  // Active servers
  activeServers: string[];
  serverInfo: Map<string, ServerInfo>;
  focusedServer: string | null; // Deprecated - use tabs instead

  // Tab management
  tabs: Tab[];
  activeTabId: string | null;

  // File cache per server
  fileCache: Map<string, FileCache>;

  // Transfers
  transfers: Transfer[];

  // UI state
  showAbout: boolean;
  showUpdate: boolean;

  // Actions
  addBookmark: (bookmark: Bookmark) => void;
  setBookmarks: (bookmarks: Bookmark[]) => void;
  removeBookmark: (id: string) => void;
  updateBookmark: (id: string, bookmark: Partial<Bookmark>) => void;

  addTracker: (tracker: TrackerBookmark) => void;
  removeTracker: (id: string) => void;

  addMnemosyneBookmark: (bookmark: MnemosyneBookmark) => void;
  removeMnemosyneBookmark: (id: string) => void;
  updateMnemosyneBookmark: (id: string, updates: Partial<MnemosyneBookmark>) => void;

  setFocusedServer: (serverId: string | null) => void; // Deprecated
  addActiveServer: (serverId: string, info: ServerInfo) => void;
  removeActiveServer: (serverId: string) => void;
  reconnectServer: (serverId: string) => Promise<void>;

  // Tab actions
  addTab: (tab: Tab) => void;
  removeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  updateTabUnread: (tabId: string, count: number) => void;
  updateTabTitle: (tabId: string, title: string) => void;
  updateTabConnectionStatus: (tabId: string, status: ConnectionStatus) => void;

  setShowAbout: (show: boolean) => void;
  setShowUpdate: (show: boolean) => void;

  // File cache actions
  setFileCache: (serverId: string, path: string[], files: FileItem[]) => void;
  getFileCache: (serverId: string, path: string[]) => FileItem[] | null;
  clearFileCache: (serverId: string) => void;
  clearFileCachePath: (serverId: string, path: string[]) => void;

  // Transfer actions
  addTransfer: (transfer: Transfer) => void;
  updateTransfer: (id: string, updates: Partial<Transfer>) => void;
  removeTransfer: (id: string) => void;
  clearCompletedTransfers: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  bookmarks: [],
  trackers: [],
  mnemosyneBookmarks: loadMnemosyneBookmarks(),
  activeServers: [],
  serverInfo: new Map(),
  focusedServer: null,
  tabs: [{ id: 'tracker-1', type: 'tracker', title: 'Tracker', unreadCount: 0 }], // Start with one tracker tab
  activeTabId: 'tracker-1',
  showAbout: false,
  showUpdate: false,
  fileCache: new Map(),
  transfers: [],

  addBookmark: (bookmark) => set((state) => {
    // Check if bookmark already exists to prevent duplicates
    if (state.bookmarks.some((b) => b.id === bookmark.id)) {
      return state;
    }
    return {
      bookmarks: [...state.bookmarks, bookmark],
    };
  }),

  setBookmarks: (bookmarks) => set({ bookmarks }),

  removeBookmark: (id) => set((state) => ({
    bookmarks: state.bookmarks.filter((b) => b.id !== id),
  })),

  updateBookmark: (id, bookmark) => set((state) => ({
    bookmarks: state.bookmarks.map((b) =>
      b.id === id ? { ...b, ...bookmark } : b
    ),
  })),

  addTracker: (tracker) => set((state) => ({
    trackers: [...state.trackers, tracker],
  })),

  removeTracker: (id) => set((state) => ({
    trackers: state.trackers.filter((t) => t.id !== id),
  })),

  addMnemosyneBookmark: (bookmark) => set((state) => {
    const updated = [...state.mnemosyneBookmarks, bookmark];
    localStorage.setItem(MNEMOSYNE_BOOKMARKS_STORAGE_KEY, JSON.stringify(updated));
    return { mnemosyneBookmarks: updated };
  }),

  removeMnemosyneBookmark: (id) => set((state) => {
    const updated = state.mnemosyneBookmarks.filter((b) => b.id !== id);
    localStorage.setItem(MNEMOSYNE_BOOKMARKS_STORAGE_KEY, JSON.stringify(updated));
    return { mnemosyneBookmarks: updated };
  }),

  updateMnemosyneBookmark: (id, updates) => set((state) => {
    const updated = state.mnemosyneBookmarks.map((b) =>
      b.id === id ? { ...b, ...updates } : b
    );
    localStorage.setItem(MNEMOSYNE_BOOKMARKS_STORAGE_KEY, JSON.stringify(updated));
    return { mnemosyneBookmarks: updated };
  }),

  setFocusedServer: (serverId) => set({ focusedServer: serverId }), // Deprecated

  // Tab actions
  addTab: (tab) => set((state) => {
    // Check if tab already exists (by serverId for server tabs, mnemosyneId for mnemosyne tabs, or by id)
    const existingTab = state.tabs.find(t =>
      (tab.type === 'server' && t.type === 'server' && t.serverId === tab.serverId) ||
      (tab.type === 'mnemosyne' && t.type === 'mnemosyne' && t.mnemosyneId === tab.mnemosyneId) ||
      t.id === tab.id
    );
    if (existingTab) {
      // Tab exists, just switch to it
      return { activeTabId: existingTab.id };
    }
    return {
      tabs: [...state.tabs, tab],
      activeTabId: tab.id,
    };
  }),

  removeTab: (tabId) => set((state) => {
    // Find the tab being closed
    const tabToClose = state.tabs.find(t => t.id === tabId);
    
    // Don't allow closing tracker tabs
    if (tabToClose?.type === 'tracker') {
      return state;
    }
    
    // Count tracker tabs
    const trackerTabCount = state.tabs.filter(t => t.type === 'tracker').length;
    const newTabs = state.tabs.filter(t => t.id !== tabId);
    const newTrackerTabCount = newTabs.filter(t => t.type === 'tracker').length;
    
    // Ensure at least one tracker tab remains
    if (newTrackerTabCount === 0 && trackerTabCount > 0) {
      return state;
    }
    
    if (state.tabs.length === 1) {
      // Don't allow closing the last tab
      return state;
    }
    
    let newActiveTabId = state.activeTabId;
    
    // If we're closing the active tab, switch to another
    if (tabId === state.activeTabId) {
      const closedIndex = state.tabs.findIndex(t => t.id === tabId);
      // Try to switch to tab to the right, or left if at end
      if (closedIndex < newTabs.length) {
        newActiveTabId = newTabs[closedIndex].id;
      } else {
        newActiveTabId = newTabs[newTabs.length - 1].id;
      }
    }
    
    return {
      tabs: newTabs,
      activeTabId: newActiveTabId,
    };
  }),

  setActiveTab: (tabId) => set((state) => {
    // Clear unread count when switching to a tab
    const newTabs = state.tabs.map(t => 
      t.id === tabId ? { ...t, unreadCount: 0 } : t
    );
    return {
      tabs: newTabs,
      activeTabId: tabId,
    };
  }),

  updateTabUnread: (tabId, count) => set((state) => ({
    tabs: state.tabs.map(t => 
      t.id === tabId ? { ...t, unreadCount: count } : t
    ),
  })),

  updateTabTitle: (tabId, title) => set((state) => ({
    tabs: state.tabs.map(t =>
      t.id === tabId ? { ...t, title } : t
    ),
  })),

  updateTabConnectionStatus: (tabId, status) => set((state) => ({
    tabs: state.tabs.map(t =>
      t.id === tabId ? { ...t, connectionStatus: status } : t
    ),
  })),

  addActiveServer: (serverId, info) => set((state) => {
    const newServerInfo = new Map(state.serverInfo);
    newServerInfo.set(serverId, info);
    return {
      activeServers: [...state.activeServers, serverId],
      serverInfo: newServerInfo,
    };
  }),

  removeActiveServer: (serverId) => set((state) => {
    const newServerInfo = new Map(state.serverInfo);
    newServerInfo.delete(serverId);
    return {
      activeServers: state.activeServers.filter((id) => id !== serverId),
      serverInfo: newServerInfo,
    };
  }),

  reconnectServer: async (serverId) => {
    const state = useAppStore.getState();
    const info = state.serverInfo.get(serverId);
    if (!info) return;

    // Find the matching bookmark by address
    const bookmark = state.bookmarks.find(b => b.address === info.address);
    if (!bookmark) return;

    // Read preferences for connection settings
    const prefs = usePreferencesStore.getState();
    const { username, userIconId, autoDetectTls, allowLegacyTls } = prefs;

    // Disconnect old client
    try {
      await invoke('disconnect_from_server', { serverId });
    } catch { /* ignore */ }

    // Reconnect with same bookmark
    try {
      await invoke('connect_to_server', {
        bookmark: await withBookmarkPassword(bookmark),
        username,
        userIconId,
        autoDetectTls: autoDetectTls && !bookmark.tls,
        allowLegacyTls,
      });
    } catch (error) {
      console.error('Reconnect failed:', error);
    }
  },

  setShowAbout: (show) => set({ showAbout: show }),
  setShowUpdate: (show) => set({ showUpdate: show }),

  // File cache actions
  setFileCache: (serverId, path, files) => set((state) => {
    const cache = state.fileCache.get(serverId) || new Map();
    const pathKey = path.join('/');
    cache.set(pathKey, files);
    const newCache = new Map(state.fileCache);
    newCache.set(serverId, cache);
    return { fileCache: newCache };
  }),

  getFileCache: (serverId: string, path: string[]): FileItem[] | null => {
    const cache = useAppStore.getState().fileCache.get(serverId);
    if (!cache) return null;
    const pathKey = path.join('/');
    return cache.get(pathKey) || null;
  },

  clearFileCache: (serverId) => set((state) => {
    const newCache = new Map(state.fileCache);
    newCache.delete(serverId);
    return { fileCache: newCache };
  }),

  clearFileCachePath: (serverId, path) => set((state) => {
    const cache = state.fileCache.get(serverId);
    if (!cache) return state;
    const pathKey = path.join('/');
    const newCache = new Map(cache);
    newCache.delete(pathKey);
    const newFileCache = new Map(state.fileCache);
    newFileCache.set(serverId, newCache);
    return { fileCache: newFileCache };
  }),

  // Transfer actions
  addTransfer: (transfer) => set((state) => ({
    transfers: [...state.transfers, transfer],
  })),

  updateTransfer: (id, updates) => set((state) => ({
    transfers: state.transfers.map((t) =>
      t.id === id ? { ...t, ...updates } : t
    ),
  })),

  removeTransfer: (id) => set((state) => ({
    transfers: state.transfers.filter((t) => t.id !== id),
  })),

  clearCompletedTransfers: () => set((state) => ({
    transfers: state.transfers.filter((t) => t.status === 'active'),
  })),
}));
