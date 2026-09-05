import type { UploadedMedia } from '../../chat/useChatAttachment';
import { invoke } from '@tauri-apps/api/core';
import { openPath } from '@tauri-apps/plugin-opener';
import type { ChatMessage, NewsArticle } from '../serverTypes';
import { useSound } from '../../../hooks/useSound';
import { usePreferencesStore } from '../../../stores/preferencesStore';
import { showNotification, useNotificationStore } from '../../../stores/notificationStore';
import { log, error as logError } from '../../../utils/logger';

interface UseServerHandlersProps {
  serverId: string;
  serverName: string;
  currentPath: string[];
  downloadFolder?: string | null;
  setMessage: React.Dispatch<React.SetStateAction<string>>;
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  setSending: React.Dispatch<React.SetStateAction<boolean>>;
  setBoardMessage: React.Dispatch<React.SetStateAction<string>>;
  setPostingBoard: React.Dispatch<React.SetStateAction<boolean>>;
  setBoardPosts: React.Dispatch<React.SetStateAction<string[]>>;
  setDownloadProgress: React.Dispatch<React.SetStateAction<Map<string, number>>>;
  setUploadProgress: React.Dispatch<React.SetStateAction<Map<string, number>>>;
  setPrivateMessageHistory: React.Dispatch<React.SetStateAction<Map<number, any[]>>>;
  setAgreementText: React.Dispatch<React.SetStateAction<string | null>>;
  setNewsPath: React.Dispatch<React.SetStateAction<string[]>>;
  setNewsLeafType: React.Dispatch<React.SetStateAction<2 | 3>>;
  setNewsArticles: React.Dispatch<React.SetStateAction<NewsArticle[]>>;
  setComposerTitle: React.Dispatch<React.SetStateAction<string>>;
  setComposerBody: React.Dispatch<React.SetStateAction<string>>;
  setShowComposer: React.Dispatch<React.SetStateAction<boolean>>;
  setPostingNews: React.Dispatch<React.SetStateAction<boolean>>;
  clearFileCachePath: (serverId: string, path: string[]) => void;
  onClose: () => void;
}

