import { version as buildVersion } from '../../../src-tauri/tauri.conf.json';
import { useState, useEffect } from 'react';
import { getVersion } from '@tauri-apps/api/app';

interface AboutViewProps {
  onClose: () => void;
}

export default function AboutView({ onClose }: AboutViewProps) {
  const [version, setVersion] = useState<string>(buildVersion);

  useEffect(() => {
    getVersion().then(setVersion).catch(() => {
      setVersion(buildVersion);
    });
  }, []);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-md">
        {/* Header */}
        <div className="bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4 flex items-center justify-between rounded-t-lg">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
            About Hotline Navigator
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
          {/* Logo/Icon */}
          <div className="flex justify-center">
            <img
              src="/app-icon.png"
              alt="Hotline Navigator"
              className="w-20 h-20 rounded-lg object-contain"
              onError={(e) => {
                // Fallback to placeholder if image fails to load
                console.error('Failed to load app icon:', e);
                const target = e.target as HTMLImageElement;
                target.style.display = 'none';
                if (target.nextElementSibling) {
                  (target.nextElementSibling as HTMLElement).style.display = 'flex';
                }
              }}
              onLoad={() => {
                console.log('App icon loaded successfully');
              }}
            />
            <div className="w-20 h-20 hidden items-center justify-center bg-blue-600 rounded-lg">
              <span className="text-3xl font-bold text-white">H</span>
            </div>
          </div>

          {/* App Name */}
          <div className="text-center">
            <h3 className="text-2xl font-bold text-gray-900 dark:text-white">
              Hotline Navigator
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Version {version}
            </p>
          </div>

          {/* Description */}
          <div className="text-center text-gray-600 dark:text-gray-400 text-sm">
            <p>
              A multi-platform port of Hotline, using Tauri, designed for a single pane interface.
            </p>
          </div>

          {/* Credits */}
          <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
            <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
              Credits
            </h4>
            <div className="text-xs text-gray-600 dark:text-gray-400 space-y-2">
              <p>
                <strong>Author:</strong>{' '}
                <a
                  href="https://greggant.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 dark:text-blue-400 hover:underline"
                >
                  Greg Gant
                </a>
              </p>
              <p>
                Built with <span className="font-mono">Tauri</span>, <span className="font-mono">React</span>, and <span className="font-mono">TypeScript</span>
              </p>
              <p>
                Protocol implementation based on the Hotline protocol specification
              </p>
              <div className="pt-2 space-y-1 min-[700px]:space-y-0 min-[700px]:flex min-[700px]:items-center min-[700px]:justify-between">
                <p className="min-[700px]:text-left">
                  <a
                    href="https://github.com/fuzzywalrus/hotline"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    GitHub: fuzzywalrus/hotline
                  </a>
                </p>
                <p className="text-gray-500 dark:text-gray-500 min-[700px]:text-right">
                  Forked from{' '}
                  <a
                    href="https://github.com/mierau/hotline"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    mierau/hotline
                  </a>
                </p>
              </div>
            </div>
          </div>

          {/* Copyright */}
          <div className="text-center text-xs text-gray-500 dark:text-gray-500 pt-2 border-t border-gray-200 dark:border-gray-700">
            <p>© 2026 Greg Gant</p>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 dark:border-gray-700 px-6 py-4 flex justify-end rounded-b-lg">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md font-medium"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
