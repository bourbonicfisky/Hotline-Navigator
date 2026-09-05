import { useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

export default function GifAvatarControls({ serverId }: { serverId: string }) {
  const picker = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const send = async (file?: File) => {
    setBusy(true); setMessage(null);
    try {
      if (file && file.size > 32768) throw new Error('Choose a GIF no larger than 32 KiB.');
      const bytes = file ? Array.from(new Uint8Array(await file.arrayBuffer())) : [];
      await invoke('set_gif_icon', { serverId, bytes });
      setMessage(file ? 'Avatar updated for this connection.' : 'Custom avatar cleared.');
    } catch (error) { setMessage(String(error)); }
    finally { setBusy(false); }
  };
  return <div className="px-2 mb-2 text-xs">
    <input ref={picker} type="file" accept="image/gif,.gif" className="hidden" aria-label="Choose custom GIF avatar"
      onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void send(file); }} />
    <div className="flex gap-2">
      <button disabled={busy} onClick={() => picker.current?.click()} className="text-blue-600 dark:text-blue-400 disabled:opacity-50">Set Avatar</button>
      <button disabled={busy} onClick={() => void send()} className="text-gray-500 disabled:opacity-50">Clear Avatar</button>
    </div>
    {message && <p role="status" className="mt-1 break-words">{message}</p>}
  </div>;
}
