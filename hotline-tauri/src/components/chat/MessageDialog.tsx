import type { ChatMessageMedia } from '../server/serverTypes';
import { useChatAttachment, type UploadedMedia } from './useChatAttachment';
import AttachmentControls from './AttachmentControls';
import MediaImage from './MediaImage';
import { useState, useEffect, useRef } from 'react';
import MarkdownText from '../common/MarkdownText';

interface Message {
  media?: ChatMessageMedia;
  text: string;
  isOutgoing: boolean;
  timestamp: Date;
}

interface MessageDialogProps {
  serverId: string;
  userId: number;
  userName: string;
  messages: Message[];
  onSendMessage: (userId: number, message: string, media?: UploadedMedia | null) => Promise<void>;
  onClose: () => void;
}

export default function MessageDialog({ serverId, userId, userName, messages, onSendMessage, onClose }: MessageDialogProps) {
  const attachment = useChatAttachment(serverId, userName);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [visible, setVisible] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const handleClose = () => {
    setVisible(false);
    setTimeout(onClose, 300);
  };

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendCurrentMessage = async () => {
    if ((!input.trim() && !attachment.staged) || sending || attachment.uploading) return;

    const messageText = input.trim();
    setSending(true);

    try {
      if (await attachment.send((media) => onSendMessage(userId, messageText || '[image]', media))) setInput('');
    } catch (error) {
      console.error('Failed to send private message:', error);
      // Error will be handled by useServerHandlers
    } finally {
      setSending(false);
    }
  };

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    void sendCurrentMessage();
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Keep quick-send behavior: Enter sends, Shift+Enter inserts a newline.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendCurrentMessage();
    }
  };

  // Auto-grow composer up to 3 lines, then keep content scrollable.
  useEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;

    textarea.style.height = 'auto';
    const lineHeight = Number.parseFloat(window.getComputedStyle(textarea).lineHeight) || 24;
    const maxHeight = lineHeight * 3;
    const nextHeight = Math.min(textarea.scrollHeight, maxHeight);

    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [input]);

  return (
    <div
      onClick={handleClose}
      className={`fixed inset-0 flex items-center justify-center z-50 transition-all duration-300 ease-in-out ${
        visible ? 'bg-black/60 backdrop-blur-sm' : 'bg-black/0 backdrop-blur-none'
      }`}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`bg-white dark:bg-gray-900 rounded-lg shadow-xl w-[500px] min-h-[400px] h-[70vh] max-h-[90vh] flex flex-col transition-all duration-300 ease-in-out ${
          visible ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-95 translate-y-2'
        }`}
      >
        {/* Header */}
        <div className="bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-3 flex items-center justify-between rounded-t-lg">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Message {userName}
          </h2>
          <button
            onClick={handleClose}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            ✕
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.length === 0 ? (
            <div className="text-center text-gray-500 dark:text-gray-400 py-8">
              No messages yet. Start a conversation!
            </div>
          ) : (
            messages.map((msg, index) => {
              // Create unique key from timestamp, content, and index
              const uniqueKey = `${msg.timestamp.getTime()}-${msg.isOutgoing ? 'out' : 'in'}-${msg.text.substring(0, 20)}-${index}`;
              return (
              <div
                key={uniqueKey}
                className={`flex ${msg.isOutgoing ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[70%] rounded-lg px-4 py-2 ${
                    msg.isOutgoing
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white'
                  }`}
                >
                  <div className="text-sm font-sans whitespace-pre-wrap break-words">
                    <MarkdownText text={msg.text} />
                    {msg.media && <MediaImage serverId={serverId} media={msg.media} />}
                  </div>
                </div>
              </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <form onSubmit={handleSend} className="border-t border-gray-200 dark:border-gray-700 p-4">
          <AttachmentControls attachment={attachment} />
          <div className="flex gap-2">
            <textarea
              ref={inputRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleInputKeyDown}
              onPaste={attachment.handlePaste}
              placeholder={`Message ${userName}...`}
              disabled={sending}
              className="flex-1 px-3 py-2 leading-6 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 resize-none"
            />
            <button
              type="submit"
              disabled={(!input.trim() && !attachment.staged) || sending || attachment.uploading}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-md font-medium disabled:cursor-not-allowed"
            >
              {sending ? 'Sending...' : 'Send'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
