import React, { useRef, useEffect, useState } from 'react';
import MarkdownText from '../common/MarkdownText';
import DiscordChatRenderer from './DiscordChatRenderer';
import MediaImage from './MediaImage';
import AttachChip from './AttachChip';
import { useChatAttachment } from './useChatAttachment';
import { usePreferencesStore } from '../../stores/preferencesStore';
import { resolveNameColor } from '../../utils/displayColor';
import { useThemeBackground } from '../../hooks/useThemeBackground';
import type { ChatMessageMedia } from '../server/serverTypes';

interface ChatMessage {
  userId: number;
  userName: string;
  message: string;
  timestamp: Date;
  iconId?: number;
  type?: 'message' | 'agreement' | 'server' | 'joined' | 'left' | 'signOut';
  isMention?: boolean; // Indicates if this message mentions the current user
  isAdmin?: boolean;
  isServerHistory?: boolean;
  isAction?: boolean;
  isDeleted?: boolean;
  messageId?: string;
  fromHistory?: boolean;
  pending?: boolean;
  optimisticKey?: string;
  color?: string | null;
  media?: ChatMessageMedia;
}

interface ChatUser {
  userId: number;
  userName: string;
  iconId?: number;
  isAdmin?: boolean;
  color?: string | null;
}

interface ChatTabProps {
  serverId: string;
  serverName: string;
  messages: ChatMessage[];
  users?: ChatUser[];
  message: string;
  sending: boolean;
  bannerUrl?: string | null;
  agreementText?: string | null;
  canBroadcast?: boolean;
  onMessageChange: (value: string) => void;
  onSendMessage: (e: React.FormEvent, media?: { handle: string; mime: string } | null) => void | Promise<void>;
  onSendBroadcast?: (message: string) => void;
  onAcceptAgreement?: () => void;
  onDeclineAgreement?: () => void;
  // Server-side chat history
  historyLoading?: boolean;
  historyHasMore?: boolean;
  onLoadMoreHistory?: () => void;
  historyMaxMsgs?: number;
  historyMaxDays?: number;
}

