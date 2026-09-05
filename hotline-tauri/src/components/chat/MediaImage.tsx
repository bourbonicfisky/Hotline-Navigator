import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { ChatMessageMedia } from '../server/serverTypes';

interface MediaImageProps {
  serverId: string;
  media: ChatMessageMedia;
  /// Called with the resolved blob URL once bytes are loaded so the parent
  /// can update its message state. Optional — for messages that don't need
  /// state lifted (e.g. own optimistic echo with bytes already in hand).
  onLoaded?: (bytesUrl: string) => void;
  onFailed?: (reason: string) => void;
  /// Cap on display width in CSS pixels; intrinsic dimensions still scale
  /// proportionally below this.
  maxDisplayWidth?: number;
}

interface DownloadedMedia {
  bytesBase64: string;
  mime: string;
  width: number;
  height: number;
}

function base64ToBlob(b64: string, mime: string): Blob {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function metaLine(media: ChatMessageMedia): string {
  const parts: string[] = [media.mime];
  if (media.byteSize > 0) parts.push(formatBytes(media.byteSize));
  if (media.width > 0 && media.height > 0) parts.push(`${media.width}×${media.height}`);
  if (media.filename) parts.push(media.filename);
  return parts.join(' · ');
}

export default function MediaImage({
  serverId,
  media,
  onLoaded,
  onFailed,
  maxDisplayWidth = 480,
}: MediaImageProps) {
  const [state, setState] = useState(media.state);
  const [bytesUrl, setBytesUrl] = useState(media.bytesUrl);
  const [failureReason, setFailureReason] = useState(media.failureReason);
  const [dimensions, setDimensions] = useState({ width: media.width, height: media.height });
  const callbacks = useRef({ onLoaded, onFailed });
  callbacks.current = { onLoaded, onFailed };
  useEffect(() => {
    let cancelled = false;
    let ownedUrl: string | undefined;
    setBytesUrl(media.bytesUrl);
    setState(media.state);
    setFailureReason(media.failureReason);
    setDimensions({ width: media.width, height: media.height });
    if (media.state === 'failed' || (media.state === 'loaded' && media.bytesUrl)) return;
    setState('loading');
    invoke<DownloadedMedia>('download_media', { serverId, handle: media.handle })
      .then((result) => {
        if (cancelled) return;
        ownedUrl = URL.createObjectURL(base64ToBlob(result.bytesBase64, result.mime));
        setBytesUrl(ownedUrl);
        setDimensions({ width: result.width, height: result.height });
        setState('loaded');
        callbacks.current.onLoaded?.(ownedUrl);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const reason = String(err);
        setFailureReason(reason);
        setState('failed');
        callbacks.current.onFailed?.(reason);
      });
    return () => {
      cancelled = true;
      if (ownedUrl) URL.revokeObjectURL(ownedUrl);
    };
  }, [serverId, media.handle, media.state, media.bytesUrl, media.failureReason, media.width, media.height]);

  // Compute display dimensions: cap width, scale height proportionally.
  const aspect = dimensions.width > 0 && dimensions.height > 0 ? dimensions.height / dimensions.width : 0.5625;
  const displayWidth = Math.min(dimensions.width || maxDisplayWidth, maxDisplayWidth);
  const displayHeight = Math.min(480, Math.round(displayWidth * aspect));

  if (state === 'loaded' && bytesUrl) {
    return (
      <div className="mt-1 inline-block max-w-full">
        <img
          src={bytesUrl}
          onError={() => { setState('failed'); setFailureReason('Image could not be decoded'); }}
          alt={media.filename ?? media.mime}
          className="rounded-md border border-gray-200 dark:border-gray-700 max-w-full h-auto"
          style={{ maxWidth: `${displayWidth}px` }}
        />
        <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
          {metaLine(media)}
        </div>
      </div>
    );
  }

  if (state === 'failed') {
    return (
      <div
        className="mt-1 inline-flex items-center gap-2 px-3 py-2 border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 rounded-md text-xs"
        style={{ maxWidth: `${displayWidth}px` }}
      >
        <svg className="w-4 h-4 text-red-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <div className="flex-1">
          <div className="text-red-700 dark:text-red-400 font-medium">Image could not be loaded</div>
          <div className="text-gray-500 dark:text-gray-400">[image: {metaLine(media)}]</div>
          {failureReason && <div className="text-gray-400 dark:text-gray-500">{failureReason}</div>}
        </div>
      </div>
    );
  }

  // placeholder + loading: skeleton at server-supplied dimensions
  return (
    <div className="mt-1 inline-block">
      <div
        className="rounded-md bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 flex items-center justify-center animate-pulse"
        style={{ width: `${displayWidth}px`, height: `${displayHeight}px`, maxWidth: '100%' }}
      >
        <svg
          className="w-8 h-8 text-gray-300 dark:text-gray-600"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
          />
        </svg>
      </div>
      <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
        [image: {metaLine(media)}]
      </div>
    </div>
  );
}
