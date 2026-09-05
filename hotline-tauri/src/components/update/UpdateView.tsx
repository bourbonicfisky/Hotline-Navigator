import { version as buildVersion } from '../../../src-tauri/tauri.conf.json';
import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { openUrl } from '@tauri-apps/plugin-opener';
import MarkdownText from '../common/MarkdownText';

interface UpdateRelease {
  tag_name: string;
  display_version: string;
  version_number: number;
  build_number: number;
  notes: string;
  download_url: string;
  asset_name: string;
  published_at: string;
}

interface UpdateViewProps {
  onClose: () => void;
}

export default function UpdateView({ onClose }: UpdateViewProps) {
  const [currentVersion, setCurrentVersion] = useState<string>(buildVersion);
  const [isChecking, setIsChecking] = useState(false);
  const [update, setUpdate] = useState<UpdateRelease | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  useEffect(() => {
    getVersion().then(setCurrentVersion).catch(() => {
      setCurrentVersion(buildVersion);
    });
  }, []);

  const checkForUpdates = async () => {
    setIsChecking(true);
    setError(null);
    setUpdate(null);

    try {
      const release = await invoke<UpdateRelease | null>('check_for_updates');
      
      if (release) {
        // Compare versions - parse semantic version (e.g., "0.1.0" or "v0.1.0")
        const parseVersion = (version: string): number[] => {
          const cleaned = version.replace(/^v/, '').trim();
          return cleaned.split('.').map(part => {
            // Remove any non-numeric suffix (e.g., "0.1.0-beta" -> "0.1.0")
            const numPart = part.replace(/[^0-9].*$/, '');
            return parseInt(numPart, 10) || 0;
          });
        };
        
        const currentParts = parseVersion(currentVersion);
        const releaseParts = parseVersion(release.display_version);
        
        // Compare version parts
        let isNewer = false;
        for (let i = 0; i < Math.max(currentParts.length, releaseParts.length); i++) {
          const currentPart = currentParts[i] || 0;
          const releasePart = releaseParts[i] || 0;
          if (releasePart > currentPart) {
            isNewer = true;
            break;
          } else if (releasePart < currentPart) {
            break;
          }
        }
        
        if (isNewer) {
          setUpdate(release);
        } else {
          setError('You are already using the latest version!');
        }
      } else {
        setError('No updates available.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to check for updates');
    } finally {
      setIsChecking(false);
    }
  };

  const handleDownload = async () => {
    if (!update) return;
    
    setIsDownloading(true);
    try {
      // Open the download URL in the default browser
      await openUrl(update.download_url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open download link');
    } finally {
      setIsDownloading(false);
    }
  };

  const handleRemindLater = () => {
    // Store reminder preference (could use localStorage)
    onClose();
  };

  // Auto-check when component mounts (when user opens update window)
  useEffect(() => {
    checkForUpdates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-lg">
        {/* Header */}
        <div className="bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4 flex items-center justify-between rounded-t-lg">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
            Check for Updates
          </h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {isChecking && (
            <div className="text-center py-8">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              <p className="mt-4 text-gray-600 dark:text-gray-400">Checking for updates...</p>
            </div>
          )}

          {!isChecking && !update && !error && (
            <div className="text-center py-8">
              <p className="text-gray-600 dark:text-gray-400 mb-4">
                Click the button below to check for updates.
              </p>
              <button
                onClick={checkForUpdates}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors text-sm font-medium"
              >
                Check for Updates
              </button>
            </div>
          )}

          {error && !isChecking && (
            <div className="text-center py-8">
              <div className="text-4xl mb-4">ℹ️</div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                {error.includes('latest') ? 'Up to Date' : 'Update Check Failed'}
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">{error}</p>
              <button
                onClick={checkForUpdates}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors text-sm font-medium"
              >
                Check Again
              </button>
            </div>
          )}

          {update && !isChecking && (
            <>
              {/* Header Section */}
              <div className="flex items-center gap-4">
                <img
                  src="/app-icon.png"
                  alt="Hotline Navigator"
                  className="w-14 h-14 rounded-lg"
                  onError={(e) => {
                    const target = e.target as HTMLImageElement;
                    target.style.display = 'none';
                  }}
                />
                <div>
                  <h3 className="text-xl font-semibold text-gray-900 dark:text-white">
                    Hotline Navigator {update.display_version}
                  </h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    A new version is available! 🎉
                  </p>
                </div>
              </div>

              {/* Release Notes */}
              {update.notes && (
                <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 max-h-64 overflow-y-auto">
                  <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    Release Notes
                  </h4>
                  <div className="text-xs text-gray-600 dark:text-gray-400">
                    <MarkdownText text={update.notes} />
                  </div>
                </div>
              )}

              {/* Current Version Info */}
              <div className="text-xs text-gray-500 dark:text-gray-500 text-center">
                Current version: {currentVersion}
              </div>
            </>
          )}

          {/* Action Buttons */}
          {update && !isChecking && (
            <div className="flex gap-3 justify-end pt-4 border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={handleRemindLater}
                className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-sm font-medium"
                disabled={isDownloading}
              >
                Not Now
              </button>
              <button
                onClick={handleDownload}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                disabled={isDownloading}
              >
                {isDownloading ? (
                  <>
                    <div className="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    Opening...
                  </>
                ) : (
                  'Download'
                )}
              </button>
            </div>
          )}

          {error && !isChecking && (
            <div className="flex justify-end pt-4 border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={onClose}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors text-sm font-medium"
              >
                Close
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
