import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import type { ConnectionStatus } from '../../../types';
import type { ChatMessage, ChatMessageMedia, FileItem, User, PrivateChatRoom } from '../serverTypes';

/// Wire-format media metadata received from Rust events. Snake-case fields are
/// already converted to camelCase via serde rename; we add UI-only state.
interface WireMedia {
  handle: string;
  mime: string;
  width: number;
  height: number;
  byteSize: number;
}

function wireMediaToChatMedia(wire: WireMedia | null | undefined): ChatMessageMedia | undefined {
  if (!wire || !wire.handle) return undefined;
  return {
    handle: wire.handle,
    mime: wire.mime,
    width: wire.width,
    height: wire.height,
    byteSize: wire.byteSize,
    state: 'placeholder',
  };
}
import { useSound } from '../../../hooks/useSound';
import { useAppStore } from '../../../stores/appStore';
import { usePreferencesStore } from '../../../stores/preferencesStore';
import { showNotification, useNotificationStore } from '../../../stores/notificationStore';
import { containsMention, containsWatchWord } from '../../../utils/mentions';
import { log, error as logError } from '../../../utils/logger';
import { useChatHistoryStore } from '../../../stores/chatHistoryStore';

interface UseServerEventsProps {
  serverId: string;
  serverName: string;
  messagesRef: React.MutableRefObject<ChatMessage[]>;
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  setUsers: React.Dispatch<React.SetStateAction<User[]>>;
  setFiles: React.Dispatch<React.SetStateAction<FileItem[]>>;
  setBoardPosts: React.Dispatch<React.SetStateAction<string[]>>;
  setPrivateMessageHistory: React.Dispatch<React.SetStateAction<Map<number, any[]>>>;
  setUnreadCounts: React.Dispatch<React.SetStateAction<Map<number, number>>>;
  setDownloadProgress: React.Dispatch<React.SetStateAction<Map<string, number>>>;
  setUploadProgress: React.Dispatch<React.SetStateAction<Map<string, number>>>;
  setAgreementText: React.Dispatch<React.SetStateAction<string | null>>;
  setDisconnectMessage: React.Dispatch<React.SetStateAction<string | null>>;
  setConnectionStatus: React.Dispatch<React.SetStateAction<ConnectionStatus>>;
  setPrivateChatRooms: React.Dispatch<React.SetStateAction<PrivateChatRoom[]>>;
  onChatInvite?: (chatId: number, userId: number, userName: string) => void;
  setFileCache: (serverId: string, path: string[], files: FileItem[]) => void;
  currentPathRef: React.MutableRefObject<string[]>;
  parseUserFlags: (flags: number) => { isAdmin: boolean; isIdle: boolean };
  enablePrivateMessaging: boolean;
  addTransfer: (transfer: any) => void;
  updateTransfer: (id: string, updates: Partial<any>) => void;
  onFileListReceived?: (path: string[]) => void;
  serverInfoRef?: React.MutableRefObject<any>;
}

