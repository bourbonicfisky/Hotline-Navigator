import React, { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { usePreferencesStore } from '../../stores/preferencesStore';
import { showNotification } from '../../stores/notificationStore';
import { error as logError } from '../../utils/logger';
export interface MediaLimits {
  maxBytes: number; maxDimension: number; maxPixels: number; chunkSize: number;
  maxFrames: number; maxDurationMs: number;
}
export interface UploadedMedia {
  handle: string; mime: string; width: number; height: number; byteSize: number;
}
interface StagedImage { bytesBase64: string; mime: string; filename: string; byteSize: number; }
interface InlineMediaStatus { serverSupports: boolean; canSend: boolean; limits?: MediaLimits; }
export function useChatAttachment(serverId: string, serverName: string) {
  const { inlineMediaEnabled, imageUploadSizeKb } = usePreferencesStore();
  const uploadedRef = useRef<UploadedMedia | null>(null);
  const busyRef = useRef(false);
  const sessionRef = useRef(0);
  // ─── Inline-media state ──────────────────────────────────────────
  const [staged, setStaged] = useState<StagedImage | null>(null);
  const [uploading, setUploading] = useState(false);
  const [mediaStatus, setMediaStatus] = useState<InlineMediaStatus>({
    serverSupports: false,
    canSend: false,
  });

  // Subscribe before probing. A newer access event wins over the snapshot;
  // reconnects refresh limits and invalidate session-scoped uploaded handles.
  useEffect(() => {
    let cancelled = false;
    let revision = 0;
    sessionRef.current += 1;
    uploadedRef.current = null;
    const refresh = async () => {
      const atRevision = revision;
      const session = sessionRef.current;
      try {
        const status = await invoke<InlineMediaStatus>('get_inline_media_status', { serverId });
        if (cancelled || session !== sessionRef.current) return;
        setMediaStatus((prev) => atRevision === revision ? status : { ...prev, limits: status.limits ?? prev.limits });
      } catch {
        if (!cancelled && atRevision === revision) setMediaStatus({ serverSupports: false, canSend: false });
      }
    };
    const accessListener = listen<InlineMediaStatus>(`inline-media-status-${serverId}`, (event) => {
      if (cancelled) return;
      revision += 1;
      setMediaStatus((prev) => ({ ...prev, ...event.payload }));
    });
    const statusListener = listen<{ status: string }>(`status-changed-${serverId}`, (event) => {
      if (cancelled) return;
      if (event.payload.status === 'disconnected') {
        sessionRef.current += 1;
        revision += 1;
        uploadedRef.current = null;
        setMediaStatus({ serverSupports: false, canSend: false });
      } else if (event.payload.status === 'logged-in') {
        void refresh();
      }
    });
    Promise.all([accessListener, statusListener]).then(refresh).catch(() => {});
    return () => {
      cancelled = true;
      sessionRef.current += 1;
      accessListener.then((fn) => fn()).catch(() => {});
      statusListener.then((fn) => fn()).catch(() => {});
    };
  }, [serverId]);

  const attachEnabled = inlineMediaEnabled && mediaStatus.serverSupports && mediaStatus.canSend;
  const limitBytes = Math.min(imageUploadSizeKb * 1024, mediaStatus.limits?.maxBytes ?? 256 * 1024);

  const stageImage = (image: StagedImage) => {
    if (image.byteSize > limitBytes) {
      const sizeStr = image.byteSize > 1024 * 1024
        ? `${(image.byteSize / (1024 * 1024)).toFixed(1)} MB`
        : `${(image.byteSize / 1024).toFixed(0)} KB`;
      showNotification.warning(
        `Image is ${sizeStr}, exceeds your ${Math.floor(limitBytes / 1024)} KB attachment limit. Pick a smaller image or resize it or check the server limits.`,
        'Image too large',
        undefined,
        serverName,
      );
      return;
    }
    setStaged(image);
    uploadedRef.current = null;
  };

  const handleAttachClick = async () => {
    try {
      const picked = await invoke<StagedImage | null>('pick_image_for_chat');
      if (picked) stageImage(picked);
    } catch (err) {
      logError('Chat', 'pick_image_for_chat failed', err);
    }
  };

  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (!attachEnabled || busyRef.current) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const blob = item.getAsFile();
        if (!blob) continue;
        e.preventDefault();
        if (blob.size > limitBytes) {
          stageImage({ bytesBase64: '', mime: blob.type, filename: '', byteSize: blob.size });
          return;
        }
        const buf = await blob.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        stageImage({
          bytesBase64: btoa(binary),
          mime: blob.type || 'image/png',
          filename: '', // pasted images carry no filename
          byteSize: bytes.length,
        });
        return;
      }
    }
  };

  const removeStaged = () => { setStaged(null); uploadedRef.current = null; };

  // Retain the uploaded handle on send failure so retry doesn't upload twice.
  const send = async (callback: (media: UploadedMedia | null) => void | Promise<void>): Promise<boolean> => {
    if (busyRef.current) return false;
    busyRef.current = true;
    const session = sessionRef.current;
    setUploading(true);
    try {
      if (staged && !attachEnabled) throw new Error('Image sending is unavailable for this connection.');
      let media = uploadedRef.current;
      if (staged && !media) {
        media = await invoke<UploadedMedia>('upload_media', {
          serverId, bytesBase64: staged.bytesBase64, declaredMime: staged.mime,
        });
        if (session !== sessionRef.current) throw new Error('Connection changed; retry the attachment.');
        uploadedRef.current = media;
      }
      if (session !== sessionRef.current) throw new Error('Connection changed; retry the attachment.');
      await callback(media);
      removeStaged();
      return true;
    } catch (error) {
      showNotification.error(`Message could not be sent: ${error}`, 'Message Error', undefined, serverName);
      return false;
    } finally {
      busyRef.current = false;
      setUploading(false);
    }
  };
  return { staged, uploading, mediaStatus, attachEnabled, handleAttachClick, handlePaste, removeStaged, send };
}
