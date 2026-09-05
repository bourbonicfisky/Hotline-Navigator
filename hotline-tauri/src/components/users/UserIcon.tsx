import { useState, useEffect } from 'react';
import { useAvatarStore } from '../../stores/avatarStore';
import { usePreferencesStore } from '../../stores/preferencesStore';
import { isIconBlocked } from '../../utils/iconBlocklist';

interface UserIconProps {
  serverId?: string;
  userId?: number;
  iconId: number;
  size?: number;
  className?: string;
}

export default function UserIcon({ iconId, serverId, userId, size = 16, className = '' }: UserIconProps) {
  const avatar = useAvatarStore(state => serverId && userId !== undefined ? state.icons[serverId]?.[userId] : undefined);
  const [avatarError, setAvatarError] = useState(false);
  useEffect(() => { setAvatarError(false); setLocalError(false); setRemoteError(false); setIsBanner(false); }, [iconId, avatar]);
  const [localError, setLocalError] = useState(false);
  const [remoteError, setRemoteError] = useState(false);
  const [isBanner, setIsBanner] = useState(false);
  const useRemoteIcons = usePreferencesStore((s) => s.useRemoteIcons);

  if (isIconBlocked(iconId)) {
    return (
      <div
        className={`inline-flex items-center justify-center ${className}`}
        style={{ width: size, height: size, fontSize: `${size}px`, lineHeight: 1 }}
        title={`Blocked icon ${iconId}`}
      >
        <span role="img" aria-label="blocked">&#x1F921;</span>
      </div>
    );
  }

  if (avatar && !avatarError) return <img src={avatar} alt="Custom avatar" width={size} height={size}
    className={`object-contain ${className}`} style={{ width: size, height: size }} onError={() => setAvatarError(true)} />;

  const localPath = `/icons/classic/${iconId}.png`;
  const remotePath = `https://hlwiki.com/ik0ns/${iconId}.png`;

  const showRemote = localError && useRemoteIcons && !remoteError && !isBanner;
  const showFallback = localError && (!useRemoteIcons || remoteError || isBanner);

  if (showFallback) {
    // Banner images are handled by UserBanner — show a generic user icon here
    if (isBanner) {
      return (
        <div
          className={`inline-flex items-center justify-center text-gray-400 dark:text-gray-500 ${className}`}
          style={{ width: size, height: size }}
          title={`Icon ${iconId}`}
        >
          <svg viewBox="0 0 24 24" fill="currentColor" width={size} height={size}>
            <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z" />
          </svg>
        </div>
      );
    }
    return (
      <div
        className={`inline-flex items-center justify-center bg-gray-300 dark:bg-gray-600 rounded text-xs ${className}`}
        style={{ width: size, height: size, fontSize: `${Math.max(8, size * 0.5)}px` }}
        title={`Icon ${iconId}`}
      >
        {iconId}
      </div>
    );
  }

  // Remote images: render at 1x natural size, clipped to container (no scaling)
  // Local images: scale to fit with pixelated rendering
  return (
    <div
      className={`inline-flex items-center justify-center overflow-hidden ${className}`}
      style={{ width: size, height: size }}
    >
      <img
        src={showRemote ? remotePath : localPath}
        alt={`Icon ${iconId}`}
        className={showRemote ? "max-w-none max-h-none" : "w-full h-full object-contain"}
        style={showRemote ? { imageRendering: 'auto' } : { imageRendering: 'pixelated' }}
        onLoad={(e) => {
          // Detect banner images (much wider than tall) — these look blank when
          // clipped into a small icon box, so fall back to the numeric ID and let
          // UserBanner handle the full-width display.
          if (showRemote) {
            const img = e.currentTarget;
            if (img.naturalWidth > img.naturalHeight * 4) {
              setIsBanner(true);
            }
          }
        }}
        onError={() => {
          if (!localError) setLocalError(true);
          else setRemoteError(true);
        }}
      />
    </div>
  );
}

/**
 * Renders a remote banner as a row background.
 * Known banner sizes: 232x18 (2242), 267x18 (575), 260x18 (32),
 * 300x19 (24), 427x16 (12), 486x18 (9), 220x19 (8), 300x18 (4).
 * Only shows when the local icon is missing and remote icons are enabled.
 */
export function UserBanner({ iconId }: { iconId: number }) {
  const [localExists, setLocalExists] = useState(true);
  const [remoteError, setRemoteError] = useState(false);
  const useRemoteIcons = usePreferencesStore((s) => s.useRemoteIcons);
  const showRemoteBanners = usePreferencesStore((s) => s.showRemoteBanners);

  const remotePath = `https://hlwiki.com/ik0ns/${iconId}.png`;

  // Probe local icon existence via a hidden img
  if (localExists) {
    return (
      <img
        src={`/icons/classic/${iconId}.png`}
        alt=""
        className="hidden"
        onLoad={() => setLocalExists(true)}
        onError={() => setLocalExists(false)}
      />
    );
  }

  if (!useRemoteIcons || !showRemoteBanners || remoteError) return null;

  return (
    <img
      src={remotePath}
      alt=""
      className="absolute left-0 top-0 h-full w-auto max-w-none opacity-80 pointer-events-none"
      style={{ imageRendering: 'auto' }}
      onError={() => setRemoteError(true)}
    />
  );
}
