import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface LinkPreviewData {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
}

// In-memory cache so we don't re-fetch the same URL within a session
const previewCache = new Map<string, LinkPreviewData | null>();

function openUrl(url: string) {
  if ((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) {
    import('@tauri-apps/plugin-opener').then(({ openUrl }) => openUrl(url));
  } else {
    window.open(url, '_blank');
  }
}

export default function LinkPreview({ url }: { url: string }) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [preview, setPreview] = useState<LinkPreviewData | null | undefined>(
    previewCache.has(url) ? previewCache.get(url) : undefined
  );

  useEffect(() => {
    if (previewCache.has(url)) {
      setPreview(previewCache.get(url) ?? null);
      return;
    }

    let cancelled = false;
    invoke<LinkPreviewData>('fetch_link_preview', { url })
      .then((data) => {
        if (!cancelled) {
          // Only cache/show if we got meaningful data
          const hasContent = data.title || data.description || data.image;
          const result = hasContent ? data : null;
          previewCache.set(url, result);
          setPreview(result);
        }
      })
      .catch(() => {
        if (!cancelled) {
          previewCache.set(url, null);
          setPreview(null);
        }
      });

    return () => { cancelled = true; };
  }, [url]);

  useEffect(() => {
    let cancelled = false;
    let blobUrl: string | undefined;
    setImageUrl(null);
    if (preview?.image) {
      invoke<{ bytesBase64: string; mime: string }>('fetch_external_image', { url: preview.image })
        .then(({ bytesBase64, mime }) => {
          if (cancelled) return;
          const bytes = Uint8Array.from(atob(bytesBase64), c => c.charCodeAt(0));
          blobUrl = URL.createObjectURL(new Blob([bytes], { type: mime }));
          setImageUrl(blobUrl);
        }).catch(() => {});
    }
    return () => {
      cancelled = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [preview?.image]);

  // Loading or no data
  if (preview === undefined || preview === null) return null;

  return (
    <a
      href={preview.url}
      onClick={(e) => {
        e.preventDefault();
        openUrl(preview.url);
      }}
      className="block my-1.5 max-w-[400px] border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors cursor-pointer"
    >
      {imageUrl && (
        <img
          src={imageUrl}
          alt=""
          className="w-full max-h-[200px] object-cover"
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
      )}
      <div className="px-3 py-2">
        {preview.siteName && (
          <div className="text-xs text-gray-500 dark:text-gray-400 mb-0.5">
            {preview.siteName}
          </div>
        )}
        {preview.title && (
          <div className="text-sm font-semibold text-blue-600 dark:text-blue-400 leading-snug">
            {preview.title}
          </div>
        )}
        {preview.description && (
          <div className="text-xs text-gray-600 dark:text-gray-300 mt-0.5 line-clamp-2 leading-relaxed">
            {preview.description}
          </div>
        )}
      </div>
    </a>
  );
}
