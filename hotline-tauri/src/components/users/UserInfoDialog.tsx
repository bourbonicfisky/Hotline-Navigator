import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import UserIcon from './UserIcon';

interface User {
  userId: number;
  userName: string;
  iconId: number;
  flags: number;
  isAdmin: boolean;
  isIdle: boolean;
}

interface UserInfoDialogProps {
  user: User;
  serverId: string;
  onClose: () => void;
  onSendMessage?: (user: User) => void;
  enablePrivateMessaging?: boolean;
}

export default function UserInfoDialog({ user, serverId, onClose, onSendMessage, enablePrivateMessaging = true }: UserInfoDialogProps) {
  const [clientInfo, setClientInfo] = useState<string | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(true);

  useEffect(() => {
    let cancelled = false;
    invoke<string>('get_client_info', { serverId, userId: user.userId })
      .then((info) => {
        if (!cancelled) setClientInfo(info);
      })
      .catch(() => {
        if (!cancelled) setClientInfo(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingInfo(false);
      });
    return () => { cancelled = true; };
  }, [serverId, user.userId]);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl w-[400px] flex flex-col">
        {/* Header */}
        <div className="bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-3 flex items-center justify-between rounded-t-lg">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            User Information
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
          {/* User Icon */}
          <div className="flex justify-center">
            <UserIcon serverId={serverId} userId={user.userId} iconId={user.iconId} size={64} className="rounded-lg" />
          </div>

          {/* User Details */}
          <div className="space-y-3">
            <div>
              <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">
                Username
              </label>
              <div className="mt-1 text-gray-900 dark:text-white font-medium">
                {user.userName}
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">
                User ID
              </label>
              <div className="mt-1 text-gray-900 dark:text-white">
                {user.userId}
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">
                Icon ID
              </label>
              <div className="mt-1 text-gray-900 dark:text-white">
                {user.iconId}
              </div>
            </div>

            {/* Status Badges */}
            <div>
              <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">
                Status
              </label>
              <div className="mt-1 flex gap-2">
                {user.isAdmin && (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
                    Administrator
                  </span>
                )}
                {user.isIdle && (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200">
                    Idle
                  </span>
                )}
                {!user.isAdmin && !user.isIdle && (
                  <span className="text-gray-500 dark:text-gray-400 text-sm">
                    Active
                  </span>
                )}
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">
                Flags
              </label>
              <div className="mt-1 text-gray-600 dark:text-gray-400 font-mono text-sm">
                0x{user.flags.toString(16).padStart(4, '0').toUpperCase()}
              </div>
            </div>

            {/* Server-provided client info */}
            <div>
              <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">
                Client Info
              </label>
              <div className="mt-1">
                {loadingInfo ? (
                  <span className="text-gray-400 dark:text-gray-500 text-sm italic">Loading...</span>
                ) : clientInfo ? (
                  <pre className="text-xs font-mono text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-words bg-gray-50 dark:bg-gray-800 rounded p-2 max-h-40 overflow-y-auto">
                    {clientInfo}
                  </pre>
                ) : (
                  <span className="text-gray-400 dark:text-gray-500 text-sm italic">Not available</span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="border-t border-gray-200 dark:border-gray-700 p-4 flex gap-2 justify-end">
          {onSendMessage && enablePrivateMessaging && (
            <button
              onClick={() => {
                onSendMessage(user);
                onClose();
              }}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md font-medium"
            >
              Send Message
            </button>
          )}
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-white rounded-md font-medium"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
