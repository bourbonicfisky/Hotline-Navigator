import { invoke } from '@tauri-apps/api/core';
import { useState, useEffect } from 'react';
import { useAppStore } from '../../stores/appStore';

interface FileInfoDialogProps {
  serverId: string;
  fileName: string;
  fileSize: number;
  fileType?: string;
  creator?: string;
  isFolder: boolean;
  path: string[];
  onClose: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const idx = Math.min(i, sizes.length - 1);
  return `${(bytes / Math.pow(k, idx)).toFixed(1)} ${sizes[idx]}`;
}

export default function FileInfoDialog({ serverId, fileName, fileSize, fileType, creator, isFolder, path, onClose }: FileInfoDialogProps) {
  const [details, setDetails] = useState<{ file_size: number; create_date: string | null; modify_date: string | null; comment: string } | null>(null);
  const [infoError, setInfoError] = useState(false);
  const pathKey = JSON.stringify(path);
  useEffect(() => {
    let active = true;
    setDetails(null);
    setInfoError(false);
    invoke<typeof details>('get_file_info', { serverId, path: JSON.parse(pathKey), fileName })
      .then((value) => { if (active) setDetails(value); })
      .catch(() => { if (active) setInfoError(true); });
    return () => { active = false; };
  }, [serverId, pathKey, fileName]);
  const [visible, setVisible] = useState(false);
  const serverInfo = useAppStore((s) => s.serverInfo.get(serverId));

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const handleClose = () => {
    setVisible(false);
    setTimeout(onClose, 300);
  };

  // Build hotline:// URL for the file
  const buildFileUrl = (): string | null => {
    if (!serverInfo) return null;
    const portPart = serverInfo.port === 5500 ? '' : `:${serverInfo.port}`;
    const filePath = [...path, fileName]
      .map((p) => encodeURIComponent(p))
      .join('/');
    return `hotline://${serverInfo.address}${portPart}/files/${filePath}`;
  };

  const fileUrl = buildFileUrl();

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const rows: { label: string; value: string }[] = [
    { label: 'Name', value: fileName },
    { label: 'Kind', value: isFolder ? 'Folder' : (fileType || 'File') },
  ];

  if (!isFolder) {
    rows.push({ label: 'Size', value: `${formatBytes(details?.file_size ?? fileSize)} (${(details?.file_size ?? fileSize).toLocaleString()} bytes)` });
  }

  if (details?.create_date) rows.push({ label: 'Created', value: details.create_date });
  if (details?.modify_date) rows.push({ label: 'Modified', value: details.modify_date });
  if (details?.comment) rows.push({ label: 'Comment', value: details.comment });
  if (infoError) rows.push({ label: 'Details', value: 'Server details unavailable' });
  if (creator) {
    rows.push({ label: 'Creator', value: creator });
  }

  if (path.length > 0) {
    rows.push({ label: 'Path', value: '/' + path.join('/') });
  }

  if (fileUrl) {
    rows.push({ label: 'URL', value: fileUrl });
  }

  return (
    <div
      onClick={handleClose}
      className={`fixed inset-0 flex items-center justify-center z-50 transition-all duration-300 ease-in-out ${
        visible ? 'bg-black/60 backdrop-blur-sm' : 'bg-black/0 backdrop-blur-none'
      }`}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-sm mx-4 transition-all duration-300 ease-in-out ${
          visible ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-95 translate-y-2'
        }`}
      >
        <div className="bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4 flex items-center justify-between rounded-t-lg">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex-shrink-0">
              {isFolder ? (
                <svg className="w-6 h-6 text-yellow-500" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M2 6a2 2 0 012-2h4l2 2h6a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                </svg>
              ) : (
                <svg className="w-6 h-6 text-gray-400 dark:text-gray-500" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
                </svg>
              )}
            </div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white truncate">
              {fileName}
            </h2>
          </div>
          <button
            onClick={handleClose}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 flex-shrink-0 ml-2"
          >
            ✕
          </button>
        </div>

        <div className="px-6 py-4 space-y-3">
          {rows.map((row) => (
            <div key={row.label} className="flex items-start gap-3">
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400 w-14 flex-shrink-0 pt-0.5 text-right">
                {row.label}
              </span>
              <span className="text-sm text-gray-900 dark:text-white break-all flex-1 select-all">
                {row.value}
              </span>
            </div>
          ))}
        </div>

        <div className="flex gap-2 px-6 py-4 bg-gray-50 dark:bg-gray-900/50 rounded-b-lg">
          {fileUrl && (
            <button
              onClick={() => copyToClipboard(fileUrl)}
              className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm font-medium transition-colors"
            >
              Copy URL
            </button>
          )}
          <button
            onClick={handleClose}
            className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-md text-sm font-medium hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
