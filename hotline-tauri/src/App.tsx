import ChatHistoryPassphraseDialog from './components/settings/ChatHistoryPassphraseDialog';
import { usePasswordVaultPrompt } from './utils/passwordVault';
import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useAppStore } from './stores/appStore';
import { usePreferencesStore } from './stores/preferencesStore';
import { useChatHistoryStore } from './stores/chatHistoryStore';
import TrackerWindow from './components/tracker/TrackerWindow';
import ServerWindow from './components/server/ServerWindow';
import MnemosyneWindow from './components/mnemosyne/MnemosyneWindow';
import TabBar from './components/tabs/TabBar';
import { useDarkMode } from './hooks/useDarkMode';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import NotificationContainer from './components/notifications/NotificationContainer';

function App() {
  const vaultPrompt = usePasswordVaultPrompt();
  // Initialize dark mode management
  useDarkMode();

  const { tabs, activeTabId, serverInfo, removeTab, addTab, setActiveTab } = useAppStore();
  const enableChatHistory = usePreferencesStore((s) => s.enableChatHistory);

  // Auto-unlock chat history vault on startup (default passphrase, no user prompt)
  useEffect(() => {
    if (enableChatHistory) {
      useChatHistoryStore.getState().unlock('hotline-navigator-chat-v1');
    }
  }, []); // Only on mount
  
  // Ensure we always have at least one tab
  useEffect(() => {
    if (tabs.length === 0) {
      addTab({
        id: 'tracker-1',
        type: 'tracker',
        title: 'Tracker',
        unreadCount: 0,
      });
    }
  }, [tabs.length, addTab]);
  
  // Keyboard shortcuts for tab management
  useKeyboardShortcuts([
    {
      key: 'W',
      modifiers: { meta: true },
      description: 'Close tab',
      action: () => {
        if (activeTabId && tabs.length > 1) {
          const activeTab = tabs.find(t => t.id === activeTabId);
          // Don't close tracker tabs; allow closing server and mnemosyne tabs
          if (activeTab?.type !== 'tracker') {
            removeTab(activeTabId);
          }
        }
      },
    },
    {
      key: 'Tab',
      modifiers: { meta: true },
      description: 'Next tab',
      action: () => {
        const currentIndex = tabs.findIndex(t => t.id === activeTabId);
        const nextIndex = (currentIndex + 1) % tabs.length;
        setActiveTab(tabs[nextIndex].id);
      },
    },
    {
      key: 'Tab',
      modifiers: { meta: true, shift: true },
      description: 'Previous tab',
      action: () => {
        const currentIndex = tabs.findIndex(t => t.id === activeTabId);
        const prevIndex = (currentIndex - 1 + tabs.length) % tabs.length;
        setActiveTab(tabs[prevIndex].id);
      },
    },
    // Number keys 1-9 to switch to specific tab
    ...Array.from({ length: 9 }, (_, i) => ({
      key: String(i + 1),
      modifiers: { meta: true },
      description: `Switch to tab ${i + 1}`,
      action: () => {
        if (tabs[i]) {
          setActiveTab(tabs[i].id);
        }
      },
    })),
  ]);

  return (
    <div className="h-screen w-screen bg-gray-100 dark:bg-gray-900 flex flex-col">
      {/* Tab bar - always visible */}
      <TabBar />
      
      {/* Content area */}
      <div className="flex-1 overflow-hidden relative">
        {/* Render all tabs, but only show the active one */}
        {tabs.length > 0 ? (
          tabs.map((tab) => (
            <div
              key={tab.id}
              className={`absolute inset-0 transition-all duration-200 ease-out ${
              tab.id === activeTabId
                ? 'opacity-100 translate-y-0 pointer-events-auto'
                : 'opacity-0 translate-y-1 pointer-events-none'
            }`}
            >
              {tab.type === 'tracker' && <TrackerWindow />}
              {tab.type === 'mnemosyne' && tab.mnemosyneId && (
                <MnemosyneWindow mnemosyneId={tab.mnemosyneId} />
              )}
              {tab.type === 'server' && tab.serverId && (() => {
                const server = serverInfo.get(tab.serverId);
                return server ? (
                  <ServerWindow
                    serverId={tab.serverId}
                    serverName={tab.title}
                    onClose={() => {
                      // Disconnect and remove tab
                      invoke('disconnect_from_server', { serverId: tab.serverId }).catch(console.error);
                      removeTab(tab.id);
                    }}
                  />
                ) : (
                  <div className="flex items-center justify-center h-full text-gray-500">
                    Server not found or disconnected
                  </div>
                );
              })()}
            </div>
          ))
        ) : (
          <div className="flex items-center justify-center h-full text-gray-500">
            No tabs available
          </div>
        )}
      </div>
      
      {/* Notification toasts */}
      <NotificationContainer />
      {vaultPrompt.mode && <ChatHistoryPassphraseDialog purpose="passwords" mode={vaultPrompt.mode}
        onSubmit={vaultPrompt.submit} onCancel={vaultPrompt.cancel} />}
    </div>
  );
}

export default App;
