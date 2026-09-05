// Type definitions for ServerWindow and related components

/// Inline-media metadata carried alongside a chat message (capability bit 3).
/// `state` tracks the lifecycle of fetching the canonical bytes for display.
export type ChatMessageMediaState = 'placeholder' | 'loading' | 'loaded' | 'failed';

export interface ChatMessageMedia {
  /// Hex-encoded server-issued handle.
  handle: string;
  /// Canonical MIME (image/jpeg | image/png | image/gif).
  mime: string;
  width: number;
  height: number;
  byteSize: number;
  /// Local-side filename when known (sender side; absent on receive).
  filename?: string;
  /// Blob URL once bytes have been fetched (loaded state).
  bytesUrl?: string;
  state: ChatMessageMediaState;
  failureReason?: string;
}

export interface ChatMessage {
  userId: number;
  userName: string;
  message: string;
  timestamp: Date;
  iconId?: number;
  type?: 'message' | 'agreement' | 'server' | 'joined' | 'left' | 'signOut';
  isMention?: boolean; // Indicates if this message mentions the current user
  isAdmin?: boolean; // Indicates if the sender is an admin
  isServerHistory?: boolean; // Message from server chat replay on reconnect
  isAction?: boolean; // /me emote (from history flags bit 0)
  isDeleted?: boolean; // Tombstoned message (from history flags bit 2)
  messageId?: string; // Server-assigned history ID (string to avoid JS precision loss)
  fromHistory?: boolean; // True if loaded from server-side chat history extension
  pending?: boolean; // Optimistic local insert awaiting server echo
  optimisticKey?: string; // Identifier for matching optimistic insert with its echo
  color?: string | null; // Sender's nickname color (CSS hex), if known at receipt time
  media?: ChatMessageMedia; // Inline media metadata (capability bit 3)
}

export interface User {
  userId: number;
  userName: string;
  iconId: number;
  flags: number;
  isAdmin: boolean;
  isIdle: boolean;
  color?: string | null;
}

export interface PrivateMessage {
  media?: ChatMessageMedia;
  text: string;
  isOutgoing: boolean;
  timestamp: Date;
}

export interface FileItem {
  name: string;
  size: number;
  isFolder: boolean;
  fileType?: string;
  creator?: string;
}

export interface NewsCategory {
  type: number;
  count: number;
  name: string;
  path: string[];
}

export interface NewsArticle {
  id: number;
  parent_id: number;
  flags: number;
  title: string;
  poster: string;
  date?: string;
  path: string[];
}

export interface PrivateChatRoom {
  chatId: number;
  subject: string;
  users: { id: number; name: string; icon: number; flags: number; color?: string }[];
  messages: ChatMessage[];
}

/// JSON-safe chat message for encrypted storage (timestamps as ISO strings)
export interface StoredChatMessage {
  userId: number;
  userName: string;
  message: string;
  timestamp: string; // ISO 8601
  iconId?: number;
  isMention?: boolean;
  isAdmin?: boolean;
  type?: string; // 'joined' | 'left' etc.
  isServerHistory?: boolean;
}

export type ViewTab = 'chat' | 'board' | 'news' | 'files' | `pchat-${number}`;

