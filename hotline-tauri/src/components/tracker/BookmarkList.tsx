import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useAppStore } from '../../stores/appStore';
import { usePreferencesStore } from '../../stores/preferencesStore';
import { useIsMobile } from '../../hooks/useIsMobile';
import type { Bookmark, ServerBookmark } from '../../types';
import EditBookmarkDialog from './EditBookmarkDialog';
import BookmarkInfoDialog from './BookmarkInfoDialog';
import ErrorModal from './ErrorModal';
import { classifyError, type ClassifiedError } from '../../utils/errorClassifier';
import { getPassword } from '../../utils/passwordVault';
import { useContextMenu, ContextMenuRenderer, type ContextMenuItem } from '../common/ContextMenu';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface BookmarkListProps {
  bookmarks: Bookmark[];
  searchQuery?: string;
}

interface SortableItemProps {
  id: string;
  children: (dragHandleProps: any) => React.ReactNode;
}

function SortableItem({ id, children }: SortableItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const dragHandleProps = {
    ref: setActivatorNodeRef,
    ...listeners,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      {children(dragHandleProps)}
    </div>
  );
}

export default function BookmarkList({ bookmarks, searchQuery = '' }: BookmarkListProps) {
  const { removeBookmark, addActiveServer, addTab, setBookmarks, tabs, serverInfo, setActiveTab, mnemosyneBookmarks, removeMnemosyneBookmark } = useAppStore();
  const { username, userIconId, autoDetectTls, allowLegacyTls } = usePreferencesStore();
  const [editingBookmark, setEditingBookmark] = useState<Bookmark | null>(null);
  const [addingBookmark, setAddingBookmark] = useState<Bookmark | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [infoBookmark, setInfoBookmark] = useState<Bookmark | null>(null);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [connectionErrors, setConnectionErrors] = useState<Map<string, ClassifiedError>>(new Map());
  const [errorDetailId, setErrorDetailId] = useState<string | null>(null);
  const [expandedTrackers, setExpandedTrackers] = useState<Set<string>>(new Set());
  const [trackerServers, setTrackerServers] = useState<Map<string, ServerBookmark[]>>(new Map());
  const [loadingTrackers, setLoadingTrackers] = useState<Set<string>>(new Set());
  const [mobileActionServer, setMobileActionServer] = useState<{ trackerId: string; server: ServerBookmark } | null>(null);
  const isMobile = useIsMobile();
  const { contextMenu, showContextMenu, hideContextMenu } = useContextMenu();

  // dnd-kit sensors
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDelete = async (id: string) => {
    try {
      await invoke('delete_bookmark', { id });
      removeBookmark(id);
      setDeletingId(null);
    } catch (error) {
      console.error('Failed to delete bookmark:', error);
    }
  };

  const handleConnect = async (bookmark: Bookmark) => {
    // Don't connect to trackers - they should be expanded instead
    // Check both explicit type and port (trackers use port 5498)
    if (bookmark.type === 'tracker' || bookmark.port === 5498) {
      console.log('Tracker detected, expanding instead of connecting:', bookmark.name);
      handleToggleTracker(bookmark.id);
      return;
    }

    // If already connected to this server, just switch to its tab
    // Match by address only — port may differ due to TLS auto-detection (e.g. 5500 vs 5600)
    const existingTab = tabs.find(t => {
      if (t.type !== 'server' || !t.serverId) return false;
      const info = serverInfo.get(t.serverId);
      return info?.address === bookmark.address;
    });
    if (existingTab) {
      setActiveTab(existingTab.id);
      return;
    }

    // If another connection is in progress, cancel it and start the new one
    if (connectingId) {
      try {
        await invoke('cancel_connection');
      } catch {
        // Ignore cancel errors
      }
    }

    setConnectingId(bookmark.id);
    // Clear any previous error for this bookmark
    setConnectionErrors((prev) => {
      const next = new Map(prev);
      next.delete(bookmark.id);
      return next;
    });

    try {
      // Load password from secure vault if one is stored
      const connectBookmark = { ...bookmark };
      if (bookmark.hasPassword && !bookmark.password) {
        const vaultPassword = await getPassword(bookmark.id);
        if (vaultPassword) connectBookmark.password = vaultPassword;
      }
      const result = await invoke<{ serverId: string; tls: boolean; port: number }>('connect_to_server', {
        bookmark: connectBookmark,
        username,
        userIconId,
        autoDetectTls: autoDetectTls && !bookmark.tls, // Only probe if not already TLS
        allowLegacyTls,
      });
      console.log('Connected to server:', result.serverId, result.tls ? '(TLS)' : '(plain)');

      // Add to active servers and create new tab
      addActiveServer(result.serverId, {
        id: result.serverId,
        name: bookmark.name,
        address: bookmark.address,
        port: result.port,
        tls: result.tls,
      });

      // Add server tab
      addTab({
        id: `server-${result.serverId}`,
        type: 'server',
        serverId: result.serverId,
        title: bookmark.name,
        unreadCount: 0,
      });
    } catch (error) {
      const classified = classifyError(String(error));

      // Silently ignore cancellation — the user clicked a different server
      if (classified.category === 'cancelled') {
        return;
      }

      console.error('Failed to connect:', error);

      setConnectionErrors((prev) => {
        const next = new Map(prev);
        next.set(bookmark.id, classified);
        return next;
      });

      // Show the error modal immediately
      setErrorDetailId(bookmark.id);
    } finally {
      // Only clear if we're still the active connection attempt
      setConnectingId((prev) => (prev === bookmark.id ? null : prev));
    }
  };

  const fetchTrackerServers = async (trackerId: string) => {
    const tracker = bookmarks.find(b => b.id === trackerId);
    if (!tracker || tracker.type !== 'tracker') return;
    
    setLoadingTrackers((prev) => new Set(prev).add(trackerId));
    
    try {
      interface TrackerServer {
        address: string;
        port: number;
        users: number;
        name?: string | null;
        description?: string | null;
      }
      
      const servers = await invoke<TrackerServer[]>('fetch_tracker_servers', {
        address: tracker.address,
        port: tracker.port || undefined,
        tls: tracker.tls ?? false,
        login: tracker.login || 'guest',
        password: tracker.hasPassword ? await getPassword(tracker.id) : (tracker.password || null),
      });
      
      // Convert TrackerServer to ServerBookmark format
      const serverBookmarks: ServerBookmark[] = servers.map((server, index) => ({
        id: `${trackerId}-${index}`,
        name: server.name || server.address,
        description: server.description || '',
        address: server.address,
        port: server.port,
        users: server.users,
      }));
      
      setTrackerServers((prev) => {
        const next = new Map(prev);
        next.set(trackerId, serverBookmarks);
        return next;
      });
      
      // Clear any previous errors
      setConnectionErrors((prev) => {
        const next = new Map(prev);
        next.delete(trackerId);
        return next;
      });
    } catch (error) {
      console.error('Failed to fetch tracker servers:', error);
      setConnectionErrors((prev) => {
        const next = new Map(prev);
        next.set(trackerId, classifyError(`Failed to fetch servers: ${error}`));
        return next;
      });
    } finally {
      setLoadingTrackers((prev) => {
        const next = new Set(prev);
        next.delete(trackerId);
        return next;
      });
    }
  };

  const handleToggleTracker = async (trackerId: string) => {
    const isExpanded = expandedTrackers.has(trackerId);
    
    if (isExpanded) {
      // Collapse: remove from expanded set and clear servers
      setExpandedTrackers((prev) => {
        const next = new Set(prev);
        next.delete(trackerId);
        return next;
      });
      setTrackerServers((prev) => {
        const next = new Map(prev);
        next.delete(trackerId);
        return next;
      });
    } else {
      // Expand: fetch servers from tracker
      setExpandedTrackers((prev) => new Set(prev).add(trackerId));
      await fetchTrackerServers(trackerId);
    }
  };

  const handleRefreshTracker = async (trackerId: string) => {
    // Refresh: re-fetch servers if tracker is expanded
    if (expandedTrackers.has(trackerId)) {
      await fetchTrackerServers(trackerId);
    } else {
      // If not expanded, expand it (which will fetch)
      setExpandedTrackers((prev) => new Set(prev).add(trackerId));
      await fetchTrackerServers(trackerId);
    }
  };

  const handleRefreshAllTrackers = useCallback(() => {
    const trackerBookmarks = bookmarks.filter(b => b.type === 'tracker');
    trackerBookmarks.forEach(tracker => {
      // Only refresh trackers that are already expanded
      if (expandedTrackers.has(tracker.id)) {
        fetchTrackerServers(tracker.id);
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookmarks, expandedTrackers]);

  // Listen for master refresh event from TrackerWindow
  useEffect(() => {
    const handler = () => handleRefreshAllTrackers();
    window.addEventListener('refresh-all-trackers', handler);
    return () => window.removeEventListener('refresh-all-trackers', handler);
  }, [handleRefreshAllTrackers]);

  const handleConnectToTrackerServer = async (trackerId: string, server: ServerBookmark) => {
    // Create a bookmark from the tracker server and connect
    // Make sure it's explicitly marked as a server (not tracker)
    const bookmark: Bookmark = {
      id: `${trackerId}-${server.id}`,
      name: server.name,
      address: server.address,
      port: server.port,
      login: 'guest',
      password: undefined,
      icon: undefined,
      autoConnect: false,
      type: 'server', // Explicitly set as server
    };
    
    console.log('Connecting to server from tracker:', bookmark.name, bookmark.address, bookmark.port);
    await handleConnect(bookmark);
  };

  const handleAddTrackerServerToBookmarks = (_trackerId: string, server: ServerBookmark) => {
    // Check if a bookmark with this address already exists
    const existing = bookmarks.find(b => b.address === server.address && b.port === server.port && b.type !== 'tracker');
    if (existing) {
      console.log('Bookmark already exists for', server.address);
      return;
    }

    // Show the add bookmark dialog pre-populated with server info
    setAddingBookmark({
      id: crypto.randomUUID(),
      name: server.name,
      address: server.address,
      port: server.port,
      login: 'guest',
      type: 'server',
    });
  };

  // Filter helper functions
  const matchesSearch = (text: string): boolean => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase().trim();
    return text.toLowerCase().includes(query);
  };

  const shouldShowBookmark = (bookmark: Bookmark): boolean => {
    if (!searchQuery.trim()) return true;
    // For regular bookmarks, filter by name
    if (bookmark.type !== 'tracker') {
      return matchesSearch(bookmark.name);
    }
    // Trackers are always shown (they won't be filtered)
    return true;
  };

  const getFilteredTrackerServers = (servers: ServerBookmark[]): ServerBookmark[] => {
    if (!searchQuery.trim()) return servers;
    return servers.filter(server => 
      matchesSearch(server.name) || 
      (server.description && matchesSearch(server.description))
    );
  };

  // Filter bookmarks based on search query
  const filteredBookmarks = bookmarks.filter(shouldShowBookmark);

  // Handle drag end with dnd-kit
  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = bookmarks.findIndex((b) => b.id === active.id);
      const newIndex = bookmarks.findIndex((b) => b.id === over.id);

      const newBookmarks = arrayMove(bookmarks, oldIndex, newIndex);

      // Update local state immediately
      setBookmarks(newBookmarks);

      // Save to backend
      try {
        await invoke('reorder_bookmarks', { bookmarks: newBookmarks });
        console.log('Successfully reordered bookmarks');
      } catch (error) {
        console.error('Failed to reorder bookmarks:', error);
        // Revert on error
        setBookmarks(bookmarks);
      }
    }
  };

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={filteredBookmarks.map(b => b.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="bg-white dark:bg-gray-900">
        {filteredBookmarks.map((bookmark, index) => {
          const isTracker = bookmark.type === 'tracker';
          const isExpanded = expandedTrackers.has(bookmark.id);
          const allServers = trackerServers.get(bookmark.id) || [];
          const servers = getFilteredTrackerServers(allServers);
          const isLoading = loadingTrackers.has(bookmark.id);
          const isEven = index % 2 === 0;
          
          // Trackers are always shown (never filtered by name)
          // Only their nested servers are filtered
          
          return (
            isTracker ? (
              // Tracker display - compact, list-like
              <SortableItem key={bookmark.id} id={bookmark.id}>
                {(dragHandleProps) => (
                <>
                <div
                  onClick={() => handleToggleTracker(bookmark.id)}
                  className={`h-[34px] px-2 flex items-center gap-1.5 group ${
                    isEven
                      ? 'bg-white dark:bg-gray-900'
                      : 'bg-gray-50 dark:bg-gray-800/50'
                  } hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors`}
                    onContextMenu={(e) => {
                      const items: ContextMenuItem[] = [
                        {
                          label: 'Copy Link',
                          icon: '🔗',
                          action: () => {
                            const link = `hotlinetracker://${bookmark.address}:${bookmark.port}`;
                            navigator.clipboard.writeText(link);
                          },
                        },
                        {
                          label: 'Copy Address',
                          icon: '📋',
                          action: () => {
                            navigator.clipboard.writeText(`${bookmark.address}:${bookmark.port}`);
                          },
                        },
                        { divider: true },
                        {
                          label: 'Get Info',
                          icon: 'ℹ️',
                          action: () => setInfoBookmark(bookmark),
                        },
                        {
                          label: 'Edit Tracker...',
                          icon: '✏️',
                          action: () => setEditingBookmark(bookmark),
                        },
                        { divider: true, label: '', action: () => {} },
                        {
                          label: 'Delete Tracker',
                          icon: '🗑️',
                          action: () => setDeletingId(bookmark.id),
                        },
                      ];
                      showContextMenu(e, items);
                    }}
                  >
                    {/* Drag handle - only draggable from here */}
                    <div
                      {...dragHandleProps}
                      className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 cursor-grab active:cursor-grabbing flex-shrink-0 w-[12px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Drag to reorder"
                    >
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 16 16">
                        <path d="M5 3h2v2H5V3zm0 4h2v2H5V7zm0 4h2v2H5v-2zm4-8h2v2H9V3zm0 4h2v2H9V7zm0 4h2v2H9v-2z"/>
                      </svg>
                    </div>

                    {/* Chevron - 10px width, opacity 0.5 */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleTracker(bookmark.id);
                      }}
                      className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 flex-shrink-0 w-[10px] flex items-center justify-center text-[10px] font-bold opacity-50"
                      aria-label={isExpanded ? 'Collapse tracker' : 'Expand tracker'}
                    >
                      {isExpanded ? '▼' : '▶'}
                    </button>
                    
                    {/* Tracker icon - 16x16 */}
                    <div className="w-4 h-4 flex-shrink-0 flex items-center justify-center">
                      <img 
                        src="/icons/tracker.png" 
                        alt="Tracker" 
                        className="w-4 h-4"
                        onError={(e) => {
                          // Fallback to SVG if image not found
                          const target = e.target as HTMLImageElement;
                          target.style.display = 'none';
                          const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                          svg.setAttribute('class', 'w-4 h-4 text-blue-600 dark:text-blue-400');
                          svg.setAttribute('viewBox', '0 0 16 16');
                          svg.setAttribute('fill', 'currentColor');
                          svg.innerHTML = '<path d="M8 0L0 4v8l8 4 8-4V4L8 0zm0 2.18l6 3v5.64l-6 3-6-3V5.18l6-3z"/><circle cx="8" cy="8" r="1.5"/>';
                          target.parentNode?.appendChild(svg);
                        }}
                      />
                    </div>
                    
                    {/* Tracker name - bold, no max width */}
                    <span className="text-sm font-semibold text-gray-900 dark:text-white flex-1 truncate min-w-0">
                  {bookmark.name}
                    </span>
                    
                    {/* Loading indicator - mini progress view */}
                    {isLoading && (
                      <div className="flex-shrink-0 w-3 h-3 mr-1">
                        <div className="w-3 h-3 border border-gray-300 dark:border-gray-600 border-t-blue-600 dark:border-t-blue-400 rounded-full animate-spin"></div>
                      </div>
                    )}
                    
                    {/* Server count badge when expanded */}
                    {isExpanded && servers.length > 0 && !isLoading && (
                      <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs text-gray-500 dark:text-gray-400">
                        <span>{servers.length}</span>
                        <span className="text-[10px]">🌐</span>
              </div>
                    )}
                    
                    {/* Refresh button - always visible for trackers */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRefreshTracker(bookmark.id);
                      }}
                      disabled={isLoading}
                      className="text-gray-600 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200 flex-shrink-0 w-5 h-5 flex items-center justify-center rounded hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      title="Refresh tracker servers"
                    >
                      <svg className={`w-4 h-4 transition-transform duration-700 ease-in-out ${isLoading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                    </button>
                    
                    {/* Edit/Delete buttons on hover */}
                    <div 
                      className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity mr-1"
                      onDragOver={(e) => {
                        // CRITICAL: preventDefault() to allow drop
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                      }}
                    >
                <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingBookmark(bookmark);
                        }}
                        className="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 text-xs px-1.5 py-0.5 rounded hover:bg-blue-100 dark:hover:bg-blue-900/30"
                        title="Edit tracker"
                      >
                        Edit
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeletingId(bookmark.id);
                        }}
                        className="text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 text-xs px-1.5 py-0.5 rounded hover:bg-red-100 dark:hover:bg-red-900/30"
                        title="Delete tracker"
                      >
                        Delete
                      </button>
                    </div>
                  </div>

                  {/* Tracker servers list (when expanded) - indented 34px */}
                  {isExpanded && servers.map((server, serverIndex) => {
                    const serverIsEven = (index + serverIndex + 1) % 2 === 0;
                    const trackerServerId = `${bookmark.id}-${server.id}`;
                    return (
                      <div
                        key={server.id}
                        className={`${isMobile ? 'min-h-[44px] py-1' : 'h-[34px]'} pl-[34px] pr-2 ${isMobile ? 'flex flex-wrap items-start' : 'flex items-center'} gap-1.5 cursor-pointer group min-w-0 ${
                          serverIsEven
                            ? 'bg-white dark:bg-gray-900'
                            : 'bg-gray-50 dark:bg-gray-800/50'
                        } hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors`}
                        onClick={() => {
                          if (isMobile) {
                            setMobileActionServer({ trackerId: bookmark.id, server });
                          } else {
                            handleConnectToTrackerServer(bookmark.id, server);
                          }
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          const items: ContextMenuItem[] = [
                            {
                              label: 'Connect',
                              icon: '🔗',
                              action: () => handleConnectToTrackerServer(bookmark.id, server),
                            },
                            {
                              label: 'Add to Bookmarks',
                              icon: '🔖',
                              action: () => handleAddTrackerServerToBookmarks(bookmark.id, server),
                            },
                            { divider: true, label: '', action: () => {} },
                            {
                              label: 'Copy Address',
                              icon: '📋',
                              action: () => {
                                navigator.clipboard.writeText(`${server.address}:${server.port}`);
                              },
                            },
                          ];
                          showContextMenu(e, items);
                        }}
                      >
                        {/* Server icon - 16x16 */}
                        <div className="w-4 h-4 flex-shrink-0 flex items-center justify-center">
                          <img
                            src="/icons/server.png"
                            alt="Server"
                            className="w-4 h-4"
                            onError={(e) => {
                              // Fallback to SVG if image not found
                              const target = e.target as HTMLImageElement;
                              target.style.display = 'none';
                              const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                              svg.setAttribute('class', 'w-4 h-4 text-gray-600 dark:text-gray-400');
                              svg.setAttribute('viewBox', '0 0 16 16');
                              svg.setAttribute('fill', 'currentColor');
                              svg.innerHTML = '<circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1" fill="none"/><circle cx="8" cy="8" r="2"/>';
                              target.parentNode?.appendChild(svg);
                            }}
                          />
                        </div>

                        {/* Server name - truncates naturally, no max width */}
                        <span className="text-sm text-gray-900 dark:text-white truncate min-w-0 flex-shrink">
                          {server.name}
                        </span>

                        {/* Server description if available */}
                        {server.description && !isMobile && (
                          <span className="text-xs text-gray-500 dark:text-gray-400 min-w-0 flex-shrink truncate">
                            {server.description}
                          </span>
                        )}

                        {/* Spacer to push user count to the right */}
                        <div className="flex-1 min-w-0"></div>

                        {/* User count with animated dot */}
                        {server.users > 0 && (
                          <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">
                            <span>{server.users}</span>
                            <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></div>
                          </div>
                        )}

                        {/* Action buttons - hover on desktop only */}
                        {!isMobile && (
                          <div className="flex items-center gap-1 transition-opacity flex-shrink-0 opacity-0 group-hover:opacity-100">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleAddTrackerServerToBookmarks(bookmark.id, server);
                              }}
                              className="text-gray-600 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300 text-xs px-1.5 py-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
                              title="Add to bookmarks"
                            >
                              Bookmark
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleConnectToTrackerServer(bookmark.id, server);
                              }}
                              disabled={connectingId === trackerServerId}
                              className="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 text-xs px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-900/30 disabled:opacity-50 disabled:cursor-not-allowed"
                              title="Connect to server"
                            >
                              {connectingId === trackerServerId ? 'Connecting...' : 'Connect'}
                            </button>
                          </div>
                        )}

                        {/* Full-width description on mobile */}
                        {isMobile && server.description && (
                          <div className="w-full pl-[22px] pb-1">
                            <span className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2">
                              {server.description}
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  
                  {/* Loading/Empty states */}
                  {isExpanded && isLoading && (
                    <div className={`h-[34px] pl-[34px] pr-2 flex items-center ${
                      (index + servers.length + 1) % 2 === 0 
                        ? 'bg-white dark:bg-gray-900' 
                        : 'bg-gray-50 dark:bg-gray-800/50'
                    }`}>
                      <span className="text-xs text-gray-500 dark:text-gray-400">Loading servers...</span>
                    </div>
                  )}
                  {isExpanded && !isLoading && servers.length === 0 && (
                    <div className={`h-[34px] pl-[34px] pr-2 flex items-center ${
                      (index + 1) % 2 === 0 
                        ? 'bg-white dark:bg-gray-900' 
                        : 'bg-gray-50 dark:bg-gray-800/50'
                    }`}>
                      <span className="text-xs text-gray-500 dark:text-gray-400">No servers found</span>
                    </div>
                  )}
                </>
                )}
              </SortableItem>
            ) : (
              // Regular server bookmark - compact list style
              <SortableItem key={bookmark.id} id={bookmark.id}>
                {(dragHandleProps) => (
                <>
                <div
                  onClick={() => handleConnect(bookmark)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const items: ContextMenuItem[] = [
                      {
                        label: 'Copy Link',
                        icon: '🔗',
                        action: () => {
                          const link = `hotline://${bookmark.address}:${bookmark.port}`;
                          navigator.clipboard.writeText(link);
                        },
                      },
                      {
                        label: 'Copy Address',
                        icon: '📋',
                        action: () => {
                          navigator.clipboard.writeText(`${bookmark.address}:${bookmark.port}`);
                        },
                      },
                      { divider: true, label: '', action: () => {} },
                      {
                        label: 'Get Info',
                        icon: 'ℹ️',
                        action: () => setInfoBookmark(bookmark),
                      },
                      {
                        label: 'Edit Bookmark...',
                        icon: '✏️',
                        action: () => setEditingBookmark(bookmark),
                      },
                      { divider: true, label: '', action: () => {} },
                      {
                        label: 'Delete Bookmark',
                        icon: '🗑️',
                        action: () => setDeletingId(bookmark.id),
                      },
                    ];
                    showContextMenu(e, items);
                  }}
                  className={`h-[34px] px-2 flex items-center gap-1.5 group ${
                    isEven
                      ? 'bg-white dark:bg-gray-900'
                      : 'bg-gray-50 dark:bg-gray-800/50'
                  } hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors`}
                >
                  {/* Drag handle - only draggable from here */}
                  <div
                    {...dragHandleProps}
                    className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 cursor-grab active:cursor-grabbing flex-shrink-0 w-[12px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Drag to reorder"
                  >
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 16 16">
                      <path d="M5 3h2v2H5V3zm0 4h2v2H5V7zm0 4h2v2H5v-2zm4-8h2v2H9V3zm0 4h2v2H9V7zm0 4h2v2H9v-2z"/>
                    </svg>
                  </div>

                  {/* Bookmark icon - 11x11, opacity 0.75 
                      This indicates it's a saved server bookmark (not a tracker).
                      In the Swift app, server bookmarks show bookmark.fill before the server icon. */}
                  <svg className="w-[11px] h-[11px] text-gray-400 dark:text-gray-500 opacity-75 flex-shrink-0" fill="currentColor" viewBox="0 0 16 16">
                    <path d="M3 1a1 1 0 0 0-1 1v12.5l5.5-2.75L13 14.5V2a1 1 0 0 0-1-1H3z"/>
                  </svg>
                  
                  {/* Server icon - 16x16 */}
                  <div className="w-4 h-4 flex-shrink-0 flex items-center justify-center">
                    <img 
                      src="/icons/server.png" 
                      alt="Server" 
                      className="w-4 h-4"
                      onError={(e) => {
                        // Fallback to SVG if image not found
                        const target = e.target as HTMLImageElement;
                        target.style.display = 'none';
                        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                        svg.setAttribute('class', 'w-4 h-4 text-gray-600 dark:text-gray-400');
                        svg.setAttribute('viewBox', '0 0 16 16');
                        svg.setAttribute('fill', 'currentColor');
                        svg.innerHTML = '<circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1" fill="none"/><circle cx="8" cy="8" r="2"/>';
                        target.parentNode?.appendChild(svg);
                      }}
                    />
                  </div>
                  
                  {/* Server name - not bold, no max width */}
                  <span className="text-sm text-gray-900 dark:text-white flex-1 truncate min-w-0">
                    {bookmark.name}
                  </span>
                  {bookmark.tls && (
                    <span title="TLS Enabled">
                      <svg className="w-3 h-3 text-green-600 dark:text-green-400 flex-shrink-0" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M8 1a3.5 3.5 0 0 0-3.5 3.5V7H3.5A1.5 1.5 0 0 0 2 8.5v5A1.5 1.5 0 0 0 3.5 15h9a1.5 1.5 0 0 0 1.5-1.5v-5A1.5 1.5 0 0 0 12.5 7h-1V4.5A3.5 3.5 0 0 0 8 1zm2 6H6V4.5a2 2 0 1 1 4 0V7z"/>
                      </svg>
                    </span>
                  )}
                  {bookmark.hope && (
                    <span title="HOPE Secure Login">
                      <svg className="w-3 h-3 text-blue-600 dark:text-blue-400 flex-shrink-0" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M8 0L2 3v4.5c0 3.87 2.56 7.49 6 8.5 3.44-1.01 6-4.63 6-8.5V3L8 0zm0 2.18l4 2.1V7.5c0 2.9-1.86 5.63-4 6.46-2.14-.83-4-3.56-4-6.46V4.28l4-2.1z"/>
                      </svg>
                    </span>
                  )}

                  {/* Edit/Delete/Connect buttons on hover */}
                  <div 
                    className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                    onDragOver={(e) => {
                      // CRITICAL: preventDefault() to allow drop
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                    }}
                  >
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingBookmark(bookmark);
                  }}
                      className="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 text-xs px-1.5 py-0.5 rounded hover:bg-blue-100 dark:hover:bg-blue-900/30"
                      title="Edit bookmark"
                >
                  Edit
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeletingId(bookmark.id);
                  }}
                      className="text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 text-xs px-1.5 py-0.5 rounded hover:bg-red-100 dark:hover:bg-red-900/30"
                      title="Delete bookmark"
                >
                  Delete
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleConnect(bookmark);
                  }}
                  disabled={connectingId === bookmark.id}
                      className="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 text-xs px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-900/30 disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Connect to server"
                >
                  {connectingId === bookmark.id ? 'Connecting...' : 'Connect'}
                </button>
              </div>
                </div>

                {/* Connection error message for servers */}
                {connectionErrors.has(bookmark.id) && (
                  <div className={`px-2 py-1.5 bg-red-50 dark:bg-red-900/20 border-l-2 border-red-500 flex items-center justify-between gap-2 ${
                    isEven 
                      ? 'bg-red-50 dark:bg-red-900/20' 
                      : 'bg-red-100 dark:bg-red-900/30'
                  }`}>
                    <p className="text-xs text-red-800 dark:text-red-200 font-medium flex-1">
                      {connectionErrors.get(bookmark.id)?.title}
                    </p>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => setErrorDetailId(bookmark.id)}
                        className="text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-200 text-xs font-medium"
                      >
                        Details
                      </button>
                      <button
                        onClick={() => {
                          setConnectionErrors((prev) => {
                            const next = new Map(prev);
                            next.delete(bookmark.id);
                            return next;
                          });
                        }}
                        className="text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-200 text-xs font-medium"
                        aria-label="Dismiss error"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                )}
                </>
                )}
              </SortableItem>
            )
          );
        })}
          </div>
        </SortableContext>
      </DndContext>

      {/* Mnemosyne instances */}
      {mnemosyneBookmarks.length > 0 && (
        <div className="bg-white dark:bg-gray-900">
          {mnemosyneBookmarks
            .filter((m) => !searchQuery.trim() || m.name.toLowerCase().includes(searchQuery.toLowerCase()))
            .map((mnemosyne, index) => {
              const rowIndex = filteredBookmarks.length + index;
              const isEven = rowIndex % 2 === 0;
              return (
                <div
                  key={mnemosyne.id}
                  onClick={() => {
                    addTab({
                      id: `mnemosyne-${mnemosyne.id}`,
                      type: 'mnemosyne',
                      mnemosyneId: mnemosyne.id,
                      title: mnemosyne.name,
                      unreadCount: 0,
                    });
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const items: ContextMenuItem[] = [
                      {
                        label: 'Open',
                        icon: '🔍',
                        action: () => {
                          addTab({
                            id: `mnemosyne-${mnemosyne.id}`,
                            type: 'mnemosyne',
                            mnemosyneId: mnemosyne.id,
                            title: mnemosyne.name,
                            unreadCount: 0,
                          });
                        },
                      },
                      {
                        label: 'Copy URL',
                        icon: '📋',
                        action: () => {
                          navigator.clipboard.writeText(mnemosyne.url);
                        },
                      },
                      { divider: true },
                      {
                        label: 'Delete',
                        icon: '🗑️',
                        action: () => {
                          removeMnemosyneBookmark(mnemosyne.id);
                        },
                      },
                    ];
                    showContextMenu(e, items);
                  }}
                  className={`h-[34px] px-2 flex items-center gap-1.5 group cursor-pointer ${
                    isEven
                      ? 'bg-white dark:bg-gray-900'
                      : 'bg-gray-50 dark:bg-gray-800/50'
                  } hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-colors`}
                >
                  {/* Spacer for drag handle alignment */}
                  <div className="w-[12px] flex-shrink-0"></div>

                  {/* Search icon */}
                  <div className="w-4 h-4 flex-shrink-0 flex items-center justify-center">
                    <svg className="w-4 h-4 text-purple-600 dark:text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  </div>

                  {/* Name */}
                  <span className="text-sm font-semibold text-gray-900 dark:text-white flex-1 truncate min-w-0">
                    {mnemosyne.name}
                  </span>

                  {/* URL hint */}
                  <span className="text-xs text-gray-400 dark:text-gray-500 truncate max-w-[150px] hidden sm:inline">
                    {mnemosyne.url.replace(/^https?:\/\//, '')}
                  </span>

                  {/* Delete button on hover */}
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeMnemosyneBookmark(mnemosyne.id);
                      }}
                      className="text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 text-xs px-1.5 py-0.5 rounded hover:bg-red-100 dark:hover:bg-red-900/30"
                      title="Delete"
                    >
                      Delete
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        addTab({
                          id: `mnemosyne-${mnemosyne.id}`,
                          type: 'mnemosyne',
                          mnemosyneId: mnemosyne.id,
                          title: mnemosyne.name,
                          unreadCount: 0,
                        });
                      }}
                      className="text-purple-600 hover:text-purple-700 dark:text-purple-400 dark:hover:text-purple-300 text-xs px-2 py-0.5 rounded bg-purple-50 dark:bg-purple-900/30"
                      title="Open search"
                    >
                      Open
                    </button>
                  </div>
                </div>
              );
            })}
        </div>
      )}

      {/* Info dialog */}
      {infoBookmark && (
        <BookmarkInfoDialog
          bookmark={infoBookmark}
          onClose={() => setInfoBookmark(null)}
        />
      )}

      {/* Edit dialog */}
      {editingBookmark && (
        <EditBookmarkDialog
          bookmark={editingBookmark}
          onClose={() => setEditingBookmark(null)}
        />
      )}

      {/* Add bookmark dialog */}
      {addingBookmark && (
        <EditBookmarkDialog
          bookmark={addingBookmark}
          mode="add"
          onClose={() => setAddingBookmark(null)}
        />
      )}

      {/* Error detail modal */}
      {errorDetailId && connectionErrors.has(errorDetailId) && (() => {
        const err = connectionErrors.get(errorDetailId)!;
        const bm = bookmarks.find(b => b.id === errorDetailId);
        return (
          <ErrorModal
            error={err}
            serverName={bm?.name || bm?.address || 'Unknown server'}
            onClose={() => setErrorDetailId(null)}
            onRetry={bm ? () => {
              setConnectionErrors((prev) => {
                const next = new Map(prev);
                next.delete(errorDetailId);
                return next;
              });
              setErrorDetailId(null);
              handleConnect(bm);
            } : undefined}
          />
        );
      })()}

      {/* Context menu */}
      <ContextMenuRenderer
        contextMenu={contextMenu}
        onClose={hideContextMenu}
      />

      {/* Mobile action modal for tracker servers */}
      {mobileActionServer && (
        <div
          className="fixed inset-0 bg-black/50 flex items-end justify-center z-50"
          onClick={() => setMobileActionServer(null)}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-t-xl shadow-xl w-full max-w-lg mx-0 pb-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 pt-4 pb-2">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-base font-semibold text-gray-900 dark:text-white truncate">
                  {mobileActionServer.server.name}
                </h3>
                <button
                  onClick={() => setMobileActionServer(null)}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1"
                >
                  ✕
                </button>
              </div>
              {mobileActionServer.server.description && (
                <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 mb-1">
                  {mobileActionServer.server.description}
                </p>
              )}
              <p className="text-xs text-gray-400 dark:text-gray-500">
                {mobileActionServer.server.address}:{mobileActionServer.server.port}
                {mobileActionServer.server.users > 0 && ` · ${mobileActionServer.server.users} user${mobileActionServer.server.users !== 1 ? 's' : ''}`}
              </p>
            </div>
            <div className="px-4 pt-2 space-y-1">
              <button
                onClick={() => {
                  handleConnectToTrackerServer(mobileActionServer.trackerId, mobileActionServer.server);
                  setMobileActionServer(null);
                }}
                disabled={!!connectingId}
                className="w-full text-left px-4 py-3 text-sm font-medium text-blue-600 dark:text-blue-400 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 disabled:opacity-50"
              >
                Connect to Server
              </button>
              <button
                onClick={() => {
                  handleAddTrackerServerToBookmarks(mobileActionServer.trackerId, mobileActionServer.server);
                  setMobileActionServer(null);
                }}
                className="w-full text-left px-4 py-3 text-sm font-medium text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                Add to Bookmarks
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation dialog */}
      {deletingId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-sm mx-4">
            <div className="px-6 py-4">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                Delete Bookmark
              </h2>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Are you sure you want to delete this bookmark? This action cannot be undone.
              </p>
            </div>
            <div className="flex gap-3 px-6 py-4 bg-gray-50 dark:bg-gray-900/50 rounded-b-lg">
              <button
                onClick={() => setDeletingId(null)}
                className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deletingId)}
                className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-md transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