export function useServerHandlers({
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
}: UseServerHandlersProps) {
  const sounds = useSound();

  const handleSendMessage = async (
    e: React.FormEvent,
    message: string,
    sending: boolean,
    media?: { handle: string; mime: string } | null,
  ) => {
    e.preventDefault();
    if ((!message.trim() && !media) || sending) return;

    const messageText = message.trim() || (media ? '[image]' : '');

    // Optimistically insert only for commands (! and /), so the user's command
    // reliably appears before the server's broadcast response. Regular chat
    // keeps the original wait-for-echo behavior.
    const isCommand = messageText.startsWith('!') || messageText.startsWith('/');
    let optimisticKey: string | null = null;
    if (isCommand) {
      const prefs = usePreferencesStore.getState();
      const ownUsername = prefs.username;
      const ownIconId = prefs.userIconId;

      // Preformat /me and /em as the server will echo them, so dedup matches.
      let displayMessage = messageText;
      const meMatch = messageText.match(/^\/(me|em)\s+(.*)$/);
      if (meMatch) {
        displayMessage = `*** ${ownUsername} ${meMatch[2]}`;
      }

      optimisticKey = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const key = optimisticKey;
      setMessages((prev) => [
        ...prev,
        {
          userId: 0,
          userName: ownUsername,
          iconId: ownIconId,
          message: displayMessage,
          timestamp: new Date(),
          pending: true,
          optimisticKey: key,
        },
      ]);
      setMessage('');

      // Safety: clear pending after 30s if the server never echoes (e.g. dropped).
      setTimeout(() => {
        setMessages((prev) =>
          prev.map((m) => (m.optimisticKey === key ? { ...m, pending: false } : m))
        );
      }, 30000);
    }

    setSending(true);
    try {
      await invoke('send_chat_message', {
        serverId,
        message: messageText,
        media: media ?? null,
      });
      log('Chat', 'Message sent');
      if (!isCommand) setMessage('');
    } catch (err) {
      logError('Chat', 'Failed to send message', err);
      if (optimisticKey) {
        const key = optimisticKey;
        setMessages((prev) => prev.filter((m) => m.optimisticKey !== key));
        setMessage(messageText);
      }
      throw err;
    } finally {
      setSending(false);
    }
  };

  const handlePostBoard = async (e: React.FormEvent, boardMessage: string, postingBoard: boolean) => {
    e.preventDefault();
    if (!boardMessage.trim() || postingBoard) return;

    const messageText = boardMessage.trim();
    setPostingBoard(true);
    try {
      await invoke('post_message_board', {
        serverId,
        message: messageText,
      });

      const posts = await invoke<string[]>('get_message_board', {
        serverId,
      });
      setBoardPosts(posts);

      log('Board', 'Board message posted');
      setBoardMessage('');
    } catch (error) {
      logError('Board', 'Failed to post to board', error);
      showNotification.error(
        `Failed to post to board: ${error}`,
        'Post Error',
        undefined,
        serverName
      );
    } finally {
      setPostingBoard(false);
    }
  };

  const handleDownloadFile = async (fileName: string, fileSize: number, isFolder = false, sourcePath = currentPath) => {
    log('Transfer', `Download initiated: ${fileName}`, { fileSize, path: currentPath });
    try {
      setDownloadProgress((prev) => new Map(prev).set(fileName, 0));

      const result = await invoke<string>(isFolder ? 'download_folder' : 'download_file', {
        serverId,
        path: sourcePath,
        fileName,
        fileSize,
        downloadFolder: downloadFolder ?? null,
      });

      setDownloadProgress((prev) => {
        const next = new Map(prev);
        next.delete(fileName);
        return next;
      });

      // Extract file path from result string "Downloaded to: <path>"
      const filePath = result.replace(/^Downloaded to:\s*/, '').trim();

      const isIOS = typeof window !== 'undefined' && (
        /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
      );

      if (isIOS) {
        useNotificationStore.getState().addNotification({
          type: 'success',
          message: `${fileName} saved to app storage`,
          title: 'Download Complete',
          serverName,
          duration: 8000,
          action: {
            label: 'View File',
            onClick: () => {
              openPath(filePath).catch((err) =>
                logError('Files', 'Failed to open file', err)
              );
            },
          },
        });
      } else {
        showNotification.success(
          result,
          'Download Complete',
          undefined,
          serverName
        );
      }
      sounds.playFileTransferCompleteSound();
    } catch (error) {
      logError('Transfer', 'Download failed', error);
      sounds.playErrorSound();

      setDownloadProgress((prev) => {
        const next = new Map(prev);
        next.delete(fileName);
        return next;
      });

      showNotification.error(
        `Download failed: ${error}`,
        'Download Error',
        undefined,
        serverName
      );
    }
  };

  const handleUploadFile = async (file: File) => {
    log('Transfer', `Upload initiated: ${file.name}`, { size: file.size, path: currentPath });
    try {
      const fileName = file.name;
      setUploadProgress((prev) => new Map(prev).set(fileName, 0));

      const arrayBuffer = await file.arrayBuffer();
      const fileData = Array.from(new Uint8Array(arrayBuffer));

      await invoke('upload_file', {
        serverId,
        path: currentPath,
        fileName,
        fileData,
      });

      setUploadProgress((prev) => {
        const next = new Map(prev);
        next.delete(fileName);
        return next;
      });

      clearFileCachePath(serverId, currentPath);
      await invoke('get_file_list', {
        serverId,
        path: currentPath,
      });

      showNotification.success(
        `Upload complete: ${fileName}`,
        'Upload Complete',
        undefined,
        serverName
      );
      sounds.playFileTransferCompleteSound();
    } catch (error) {
      logError('Transfer', 'Upload failed', error);
      sounds.playErrorSound();

      setUploadProgress((prev) => {
        const next = new Map(prev);
        next.delete(file.name);
        return next;
      });

      showNotification.error(
        `Upload failed: ${error}`,
        'Upload Error',
        undefined,
        serverName
      );
    }
  };

  const handleSendPrivateMessage = async (userId: number, message: string, media?: UploadedMedia | null) => {
    log('Chat', 'Sending private message', { userId });
    try {
      await invoke('send_private_message', {
        serverId,
        userId,
        message,
        media: media ?? null,
      });
      log('Chat', 'Private message sent', { userId });

      setPrivateMessageHistory((prev) => {
        const newHistory = new Map(prev);
        const userMessages = newHistory.get(userId) || [];
        newHistory.set(userId, [
          ...userMessages,
          {
            text: message,
            media: media ? { ...media, state: 'placeholder' } : undefined,
            isOutgoing: true,
            timestamp: new Date(),
          },
        ]);
        return newHistory;
      });
    } catch (error) {
      logError('Chat', 'Failed to send private message', error);
      throw error;
    }
  };

  const handleAcceptAgreement = async () => {
    try {
      await invoke('accept_agreement', { serverId });
      log('Agreement', 'Agreement accepted');
      setAgreementText(null);
    } catch (error) {
      logError('Agreement', 'Failed to accept agreement', error);
      showNotification.error(
        `Failed to accept agreement: ${error}`,
        'Agreement Error',
        undefined,
        serverName
      );
    }
  };

  const handleDeclineAgreement = () => {
    setAgreementText(null);
    handleDisconnect();
  };

  const handleDisconnect = async () => {
    log('Connection', 'Disconnecting from server');
    try {
      await invoke('disconnect_from_server', { serverId });
      log('Connection', 'Disconnected from server');
      onClose();
    } catch (error) {
      logError('Connection', 'Failed to disconnect', error);
    }
  };

  const handlePostNews = async (
    e: React.FormEvent,
    newsPath: string[],
    composerTitle: string,
    composerBody: string,
    postingNews: boolean,
    parentId: number = 0,
  ) => {
    e.preventDefault();
    if (!composerTitle.trim() || !composerBody.trim() || postingNews) return;

    log('News', 'Posting news article', { path: newsPath, title: composerTitle.trim(), parentId });
    setPostingNews(true);
    try {
      await invoke('post_news_article', {
        serverId,
        path: newsPath,
        title: composerTitle.trim(),
        text: composerBody.trim(),
        parentId,
      });
      log('News', 'News article posted');

      setComposerTitle('');
      setComposerBody('');
      setShowComposer(false);

      const articles = await invoke<NewsArticle[]>('get_news_articles', {
        serverId,
        path: newsPath,
      });
      log('News', 'Articles refreshed after post', { count: articles.length });
      setNewsArticles(articles);
    } catch (error) {
      logError('News', 'Failed to post news', error);
      const errorMsg = String(error);
      if (errorMsg.includes('Access denied') || errorMsg.toLowerCase().includes('permission')) {
        showNotification.error(
          `Unable to post news article: ${error}\n\nYou may not have posting privileges on this server. Contact the server administrator to request access.`,
          'Permission Denied',
          undefined,
          serverName
        );
      } else {
        showNotification.error(
          `Failed to post news: ${error}`,
          'Post Error',
          undefined,
          serverName
        );
      }
    } finally {
      setPostingNews(false);
    }
  };

  const handleNavigateNews = (category: any) => {
    log('News', 'Navigating to category', category);
    if (category.type === 2 || category.type === 3) {
      setNewsPath(category.path);
      setNewsLeafType(category.type);
    }
  };

  const handleNewsBack = (newsPath: string[]) => {
    log('News', 'Navigating back from path', newsPath);
    if (newsPath.length > 0) {
      setNewsPath(newsPath.slice(0, -1));
      // Parent of any item is by definition a bundle (it contained children).
      setNewsLeafType(2);
    }
  };

  const handleSelectArticle = async (
    article: NewsArticle,
    setSelectedArticle: React.Dispatch<React.SetStateAction<NewsArticle | null>>,
    setArticleContent: React.Dispatch<React.SetStateAction<string>>
  ) => {
    log('News', 'Selecting article', { id: article.id, title: article.title });
    setSelectedArticle(article);
    setArticleContent('Loading...');

    try {
      const content = await invoke<string>('get_news_article_data', {
        serverId,
        articleId: article.id,
        path: article.path,
      });
      log('News', 'Article content received', { length: content.length });
      setArticleContent(content);
    } catch (error) {
      logError('News', 'Failed to get article content', error);
      setArticleContent(`Error loading article: ${error}`);
    }
  };

  return {
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
  };
}

