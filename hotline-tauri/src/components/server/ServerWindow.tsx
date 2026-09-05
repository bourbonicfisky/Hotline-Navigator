import type { UploadedMedia } from '../chat/useChatAttachment';
import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import MessageDialog from '../chat/MessageDialog';
import UserInfoDialog from '../users/UserInfoDialog';
import { useContextMenu, ContextMenuRenderer, type ContextMenuItem } from '../common/ContextMenu';
import ChatTab from '../chat/ChatTab';
import PrivateChatTab from '../chat/PrivateChatTab';
import BoardTab from '../board/BoardTab';
import FilesTab from '../files/FilesTab';
import NewsTab from '../news/NewsTab';
import ServerBanner from './ServerBanner';
import { showNotification } from '../../stores/notificationStore';
import ServerHeader from './ServerHeader';
import ServerSidebar from './ServerSidebar';
import MobileTabBar from './MobileTabBar';
import TransferList from '../transfers/TransferList';
import NotificationLog from '../notifications/NotificationLog';
import MarkdownText from '../common/MarkdownText';
import { ServerInfo, ConnectionStatus, ChatHistoryResponse } from '../../types';
import { useAppStore } from '../../stores/appStore';
import { usePreferencesStore } from '../../stores/preferencesStore';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts';
import { useServerEvents } from './hooks/useServerEvents';
import { useServerHandlers } from './hooks/useServerHandlers';
import { useAutoReconnect } from './hooks/useAutoReconnect';
import { parseUserFlags, hasAccessBit } from './serverUtils';
import type { ChatMessage, User, PrivateMessage, FileItem, NewsCategory, NewsArticle, ViewTab, PrivateChatRoom } from './serverTypes';
import { log, error as logError } from '../../utils/logger';
import { useChatHistoryStore } from '../../stores/chatHistoryStore';

interface ServerWindowProps {
  serverId: string;
  serverName: string;
  onClose: () => void;
}