export function useServerEvents({
  serverId,
  serverName,
  messagesRef,
  setMessages,
  setUsers,
  setFiles,
  setBoardPosts,
  setPrivateMessageHistory,
  setUnreadCounts,
  setDownloadProgress,
  setUploadProgress,
  setAgreementText,
  setDisconnectMessage,
  setConnectionStatus,
  setPrivateChatRooms,
  onChatInvite,
  setFileCache,
  currentPathRef,
  parseUserFlags,
  enablePrivateMessaging,
  addTransfer,
  updateTransfer,
  onFileListReceived,
  serverInfoRef,
}: UseServerEventsProps) {
  const sounds = useSound();
  const soundsRef = useRef(sounds);
  const usersRef = useRef<User[]>([]);
  const { updateTabUnread } = useAppStore();
  const { username } = usePreferencesStore();

  // ─── Replay dedup filter ──────────────────────────────────────────
  // Tracks whether we're in the server chat replay window after login.
  // During replay, duplicates (matching stored history) are dropped and
  // new replay messages are flagged as "Server History."
  const replayFilterRef = useRef<{
    mode: 'idle' | 'replay_filter' | 'live';
    storedTail: string[];  // last 200 stored message texts for comparison
    messageCount: number;  // messages processed during filter
    gapTimer: ReturnType<typeof setTimeout> | null;
    safetyTimer: ReturnType<typeof setTimeout> | null;
  }>({
    mode: 'idle',
    storedTail: [],
    messageCount: 0,
    gapTimer: null,
    safetyTimer: null,
  });

  const exitReplayFilter = () => {
    const rf = replayFilterRef.current;
    if (rf.gapTimer) clearTimeout(rf.gapTimer);
    if (rf.safetyTimer) clearTimeout(rf.safetyTimer);
    rf.mode = 'live';
    rf.storedTail = [];
    rf.messageCount = 0;
    rf.gapTimer = null;
    rf.safetyTimer = null;
    log('Chat', 'Replay filter ended, entering live mode');
  };
  
  // Helper to check if this server's tab is active
  const isTabActive = () => {
    const state = useAppStore.getState();
    const tab = state.tabs.find(t => t.type === 'server' && t.serverId === serverId);
    return tab?.id === state.activeTabId;
  };
  
  // Helper to increment unread count for this server's tab
  const incrementUnread = () => {
    const state = useAppStore.getState();
    const tab = state.tabs.find(t => t.type === 'server' && t.serverId === serverId);
    if (tab && !isTabActive()) {
      updateTabUnread(tab.id, tab.unreadCount + 1);
    }
  };
  
  // Keep sounds ref up to date
  useEffect(() => {
    soundsRef.current = sounds;
  }, [sounds]);

  // Listen for incoming chat messages
  useEffect(() => {
    let isActive = true;
    
    const unlistenPromise = listen<ChatMessage>(`chat-message-${serverId}`, (event) => {
      if (!isActive) return; // Prevent processing if effect has been cleaned up

      const prefs = usePreferencesStore.getState();

      // For emote messages ("*** name action"), the Rust parser extracts only the
      // first whitespace token as the sender name — but Hotline usernames can
      // contain spaces (e.g. "dmg - dev"). Re-resolve the real sender by finding
      // the longest username in the live user list that the body starts with.
      let resolvedUserName = event.payload.userName;
      const bodyTrimmed = event.payload.message.replace(/^[\r\n\s]+/, '');
      if (bodyTrimmed.startsWith('*** ')) {
        const afterStars = bodyTrimmed.slice(4);
        let bestMatch = '';
        for (const u of usersRef.current) {
          if (
            (afterStars.startsWith(u.userName + ' ') || afterStars === u.userName)
            && u.userName.length > bestMatch.length
          ) {
            bestMatch = u.userName;
          }
        }
        if (bestMatch) {
          resolvedUserName = bestMatch;
        }
      }

      const isMuted = prefs.mutedUsers.some(
        (u) => u.toLowerCase() === resolvedUserName.toLowerCase()
      );

      // Look up sender from current users — try by userId first, fall back to userName
      const sender = usersRef.current.find(u => u.userId === event.payload.userId)
        || usersRef.current.find(u => u.userName === resolvedUserName);

      // Check if message contains a mention of the current user or a watch word
      const isMention = !isMuted && (
        containsMention(event.payload.message, username) ||
        containsWatchWord(event.payload.message, prefs.watchWords)
      );

      log('Chat', 'Chat message received', { userId: event.payload.userId, userName: event.payload.userName });

      // ─── Replay dedup check ───
      const rf = replayFilterRef.current;
      let isServerHistory = false;

      // Lazy activation: start replay filter on first chat message if the
      // message matches something in our displayed history (indicating a server replay).
      // If the first message doesn't match, go straight to live mode — no replay happening.
      if (rf.mode === 'idle') {
        const currentMessages = messagesRef.current;
        if (currentMessages.length > 0) {
          const tail = currentMessages.slice(-200).map(m => m.message.trim());
          const msgText = event.payload.message.trim();
          const firstMatchesHistory = tail.some(stored => stored === msgText);

          if (firstMatchesHistory) {
            rf.mode = 'replay_filter';
            rf.storedTail = tail;
            rf.messageCount = 0;
            rf.gapTimer = setTimeout(exitReplayFilter, 3000);
            rf.safetyTimer = setTimeout(exitReplayFilter, 60000);
            log('Chat', `Replay filter activated, ${tail.length} displayed messages to compare`);
          } else {
            rf.mode = 'live';
            log('Chat', 'First message does not match history, skipping replay filter');
          }
        }
      }

      if (rf.mode === 'replay_filter') {
        const msgText = event.payload.message.trim();
        const isDuplicate = rf.storedTail.some(stored => stored === msgText);

        if (isDuplicate) {
          log('Chat', 'Replay filter: skipping duplicate message');
          // Reset gap timer (more replay messages coming)
          if (rf.gapTimer) clearTimeout(rf.gapTimer);
          rf.gapTimer = setTimeout(exitReplayFilter, 3000);
          rf.messageCount++;
          if (rf.messageCount >= 200) exitReplayFilter();
          return; // Drop the duplicate
        }

        // Not a duplicate — it's a message from while we were offline
        isServerHistory = true;
        log('Chat', 'Replay filter: new message from server history');

        // Reset gap timer
        if (rf.gapTimer) clearTimeout(rf.gapTimer);
        rf.gapTimer = setTimeout(exitReplayFilter, 3000);
        rf.messageCount++;
        if (rf.messageCount >= 200) exitReplayFilter();
      }

      // Resolve icon: from user list, or fall back to own icon if it's our message
      let iconId = sender?.iconId;
      if (iconId == null && resolvedUserName.toLowerCase() === username.toLowerCase()) {
        iconId = usePreferencesStore.getState().userIconId;
      }

      // Echo dedup: if this is our own message, look for a pending optimistic
      // entry with matching text within the last 10s and confirm it in place
      // (drops the duplicate). This is what makes "/help" appear before the
      // server's broadcast response — our message is already in the list.
      const isOwnMessage = resolvedUserName.toLowerCase() === username.toLowerCase();
      if (isOwnMessage) {
        const trimmedBody = event.payload.message.trim();
        const pendingMatch = messagesRef.current.find(
          (m) =>
            m.pending
            && m.userName === resolvedUserName
            && m.message.trim() === trimmedBody
            && Date.now() - m.timestamp.getTime() < 10000,
        );
        if (pendingMatch) {
          setMessages((prev) =>
            prev.map((m) =>
              m.optimisticKey === pendingMatch.optimisticKey
                ? {
                    ...m,
                    pending: false,
                    userId: event.payload.userId,
                    isAdmin: sender?.isAdmin ?? false,
                    isServerHistory,
                  }
                : m,
            ),
          );
          if (!isMuted && !isServerHistory) soundsRef.current.playChatSound();
          return;
        }
      }

      const wireMedia = (event.payload as unknown as { media?: WireMedia | null }).media;
      const messageData = {
        ...event.payload,
        userName: resolvedUserName,
        timestamp: new Date(),
        iconId,
        isMention,
        isAdmin: sender?.isAdmin ?? false,
        isServerHistory,
        media: wireMediaToChatMedia(wireMedia),
      };

      setMessages((prev) => [...prev, messageData]);
      if (!isMuted && !isServerHistory) soundsRef.current.playChatSound();

      // Persist to encrypted chat history (skip if server provides history, or if replayed)
      const serverHasHistory = serverInfoRef?.current?.chatHistorySupported && usePreferencesStore.getState().enableServerChatHistory;
      if (usePreferencesStore.getState().enableChatHistory && !isServerHistory && !serverHasHistory) {
        useChatHistoryStore.getState().addMessage(serverId, serverName, {
          userId: messageData.userId,
          userName: messageData.userName,
          message: messageData.message,
          timestamp: messageData.timestamp.toISOString(),
          iconId: messageData.iconId,
          isMention: messageData.isMention,
          isAdmin: messageData.isAdmin,
        });
      }

      if (isMuted) return;

      // Always log mentions/watch words to history; show toast only when tab is not active (and popup enabled)
      if (isMention) {
        const isWatchWord = !containsMention(event.payload.message, username) &&
          containsWatchWord(event.payload.message, prefs.watchWords);
        const notifMessage = isWatchWord
          ? `Watch word matched in chat`
          : `@${username} mentioned in chat`;
        const notifTitle = `From ${event.payload.userName}`;
        if (isTabActive() || !prefs.mentionPopup) {
          useNotificationStore.getState().addToHistory({
            type: 'info',
            message: notifMessage,
            title: notifTitle,
            serverName,
          });
        } else {
          showNotification.info(
            notifMessage,
            notifTitle,
            undefined,
            serverName
          );
        }
      }
      if (!isTabActive()) {
        incrementUnread();
      }
    });

    return () => {
      isActive = false;
      unlistenPromise.then((unlisten) => unlisten()).catch(() => {});
    };
  }, [serverId, setMessages, username]);

  // Listen for broadcast messages
  useEffect(() => {
    let isActive = true;
    
    const unlistenPromise = listen<{ message: string }>(`broadcast-message-${serverId}`, (event) => {
      if (!isActive) return;

      const broadcastMsg = event.payload.message;
      log('Chat', 'Broadcast message received', broadcastMsg);
      const now = new Date();
      setMessages((prev) => [
        ...prev,
        {
          userId: 0,
          userName: 'Server',
          message: broadcastMsg,
          timestamp: now,
        },
      ]);
      soundsRef.current.playServerMessageSound();

      if (usePreferencesStore.getState().enableChatHistory && !(serverInfoRef?.current?.chatHistorySupported && usePreferencesStore.getState().enableServerChatHistory)) {
        useChatHistoryStore.getState().addMessage(serverId, serverName, {
          userId: 0,
          userName: 'Server',
          message: broadcastMsg,
          timestamp: now.toISOString(),
        });
      }
    });

    return () => {
      isActive = false;
      unlistenPromise.then((unlisten) => unlisten()).catch(() => {});
    };
  }, [serverId, setMessages]);

  // Listen for file list events
  useEffect(() => {
    const unlisten = listen<{ files: FileItem[]; path: string[] }>(`file-list-${serverId}`, (event) => {
      const { files, path } = event.payload;
      log('Files', `File list received: ${files.length} items at /${path.join('/')}`);

      // Only update UI if this is for the current path
      if (path.length === currentPathRef.current.length && path.every((v, i) => v === currentPathRef.current[i])) {
        setFiles(files);
        // Notify that file list was received for current path
        if (onFileListReceived) {
          onFileListReceived(path);
        }
      }
      
      // Always cache the file list
      setFileCache(serverId, path, files);
    });

    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, [serverId, setFiles, setFileCache, currentPathRef, onFileListReceived]);

  // Listen for new message board posts
  useEffect(() => {
    const unlisten = listen<{ message: string }>(`message-board-post-${serverId}`, (event) => {
      log('Board', 'Board post received');
      setBoardPosts((prev) => [...prev, event.payload.message]);
    });

    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, [serverId, setBoardPosts]);

  // Sync usersRef when users are initially loaded or updated
  // We'll update the ref in the user event handlers, but also need to handle initial load
  // The ref will be updated in the join/leave/change handlers below

  // Listen for user events
  useEffect(() => {
    let isActive = true;
    
    const unlistenJoinPromise = listen<{ userId: number; userName: string; iconId: number; flags: number; color?: string | null }>(
      `user-joined-${serverId}`,
      (event) => {
        if (!isActive) return;
        log('Users', 'User joined', { userId: event.payload.userId, userName: event.payload.userName, iconId: event.payload.iconId, flags: event.payload.flags });

        // Check if user already exists before updating state
        const currentUsers = usersRef.current;
        const userExists = currentUsers.some(u => u.userId === event.payload.userId);

        if (userExists) {
          // User already exists, skip (e.g., during initial load or user update)
          log('Users', 'User already exists, skipping', event.payload.userId);
          return;
        }
        
        const { isAdmin, isIdle } = parseUserFlags(event.payload.flags);
        
        // Add user to list
        // Note: This handler is primarily for initial user list load from GetUserNameList reply
        // For actual new user joins, we rely on the user-changed handler which receives NotifyUserChange
        setUsers((prev) => {
          // Double-check user doesn't exist (race condition protection)
          if (prev.some(u => u.userId === event.payload.userId)) {
            return prev;
          }
          
          const updated = [...prev, {
            userId: event.payload.userId,
            userName: event.payload.userName,
            iconId: event.payload.iconId,
            flags: event.payload.flags,
            isAdmin,
            isIdle,
            color: event.payload.color,
          }];
          usersRef.current = updated;
          return updated;
        });

        // Don't show join messages here - this is for initial load
        // Join messages are handled by the user-changed handler for actual new user joins
      }
    );

    const unlistenLeavePromise = listen<{ userId: number }>(
      `user-left-${serverId}`,
      (event) => {
        if (!isActive) return;
        log('Users', 'User left event', { userId: event.payload.userId });

        // Get username before removing user (check current users ref)
        const currentUsers = usersRef.current;
        const userToRemove = currentUsers.find(u => u.userId === event.payload.userId);

        if (!userToRemove) {
          // User not found, nothing to remove
          log('Users', 'User not found for leave, skipping', event.payload.userId);
          return;
        }

        const userName = userToRemove.userName;
        log('Users', 'User leaving', { userId: event.payload.userId, userName });
        
        // Remove user from list
        setUsers((prev) => {
          const updated = prev.filter(u => u.userId !== event.payload.userId);
          usersRef.current = updated;
          return updated;
        });
        
        // Add leave message to chat (skip if last message is already a leave for this user)
        const leaveTime = new Date();
        setMessages((prevMessages) => {
          const last = prevMessages[prevMessages.length - 1];
          if (last?.type === 'left' && last?.userId === event.payload.userId) {
            return prevMessages;
          }
          return [...prevMessages, {
            userId: event.payload.userId,
            userName: userName,
            message: `${userName} left`,
            timestamp: leaveTime,
            type: 'left',
          }];
        });

        if (usePreferencesStore.getState().enableChatHistory && !(serverInfoRef?.current?.chatHistorySupported && usePreferencesStore.getState().enableServerChatHistory)) {
          useChatHistoryStore.getState().addMessage(serverId, serverName, {
            userId: event.payload.userId,
            userName,
            message: `${userName} left`,
            timestamp: leaveTime.toISOString(),
            type: 'left',
          });
        }

        soundsRef.current.playLeaveSound();
      }
    );

    const unlistenChangePromise = listen<{ userId: number; userName: string; iconId: number; flags: number; color?: string | null }>(
      `user-changed-${serverId}`,
      (event) => {
        if (!isActive) return;
        log('Users', 'User changed', { userId: event.payload.userId, userName: event.payload.userName, iconId: event.payload.iconId, flags: event.payload.flags });

        // Check if user already exists before updating state
        const currentUsers = usersRef.current;
        const prevLength = currentUsers.length;
        
        setUsers((prev) => {
          const existingIndex = prev.findIndex(u => u.userId === event.payload.userId);
          
          if (existingIndex >= 0) {
            // User exists, update them (like Swift: self.users[i] = User(hotlineUser: user))
            const updated = prev.map(u =>
              u.userId === event.payload.userId
                ? {
                    userId: event.payload.userId,
                    userName: event.payload.userName,
                    iconId: event.payload.iconId,
                    flags: event.payload.flags,
                    ...parseUserFlags(event.payload.flags),
                    color: event.payload.color,
                  }
                : u
            );
            usersRef.current = updated;
            return updated;
          } else {
            // User doesn't exist, add them as new user (like Swift: self.users.append(User(hotlineUser: user)))
            const { isAdmin, isIdle } = parseUserFlags(event.payload.flags);
            const updated = [...prev, {
              userId: event.payload.userId,
              userName: event.payload.userName,
              iconId: event.payload.iconId,
              flags: event.payload.flags,
              isAdmin,
              isIdle,
              color: event.payload.color,
            }];
            usersRef.current = updated;
            
            // Show join message for new users (skip if last message is already a join for this user)
            const joinTime = new Date();
            setMessages((prevMessages) => {
              const last = prevMessages[prevMessages.length - 1];
              if (last?.type === 'joined' && last?.userId === event.payload.userId) {
                return prevMessages; // Duplicate join, skip
              }
              return [...prevMessages, {
                userId: event.payload.userId,
                userName: event.payload.userName,
                message: `${event.payload.userName} joined`,
                timestamp: joinTime,
                type: 'joined',
              }];
            });

            if (usePreferencesStore.getState().enableChatHistory && !(serverInfoRef?.current?.chatHistorySupported && usePreferencesStore.getState().enableServerChatHistory)) {
              useChatHistoryStore.getState().addMessage(serverId, serverName, {
                userId: event.payload.userId,
                userName: event.payload.userName,
                message: `${event.payload.userName} joined`,
                timestamp: joinTime.toISOString(),
                type: 'joined',
              });
            }

            // Only play sound if users list was not empty (to avoid sound spam during initial load)
            if (prevLength > 0) {
              soundsRef.current.playJoinSound();
            }
            
            return updated;
          }
        });
      }
    );

    return () => {
      isActive = false;
      unlistenJoinPromise.then((fn) => fn()).catch(() => {});
      unlistenLeavePromise.then((fn) => fn()).catch(() => {});
      unlistenChangePromise.then((fn) => fn()).catch(() => {});
    };
  }, [serverId, setUsers, setMessages, parseUserFlags]);

  // Listen for private messages
  useEffect(() => {
    if (!enablePrivateMessaging) {
      return; // Private messaging is disabled, don't listen for messages
    }
    
    let isActive = true;
    
    const unlistenPromise = listen<{ userId: number; message: string; media?: WireMedia | null }>(
      `private-message-${serverId}`,
      (event) => {
        if (!isActive) return;
        
        const { userId, message, media } = event.payload;
        log('Chat', 'Private message received', { userId, message });

        soundsRef.current.playPrivateMessageSound();
        
        // Look up user name - try ref first, then fallback to querying state
        let user = usersRef.current.find(u => u.userId === userId);
        let userName = user?.userName;
        
        // If not found in ref, try to get from current users state
        if (!userName) {
          // Use a callback to get current users
          setUsers((prev) => {
            const foundUser = prev.find(u => u.userId === userId);
            if (foundUser) {
              userName = foundUser.userName;
              usersRef.current = prev; // Sync ref
            }
            return prev; // Don't modify state
          });
        }
        
        const displayName = userName || `User ${userId}`;
        
        // Show notification for private message
        showNotification.info(
          message,
          `Private message from ${displayName}`,
          undefined,
          serverName
        );

        setPrivateMessageHistory((prev) => {
          const newHistory = new Map(prev);
          const userMessages = newHistory.get(userId) || [];
          newHistory.set(userId, [
            ...userMessages,
            {
              text: message,
              media: wireMediaToChatMedia(media),
              isOutgoing: false,
              timestamp: new Date(),
            },
          ]);
          return newHistory;
        });

        setUnreadCounts((prev) => {
          const newCounts = new Map(prev);
          newCounts.set(userId, (newCounts.get(userId) || 0) + 1);
          return newCounts;
        });
        
        // Increment tab unread count if tab is not active
        if (!isTabActive()) {
          incrementUnread();
        }
      }
    );

    return () => {
      isActive = false;
      unlistenPromise.then((unlisten) => unlisten()).catch(() => {});
    };
  }, [serverId, setPrivateMessageHistory, setUnreadCounts, enablePrivateMessaging, setUsers]);

  // Listen for download progress events
  useEffect(() => {
    const unlisten = listen<{ fileName: string; bytesRead: number; totalBytes: number; progress: number }>(
      `download-progress-${serverId}`,
      (event) => {
        const { fileName, bytesRead, totalBytes, progress } = event.payload;
        setDownloadProgress((prev) => new Map(prev).set(fileName, progress));
        
        // Track transfer
        const transferId = `${serverId}-download-${fileName}`;
        const existingTransfer = useAppStore.getState().transfers.find((t) => t.id === transferId);
        
        if (!existingTransfer) {
          log('Transfer', `Download started: ${fileName}`, { totalBytes });
          addTransfer({
            id: transferId,
            serverId,
            type: 'download',
            fileName,
            fileSize: totalBytes || 0,
            transferred: bytesRead || 0,
            speed: 0,
            status: 'active',
            startTime: new Date(),
          });
        } else {
          updateTransfer(transferId, {
            transferred: bytesRead || 0,
            fileSize: totalBytes || existingTransfer.fileSize || 0,
          });
        }
      }
    );

    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, [serverId, setDownloadProgress, addTransfer, updateTransfer]);

  // Listen for upload progress events
  useEffect(() => {
    const unlisten = listen<{ fileName: string; bytesSent: number; totalBytes: number; progress: number }>(
      `upload-progress-${serverId}`,
      (event) => {
        const { fileName, bytesSent, totalBytes, progress } = event.payload;
        setUploadProgress((prev) => new Map(prev).set(fileName, progress));
        
        // Track transfer
        const transferId = `${serverId}-upload-${fileName}`;
        const existingTransfer = useAppStore.getState().transfers.find((t) => t.id === transferId);
        
        if (!existingTransfer) {
          log('Transfer', `Upload started: ${fileName}`, { totalBytes });
          addTransfer({
            id: transferId,
            serverId,
            type: 'upload',
            fileName,
            fileSize: totalBytes || 0,
            transferred: bytesSent || 0,
            speed: 0,
            status: 'active',
            startTime: new Date(),
          });
        } else {
          updateTransfer(transferId, {
            transferred: bytesSent || 0,
            fileSize: totalBytes || existingTransfer.fileSize || 0,
          });
        }
      }
    );

    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, [serverId, setUploadProgress, addTransfer, updateTransfer]);

  // Listen for download/upload complete and error events
  useEffect(() => {
    const unlistenDownloadComplete = listen<{ fileName: string }>(
      `download-complete-${serverId}`,
      (event) => {
        log('Transfer', `Download complete: ${event.payload.fileName}`);
        setDownloadProgress((prev) => {
          const next = new Map(prev);
          next.delete(event.payload.fileName);
          return next;
        });
        
        // Mark transfer as completed
        const transferId = `${serverId}-download-${event.payload.fileName}`;
        updateTransfer(transferId, {
          status: 'completed',
          endTime: new Date(),
        });
        
        // Show notification
        showNotification.success(
          `Download complete: ${event.payload.fileName}`,
          'Download Complete',
          undefined,
          serverName
        );
        soundsRef.current.playFileTransferCompleteSound();
      }
    );

    const unlistenUploadComplete = listen<{ fileName: string }>(
      `upload-complete-${serverId}`,
      (event) => {
        log('Transfer', `Upload complete: ${event.payload.fileName}`);
        setUploadProgress((prev) => {
          const next = new Map(prev);
          next.delete(event.payload.fileName);
          return next;
        });
        
        // Mark transfer as completed
        const transferId = `${serverId}-upload-${event.payload.fileName}`;
        updateTransfer(transferId, {
          status: 'completed',
          endTime: new Date(),
        });
        
        // Show notification
        showNotification.success(
          `Upload complete: ${event.payload.fileName}`,
          'Upload Complete',
          undefined,
          serverName
        );
        soundsRef.current.playFileTransferCompleteSound();
      }
    );

    const unlistenDownloadError = listen<{ fileName: string; error: string }>(
      `download-error-${serverId}`,
      (event) => {
        logError('Transfer', `Download error: ${event.payload.fileName}`, event.payload.error);
        setDownloadProgress((prev) => {
          const next = new Map(prev);
          next.delete(event.payload.fileName);
          return next;
        });
        
        // Mark transfer as failed
        const transferId = `${serverId}-download-${event.payload.fileName}`;
        updateTransfer(transferId, {
          status: 'failed',
          error: event.payload.error,
          endTime: new Date(),
        });
        
        // Show notification
        showNotification.error(
          `Download failed: ${event.payload.fileName}\n${event.payload.error}`,
          'Download Error',
          undefined,
          serverName
        );
        soundsRef.current.playErrorSound();
      }
    );

    const unlistenUploadError = listen<{ fileName: string; error: string }>(
      `upload-error-${serverId}`,
      (event) => {
        logError('Transfer', `Upload error: ${event.payload.fileName}`, event.payload.error);
        setUploadProgress((prev) => {
          const next = new Map(prev);
          next.delete(event.payload.fileName);
          return next;
        });
        
        // Mark transfer as failed
        const transferId = `${serverId}-upload-${event.payload.fileName}`;
        updateTransfer(transferId, {
          status: 'failed',
          error: event.payload.error,
          endTime: new Date(),
        });
        
        // Show notification
        showNotification.error(
          `Upload failed: ${event.payload.fileName}\n${event.payload.error}`,
          'Upload Error',
          undefined,
          serverName
        );
        soundsRef.current.playErrorSound();
      }
    );

    return () => {
      unlistenDownloadComplete.then((fn) => fn()).catch(() => {});
      unlistenUploadComplete.then((fn) => fn()).catch(() => {});
      unlistenDownloadError.then((fn) => fn()).catch(() => {});
      unlistenUploadError.then((fn) => fn()).catch(() => {});
    };
  }, [serverId, sounds, setDownloadProgress, setUploadProgress, updateTransfer]);

  // Listen for connection status changes
  useEffect(() => {
    const unlisten = listen<{ status: ConnectionStatus }>(
      `status-changed-${serverId}`,
      (event) => {
        const newStatus = event.payload.status;
        log('Connection', `Status changed: ${newStatus}`);
        setConnectionStatus(newStatus);
        if (newStatus === 'logged-in') {
          soundsRef.current.playLoggedInSound();

          // Reset replay filter to idle so it re-activates lazily
          // on the first incoming chat message (handles reconnect)
          const rf = replayFilterRef.current;
          if (rf.gapTimer) clearTimeout(rf.gapTimer);
          if (rf.safetyTimer) clearTimeout(rf.safetyTimer);
          rf.mode = 'idle';
          rf.storedTail = [];
          rf.messageCount = 0;
        }
        if (newStatus === 'disconnected' || newStatus === 'failed') {
          // Reset replay filter on disconnect
          const rf = replayFilterRef.current;
          if (rf.gapTimer) clearTimeout(rf.gapTimer);
          if (rf.safetyTimer) clearTimeout(rf.safetyTimer);
          rf.mode = 'idle';
          rf.storedTail = [];
          rf.messageCount = 0;
        }
      }
    );

    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, [serverId, sounds, setConnectionStatus]);

  // Listen for agreement required events
  useEffect(() => {
    const unlisten = listen<{ agreement: string }>(`agreement-required-${serverId}`, (event) => {
      const agreement = event.payload.agreement;
      log('Agreement', 'Agreement required, length:', agreement.length);
      setAgreementText(agreement);
    });

    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, [serverId, setAgreementText]);

  // Listen for disconnect messages (server kicking us)
  useEffect(() => {
    const unlisten = listen<{ message: string }>(`disconnect-message-${serverId}`, (event) => {
      const { message } = event.payload;
      const isProtocolFailure = message.startsWith('HOPE/protocol');
      logError(isProtocolFailure ? 'HOPE' : 'Connection', 'Disconnect message received', message);
      setDisconnectMessage(message);
      setConnectionStatus('disconnected');
      useNotificationStore.getState().addToHistory({
        type: 'error',
        title: isProtocolFailure ? 'Connection Failed' : 'Disconnected',
        message,
        serverName,
      });
    });

    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, [serverId, serverName, setDisconnectMessage, setConnectionStatus]);

  // Listen for protocol / HOPE debug messages from the backend
  useEffect(() => {
    const unlisten = listen<{ level: string; message: string }>(
      `protocol-log-${serverId}`,
      (event) => {
        const { level, message } = event.payload;
        const category = message.includes('HOPE') ? 'HOPE' : 'Protocol';
        const title = category === 'HOPE' ? 'HOPE' : 'Protocol';
        if (level === 'error') {
          logError(category, message);
          useNotificationStore.getState().addToHistory({
            type: 'error',
            title: `${title} Error`,
            message,
            serverName,
          });
        } else if (level === 'warn') {
          logError(category, message);
          useNotificationStore.getState().addToHistory({
            type: 'warning',
            title: `${title} Warning`,
            message,
            serverName,
          });
        } else {
          log(category, message);
        }
      }
    );

    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, [serverId, serverName]);

  // Listen for server banner updates
  useEffect(() => {
    const unlisten = listen<{ bannerType: number | null; url: string | null }>(`server-banner-${serverId}`, (event) => {
      log('Banner', 'Server banner update received', event.payload);
    });

    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, [serverId]);

  // Listen for private chat room events
  useEffect(() => {
    const unlistenInvite = listen<{ chatId: number; userId: number; userName: string }>(
      `chat-invite-${serverId}`,
      (event) => {
        const { chatId, userId, userName } = event.payload;
        log('Chat', 'Chat invite received', { chatId, userId, userName });
        if (onChatInvite) {
          onChatInvite(chatId, userId, userName);
        }
      }
    );

    const unlistenMessage = listen<{ chatId: number; userId: number; userName: string; message: string; media?: WireMedia | null }>(
      `private-chat-message-${serverId}`,
      (event) => {
        const { chatId, userId, userName, message, media } = event.payload;
        log('Chat', 'Private chat message', { chatId, userId, userName, message });
        const chatMedia = wireMediaToChatMedia(media);
        setPrivateChatRooms((prev) => prev.map((room) =>
          room.chatId === chatId
            ? { ...room, messages: [...room.messages, { userId, userName, message, timestamp: new Date(), media: chatMedia }] }
            : room
        ));
      }
    );

    const unlistenUserJoined = listen<{ chatId: number; userId: number; userName: string; icon: number; flags: number; color?: string | null }>(
      `chat-user-joined-${serverId}`,
      (event) => {
        const { chatId, userId, userName, icon, flags, color } = event.payload;
        log('Chat', 'Chat user joined', { chatId, userId, userName, icon, flags, color });
        setPrivateChatRooms((prev) => prev.map((room) => {
          if (room.chatId !== chatId) return room;
          if (room.users.some((u) => u.id === userId)) return room;
          return { ...room, users: [...room.users, { id: userId, name: userName, icon, flags, color: color ?? undefined }] };
        }));
      }
    );

    const unlistenUserLeft = listen<{ chatId: number; userId: number }>(
      `chat-user-left-${serverId}`,
      (event) => {
        const { chatId, userId } = event.payload;
        log('Chat', 'Chat user left', { chatId, userId });
        setPrivateChatRooms((prev) => prev.map((room) =>
          room.chatId === chatId
            ? { ...room, users: room.users.filter((u) => u.id !== userId) }
            : room
        ));
      }
    );

    const unlistenSubject = listen<{ chatId: number; subject: string }>(
      `chat-subject-${serverId}`,
      (event) => {
        const { chatId, subject } = event.payload;
        log('Chat', 'Chat subject changed', { chatId, subject });
        setPrivateChatRooms((prev) => prev.map((room) =>
          room.chatId === chatId ? { ...room, subject } : room
        ));
      }
    );

    return () => {
      unlistenInvite.then((fn) => fn()).catch(() => {});
      unlistenMessage.then((fn) => fn()).catch(() => {});
      unlistenUserJoined.then((fn) => fn()).catch(() => {});
      unlistenUserLeft.then((fn) => fn()).catch(() => {});
      unlistenSubject.then((fn) => fn()).catch(() => {});
    };
  }, [serverId, setPrivateChatRooms, onChatInvite]);
}