export default function ChatTab({
  serverId,
  serverName,
  messages,
  users,
  message,
  sending,
  bannerUrl: _bannerUrl,
  agreementText,
  canBroadcast,
  onMessageChange,
  onSendMessage,
  onSendBroadcast,
  onAcceptAgreement: _onAcceptAgreement,
  onDeclineAgreement: _onDeclineAgreement,
  historyLoading,
  historyHasMore,
  onLoadMoreHistory,
  historyMaxMsgs,
  historyMaxDays,
}: ChatTabProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isAtBottomRef = useRef(true);
  const [broadcastMode, setBroadcastMode] = useState(false);
  const [broadcastMessage, setBroadcastMessage] = useState('');
  const {
    clickableLinks,
    showTimestamps,
    chatDisplayMode,
    displayUserColors,
    enforceColorLegibility,
    inlineMediaEnabled,
  } = usePreferencesStore();

  const attachment = useChatAttachment(serverId, serverName);
  const { staged, uploading, mediaStatus, attachEnabled, handleAttachClick, handlePaste, removeStaged } = attachment;
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending || uploading) return;
    await attachment.send((media) => onSendMessage(e, media));
  };
  const themeBg = useThemeBackground();
  const colorPrefs = { displayUserColors, enforceColorLegibility };

  // Resolve a name color from the live user list (so a user who chatted before
  // their info loaded still gets their color once we know it).
  const resolveLiveColor = (msg: ChatMessage): string | null | undefined => {
    if (!users || !msg.userId) return msg.color;
    const live = users.find((u) => u.userId === msg.userId)
      || users.find((u) => u.userName === msg.userName);
    return live?.color ?? msg.color;
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const scrollToBottom = (smooth = true) => {
    messagesEndRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'instant' });
  };

  const loadingMoreRef = useRef(false);
  const prevScrollHeightRef = useRef(0);
  const pullDistanceRef = useRef(0);
  const [pullProgress, setPullProgress] = useState(0); // 0–1 for pull indicator
  const PULL_THRESHOLD = 60; // pixels of overscroll to trigger load

  const handleScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 50;

    // Reset pull progress when user scrolls away from top
    if (el.scrollTop > 0) {
      pullDistanceRef.current = 0;
      setPullProgress(0);
    }
  };

  // Track overscroll via wheel events for elastic pull-to-load
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      if (!historyHasMore || historyLoading || loadingMoreRef.current || !onLoadMoreHistory) return;

      // Only accumulate when at the very top and scrolling up
      if (el.scrollTop === 0 && e.deltaY < 0) {
        pullDistanceRef.current = Math.min(pullDistanceRef.current + Math.abs(e.deltaY), PULL_THRESHOLD * 1.2);
        setPullProgress(Math.min(pullDistanceRef.current / PULL_THRESHOLD, 1));

        // Trigger load when threshold reached
        if (pullDistanceRef.current >= PULL_THRESHOLD) {
          loadingMoreRef.current = true;
          prevScrollHeightRef.current = el.scrollHeight;
          pullDistanceRef.current = 0;
          setPullProgress(0);
          onLoadMoreHistory();
        }
      } else if (e.deltaY > 0) {
        // Scrolling down — reset pull
        pullDistanceRef.current = 0;
        setPullProgress(0);
      }
    };

    el.addEventListener('wheel', handleWheel, { passive: true });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [historyHasMore, historyLoading, onLoadMoreHistory]);

  // Restore scroll position after older messages are prepended
  useEffect(() => {
    if (!loadingMoreRef.current) return;
    const el = scrollContainerRef.current;
    if (!el) return;

    // Wait for DOM to update with new messages
    requestAnimationFrame(() => {
      const newScrollHeight = el.scrollHeight;
      const addedHeight = newScrollHeight - prevScrollHeightRef.current;
      if (addedHeight > 0) {
        el.scrollTop = addedHeight;
      }
      loadingMoreRef.current = false;
    });
  }, [messages]);

  // Auto-scroll to bottom when new messages arrive (only if already at bottom)
  useEffect(() => {
    if (isAtBottomRef.current) {
      scrollToBottom();
    }
  }, [messages]);

  // Auto-resize textarea as message content changes
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [message]);

  // Re-anchor to bottom on container resize (e.g. window resize)
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      if (isAtBottomRef.current) {
        scrollToBottom(false);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Messages */}
      <div ref={scrollContainerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto p-4 space-y-2">
        {/* Pull-to-load-more indicator */}
        {pullProgress > 0 && !historyLoading && historyHasMore && (
          <div
            className="text-xs text-gray-400 dark:text-gray-500 text-center flex items-center justify-center gap-2 overflow-hidden transition-all duration-150"
            style={{ height: `${pullProgress * 36}px`, opacity: pullProgress }}
          >
            <svg
              className="h-3.5 w-3.5 transition-transform duration-150"
              style={{ transform: `rotate(${pullProgress * 180}deg)` }}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
            {pullProgress >= 1 ? 'Release to load more' : 'Pull to load more'}
          </div>
        )}
        {/* Server-side history loading indicator */}
        {historyLoading && (
          <div className="text-xs text-gray-400 dark:text-gray-500 text-center py-3 flex items-center justify-center gap-2">
            <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Loading chat history...
          </div>
        )}
        {/* Beginning of chat history — shown only when fully scrolled to the start */}
        {historyHasMore === false && messages.some(m => m.fromHistory) && (
          <div className="text-xs text-gray-400 dark:text-gray-500 text-center py-2 border-b border-gray-200 dark:border-gray-700 mb-2">
            Beginning of chat history
          </div>
        )}
        {/* Server retention policy hint — shown above loaded history messages */}
        {messages.some(m => m.fromHistory) && (historyMaxMsgs || historyMaxDays) && (
          <div className="text-xs text-gray-400 dark:text-gray-500 text-center py-1">
            This server keeps {historyMaxDays ? `${historyMaxDays} days` : ''}{historyMaxDays && historyMaxMsgs ? ' / ' : ''}{historyMaxMsgs ? `${historyMaxMsgs.toLocaleString()} messages` : ''} of chat history
          </div>
        )}
        {messages.length === 0 && !agreementText && !historyLoading ? (
          <div className="text-sm text-gray-500 dark:text-gray-400 text-center">
            Connected to {serverName}
          </div>
        ) : chatDisplayMode === 'discord' ? (
          <DiscordChatRenderer serverId={serverId} messages={messages} users={users} formatTime={formatTime} />
        ) : (
          messages.map((msg, index) => {
            // Show dividers when timestamps are enabled
            const prevMsg = index > 0 ? messages[index - 1] : null;
            const showServerHistoryDivider = msg.isServerHistory && (!prevMsg || !prevMsg.isServerHistory);
            const showLiveDivider = !msg.isServerHistory && prevMsg?.isServerHistory;

            // Render dividers for server history / live transitions
            const divider = (
              <>
                {showServerHistoryDivider && (
                  <div className="flex items-center gap-2 my-2">
                    <div className="flex-1 border-t border-gray-300 dark:border-gray-600" />
                    <span className="text-xs text-gray-400 dark:text-gray-500 italic">Server History</span>
                    <div className="flex-1 border-t border-gray-300 dark:border-gray-600" />
                  </div>
                )}
                {showLiveDivider && (
                  <div className="flex items-center gap-2 my-2">
                    <div className="flex-1 border-t border-gray-300 dark:border-gray-600" />
                    <span className="text-xs text-gray-400 dark:text-gray-500">{formatTime(msg.timestamp)}</span>
                    <div className="flex-1 border-t border-gray-300 dark:border-gray-600" />
                  </div>
                )}
              </>
            );

            // Check if this is a broadcast message (from Server)
            const isBroadcast = msg.userName === 'Server' && msg.userId === 0;

            if (isBroadcast) {
              // Create unique key for broadcast
              const uniqueKey = `broadcast-${msg.timestamp.getTime()}-${msg.message.substring(0, 20)}-${index}`;
              return (
                <React.Fragment key={uniqueKey}>{divider}<div className="my-2">
                  <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3 flex items-start gap-3">
                    <svg className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
                    </svg>
                    <div className="flex-1">
                      <div className="text-xs font-semibold text-blue-700 dark:text-blue-300 mb-1">
                        Server Broadcast
                        {showTimestamps && (
                          <span className="font-normal text-blue-500 dark:text-blue-400 ml-2">{formatTime(msg.timestamp)}</span>
                        )}
                      </div>
                      <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                        {msg.message}
                      </div>
                    </div>
                  </div>
                </div></React.Fragment>
              );
            }

            // Check if this is a join/leave message
            if (msg.type === 'joined' || msg.type === 'left') {
              const uniqueKey = `${msg.type}-${msg.userId}-${msg.timestamp.getTime()}-${index}`;
              return (
                <React.Fragment key={uniqueKey}>{divider}<div className="text-sm text-center my-1">
                  {showTimestamps && !msg.isServerHistory && (
                    <span className="text-xs text-gray-400 dark:text-gray-500 mr-1">{formatTime(msg.timestamp)}</span>
                  )}
                  <span className="italic text-gray-500 dark:text-gray-400">
                    {msg.message}
                  </span>
                </div></React.Fragment>
              );
            }

            const isOwnMessage = msg.userName === 'Me';
            const isMention = msg.isMention || false;
            // Create unique key from userId, timestamp, message content, and index
            const uniqueKey = `${msg.userId}-${msg.timestamp.getTime()}-${msg.message.substring(0, 20)}-${index}`;

            // Detect relay messages: userName is "Relay" and message is "Service | actualUser: text"
            const relayMatch = msg.userName === 'Relay'
              ? msg.message.match(/^(.+?)\s*\|\s*(.+?):\s(.*)$/s)
              : null;

            const nameColor = resolveNameColor({
              userColor: resolveLiveColor(msg),
              isOwn: isOwnMessage,
              isAdmin: !!msg.isAdmin,
              themeBg,
              prefs: colorPrefs,
            });

            return (
              <React.Fragment key={uniqueKey}>{divider}<div
                className={`text-sm ${
                  isMention
                    ? 'bg-yellow-50 dark:bg-yellow-900/20 border-l-4 border-yellow-400 dark:border-yellow-500 pl-3 py-2 rounded-r my-1'
                    : ''
                }`}
              >
                {showTimestamps && !msg.isServerHistory && (
                  <span className="text-xs text-gray-400 dark:text-gray-500 mr-1">{formatTime(msg.timestamp)}</span>
                )}
                {relayMatch ? (
                  <>
                    <span className="font-bold text-[#5865F2]">
                      {msg.userName}: {relayMatch[1]}
                    </span>
                    <span className="text-gray-400 dark:text-gray-500"> | </span>
                    <span className="font-bold text-sky-600 dark:text-sky-400">
                      {relayMatch[2]}:
                    </span>{' '}
                  </>
                ) : (
                  <span
                    className="font-bold"
                    style={nameColor ? { color: nameColor } : undefined}
                  >
                    {msg.userName}:
                  </span>
                )}{' '}
                <span className="text-gray-900 dark:text-gray-100">
                  {clickableLinks ? <MarkdownText text={relayMatch ? relayMatch[3] : msg.message} /> : (relayMatch ? relayMatch[3] : msg.message)}
                </span>
                {msg.media && (
                  <div className="ml-1">
                    <MediaImage serverId={serverId} media={msg.media} />
                  </div>
                )}
              </div></React.Fragment>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Broadcast mode input */}
      {broadcastMode && (
        <div className="border-t border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 p-4">
          <div className="flex items-center gap-2 mb-2">
            <svg className="w-4 h-4 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
            </svg>
            <span className="text-xs font-semibold text-blue-700 dark:text-blue-300">Server Broadcast</span>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={broadcastMessage}
              onChange={(e) => setBroadcastMessage(e.target.value)}
              placeholder="Type broadcast message..."
              onKeyDown={(e) => {
                if (e.key === 'Enter' && broadcastMessage.trim()) {
                  onSendBroadcast?.(broadcastMessage.trim());
                  setBroadcastMessage('');
                  setBroadcastMode(false);
                }
                if (e.key === 'Escape') {
                  setBroadcastMode(false);
                  setBroadcastMessage('');
                }
              }}
              autoFocus
              className="flex-1 px-3 py-2 border border-blue-300 dark:border-blue-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={() => {
                if (broadcastMessage.trim()) {
                  onSendBroadcast?.(broadcastMessage.trim());
                  setBroadcastMessage('');
                }
                setBroadcastMode(false);
              }}
              disabled={!broadcastMessage.trim()}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-md font-medium disabled:cursor-not-allowed"
            >
              Broadcast
            </button>
            <button
              onClick={() => { setBroadcastMode(false); setBroadcastMessage(''); }}
              className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Message input */}
      <form
        onSubmit={async (e) => {
          await handleSubmit(e);
          scrollToBottom();
          isAtBottomRef.current = true;
        }}
        className="border-t border-gray-200 dark:border-gray-700 p-4"
      >
        {staged && (
          <AttachChip
            filename={staged.filename || undefined}
            mime={staged.mime}
            byteSize={staged.byteSize}
            onRemove={removeStaged}
          />
        )}
        <div className="flex gap-2">
          {canBroadcast && !broadcastMode && (
            <button
              type="button"
              onClick={() => setBroadcastMode(true)}
              title="Send Server Broadcast"
              className="px-2 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:border-blue-400 dark:hover:border-blue-500 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
              </svg>
            </button>
          )}
          {inlineMediaEnabled && mediaStatus.serverSupports && (
            <button
              type="button"
              onClick={handleAttachClick}
              disabled={!attachEnabled || sending || uploading || !!agreementText}
              title={
                !mediaStatus.canSend
                  ? 'Your account does not have permission to send images'
                  : 'Attach image'
              }
              className="px-2 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:border-blue-400 dark:hover:border-blue-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
              </svg>
            </button>
          )}
          <textarea
            ref={textareaRef}
            rows={1}
            value={message}
            onChange={(e) => onMessageChange(e.target.value)}
            onPaste={handlePaste}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if ((message.trim() || staged) && !sending && !uploading && !agreementText) {
                  (e.currentTarget.form as HTMLFormElement)?.requestSubmit();
                }
              }
            }}
            placeholder={agreementText ? "Please accept or decline the server agreement" : "Type a message..."}
            disabled={sending || uploading || !!agreementText}
            className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 resize-none overflow-y-hidden leading-normal"
          />
          <button
            type="submit"
            disabled={(!message.trim() && !staged) || sending || uploading || !!agreementText}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-md font-medium disabled:cursor-not-allowed"
          >
            {uploading ? 'Uploading...' : sending ? 'Sending...' : 'Send'}
          </button>
        </div>
      </form>
    </div>
  );
}
