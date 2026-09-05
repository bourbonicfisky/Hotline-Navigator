import { useChatAttachment, type UploadedMedia } from './useChatAttachment';
import AttachmentControls from './AttachmentControls';
import MediaImage from './MediaImage';
import { useRef, useEffect, useState } from 'react';
import MarkdownText from '../common/MarkdownText';
import { usePreferencesStore } from '../../stores/preferencesStore';
import { getDisplayColor } from '../../utils/displayColor';
import { useThemeBackground } from '../../hooks/useThemeBackground';
import type { PrivateChatRoom } from '../server/serverTypes';

interface PrivateChatTabProps {
  serverId: string;
  room: PrivateChatRoom;
  onSendMessage: (chatId: number, message: string, media?: UploadedMedia | null) => Promise<void>;
  onLeave: (chatId: number) => void;
  onSetSubject: (chatId: number, subject: string) => void;
}

export default function PrivateChatTab({ serverId, room, onSendMessage, onLeave, onSetSubject }: PrivateChatTabProps) {
  const attachment = useChatAttachment(serverId, room.subject || 'Private chat');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isAtBottomRef = useRef(true);
  const [message, setMessage] = useState('');
  const [editingSubject, setEditingSubject] = useState(false);
  const [subjectDraft, setSubjectDraft] = useState(room.subject);
  const { clickableLinks, displayUserColors, enforceColorLegibility } = usePreferencesStore();
  const themeBg = useThemeBackground();
  const colorPrefs = { displayUserColors, enforceColorLegibility };

  useEffect(() => {
    setSubjectDraft(room.subject);
  }, [room.subject]);

  useEffect(() => {
    if (isAtBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [room.messages]);

  const handleScroll = () => {
    const container = scrollContainerRef.current;
    if (container) {
      const { scrollTop, scrollHeight, clientHeight } = container;
      isAtBottomRef.current = scrollHeight - scrollTop - clientHeight < 50;
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!message.trim() && !attachment.staged) || attachment.uploading) return;
    if (await attachment.send((media) => onSendMessage(room.chatId, message.trim() || '[image]', media))) setMessage('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend(e);
    }
  };

  const handleSubjectSubmit = () => {
    onSetSubject(room.chatId, subjectDraft);
    setEditingSubject(false);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Subject bar */}
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <span className="text-xs text-gray-500 dark:text-gray-400">Subject:</span>
        {editingSubject ? (
          <input
            className="flex-1 text-sm bg-white dark:bg-gray-700 px-2 py-1 rounded border border-gray-300 dark:border-gray-600 text-gray-800 dark:text-gray-200"
            value={subjectDraft}
            onChange={(e) => setSubjectDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSubjectSubmit();
              if (e.key === 'Escape') setEditingSubject(false);
            }}
            onBlur={handleSubjectSubmit}
            autoFocus
          />
        ) : (
          <span
            className="flex-1 text-sm text-gray-700 dark:text-gray-300 cursor-pointer hover:text-blue-600 dark:hover:text-blue-400"
            onClick={() => setEditingSubject(true)}
            title="Click to edit subject"
          >
            {room.subject || '(no subject)'}
          </span>
        )}
        {/* Mini user list */}
        <span className="text-xs text-gray-400 dark:text-gray-500">
          {room.users.length} user{room.users.length !== 1 ? 's' : ''}
        </span>
        <button
          onClick={() => onLeave(room.chatId)}
          className="text-xs text-red-500 hover:text-red-700 dark:hover:text-red-400 px-1"
          title="Leave chat"
        >
          Leave
        </button>
      </div>

      {/* Messages */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-3 space-y-1"
      >
        {room.messages.map((msg, i) => {
          const sender = room.users.find((u) => u.id === msg.userId)
            || room.users.find((u) => u.name === msg.userName);
          const userColor = getDisplayColor(sender?.color, themeBg, colorPrefs);
          return (
          <div key={i} className="text-sm">
            <span
              className={userColor ? 'font-bold' : 'font-bold text-gray-800 dark:text-gray-200'}
              style={userColor ? { color: userColor } : undefined}
            >
              {msg.userName}
            </span>
            <span className="text-gray-500 dark:text-gray-400 text-xs ml-1">
              {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
            <span className="ml-2 text-gray-700 dark:text-gray-300">
              {clickableLinks ? (
                <MarkdownText text={msg.message} />
              ) : (
                msg.message
              )}
            </span>
            {msg.media && <MediaImage serverId={serverId} media={msg.media} />}
          </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSend} className="p-2 border-t border-gray-200 dark:border-gray-700">
        <AttachmentControls attachment={attachment} />
        <div className="flex gap-2">
          <textarea
            ref={textareaRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={attachment.handlePaste}
            disabled={attachment.uploading}
            placeholder="Type a message..."
            rows={1}
            className="flex-1 resize-none px-3 py-2 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-gray-800 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <button
            type="submit"
            disabled={(!message.trim() && !attachment.staged) || attachment.uploading}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
