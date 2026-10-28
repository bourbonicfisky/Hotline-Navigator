import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { usePreferencesStore } from '../../stores/preferencesStore';
import { useAppStore } from '../../stores/appStore';
import { showNotification } from '../../stores/notificationStore';
import { useIsMobile } from '../../hooks/useIsMobile';
import type { Bookmark } from '../../types';
import { useChatHistoryStore } from '../../stores/chatHistoryStore';

interface ChatHistoryMeta {
  serverName: string;
  messageCount: number;
  lastUpdated: string;
}

export default function GeneralSettingsTab() {
  const { username, setUsername, enablePrivateMessaging, setEnablePrivateMessaging, darkMode, setDarkMode, downloadFolder, setDownloadFolder, showServerBanner, setShowServerBanner, clickableLinks, setClickableLinks, showInlineImages, setShowInlineImages, renderMarkdown, setRenderMarkdown, renderMarkdownAgreements, setRenderMarkdownAgreements, useRemoteIcons, setUseRemoteIcons, showRemoteBanners, setShowRemoteBanners, autoDetectTls, setAutoDetectTls, allowLegacyTls, setAllowLegacyTls, autoReconnect, setAutoReconnect, autoReconnectInterval, setAutoReconnectInterval, autoReconnectMaxRetries, setAutoReconnectMaxRetries, autoReconnectSliding, setAutoReconnectSliding, mentionPopup, setMentionPopup, mutedUsers, addMutedUser, removeMutedUser, watchWords, addWatchWord, removeWatchWord, enableChatHistory, setEnableChatHistory, enableServerChatHistory, setEnableServerChatHistory, showTimestamps, setShowTimestamps, chatDisplayMode, setChatDisplayMode, showLinkPreviews, setShowLinkPreviews, nickColor, setNickColor, displayUserColors, setDisplayUserColors, enforceColorLegibility, setEnforceColorLegibility, inlineMediaEnabled, setInlineMediaEnabled, imageUploadSizeKb, setImageUploadSizeKb } = usePreferencesStore();
  const { setBookmarks } = useAppStore();
  const isMobile = useIsMobile();
  const [localUsername, setLocalUsername] = useState(username);
  const [isAddingDefaults, setIsAddingDefaults] = useState(false);
  const [muteInput, setMuteInput] = useState('');
  const [watchInput, setWatchInput] = useState('');
  const [chatHistoryServers, setChatHistoryServers] = useState<Record<string, ChatHistoryMeta>>({});
  const [clearingHistory, setClearingHistory] = useState<string | null>(null);

  useEffect(() => {
    setLocalUsername(username);
  }, [username]);

  // Load chat history metadata (re-run when vault unlocks)
  useEffect(() => {
    useChatHistoryStore.getState().getServersWithHistory().then(setChatHistoryServers);
  }, []);

  const handleSave = async () => {
    const newUsername = localUsername.trim() || 'guest';
    setUsername(newUsername);
    try {
      await invoke('update_user_info', {
        username: newUsername,
        iconId: usePreferencesStore.getState().userIconId,
        color: usePreferencesStore.getState().nickColor,
      });
    } catch {
      // Silently ignore - no servers connected or update failed on some
    }
  };

  // 0x00RRGGBB <-> "#RRGGBB" at the UI boundary. Store keeps the protocol-native u32.
  const u32ToHex = (n: number) => `#${(n & 0xffffff).toString(16).padStart(6, '0')}`;
  const hexToU32 = (hex: string) => parseInt(hex.replace(/^#/, ''), 16) & 0xffffff;

  const handleColorChange = async (hex: string) => {
    const u32 = hexToU32(hex);
    setNickColor(u32);
    try {
      await invoke('update_user_info', {
        username: usePreferencesStore.getState().username,
        iconId: usePreferencesStore.getState().userIconId,
        color: u32,
      });
    } catch {
      // Silently ignore - no servers connected or update failed on some
    }
  };

  const handleColorClear = async () => {
    setNickColor(null);
    try {
      await invoke('update_user_info', {
        username: usePreferencesStore.getState().username,
        iconId: usePreferencesStore.getState().userIconId,
        color: null,
      });
    } catch {
      // Silently ignore - no servers connected or update failed on some
    }
  };

  const handlePickDownloadFolder = async () => {
    try {
      const folder = await invoke<string | null>('pick_download_folder');
      if (folder) {
        setDownloadFolder(folder);
      }
    } catch (error) {
      console.error('Failed to pick download folder:', error);
    }
  };

  const handleAddDefaults = async () => {
    setIsAddingDefaults(true);
    try {
      const updatedBookmarks = await invoke<Bookmark[]>('add_default_bookmarks');
      setBookmarks(updatedBookmarks);
      showNotification.success('Default bookmarks added successfully', 'Bookmarks Updated');
    } catch (error) {
      console.error('Failed to add default bookmarks:', error);
      showNotification.error(
        `Failed to add default bookmarks: ${error instanceof Error ? error.message : String(error)}`,
        'Error'
      );
    } finally {
      setIsAddingDefaults(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Your Name
        </label>
        <input
          type="text"
          value={localUsername}
          onChange={(e) => setLocalUsername(e.target.value)}
          onBlur={handleSave}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              handleSave();
              (e.target as HTMLInputElement).blur();
            }
          }}
          placeholder="guest"
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          This name will be displayed to other users on servers you connect to.
        </p>
      </div>

      <div className="border border-gray-200 dark:border-gray-700 rounded-md p-4 space-y-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Username Color
          </label>
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={nickColor != null ? u32ToHex(nickColor) : '#888888'}
              onChange={(e) => handleColorChange(e.target.value)}
              className="h-9 w-14 rounded border border-gray-300 dark:border-gray-600 bg-transparent cursor-pointer"
              title={nickColor != null ? u32ToHex(nickColor) : 'No color set'}
            />
            <button
              type="button"
              onClick={handleColorClear}
              disabled={nickColor == null}
              className="px-3 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Clear
            </button>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {nickColor != null ? u32ToHex(nickColor) : 'No color (default)'}
            </span>
          </div>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Your name color on color-aware servers. "No color" matches classic 1.9.x client behavior.
          </p>
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-gray-200 dark:border-gray-700">
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Display Username Colors
            </label>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Apply colors set by other users. Off renders all names in the default theme color.
            </p>
          </div>
          <input
            type="checkbox"
            checked={displayUserColors}
            onChange={(e) => setDisplayUserColors(e.target.checked)}
            className="ml-4 toggle toggle-primary"
          />
        </div>

        <div className="flex items-center justify-between">
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Enforce Legibility
            </label>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Auto-adjust colors that fall too close to the current theme background so names stay readable.
            </p>
          </div>
          <input
            type="checkbox"
            checked={enforceColorLegibility}
            onChange={(e) => setEnforceColorLegibility(e.target.checked)}
            className="ml-4 toggle toggle-primary"
          />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Enable Private Messaging
            </label>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Allow other users to send you private messages and enable private messaging features.
            </p>
          </div>
          <input
            type="checkbox"
            checked={enablePrivateMessaging}
            onChange={(e) => setEnablePrivateMessaging(e.target.checked)}
            className="ml-4 toggle toggle-primary"
          />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Server Banner
            </label>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Show the server's banner image at the top of the server window.
            </p>
          </div>
          <input
            type="checkbox"
            checked={showServerBanner}
            onChange={(e) => setShowServerBanner(e.target.checked)}
            className="ml-4 toggle toggle-primary"
          />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Chat Display Mode
            </label>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Retro displays chat like IRC. Discord groups messages by user with icons and timestamps.
            </p>
          </div>
          <select
            value={chatDisplayMode}
            onChange={(e) => setChatDisplayMode(e.target.value as 'retro' | 'discord')}
            className="ml-4 px-3 py-1.5 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md text-gray-900 dark:text-white"
          >
            <option value="retro">Retro</option>
            <option value="discord">Discord</option>
          </select>
        </div>
        <div className={`flex items-center justify-between mb-3 ${chatDisplayMode === 'discord' ? 'opacity-50 pointer-events-none' : ''}`}>
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Show Timestamps
            </label>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Display timestamps next to chat messages.{chatDisplayMode === 'discord' ? ' (always on in Discord mode)' : ''}
            </p>
          </div>
          <input
            type="checkbox"
            checked={chatDisplayMode === 'discord' ? true : showTimestamps}
            onChange={(e) => setShowTimestamps(e.target.checked)}
            className="ml-4 toggle toggle-primary"
          />
        </div>
        <div className={`flex items-center justify-between ${chatDisplayMode === 'discord' ? 'opacity-50 pointer-events-none' : ''}`}>
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Clickable Links
            </label>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Make URLs in chat, board posts, news articles, and server agreements clickable.{chatDisplayMode === 'discord' ? ' (always on in Discord mode)' : ''}
            </p>
          </div>
          <input
            type="checkbox"
            checked={chatDisplayMode === 'discord' ? true : clickableLinks}
            onChange={(e) => setClickableLinks(e.target.checked)}
            className="ml-4 toggle toggle-primary"
          />
        </div>
        {clickableLinks && (
          <>
            <div className="flex items-center justify-between mt-3 ml-4 pl-4 border-l-2 border-gray-200 dark:border-gray-700">
              <div className="flex-1">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Inline Image Previews
                </label>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Automatically fetch and show external chat images inline. When off, each image can still be loaded individually from chat.
                </p>
              </div>
              <input
                type="checkbox"
                checked={showInlineImages}
                onChange={(e) => setShowInlineImages(e.target.checked)}
                className="ml-4 toggle toggle-primary"
              />
            </div>
            <div className="flex items-center justify-between mt-3 ml-4 pl-4 border-l-2 border-gray-200 dark:border-gray-700">
              <div className="flex-1">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Link Previews
                </label>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Show rich previews (title and description) for links in Discord chat mode. This sends preview requests to external URLs when enabled.
                </p>
              </div>
              <input
                type="checkbox"
                checked={showLinkPreviews}
                onChange={(e) => setShowLinkPreviews(e.target.checked)}
                className="ml-4 toggle toggle-primary"
              />
            </div>
            <div className="flex items-center justify-between mt-3 ml-4 pl-4 border-l-2 border-gray-200 dark:border-gray-700">
              <div className="flex-1">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Render Markdown
                </label>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Auto-detect and render markdown formatting (links, images, bold, lists, code blocks) in chat, private messages, news, and board posts.
                </p>
              </div>
              <input
                type="checkbox"
                checked={renderMarkdown}
                onChange={(e) => setRenderMarkdown(e.target.checked)}
                className="ml-4 toggle toggle-primary"
              />
            </div>
            {renderMarkdown && (
              <div className="flex items-center justify-between mt-3 ml-8 pl-4 border-l-2 border-gray-200 dark:border-gray-700">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Server Agreements
                  </label>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Render markdown formatting in server agreement dialogs. Many servers use ASCII art, so this is recommended off.
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={renderMarkdownAgreements}
                  onChange={(e) => setRenderMarkdownAgreements(e.target.checked)}
                  className="ml-4 toggle toggle-primary"
                />
              </div>
            )}
          </>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Remote Icons
            </label>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Load missing user icons from hlwiki.com when not available locally.
            </p>
          </div>
          <input
            type="checkbox"
            checked={useRemoteIcons}
            onChange={(e) => setUseRemoteIcons(e.target.checked)}
            className="ml-4 toggle toggle-primary"
          />
        </div>
        {useRemoteIcons && (
          <div className="flex items-center justify-between mt-3 ml-4 pl-4 border-l-2 border-gray-200 dark:border-gray-700">
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Show Banners
              </label>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Display banner icons (232x18) behind usernames. When off, banners are clipped to icon size.
              </p>
            </div>
            <input
              type="checkbox"
              checked={showRemoteBanners}
              onChange={(e) => setShowRemoteBanners(e.target.checked)}
              className="ml-4 toggle toggle-primary"
            />
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Auto-Detect TLS
            </label>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              When connecting from tracker listings, probe for TLS support and use a secure connection if available.
            </p>
          </div>
          <input
            type="checkbox"
            checked={autoDetectTls}
            onChange={(e) => setAutoDetectTls(e.target.checked)}
            className="ml-4 toggle toggle-primary"
          />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Allow Legacy TLS (1.0/1.1)
            </label>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Enable TLS 1.0 and 1.1 support for older Hotline servers that don't support TLS 1.2+. Less secure but required for some retro servers.
            </p>
          </div>
          <input
            type="checkbox"
            checked={allowLegacyTls}
            onChange={(e) => setAllowLegacyTls(e.target.checked)}
            className="ml-4 toggle toggle-primary"
          />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Auto-Reconnect
            </label>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Automatically reconnect when a server disconnects unexpectedly.
            </p>
          </div>
          <input
            type="checkbox"
            checked={autoReconnect}
            onChange={(e) => setAutoReconnect(e.target.checked)}
            className="ml-4 toggle toggle-primary"
          />
        </div>
        {autoReconnect && (
          <div className="mt-3 ml-4 pl-4 border-l-2 border-gray-200 dark:border-gray-700 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm text-gray-700 dark:text-gray-300">Interval (minutes)</label>
              <input
                type="number"
                min={1}
                max={999}
                value={autoReconnectInterval}
                onChange={(e) => setAutoReconnectInterval(parseInt(e.target.value) || 1)}
                className="w-20 px-2 py-1 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              />
            </div>
            <div className="flex items-center justify-between">
              <label className="text-sm text-gray-700 dark:text-gray-300">Max retries</label>
              <input
                type="number"
                min={1}
                max={99}
                value={autoReconnectMaxRetries}
                onChange={(e) => setAutoReconnectMaxRetries(parseInt(e.target.value) || 1)}
                className="w-20 px-2 py-1 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <label className="text-sm text-gray-700 dark:text-gray-300">Sliding interval</label>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Double the wait after each attempt ({autoReconnectInterval}m, {autoReconnectInterval * 2}m, {autoReconnectInterval * 4}m... max 12 hours).
                </p>
              </div>
              <input
                type="checkbox"
                checked={autoReconnectSliding}
                onChange={(e) => setAutoReconnectSliding(e.target.checked)}
                className="ml-4 toggle toggle-primary"
              />
            </div>
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Mention Pop-up Notifications
            </label>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Show a pop-up when someone @mentions you in chat. Mentions are always logged to notification history.
            </p>
          </div>
          <input
            type="checkbox"
            checked={mentionPopup}
            onChange={(e) => setMentionPopup(e.target.checked)}
            className="ml-4 toggle toggle-primary"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Muted Users
        </label>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          No notifications or sounds from these usernames.
        </p>
        {mutedUsers.length > 0 && (
          <div className="mb-3 space-y-1">
            {mutedUsers.map((u) => (
              <div key={u} className="flex items-center justify-between px-3 py-1.5 bg-gray-100 dark:bg-gray-800 rounded-md">
                <span className="text-sm text-gray-900 dark:text-gray-100">{u}</span>
                <button
                  onClick={() => removeMutedUser(u)}
                  className="text-xs text-red-500 hover:text-red-700 dark:hover:text-red-400"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <input
            type="text"
            value={muteInput}
            onChange={(e) => setMuteInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && muteInput.trim()) {
                addMutedUser(muteInput.trim());
                setMuteInput('');
              }
            }}
            placeholder="Username to mute"
            className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          />
          <button
            onClick={() => { if (muteInput.trim()) { addMutedUser(muteInput.trim()); setMuteInput(''); } }}
            disabled={!muteInput.trim()}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-md text-sm font-medium disabled:cursor-not-allowed transition-colors"
          >
            Mute
          </button>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Watch Words
        </label>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          Highlight and notify when any of these words appear in chat (case-insensitive, whole word).
        </p>
        {watchWords.length > 0 && (
          <div className="mb-3 space-y-1">
            {watchWords.map((w) => (
              <div key={w} className="flex items-center justify-between px-3 py-1.5 bg-gray-100 dark:bg-gray-800 rounded-md">
                <span className="text-sm text-gray-900 dark:text-gray-100">{w}</span>
                <button
                  onClick={() => removeWatchWord(w)}
                  className="text-xs text-red-500 hover:text-red-700 dark:hover:text-red-400"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <input
            type="text"
            value={watchInput}
            onChange={(e) => setWatchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && watchInput.trim()) {
                addWatchWord(watchInput.trim());
                setWatchInput('');
              }
            }}
            placeholder="Word to watch for"
            className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          />
          <button
            onClick={() => { if (watchInput.trim()) { addWatchWord(watchInput.trim()); setWatchInput(''); } }}
            disabled={!watchInput.trim()}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-md text-sm font-medium disabled:cursor-not-allowed transition-colors"
          >
            Add
          </button>
        </div>
      </div>

      <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Image Attachments
        </label>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          Send and receive images inline with chat messages. Requires server support.
        </p>

        <div className="flex items-center justify-between">
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Enable inline images
            </label>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              When off, images are not sent or received and the attach button is hidden.
            </p>
          </div>
          <input
            type="checkbox"
            checked={inlineMediaEnabled}
            onChange={async (e) => {
              const enabled = e.target.checked;
              setInlineMediaEnabled(enabled);
              try {
                await invoke('set_inline_media_enabled', { enabled });
              } catch (error) {
                console.error('Failed to update inline media preference', error);
              }
            }}
            className="ml-4 toggle toggle-primary"
          />
        </div>

        {inlineMediaEnabled && (
          <div className="mt-3 ml-4 pl-4 border-l-2 border-gray-200 dark:border-gray-700">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Maximum upload size
            </label>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
              Images larger than this limit will be rejected when you try to attach.
              256 KB matches the spec's recommended server default and works on most servers.
            </p>
            <select
              value={imageUploadSizeKb}
              onChange={(e) => setImageUploadSizeKb(Number(e.target.value) as 256 | 512 | 1024 | 2048)}
              className="px-3 py-1 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value={256}>256 KB (Recommended)</option>
              <option value={512}>512 KB</option>
              <option value={1024}>1 MB</option>
              <option value={2048}>2 MB</option>
            </select>
          </div>
        )}
      </div>

      <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Appearance
        </label>
        <div className="space-y-2">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="radio"
              name="darkMode"
              value="system"
              checked={darkMode === 'system'}
              onChange={() => setDarkMode('system')}
              className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
            />
            <div className="flex-1">
              <span className="text-sm text-gray-900 dark:text-white">System</span>
              <p className="text-xs text-gray-500 dark:text-gray-400">Follow system preference</p>
            </div>
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="radio"
              name="darkMode"
              value="light"
              checked={darkMode === 'light'}
              onChange={() => setDarkMode('light')}
              className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
            />
            <div className="flex-1">
              <span className="text-sm text-gray-900 dark:text-white">Light</span>
              <p className="text-xs text-gray-500 dark:text-gray-400">Always use light mode</p>
            </div>
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="radio"
              name="darkMode"
              value="dark"
              checked={darkMode === 'dark'}
              onChange={() => setDarkMode('dark')}
              className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
            />
            <div className="flex-1">
              <span className="text-sm text-gray-900 dark:text-white">Dark</span>
              <p className="text-xs text-gray-500 dark:text-gray-400">Always use dark mode</p>
            </div>
          </label>
        </div>
      </div>

      {!isMobile && (
        <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Download Folder
          </label>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
            {downloadFolder ? downloadFolder : 'System Downloads folder'}
          </p>
          <div className="flex gap-2">
            <button
              onClick={handlePickDownloadFolder}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md font-medium transition-colors"
            >
              Choose...
            </button>
            {downloadFolder && (
              <button
                onClick={() => setDownloadFolder(null)}
                className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-md font-medium hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                Reset to Default
              </button>
            )}
          </div>
        </div>
      )}

      <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Bookmarks
        </label>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          Re-add default trackers and servers if you've deleted them.
        </p>
        <button
          onClick={handleAddDefaults}
          disabled={isAddingDefaults}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-md font-medium disabled:cursor-not-allowed transition-colors"
        >
          {isAddingDefaults ? 'Adding...' : 'Re-add Default Servers & Trackers'}
        </button>
      </div>

      {/* Chat History */}
      <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
        <div className="flex items-center justify-between mb-2">
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Server Chat History
            </label>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Fetch chat history from servers that support the Chat History extension. Messages load on connect and scroll-back.
            </p>
          </div>
          <input
            type="checkbox"
            checked={enableServerChatHistory}
            onChange={(e) => setEnableServerChatHistory(e.target.checked)}
            className="ml-4 toggle toggle-primary"
          />
        </div>

        <div className="flex items-center justify-between mb-2 mt-4">
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Local Chat History
            </label>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Store chat messages locally in an encrypted vault. Used for servers that don't support server-side history.
            </p>
          </div>
          <input
            type="checkbox"
            checked={enableChatHistory}
            onChange={(e) => setEnableChatHistory(e.target.checked)}
            className="ml-4 toggle toggle-primary"
          />
        </div>

        {enableChatHistory && Object.keys(chatHistoryServers).length > 0 ? (
          <div className="space-y-2 mb-4">
            {Object.entries(chatHistoryServers).map(([serverId, meta]) => (
              <div
                key={serverId}
                className="flex items-center justify-between bg-gray-50 dark:bg-gray-800 rounded-md px-3 py-2"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-gray-900 dark:text-gray-100 truncate">
                    {meta.serverName || serverId}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {meta.messageCount} {meta.messageCount === 1 ? 'message' : 'messages'}
                  </div>
                </div>
                <button
                  onClick={async () => {
                    setClearingHistory(serverId);
                    await useChatHistoryStore.getState().clearHistory(serverId);
                    const updated = { ...chatHistoryServers };
                    delete updated[serverId];
                    setChatHistoryServers(updated);
                    setClearingHistory(null);
                  }}
                  disabled={clearingHistory === serverId}
                  className="ml-3 px-3 py-1 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors disabled:opacity-50"
                >
                  {clearingHistory === serverId ? 'Clearing...' : 'Clear'}
                </button>
              </div>
            ))}
          </div>
        ) : enableChatHistory ? (
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-4 italic">
            No chat history stored.
          </p>
        ) : null}

        {enableChatHistory && Object.keys(chatHistoryServers).length > 0 && (
          <button
            onClick={async () => {
              if (!window.confirm('Are you sure you want to clear all chat history? This cannot be undone.')) return;
              setClearingHistory('__all');
              await useChatHistoryStore.getState().clearAllHistory();
              setChatHistoryServers({});
              setClearingHistory(null);
            }}
            disabled={clearingHistory === '__all'}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white rounded-md font-medium disabled:cursor-not-allowed transition-colors"
          >
            {clearingHistory === '__all' ? 'Clearing...' : 'Clear All Chat History'}
          </button>
        )}
      </div>
    </div>
  );
}
