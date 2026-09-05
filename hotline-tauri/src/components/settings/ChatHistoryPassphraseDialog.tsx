import { useState, useEffect } from 'react';

interface ChatHistoryPassphraseDialogProps {
  mode: 'create' | 'unlock';
  purpose?: 'history' | 'passwords';
  onSubmit: (passphrase: string) => Promise<boolean>;
  onCancel: () => void;
}

export default function ChatHistoryPassphraseDialog({ mode, onSubmit, onCancel, purpose = 'history' }: ChatHistoryPassphraseDialogProps) {
  const [visible, setVisible] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const handleClose = () => {
    setVisible(false);
    setTimeout(onCancel, 300);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError(null);

    if (!passphrase) {
      setError('Passphrase is required.');
      return;
    }

    if (mode === 'create') {
      if (passphrase.length < (purpose === 'passwords' ? 12 : 4)) {
        setError(`Passphrase must be at least ${purpose === 'passwords' ? 12 : 4} characters.`);
        return;
      }
      if (passphrase !== confirm) {
        setError('Passphrases do not match.');
        return;
      }
    }

    setSubmitting(true);
    const success = await onSubmit(passphrase);
    setSubmitting(false);

    if (!success) {
      setError(mode === 'unlock'
        ? 'Could not unlock saved data. Check your passphrase and try again.'
        : 'Could not protect saved data. Check available disk space and try again.');
    }
  };

  return (
    <div
      onClick={submitting ? undefined : handleClose}
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
            {purpose === 'passwords' ? (mode === 'create' ? 'Protect Saved Passwords' : 'Unlock Saved Passwords') : (mode === 'create' ? 'Set Chat History Passphrase' : 'Unlock Chat History')}
          </h2>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
          {mode === 'create' && (
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {purpose === 'passwords' ? 'Your saved server passwords will be encrypted on this device.' : 'Chat history stores the last 1,000 messages per server in an encrypted vault on your device.'}
              Choose a passphrase to protect this data — you'll need it each time you open the app.
              <span className="font-medium text-amber-600 dark:text-amber-400"> If you forget your passphrase, {purpose === 'passwords' ? 'saved passwords cannot be recovered.' : 'stored history cannot be recovered.'}</span>
            </p>
          )}

          {mode === 'unlock' && (
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {purpose === 'passwords' ? 'Enter your passphrase to use saved server passwords this session.' : 'Enter your passphrase to unlock your encrypted chat history, or skip to continue without it this session.'}
            </p>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Passphrase
            </label>
            <input
              type="password"
              autoFocus
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Enter passphrase"
            />
          </div>

          {mode === 'create' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Confirm Passphrase
              </label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Confirm passphrase"
              />
            </div>
          )}

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={submitting ? undefined : handleClose}
              className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              {mode === 'unlock' && purpose === 'history' ? 'Skip' : 'Cancel'}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-md transition-colors"
            >
              {submitting ? 'Working...' : mode === 'create' ? 'Enable' : 'Unlock'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
