import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useAppStore } from '../../stores/appStore';
import { usePreferencesStore } from '../../stores/preferencesStore';
import BookmarkList from './BookmarkList';
import ConnectDialog from './ConnectDialog';
import SettingsView from '../settings/SettingsView';
import NotificationLog from '../notifications/NotificationLog';
import SearchFeaturePrompt from './SearchFeaturePrompt';
import { getPassword, savePassword } from '../../utils/passwordVault';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts';
import type { Bookmark } from '../../types';

const SEARCH_PROMPT_SEEN_KEY = 'mnemosyne-search-prompt-seen';
const SEARCH_BOOKMARK_URL = 'http://tracker.vespernet.net:8980';

export default function TrackerWindow() {
  const [showConnect, setShowConnect] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showNotificationLog, setShowNotificationLog] = useState(false);
  const [showSearchPrompt, setShowSearchPrompt] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const { bookmarks, setBookmarks, addActiveServer, addTab, mnemosyneBookmarks, addMnemosyneBookmark } = useAppStore();
  const autoConnectRan = useRef(false);

  // Load bookmarks from disk on mount - replace entire array to avoid duplicates
  // Also migrate any legacy plaintext passwords into the secure vault.
  useEffect(() => {
    const loadBookmarks = async () => {
      let loadedBookmarks: Bookmark[] | undefined;
      try {
        const savedBookmarks = await invoke<Bookmark[]>('get_bookmarks');
        loadedBookmarks = savedBookmarks;
        let needsResave = false;

        // Migrate legacy plaintext passwords to secure vault
        for (const bm of savedBookmarks) {
          if (bm.password) {
            await savePassword(bm.id, bm.password);
            bm.hasPassword = true;
            bm.password = undefined;
            needsResave = true;
          }
        }

        if (needsResave) {
          // Re-save bookmarks with passwords stripped
          for (const bm of savedBookmarks) {
            await invoke('save_bookmark', { bookmark: bm });
          }
          console.log('Migrated bookmark passwords to secure vault');
        }

        setBookmarks(savedBookmarks);
      } catch (error) {
        if (loadedBookmarks) setBookmarks(loadedBookmarks);
        console.error('Failed to load bookmarks:', error);
      }
    };

    loadBookmarks();
  }, [setBookmarks]);

  // Auto-connect bookmarks with autoConnect flag on first load
  useEffect(() => {
    if (autoConnectRan.current || bookmarks.length === 0) return;
    autoConnectRan.current = true;

    const autoConnectBookmarks = bookmarks.filter(
      b => b.autoConnect && b.type !== 'tracker' && b.port !== 5498
    );
    if (autoConnectBookmarks.length === 0) return;

    const { username, userIconId, autoDetectTls, allowLegacyTls } = usePreferencesStore.getState();
    const currentTabs = useAppStore.getState().tabs;
    const currentServerInfo = useAppStore.getState().serverInfo;

    for (const bookmark of autoConnectBookmarks) {
      // Skip if already connected
      const alreadyConnected = currentTabs.some(t => {
        if (t.type !== 'server' || !t.serverId) return false;
        return currentServerInfo.get(t.serverId)?.address === bookmark.address;
      });
      if (alreadyConnected) continue;

      // Fire-and-forget connection — don't block other auto-connects
      (async () => {
        try {
          console.log(`Auto-connecting to ${bookmark.name}...`);
          // Load password from secure vault
          const connectBookmark = { ...bookmark };
          if (bookmark.hasPassword) {
            const vaultPassword = await getPassword(bookmark.id);
            if (vaultPassword) connectBookmark.password = vaultPassword;
          }
          const result = await invoke<{ serverId: string; tls: boolean; port: number }>('connect_to_server', {
            bookmark: connectBookmark,
            username,
            userIconId,
            autoDetectTls: autoDetectTls && !bookmark.tls,
            allowLegacyTls,
          });

          addActiveServer(result.serverId, {
            id: result.serverId,
            name: bookmark.name,
            address: bookmark.address,
            port: result.port,
            tls: result.tls,
          });

          addTab({
            id: `server-${result.serverId}`,
            type: 'server',
            serverId: result.serverId,
            title: bookmark.name,
            unreadCount: 0,
          });

          console.log(`Auto-connected to ${bookmark.name}`);
        } catch (error) {
          console.error(`Auto-connect failed for ${bookmark.name}:`, error);
        }
      })();
    }
  }, [bookmarks, addActiveServer, addTab]);

  // Keyboard shortcuts
  useKeyboardShortcuts([
    {
      key: 'K',
      modifiers: { meta: true },
      description: 'Connect to Server',
      action: () => setShowConnect(true),
    },
  ]);

  // Listen for Settings menu item from native menu bar
  useEffect(() => {
    const unlisten = listen('menu-settings', () => {
      // Switch to tracker tab first, then open settings after React renders
      const store = useAppStore.getState();
      const trackerTab = store.tabs.find(t => t.type === 'tracker');
      if (trackerTab) {
        store.setActiveTab(trackerTab.id);
      }
      // Delay slightly so the tab switch renders before the overlay opens
      setTimeout(() => setShowSettings(true), 50);
    });
    return () => { unlisten.then(fn => fn()).catch(() => {}); };
  }, []);

  useEffect(() => {
    const hasExistingInstall = localStorage.getItem('hotline-preferences') !== null;
    const hasSeenPrompt = localStorage.getItem(SEARCH_PROMPT_SEEN_KEY) === 'true';
    const hasSearchBookmark = mnemosyneBookmarks.length > 0;

    if (!hasExistingInstall || hasSeenPrompt || hasSearchBookmark) {
      return;
    }

    setShowSearchPrompt(true);
  }, [mnemosyneBookmarks]);

  const dismissSearchPrompt = () => {
    localStorage.setItem(SEARCH_PROMPT_SEEN_KEY, 'true');
    setShowSearchPrompt(false);
  };

  const acceptSearchPrompt = () => {
    const hasSearchBookmark = useAppStore
      .getState()
      .mnemosyneBookmarks
      .some((bookmark) => bookmark.url === SEARCH_BOOKMARK_URL);

    if (!hasSearchBookmark) {
      addMnemosyneBookmark({
        id: 'default-mnemosyne-vespernet',
        name: 'vespernet.net',
        url: SEARCH_BOOKMARK_URL,
      });
    }

    localStorage.setItem(SEARCH_PROMPT_SEEN_KEY, 'true');
    setShowSearchPrompt(false);
  };

  useEffect(() => {
    window.__triggerSearchFeaturePrompt = () => {
      setShowSearchPrompt(true);
    };

    return () => {
      delete window.__triggerSearchFeaturePrompt;
    };
  }, []);

  return (
    <div className="h-full w-full flex flex-col bg-white dark:bg-gray-900">
      {/* Header - matches Swift toolbar style */}
      <div className="flex flex-col border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
        <div className="flex items-center justify-between px-4 py-2">
          <div className="flex items-center gap-3">
            {/* Hotline logo placeholder */}
            <div className="w-6 h-6 flex items-center justify-center">
              <span className="text-lg font-bold text-blue-600 dark:text-blue-400">H</span>
            </div>
            <h1 className="text-base font-semibold text-gray-900 dark:text-white">
              Servers
            </h1>
          </div>
          <div className="flex items-center gap-2">
          <button
            onClick={() => {
              if (refreshing) return;
              setRefreshing(true);
              window.dispatchEvent(new Event('refresh-all-trackers'));
              setTimeout(() => setRefreshing(false), 2000);
            }}
            disabled={refreshing}
            className="px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors flex items-center gap-1.5 disabled:opacity-50"
            title="Refresh Trackers"
          >
            <svg className={`w-4 h-4 transition-transform duration-700 ease-in-out ${refreshing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span className="hidden min-[440px]:inline">Refresh</span>
          </button>
          <button
            onClick={() => setShowConnect(true)}
            className="px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors flex items-center gap-1.5"
            title="Connect to Server"
          >
            <span>🌐</span>
            <span className="hidden min-[440px]:inline">Connect</span>
          </button>
          {mnemosyneBookmarks.length > 0 && (
          <button
            onClick={() => {
              const m = mnemosyneBookmarks[0];
              addTab({
                id: `mnemosyne-${m.id}`,
                type: 'mnemosyne',
                mnemosyneId: m.id,
                title: m.name,
                unreadCount: 0,
              });
            }}
            className="px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors flex items-center gap-1.5"
            title="Search"
          >
            <span>🔍</span>
            <span className="hidden min-[440px]:inline">Search</span>
          </button>
          )}
          <button
            onClick={() => setShowSettings(true)}
            className="px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors"
            title="Settings"
          >
            ⚙️
          </button>
          <button
            onClick={() => setShowNotificationLog(true)}
            className="px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors"
            title="Notification Log"
          >
            🔔
          </button>
        </div>
        </div>
        {/* Search bar */}
        <div className="px-4 pb-2">
          <div className="relative">
            <input
              type="text"
              placeholder="Search servers..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-3 py-1.5 pl-8 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <svg
              className="absolute left-2.5 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 transform -translate-y-1/2 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
                title="Clear search"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Content - list style */}
      <div className="flex-1 overflow-auto bg-white dark:bg-gray-900">
        {bookmarks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500 dark:text-gray-400">
            <p className="text-base mb-1">No bookmarks yet</p>
            <p className="text-sm">Click "Connect" to add a server</p>
          </div>
        ) : (
          <BookmarkList bookmarks={bookmarks} searchQuery={searchQuery} />
        )}
      </div>

      {/* Connect dialog */}
      {showConnect && <ConnectDialog onClose={() => setShowConnect(false)} />}
      
      {/* Settings dialog */}
      {showSettings && <SettingsView onClose={() => setShowSettings(false)} />}
      
      {/* Notification log */}
      {showNotificationLog && <NotificationLog onClose={() => setShowNotificationLog(false)} />}
      {showSearchPrompt && (
        <SearchFeaturePrompt
          onAccept={acceptSearchPrompt}
          onClose={dismissSearchPrompt}
        />
      )}

    </div>
  );
}