export default function ServerWindow({ serverId, serverName, onClose }: ServerWindowProps) {
  const { setFileCache, getFileCache, clearFileCache, clearFileCachePath, addTransfer, updateTransfer, updateTabTitle, updateTabConnectionStatus, serverInfo: serverInfoMap, tabs } = useAppStore();
  const isTls = serverInfoMap.get(serverId)?.tls ?? false;
  const { enablePrivateMessaging, downloadFolder, showServerBanner, renderMarkdown, renderMarkdownAgreements } = usePreferencesStore();
  const [showTransferList, setShowTransferList] = useState(false);
  const [showNotificationLog, setShowNotificationLog] = useState(false);
  const { contextMenu, showContextMenu, hideContextMenu } = useContextMenu();
  const [activeTab, setActiveTab] = useState<ViewTab>('chat');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const messagesRef = useRef<ChatMessage[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  // User access permissions (64-bit bitmask). Kept as a decimal string because
  // the bitmap crosses IPC as JSON and a JS number only has 53 bits of precision.
  const [userAccess, setUserAccess] = useState<string>('0');
  const [files, setFiles] = useState<FileItem[]>([]);
  const currentPathRef = useRef<string[]>([]);
  const [currentPath, setCurrentPath] = useState<string[]>([]);
  const [downloadProgress, setDownloadProgress] = useState<Map<string, number>>(new Map());
  const [uploadProgress, setUploadProgress] = useState<Map<string, number>>(new Map());
  const [boardPosts, setBoardPosts] = useState<string[]>([]);
  const [boardMessage, setBoardMessage] = useState('');
  const [postingBoard, setPostingBoard] = useState(false);
  const [loadingBoard, setLoadingBoard] = useState(false);
  const [boardLoaded, setBoardLoaded] = useState(false);
  const [newsCategories, setNewsCategories] = useState<NewsCategory[]>([]);
  const [newsArticles, setNewsArticles] = useState<NewsArticle[]>([]);
  const [newsPath, setNewsPath] = useState<string[]>([]);
  // Hotline news has bundles (type 2, contain bundles/categories) and categories
  // (type 3, contain articles). Only the leaf type matters for which fetch to
  // call — going back always lands on a bundle since it had to contain children.
  const [newsLeafType, setNewsLeafType] = useState<2 | 3>(2);
  const [selectedArticle, setSelectedArticle] = useState<NewsArticle | null>(null);
  const [articleContent, setArticleContent] = useState<string>('');
  const [loadingNews, setLoadingNews] = useState(false);
  const [showComposer, setShowComposer] = useState(false);
  const [composerTitle, setComposerTitle] = useState('');
  const [composerBody, setComposerBody] = useState('');
  const [postingNews, setPostingNews] = useState(false);
  const [messageDialogUser, setMessageDialogUser] = useState<User | null>(null);
  const [userInfoDialogUser, setUserInfoDialogUser] = useState<User | null>(null);
  const [unreadCounts, setUnreadCounts] = useState<Map<number, number>>(new Map());
  const [privateMessageHistory, setPrivateMessageHistory] = useState<Map<number, PrivateMessage[]>>(new Map());
  const [agreementText, setAgreementText] = useState<string | null>(null);
  const [agreementDismissing, setAgreementDismissing] = useState(false);
  const [agreementVisible, setAgreementVisible] = useState(false);
  const [disconnectMessage, setDisconnectMessage] = useState<string | null>(null);
  const [privateChatRooms, setPrivateChatRooms] = useState<PrivateChatRoom[]>([]);
  const [chatInvite, setChatInvite] = useState<{ chatId: number; userId: number; userName: string } | null>(null);
  const [bannerUrl, setBannerUrl] = useState<string | null>(null);
  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');

  // Server-side chat history state
  const oldestHistoryIdRef = useRef<string | null>(null);
  const newestHistoryIdRef = useRef<string | null>(null);
  const historyHasMoreRef = useRef(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const serverHistoryLoadedRef = useRef(false);

  // Sync connection status to tab store so TabBar can reflect it
  const tabId = tabs.find(t => t.type === 'server' && t.serverId === serverId)?.id;
  useEffect(() => {
    if (tabId) updateTabConnectionStatus(tabId, connectionStatus);
  }, [tabId, connectionStatus, updateTabConnectionStatus]);

  // Auto-reconnect on unexpected disconnect
  const {
    reconnectState,
    cancelReconnect,
    retryNow,
    searchTrackers,
    trackerResults,
    clearTrackerResults,
    searchingTrackers,
  } = useAutoReconnect({
    serverId,
    serverName,
    connectionStatus,
    disconnectMessage,
    setDisconnectMessage,
  });

  // Check if tab has an initial file path to navigate to (from hotline:// URL)
  const initialFilePath = useRef(
    tabs.find(t => t.type === 'server' && t.serverId === serverId)?.initialFilePath
  );
  const [pendingFilePath, setPendingFilePath] = useState<string[] | undefined>(initialFilePath.current);

  // Load chat history from encrypted storage on mount
  useEffect(() => {
    if (!usePreferencesStore.getState().enableChatHistory) return;
    useChatHistoryStore.getState().loadHistory(serverId).then((history) => {
      if (history.length > 0) {
        log('Chat', `Loaded ${history.length} messages from history`);
        setMessages(history.map((m) => ({
          userId: m.userId,
          userName: m.userName,
          message: m.message,
          timestamp: new Date(m.timestamp),
          iconId: m.iconId,
          isMention: m.isMention,
          isAdmin: m.isAdmin,
          type: m.type as any,
        })));
      }
    });
  }, [serverId]);

  // Navigate to file path once agreement is cleared and connection is ready
  useEffect(() => {
    if (pendingFilePath && pendingFilePath.length > 0 && !agreementText && connectionStatus === 'logged-in') {
      setActiveTab('files');
      setCurrentPath(pendingFilePath);
      currentPathRef.current = pendingFilePath;
      setPendingFilePath(undefined);
    }
  }, [pendingFilePath, agreementText, connectionStatus]);

  // Debug: log when bannerUrl changes
  useEffect(() => {
    if (bannerUrl) {
      log('Banner', 'Banner URL state updated', bannerUrl);
    } else {
      log('Banner', 'Banner URL state is null');
    }
  }, [bannerUrl]);

  // Trigger entrance animation when agreement appears
  useEffect(() => {
    if (agreementText) {
      // Allow one frame for the DOM to render before starting the transition
      const id = requestAnimationFrame(() => setAgreementVisible(true));
      return () => cancelAnimationFrame(id);
    } else {
      setAgreementVisible(false);
    }
  }, [agreementText]);

  // Check for pending agreement and connection status when component mounts
  useEffect(() => {
    const checkPendingAgreement = async () => {
      try {
        const pending = await invoke<string | null>('get_pending_agreement', { serverId });
        if (pending) {
          log('Agreement', 'Pending agreement found on mount', { length: pending.length });
          setAgreementText(pending);
        } else {
          log('Agreement', 'No pending agreement on mount');
        }
      } catch (error) {
        logError('Agreement', 'Failed to check pending agreement', error);
      }
    };
    checkPendingAgreement();
  }, [serverId]);

  // Listen for user access permissions
  useEffect(() => {
    let isActive = true;
    
    const unlistenPromise = listen<{ access: string }>(`user-access-${serverId}`, (event) => {
      if (!isActive) return;
      setUserAccess(event.payload.access);
      log('Permissions', 'User access received', '0x' + BigInt(event.payload.access).toString(16));
    });

    return () => {
      isActive = false;
      unlistenPromise.then((unlisten) => unlisten()).catch(() => {});
    };
  }, [serverId]);

  // Helper function to check if user has specific permission
  // (bitIndex 22 = canDisconnectUsers; see hasAccessBit for bit numbering)
  const hasPermission = (bitIndex: number): boolean => hasAccessBit(userAccess, bitIndex);
  
  // Update connection status based on users - if we have users, we're logged in
  // Use a ref to track if we've already updated to avoid infinite loops
  const statusUpdatedRef = useRef(false);
  useEffect(() => {
    if (users.length > 0 && !statusUpdatedRef.current && (connectionStatus === 'connecting' || connectionStatus === 'connected')) {
      setConnectionStatus('logged-in');
      statusUpdatedRef.current = true;
    }
    // Reset the ref if users list becomes empty
    if (users.length === 0) {
      statusUpdatedRef.current = false;
    }
  }, [users.length, connectionStatus]);

  // Request file list when Files tab is activated or path changes
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [isServerUnresponsive, setIsServerUnresponsive] = useState(false);
  const loadingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Synchronous guard — set immediately in onPathChange, reset only when file list arrives.
  // Using a ref so it takes effect within the same event loop tick, unlike isLoadingFiles state.
  const navigationBlockedRef = useRef(false);
  // Set to true by handleFileListReceived; tells useEffect([files]) it's safe to release guard
  const serverRespondedRef = useRef(false);
  // Path we navigated FROM, used to restore on cancel
  const previousPathRef = useRef<string[]>([]);

  const pathsEqual = (a: string[], b: string[]) =>
    a.length === b.length && a.every((v, i) => v === b[i]);

  const handleFileListReceived = (path: string[]) => {
    if (pathsEqual(path, currentPathRef.current)) {
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current);
        loadingTimeoutRef.current = null;
      }
      // Signal useEffect([files]) to release guard on next render
      serverRespondedRef.current = true;
    }
  };

  // Release navigation guard only after the SERVER responds and files actually render.
  // Cache hits also call setFiles, so we use serverRespondedRef to distinguish them.
  useEffect(() => {
    if (serverRespondedRef.current) {
      serverRespondedRef.current = false;
      navigationBlockedRef.current = false;
      setIsLoadingFiles(false);
      setIsServerUnresponsive(false);
    }
  }, [files]);

  const handleWaitForServer = () => {
    setIsServerUnresponsive(false);
    // Give 30 more seconds before asking again
    loadingTimeoutRef.current = setTimeout(() => {
      setIsServerUnresponsive(true);
      loadingTimeoutRef.current = null;
    }, 30_000);
  };

  const handleCancelNavigation = () => {
    setIsServerUnresponsive(false);
    setIsLoadingFiles(false);
    navigationBlockedRef.current = false;
    serverRespondedRef.current = false;
    if (loadingTimeoutRef.current) {
      clearTimeout(loadingTimeoutRef.current);
      loadingTimeoutRef.current = null;
    }
    // Restore path we navigated from
    const prevPath = previousPathRef.current;
    currentPathRef.current = prevPath;
    setCurrentPath(prevPath);
  };

  // Keep messagesRef in sync for dedup comparisons
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Keep a ref to serverInfo for useServerEvents (local history suppression check)
  const serverInfoRefForEvents = useRef<ServerInfo | null>(null);
  useEffect(() => { serverInfoRefForEvents.current = serverInfo; }, [serverInfo]);

  // Use server events hook (handles all event listeners)
  useServerEvents({
    serverId,
    serverName,
    messagesRef,
    setMessages, // Used for receiving chat messages from server
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
    onChatInvite: (chatId, userId, userName) => setChatInvite({ chatId, userId, userName }),
    setFileCache,
    currentPathRef,
    parseUserFlags,
    enablePrivateMessaging,
    addTransfer,
    updateTransfer,
    onFileListReceived: handleFileListReceived,
    serverInfoRef: serverInfoRefForEvents,
  });

  // Keyboard shortcuts
  useKeyboardShortcuts([
    {
      key: '1',
      modifiers: { meta: true },
      description: 'Switch to Chat tab',
      action: () => setActiveTab('chat'),
      enabled: connectionStatus === 'logged-in',
    },
    {
      key: '2',
      modifiers: { meta: true },
      description: 'Switch to Board tab',
      action: () => setActiveTab('board'),
      enabled: connectionStatus === 'logged-in',
    },
    {
      key: '3',
      modifiers: { meta: true },
      description: 'Switch to News tab',
      action: () => setActiveTab('news'),
      enabled: connectionStatus === 'logged-in',
    },
    {
      key: '4',
      modifiers: { meta: true },
      description: 'Switch to Files tab',
      action: () => setActiveTab('files'),
      enabled: connectionStatus === 'logged-in',
    },
    {
      key: 'Escape',
      description: 'Close dialogs',
      action: () => {
        if (messageDialogUser) {
          setMessageDialogUser(null);
        }
        if (userInfoDialogUser) {
          setUserInfoDialogUser(null);
        }
      },
    },
  ]);

  // Update ref when currentPath changes
  useEffect(() => {
    currentPathRef.current = currentPath;
  }, [currentPath]);

  useEffect(() => {
    if (activeTab === 'files') {
      // Set loading state immediately to prevent race conditions
      setIsLoadingFiles(true);

      // Safety timeout: if server is slow, ask the user whether to wait or cancel
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current);
      }
      loadingTimeoutRef.current = setTimeout(() => {
        setIsServerUnresponsive(true);
        loadingTimeoutRef.current = null;
      }, 10_000);

      // Check cache first for instant display
      const cached = getFileCache(serverId, currentPath);
      if (cached) {
        setFiles(cached);
      }

      // Always fetch from server to ensure we have the latest data
      // (cache is just for prefetching and instant display)
      invoke('get_file_list', {
        serverId,
        path: currentPath,
      })
        .catch((error) => {
          logError('Files', 'Failed to get file list', error);
          setIsLoadingFiles(false);
          if (loadingTimeoutRef.current) {
            clearTimeout(loadingTimeoutRef.current);
            loadingTimeoutRef.current = null;
          }
        });
    }

    return () => {
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current);
        loadingTimeoutRef.current = null;
      }
    };
  }, [activeTab, currentPath, serverId, getFileCache, setFiles]);


  // Clear cache when disconnecting
  useEffect(() => {
    return () => {
      clearFileCache(serverId);
    };
  }, [serverId, clearFileCache]);

  // Request message board when Board tab is activated
  useEffect(() => {
    if (activeTab === 'board' && connectionStatus === 'logged-in' && !loadingBoard && !boardLoaded) {
      setLoadingBoard(true);
      invoke<string[]>('get_message_board', {
        serverId,
      }).then((posts) => {
        log('Board', 'Board posts received', { count: posts.length });
        setBoardPosts(posts);
        setBoardLoaded(true);
        setLoadingBoard(false);
      }).catch((error) => {
        logError('Board', 'Failed to get message board', error);
        // Mark loaded so the effect doesn't re-fire in an endless request
        // loop — the server refused the board (e.g. account lacks the
        // privilege) and retrying won't change its answer.
        setBoardPosts([]);
        setBoardLoaded(true);
        setLoadingBoard(false);
        showNotification.error(String(error), 'Message board', undefined, serverName);
      });
    }
  }, [activeTab, connectionStatus, serverId, serverName, loadingBoard, boardLoaded]);


  // Download banner immediately after login (before agreement is shown)
  useEffect(() => {
    let cancelled = false;

    const downloadBanner = async () => {
      try {
        log('Banner', 'Starting banner download for server', serverId);

        const dataUrl = await invoke<string>('download_banner', { serverId });
        log('Banner', 'Data URL received', { length: dataUrl.length });

        if (!cancelled) {
          setBannerUrl(dataUrl);
          log('Banner', 'Banner URL set in state');
        }
      } catch (error) {
        logError('Banner', 'Banner download failed', error);
      }
    };

    // Download as soon as we're logged in (fires before agreement dialog appears)
    if (connectionStatus === 'logged-in' && !bannerUrl) {
      log('Banner', 'Conditions met for download', { connectionStatus });
      downloadBanner();
    }

    return () => {
      cancelled = true;
    };
  }, [serverId, connectionStatus]);

  // Fetch server info after connection
  useEffect(() => {
    if (connectionStatus === 'logged-in' && !serverInfo) {
      const fetchServerInfo = async () => {
        try {
          const info = await invoke<ServerInfo>('get_server_info', { serverId });
          log('Connection', 'Server info fetched', {
            name: info.name,
            hopeEnabled: info.hopeEnabled,
            hopeTransport: info.hopeTransport,
          });
          setServerInfo(info);
          // Update tab title with actual server name
          updateTabTitle(`server-${serverId}`, info.name || serverName);
        } catch (error) {
          logError('Connection', 'Failed to fetch server info', error);
        }
      };
      fetchServerInfo();
    }
  }, [serverId, connectionStatus, serverInfo, serverName, updateTabTitle]);

  // Convert a ChatHistoryEntry to a ChatMessage for the UI
  const historyEntryToMessage = (e: import('../../types').ChatHistoryEntry): ChatMessage => {
    let messageText = e.message;
    if (e.isDeleted) {
      messageText = '[message removed]';
    } else if (e.isAction) {
      // Reconstruct emote format to match live "*** nick does something"
      messageText = `*** ${e.nick} ${e.message}`;
    }
    return {
      userId: 0,
      userName: e.isDeleted ? '' : e.nick,
      message: messageText,
      timestamp: new Date(e.timestamp * 1000),
      iconId: e.iconId || undefined,
      type: e.isServerMsg ? 'server' as const : 'message' as const,
      isServerHistory: true,
      isAction: e.isAction,
      isDeleted: e.isDeleted,
      messageId: e.messageId,
      fromHistory: true,
    };
  };

  // Reset server history state on disconnect (for reconnect catch-up)
  useEffect(() => {
    if (connectionStatus === 'disconnected') {
      serverHistoryLoadedRef.current = false;
      // Keep newestHistoryIdRef so we can catch up on reconnect
    }
  }, [connectionStatus]);

  // Fetch server-side chat history on connect (when server supports it and user has it enabled)
  const enableServerChatHistory = usePreferencesStore((s) => s.enableServerChatHistory);
  useEffect(() => {
    if (!serverInfo?.chatHistorySupported || !enableServerChatHistory || serverHistoryLoadedRef.current) return;
    if (connectionStatus !== 'logged-in') return;
    serverHistoryLoadedRef.current = true;

    const isReconnect = newestHistoryIdRef.current !== null;

    const fetchServerHistory = async () => {
      try {
        setHistoryLoading(true);

        if (isReconnect) {
          // Reconnect catch-up: fetch messages since last known ID
          log('Chat', `Catching up from message ${newestHistoryIdRef.current}`);
          let after = newestHistoryIdRef.current!;
          let allCaughtUp = false;
          while (!allCaughtUp) {
            const catchUpResponse = await invoke<ChatHistoryResponse>('get_chat_history', {
              serverId,
              after,
              limit: 50,
            });
            if (catchUpResponse.entries.length > 0) {
              const catchUpMessages: ChatMessage[] = catchUpResponse.entries.map(historyEntryToMessage);
              // Deduplicate by messageId before appending
              setMessages((prev) => {
                const existingIds = new Set(prev.filter(m => m.messageId).map(m => m.messageId));
                const newMsgs = catchUpMessages.filter(m => !existingIds.has(m.messageId));
                return [...prev, ...newMsgs];
              });
              after = catchUpResponse.entries[catchUpResponse.entries.length - 1].messageId;
              newestHistoryIdRef.current = after;
            }
            allCaughtUp = !catchUpResponse.hasMore;
          }
          log('Chat', 'Reconnect catch-up complete');
          setHistoryLoading(false);
          return;
        }

        // Initial load: fetch most recent messages
        log('Chat', 'Fetching server-side chat history');
        const response = await invoke<ChatHistoryResponse>('get_chat_history', {
          serverId,
          limit: 50,
        });

        if (response.entries.length > 0) {
          log('Chat', `Loaded ${response.entries.length} messages from server history`);

          const historyMessages: ChatMessage[] = response.entries.map(historyEntryToMessage);

          // Prepend server history before any existing messages
          setMessages((prev) => [...historyMessages, ...prev]);

          // Track cursors for pagination
          oldestHistoryIdRef.current = response.entries[0].messageId;
          newestHistoryIdRef.current = response.entries[response.entries.length - 1].messageId;
          historyHasMoreRef.current = response.hasMore;
        }
      } catch (error) {
        logError('Chat', 'Failed to fetch server chat history', error);
      } finally {
        setHistoryLoading(false);
      }
    };

    fetchServerHistory();
  }, [serverInfo, serverId, connectionStatus]);


  // Load more history (scroll-back pagination)
  const handleLoadMoreHistory = async () => {
    if (!oldestHistoryIdRef.current || historyLoading) return;
    try {
      setHistoryLoading(true);
      const response = await invoke<ChatHistoryResponse>('get_chat_history', {
        serverId,
        before: oldestHistoryIdRef.current,
        limit: 50,
      });

      if (response.entries.length > 0) {
        log('Chat', `Loaded ${response.entries.length} older messages from server history`);

        const olderMessages: ChatMessage[] = response.entries.map(historyEntryToMessage);

        setMessages((prev) => [...olderMessages, ...prev]);
        oldestHistoryIdRef.current = response.entries[0].messageId;
      }
      historyHasMoreRef.current = response.hasMore;
    } catch (error) {
      logError('Chat', 'Failed to load more chat history', error);
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleUserClick = (user: User) => {
    // Open message dialog (chat) directly
    handleOpenMessageDialog(user);
  };
  
  const handleUserRightClick = (user: User, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    
    const items: ContextMenuItem[] = [
      {
        label: 'Message',
        icon: '💬',
        action: () => {
          handleOpenMessageDialog(user);
        },
      },
      { divider: true, label: '', action: () => {} },
      {
        label: 'Get Info',
        icon: 'ℹ️',
        action: () => {
          setUserInfoDialogUser(user);
        },
      },
      {
        label: 'Invite to Chat',
        icon: '🗨️',
        action: async () => {
          try {
            const chatId = await invoke<number>('invite_to_new_chat', { serverId, userId: user.userId });
            const result = await invoke<{ subject: string; users: { id: number; name: string; icon: number; flags: number; color?: string }[] }>('join_chat', { serverId, chatId });
            setPrivateChatRooms((prev) => [
              ...prev,
              { chatId, subject: result.subject, users: result.users, messages: [] },
            ]);
            setActiveTab(`pchat-${chatId}`);
          } catch (error) {
            logError('Chat', 'Failed to create chat', error);
          }
        },
      },
      { divider: true, label: '', action: () => {} },
      {
        label: `Custom icon: #${user.iconId}`,
        icon: '',
        action: () => {},
        disabled: true,
      },
    ];

    // Add Disconnect option if user has permission
    // canDisconnectUsers is bit 22 (accessIndexToBit(22) = bit 41)
    if (hasPermission(22)) {
      items.push({ divider: true, label: '', action: () => {} });
      items.push({
        label: 'Disconnect',
        icon: '🚫',
        action: async () => {
          if (confirm(`Are you sure you want to disconnect ${user.userName}? They will be disconnected from the server, but may reconnect.`)) {
            try {
              log('Users', `Disconnecting user: ${user.userName}`, { userId: user.userId });
              await invoke('disconnect_user', {
                serverId,
                userId: user.userId,
                options: null, // No ban options for now
              });
            } catch (error) {
              logError('Users', 'Failed to disconnect user', error);
            }
          }
        },
      });
    }
    
    showContextMenu(event, items);
  };

  const handleOpenMessageDialog = (user: User) => {
    if (!enablePrivateMessaging) {
      return; // Private messaging is disabled
    }
    // Reset unread count for this user
    setUnreadCounts((prev) => {
      const newCounts = new Map(prev);
      newCounts.delete(user.userId);
      return newCounts;
    });
    // Open the dialog
    setMessageDialogUser(user);
  };

  // Use server handlers hook
  const {
    handleSendMessage,
    handlePostBoard,
    handleDownloadFile,
    handleUploadFile,
    handleSendPrivateMessage,
    handleAcceptAgreement,
    handleDeclineAgreement,
    handleDisconnect,
    handlePostNews,
    handleNavigateNews,
    handleNewsBack,
    handleSelectArticle,
  } = useServerHandlers({
    serverId,
    serverName,
    currentPath,
    downloadFolder,
    setMessage,
    setMessages,
    setSending,
    setBoardMessage,
    setPostingBoard,
    setBoardPosts,
    setDownloadProgress,
    setUploadProgress,
    setPrivateMessageHistory,
    setAgreementText,
    setNewsPath,
    setNewsLeafType,
    setNewsArticles,
    setComposerTitle,
    setComposerBody,
    setShowComposer,
    setPostingNews,
    clearFileCachePath,
    onClose,
  });

  // Permission-gated feature flags
  const canBroadcast = hasPermission(32);
  const canCreateFolder = hasPermission(5);
  const canDeleteFiles = hasPermission(4);
  const canRenameFiles = hasPermission(6);
  const canCreateNewsCategories = hasPermission(34);
  const canDeleteNewsCategories = hasPermission(35);
  const canCreateNewsFolders = hasPermission(36);
  const canDeleteNewsFolders = hasPermission(37);
  const canDeleteNewsArticles = hasPermission(33);

  const handleSendBroadcast = async (msg: string) => {
    log('Chat', 'Sending broadcast');
    try {
      await invoke('send_broadcast', { serverId, message: msg });
      log('Chat', 'Broadcast sent');
    } catch (error) {
      logError('Chat', 'Failed to send broadcast', error);
    }
  };

  const handlePrivateChatSend = async (chatId: number, message: string, media?: UploadedMedia | null) => {
    log('Chat', 'Sending private chat message', { chatId });
    try {
      await invoke('send_private_chat', { serverId, chatId, message, media: media ?? null });
      log('Chat', 'Private chat message sent', { chatId });
    } catch (error) {
      logError('Chat', 'Failed to send private chat message', error);
      throw error;
    }
  };

  const handleLeaveChat = async (chatId: number) => {
    log('Chat', 'Leaving chat', { chatId });
    try {
      await invoke('leave_chat', { serverId, chatId });
      setPrivateChatRooms((prev) => prev.filter((r) => r.chatId !== chatId));
      // Switch back to main chat if we were viewing this room
      if (activeTab === `pchat-${chatId}`) {
        setActiveTab('chat');
      }
    } catch (error) {
      logError('Chat', 'Failed to leave chat', error);
    }
  };

  const handleSetChatSubject = async (chatId: number, subject: string) => {
    log('Chat', 'Setting chat subject', { chatId, subject });
    try {
      await invoke('set_chat_subject', { serverId, chatId, subject });
    } catch (error) {
      logError('Chat', 'Failed to set chat subject', error);
    }
  };

  const handleAcceptChatInvite = async (chatId: number) => {
    log('Chat', 'Accepting chat invite', { chatId });
    try {
      const result = await invoke<{ subject: string; users: { id: number; name: string; icon: number; flags: number; color?: string }[] }>('join_chat', { serverId, chatId });
      log('Chat', 'Joined chat', { chatId, subject: result.subject, users: result.users });
      setPrivateChatRooms((prev) => [
        ...prev,
        { chatId, subject: result.subject, users: result.users, messages: [] },
      ]);
      setChatInvite(null);
      setActiveTab(`pchat-${chatId}`);
    } catch (error) {
      logError('Chat', 'Failed to join chat', error);
      setChatInvite(null);
    }
  };

  const handleRejectChatInvite = async (chatId: number) => {
    log('Chat', 'Rejecting chat invite', { chatId });
    try {
      await invoke('reject_chat_invite', { serverId, chatId });
    } catch (error) {
      logError('Chat', 'Failed to reject chat invite', error);
    }
    setChatInvite(null);
  };

  const handleCreateFolder = async (name: string) => {
    log('Files', `Creating folder: ${name}`, { path: currentPath });
    try {
      await invoke('create_folder', { serverId, path: currentPath, name });
      // Refresh file list
      clearFileCachePath(serverId, currentPath);
      invoke('get_file_list', { serverId, path: currentPath }).catch((err) => logError('Files', 'Failed to refresh file list', err));
    } catch (error) {
      logError('Files', 'Failed to create folder', error);
      alert(`Failed to create folder: ${error}`);
    }
  };

  const handleCreateNewsCategory = async (name: string) => {
    log('News', `Creating news category: ${name}`, { path: newsPath });
    try {
      await invoke('create_news_category', { serverId, path: newsPath, name });
      // Reload news
      const categories = await invoke<NewsCategory[]>('get_news_categories', { serverId, path: newsPath });
      setNewsCategories(categories);
    } catch (error) {
      logError('News', 'Failed to create news category', error);
      alert(`Failed to create category: ${error}`);
    }
  };

  const handleCreateNewsFolder = async (name: string) => {
    log('News', `Creating news folder: ${name}`, { path: newsPath });
    try {
      await invoke('create_news_folder', { serverId, path: newsPath, name });
      const categories = await invoke<NewsCategory[]>('get_news_categories', { serverId, path: newsPath });
      setNewsCategories(categories);
    } catch (error) {
      logError('News', 'Failed to create news folder', error);
      alert(`Failed to create folder: ${error}`);
    }
  };

  const handleDeleteNewsItem = async (itemPath: string[]) => {
    log('News', 'Deleting news item', { path: itemPath });
    try {
      await invoke('delete_news_item', { serverId, path: itemPath });
      // Reload current news path
      if (newsPath.length === 0) {
        const categories = await invoke<NewsCategory[]>('get_news_categories', { serverId, path: newsPath });
        setNewsCategories(categories);
      } else {
        const articles = await invoke<NewsArticle[]>('get_news_articles', { serverId, path: newsPath });
        setNewsArticles(articles);
      }
    } catch (error) {
      logError('News', 'Failed to delete news item', error);
      alert(`Failed to delete: ${error}`);
    }
  };

  const handleDeleteNewsArticle = async (articleId: number, articlePath: string[]) => {
    log('News', 'Deleting news article', { articleId, path: articlePath });
    try {
      await invoke('delete_news_article', { serverId, path: articlePath, articleId, recursive: false });
      const articles = await invoke<NewsArticle[]>('get_news_articles', { serverId, path: newsPath });
      setNewsArticles(articles);
      setSelectedArticle(null);
      setArticleContent('');
    } catch (error) {
      logError('News', 'Failed to delete news article', error);
      alert(`Failed to delete article: ${error}`);
    }
  };

  // Wrapper functions for handlers that need additional state
  const handleSendMessageWrapper = (
    e: React.FormEvent,
    media?: { handle: string; mime: string } | null,
  ) => {
    e.preventDefault();
    if ((!message.trim() && !media) || sending) return;
    return handleSendMessage(e, message, sending, media ?? null);
  };

  const handlePostBoardWrapper = (e: React.FormEvent) => {
    e.preventDefault();
    if (!boardMessage.trim() || postingBoard) return;
    handlePostBoard(e, boardMessage, postingBoard);
  };

  const handleSelectArticleWrapper = async (article: NewsArticle) => {
    await handleSelectArticle(article, setSelectedArticle, setArticleContent);
  };

  const handleNavigateNewsWrapper = (category: NewsCategory) => {
    handleNavigateNews(category);
  };

  const handleNewsBackWrapper = () => {
    handleNewsBack(newsPath);
  };

  const handlePostNewsWrapper = async (e: React.FormEvent) => {
    await handlePostNews(e, newsPath, composerTitle, composerBody, postingNews, selectedArticle?.id ?? 0);
  };

  // Load news when News tab is activated or path changes
  useEffect(() => {
    if (activeTab === 'news') {
      setLoadingNews(true);
      setSelectedArticle(null);
      setArticleContent('');

      // Dispatch on the leaf item type:
      //   bundle (type 2) → list of bundles/categories  → get_news_categories
      //   category (type 3) → list of articles         → get_news_articles
      // Root path is implicitly a bundle (default leaf type 2).
      const loadNews = async () => {
        log('News', 'Loading news for path', { newsPath, leafType: newsLeafType });
        try {
          if (newsLeafType === 3) {
            log('News', 'Fetching articles (leaf is a category)');
            const articles = await invoke<NewsArticle[]>('get_news_articles', {
              serverId,
              path: newsPath,
            });
            log('News', 'Articles received', { count: articles.length });
            setNewsCategories([]);
            setNewsArticles(articles);
          } else {
            log('News', 'Fetching categories (leaf is a bundle)');
            const categories = await invoke<NewsCategory[]>('get_news_categories', {
              serverId,
              path: newsPath,
            });
            log('News', 'Categories received', { count: categories.length });
            setNewsCategories(categories);
            setNewsArticles([]);
          }
        } catch (error) {
          logError('News', 'Failed to load news', error);
          setNewsCategories([]);
          setNewsArticles([]);
        } finally {
          setLoadingNews(false);
        }
      };

      loadNews();
    }
  }, [activeTab, newsPath, newsLeafType, serverId]);


  return (
    <div className="h-full w-full bg-white dark:bg-gray-900 flex flex-col relative">
      {showServerBanner && <ServerBanner bannerUrl={bannerUrl} serverName={serverName} />}

      <ServerHeader
        serverName={serverName}
        serverInfo={serverInfo}
        users={users}
        connectionStatus={connectionStatus}
        isTls={isTls}
        onDisconnect={handleDisconnect}
        onShowTransfers={() => setShowTransferList(true)}
        onShowNotificationLog={() => setShowNotificationLog(true)}
      />

      {/* Mobile section tabs (above content on mobile) */}
      <MobileTabBar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        users={users}
        onUserClick={handleUserClick}
        onUserRightClick={handleUserRightClick}
        onOpenMessageDialog={handleOpenMessageDialog}
        unreadCounts={unreadCounts}
      />

      {/* Server Agreement Modal */}
      {agreementText && (
        <div
          className={`absolute inset-0 z-50 flex items-center justify-center transition-all duration-300 ease-in-out ${
            agreementDismissing || !agreementVisible ? 'bg-black/0 backdrop-blur-none' : 'bg-black/60 backdrop-blur-sm'
          }`}
        >
          <div
            className={`bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg mx-6 flex flex-col max-h-[80vh] transition-all duration-300 ease-in-out ${
              agreementDismissing || !agreementVisible ? 'opacity-0 scale-95 translate-y-2' : 'opacity-100 scale-100 translate-y-0'
            }`}
          >
            <div className="flex justify-center pt-6 px-6 h-[84px] items-center">
              {bannerUrl && (
                <img
                  src={bannerUrl}
                  alt="Server Banner"
                  className="max-w-full h-auto max-h-[60px] rounded-lg"
                  style={{ imageRendering: 'auto' }}
                />
              )}
            </div>
            <div className="px-6 pt-5 pb-2">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">Server Agreement</h2>
            </div>
            <div className="flex-1 overflow-y-auto px-6 pb-4 text-xs text-gray-800 dark:text-gray-200">
              {renderMarkdown && renderMarkdownAgreements ? (
                <MarkdownText text={agreementText} className="whitespace-pre-wrap break-words" />
              ) : (
                <pre className="whitespace-pre-wrap break-words font-mono">{agreementText}</pre>
              )}
            </div>
            <div className="flex gap-3 justify-end px-6 py-4 border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={() => {
                  setAgreementDismissing(true);
                  setTimeout(() => { setAgreementText(null); setAgreementDismissing(false); handleDeclineAgreement(); }, 300);
                }}
                className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-sm font-medium"
              >
                Decline
              </button>
              <button
                onClick={() => {
                  setAgreementDismissing(true);
                  setTimeout(() => { setAgreementText(null); setAgreementDismissing(false); handleAcceptAgreement(); }, 300);
                }}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors text-sm font-medium"
              >
                Accept
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Disconnect / Reconnect Modal */}
      {disconnectMessage && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md mx-6 flex flex-col">
            <div className="px-6 pt-6 pb-2">
              <h2 className="text-base font-semibold text-red-600 dark:text-red-400">
                {reconnectState.status === 'connecting' ? 'Reconnecting...' :
                 reconnectState.status === 'waiting' ? 'Reconnecting' :
                 reconnectState.status === 'exhausted' ? 'Reconnect Failed' :
                 disconnectMessage.startsWith('HOPE/protocol') ? 'Connection Failed' :
                 'Disconnected'}
              </h2>
            </div>

            <div className="px-6 pb-4 text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap break-words">
              {disconnectMessage}
            </div>

            {/* Reconnect status */}
            {reconnectState.status === 'waiting' && (
              <div className="px-6 pb-4">
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  Attempt {reconnectState.attempt + 1} of {reconnectState.maxAttempts} — retrying in{' '}
                  <span className="font-mono font-medium text-gray-900 dark:text-gray-100">
                    {Math.floor(reconnectState.countdown / 60)}:{String(reconnectState.countdown % 60).padStart(2, '0')}
                  </span>
                </div>
                {reconnectState.attempt > 0 && reconnectState.currentInterval !== usePreferencesStore.getState().autoReconnectInterval && (
                  <div className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                    Interval: {reconnectState.currentInterval}m (sliding)
                  </div>
                )}
              </div>
            )}

            {reconnectState.status === 'connecting' && (
              <div className="px-6 pb-4 flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Connecting... (attempt {reconnectState.attempt + 1} of {reconnectState.maxAttempts})
              </div>
            )}

            {reconnectState.status === 'exhausted' && (
              <div className="px-6 pb-4 text-sm text-gray-600 dark:text-gray-400">
                All {reconnectState.maxAttempts} reconnect attempts failed.
              </div>
            )}

            {/* Tracker search results */}
            {trackerResults && trackerResults.length > 0 && (
              <div className="px-6 pb-4">
                <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Server may have moved — found on trackers:
                </p>
                <div className="space-y-2 max-h-32 overflow-y-auto">
                  {trackerResults.map((match, i) => (
                    <div key={i} className="flex items-center justify-between text-xs bg-gray-50 dark:bg-gray-800 rounded px-3 py-2">
                      <div>
                        <div className="font-medium text-gray-900 dark:text-gray-100">{match.name}</div>
                        <div className="text-gray-500">{match.address}:{match.port} via {match.trackerName}</div>
                      </div>
                      <button
                        onClick={async () => {
                          const { bookmarks, updateBookmark } = useAppStore.getState();
                          const info = useAppStore.getState().serverInfo.get(serverId);
                          const bm = bookmarks.find(b => b.address === info?.address);
                          if (bm) {
                            updateBookmark(bm.id, { address: match.address, port: match.port });
                            try {
                              await invoke('save_bookmark', { bookmark: { ...bm, address: match.address, port: match.port } });
                            } catch { /* best effort */ }
                          }
                          clearTrackerResults();
                          cancelReconnect();
                          retryNow();
                        }}
                        className="ml-2 px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-medium whitespace-nowrap"
                      >
                        Update &amp; Connect
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 dark:border-gray-700">
              <div className="flex gap-2">
                {reconnectState.status === 'exhausted' && useAppStore.getState().trackers.length > 0 && (
                  <button
                    onClick={searchTrackers}
                    disabled={searchingTrackers}
                    className="px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-md transition-colors disabled:opacity-50"
                  >
                    {searchingTrackers ? 'Searching...' : 'Search Trackers'}
                  </button>
                )}
                {reconnectState.status === 'exhausted' && (
                  <button
                    onClick={() => {
                      cancelReconnect();
                      retryNow();
                    }}
                    className="px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-md transition-colors"
                  >
                    Try Again
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                {(reconnectState.status === 'waiting' || reconnectState.status === 'connecting') && (
                  <>
                    <button
                      onClick={retryNow}
                      disabled={reconnectState.status === 'connecting'}
                      className="px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-md transition-colors disabled:opacity-50"
                    >
                      Retry Now
                    </button>
                    <button
                      onClick={() => {
                        cancelReconnect();
                      }}
                      className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-md transition-colors text-sm font-medium"
                    >
                      Cancel
                    </button>
                  </>
                )}
                {(reconnectState.status === 'idle' || reconnectState.status === 'exhausted') && (
                  <button
                    onClick={() => {
                      cancelReconnect();
                      setDisconnectMessage(null);
                    }}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors text-sm font-medium"
                  >
                    OK
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Chat Invite Modal */}
      {chatInvite && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-sm w-full mx-4 p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">Chat Invitation</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              <span className="font-medium text-gray-800 dark:text-gray-200">{chatInvite.userName}</span> has invited you to a private chat.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => handleRejectChatInvite(chatInvite.chatId)}
                className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors"
              >
                Decline
              </button>
              <button
                onClick={() => handleAcceptChatInvite(chatInvite.chatId)}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors text-sm font-medium"
              >
                Accept
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        <ServerSidebar
          activeTab={activeTab}
          onTabChange={setActiveTab}
          users={users}
          onUserClick={handleUserClick}
          onUserRightClick={handleUserRightClick}
          onOpenMessageDialog={handleOpenMessageDialog}
          unreadCounts={unreadCounts}
          privateChatRooms={privateChatRooms}
          onLeaveChat={handleLeaveChat}
        />

        {/* Main area with content */}
        <div className="flex-1 flex overflow-hidden">
          {/* Content area */}
          <div className="flex-1 flex flex-col overflow-hidden">
          {/* Chat view */}
          {activeTab === 'chat' && (
            <ChatTab
              serverId={serverId}
              serverName={serverName}
              messages={messages}
              users={users}
              message={message}
              sending={sending}
              bannerUrl={bannerUrl}
              agreementText={agreementText}
              canBroadcast={canBroadcast}
              onMessageChange={setMessage}
              onSendMessage={handleSendMessageWrapper}
              onSendBroadcast={handleSendBroadcast}
              onAcceptAgreement={handleAcceptAgreement}
              onDeclineAgreement={handleDeclineAgreement}
              historyLoading={historyLoading}
              historyHasMore={historyHasMoreRef.current}
              onLoadMoreHistory={handleLoadMoreHistory}
              historyMaxMsgs={serverInfo?.historyMaxMsgs}
              historyMaxDays={serverInfo?.historyMaxDays}
            />
          )}

          {/* Private chat room views */}
          {activeTab.startsWith('pchat-') && (() => {
            const chatId = parseInt(activeTab.replace('pchat-', ''), 10);
            const room = privateChatRooms.find((r) => r.chatId === chatId);
            if (!room) return null;
            return (
              <PrivateChatTab
                serverId={serverId}
                room={room}
                onSendMessage={handlePrivateChatSend}
                onLeave={handleLeaveChat}
                onSetSubject={handleSetChatSubject}
              />
            );
          })()}

          {/* Board view */}
          {activeTab === 'board' && (
            <BoardTab
              boardPosts={boardPosts}
              loadingBoard={loadingBoard}
              boardMessage={boardMessage}
              postingBoard={postingBoard}
              onBoardMessageChange={setBoardMessage}
              onPostBoard={handlePostBoardWrapper}
            />
          )}

          {/* News view */}
          {activeTab === 'news' && (
            <NewsTab
              newsPath={newsPath}
              newsCategories={newsCategories}
              newsArticles={newsArticles}
              selectedArticle={selectedArticle}
              articleContent={articleContent}
              loadingNews={loadingNews}
              showComposer={showComposer}
              composerTitle={composerTitle}
              composerBody={composerBody}
              postingNews={postingNews}
              canCreateCategory={canCreateNewsCategories}
              canDeleteCategory={canDeleteNewsCategories}
              canCreateFolder={canCreateNewsFolders}
              canDeleteFolder={canDeleteNewsFolders}
              canDeleteArticle={canDeleteNewsArticles}
              onNewsPathChange={setNewsPath}
              onNewsBack={handleNewsBackWrapper}
              onNavigateNews={handleNavigateNewsWrapper}
              onSelectArticle={handleSelectArticleWrapper}
              onClearSelectedArticle={() => setSelectedArticle(null)}
              onToggleComposer={() => setShowComposer(!showComposer)}
              onComposerTitleChange={setComposerTitle}
              onComposerBodyChange={setComposerBody}
              onPostNews={handlePostNewsWrapper}
              onCreateCategory={handleCreateNewsCategory}
              onCreateFolder={handleCreateNewsFolder}
              onDeleteItem={handleDeleteNewsItem}
              onDeleteArticle={handleDeleteNewsArticle}
            />
          )}

          {/* Files view */}
          {activeTab === 'files' && (
            <FilesTab
              serverId={serverId}
              files={files}
              currentPath={currentPath}
              downloadProgress={downloadProgress}
              uploadProgress={uploadProgress}
              isLoading={isLoadingFiles}
              onPathChange={(path) => {
                if (!navigationBlockedRef.current) {
                  navigationBlockedRef.current = true;
                  serverRespondedRef.current = false; // cancel stale pending guard release
                  previousPathRef.current = currentPath; // save for cancel
                  currentPathRef.current = path;
                  setCurrentPath(path);
                }
              }}
              isServerUnresponsive={isServerUnresponsive}
              onWaitForServer={handleWaitForServer}
              onCancelNavigation={handleCancelNavigation}
              canCreateFolder={canCreateFolder}
              canDeleteFiles={canDeleteFiles}
              canRenameFiles={canRenameFiles}
              onCreateFolder={handleCreateFolder}
              onDownloadFile={handleDownloadFile}
              onUploadFile={handleUploadFile}
              onRefresh={() => {
                // Clear cache for current path and fetch fresh data
                clearFileCachePath(serverId, currentPath);
                // Fetch fresh data
                invoke('get_file_list', {
                  serverId,
                  path: currentPath,
                }).catch((error) => {
                  logError('Files', 'Failed to refresh file list', error);
                });
              }}
              getAllCachedFiles={() => {
                // Get all cached files from all paths
                const cache = useAppStore.getState().fileCache.get(serverId);
                if (!cache) return [];
                
                const allFiles: Array<{ file: FileItem; path: string[] }> = [];
                for (const [pathKey, cachedFiles] of cache.entries()) {
                  // Filter out empty path keys and handle root path
                  const path = pathKey && pathKey.trim() ? pathKey.split('/').filter((p: string) => p) : [];
                  for (const file of cachedFiles) {
                    allFiles.push({ file, path });
                  }
                }
                return allFiles;
              }}
            />
            )}
          </div>
        </div>

      </div>

      {/* User Info Dialog */}
      {userInfoDialogUser && (
        <UserInfoDialog
          user={userInfoDialogUser}
          serverId={serverId}
          onClose={() => setUserInfoDialogUser(null)}
          onSendMessage={handleOpenMessageDialog}
          enablePrivateMessaging={enablePrivateMessaging}
        />
      )}

      {/* Message Dialog */}
      {messageDialogUser && (
        <MessageDialog
          serverId={serverId}
          userId={messageDialogUser.userId}
          userName={messageDialogUser.userName}
          messages={privateMessageHistory.get(messageDialogUser.userId) || []}
          onSendMessage={handleSendPrivateMessage}
          onClose={() => setMessageDialogUser(null)}
        />
      )}

      {/* Transfer List */}
      {showTransferList && (
        <TransferList
          serverId={serverId}
          serverName={serverName}
          onClose={() => setShowTransferList(false)}
        />
      )}

      {/* Notification Log */}
      {showNotificationLog && (
        <NotificationLog onClose={() => setShowNotificationLog(false)} />
      )}

      {/* Context menu */}
      <ContextMenuRenderer
        contextMenu={contextMenu}
        onClose={hideContextMenu}
      />
    </div>
  );
}
