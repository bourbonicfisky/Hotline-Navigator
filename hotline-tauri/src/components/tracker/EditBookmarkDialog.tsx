import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useAppStore } from '../../stores/appStore';
import type { Bookmark } from '../../types';
import { savePassword, deletePassword } from '../../utils/passwordVault';

interface EditBookmarkDialogProps {
  bookmark: Bookmark;
  onClose: () => void;
  mode?: 'edit' | 'add';
  onSave?: (bookmark: Bookmark) => void;
}

export default function EditBookmarkDialog({ bookmark, onClose, mode = 'edit', onSave }: EditBookmarkDialogProps) {
  const { updateBookmark, addBookmark } = useAppStore();
  const [visible, setVisible] = useState(false);
  const [removePassword, setRemovePassword] = useState(false);
  const [formData, setFormData] = useState({
    name: bookmark.name,
    address: bookmark.address,
    port: bookmark.port.toString(),
    login: bookmark.login || 'guest',
    password: bookmark.password || '',
    tls: bookmark.tls || false,
    hope: bookmark.hope || false,
    autoConnect: bookmark.autoConnect || false,
  });

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const handleClose = () => {
    setVisible(false);
    setTimeout(onClose, 300);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const hasNewPassword = !removePassword && !!formData.password;
    const finalBookmark: Bookmark = {
      ...bookmark,
      name: formData.name || `${formData.address}:${formData.port}`,
      address: formData.address,
      port: parseInt(formData.port),
      login: formData.login,
      password: undefined, // Never pass plaintext password to save_bookmark
      hasPassword: hasNewPassword || bookmark.hasPassword,
      tls: formData.tls,
      hope: formData.hope,
      autoConnect: formData.autoConnect,
      type: bookmark.type,
    };

    try {
      // Store password in secure vault
      if (hasNewPassword) {
        await savePassword(bookmark.id, formData.password);
      } else if (removePassword && bookmark.hasPassword) {
        // Only an explicit removal deletes a stored credential.
        await deletePassword(bookmark.id);
        finalBookmark.hasPassword = false;
      }
      await invoke('save_bookmark', { bookmark: finalBookmark });
      if (mode === 'add') {
        addBookmark(finalBookmark);
        onSave?.(finalBookmark);
      } else {
        updateBookmark(bookmark.id, finalBookmark);
      }
      handleClose();
    } catch (error) {
      console.error(`Failed to ${mode} bookmark:`, error);
    }
  };

  const isAdd = mode === 'add';

  return (
    <div
      onClick={handleClose}
      className={`fixed inset-0 flex items-center justify-center z-50 transition-all duration-300 ease-in-out ${
        visible ? 'bg-black/60 backdrop-blur-sm' : 'bg-black/0 backdrop-blur-none'
      }`}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md mx-4 transition-all duration-300 ease-in-out ${
          visible ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-95 translate-y-2'
        }`}
      >
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            {isAdd ? 'Add Bookmark' : 'Edit Bookmark'}
          </h2>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Server Name
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="My Server"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Address *
            </label>
            <input
              type="text"
              required
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="server.example.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Port
            </label>
            <input
              type="number"
              value={formData.port}
              onChange={(e) => setFormData({ ...formData, port: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {bookmark.type !== 'tracker' && (
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id={`${mode}-tls`}
                checked={formData.tls}
                onChange={(e) => {
                  const newTls = e.target.checked;
                  const newPort = newTls && formData.port === '5500' ? '5600'
                    : !newTls && formData.port === '5600' ? '5500'
                    : formData.port;
                  setFormData({ ...formData, tls: newTls, port: newPort });
                }}
                className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              />
              <label htmlFor={`${mode}-tls`} className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Use TLS (Secure Connection)
              </label>
            </div>
          )}

          {bookmark.type !== 'tracker' && (
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id={`${mode}-hope`}
                checked={formData.hope}
                onChange={(e) => setFormData({ ...formData, hope: e.target.checked })}
                className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              />
              <label htmlFor={`${mode}-hope`} className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Use HOPE (Secure Login)
              </label>
            </div>
          )}

          {bookmark.type !== 'tracker' && (
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id={`${mode}-autoconnect`}
                checked={formData.autoConnect}
                onChange={(e) => setFormData({ ...formData, autoConnect: e.target.checked })}
                className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              />
              <label htmlFor={`${mode}-autoconnect`} className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Connect on launch
              </label>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Login
            </label>
            <input
              type="text"
              value={formData.login}
              onChange={(e) => setFormData({ ...formData, login: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Password
            </label>
            <input
              type="password"
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder={bookmark.hasPassword ? 'Stored securely — leave empty to keep' : 'Optional'}
            />
            {bookmark.hasPassword && <label className="mt-2 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={removePassword} onChange={(e) => setRemovePassword(e.target.checked)} />
              Remove saved password
            </label>}
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={handleClose}
              className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors"
            >
              {isAdd ? 'Add Bookmark' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
