// Bookmark credentials use a user-provided passphrase, retained only by the
// unlocked Stronghold instance for this session. The legacy key is migration-only.
import { Stronghold } from '@tauri-apps/plugin-stronghold';
import { appDataDir } from '@tauri-apps/api/path';
import { invoke } from '@tauri-apps/api/core';
import { create } from 'zustand';
import type { Bookmark } from '../types';

interface VaultPrompt {
  mode: 'create' | 'unlock' | null;
  submit: (passphrase: string) => Promise<boolean>;
  cancel: () => void;
}
export const usePasswordVaultPrompt = create<VaultPrompt>(() => ({
  mode: null, submit: async () => false, cancel: () => {},
}));
let instance: Stronghold | null = null;
let initPromise: Promise<Stronghold> | null = null;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function passwordStore(sh: Stronghold, createClient = false) {
  if (createClient) return (await sh.createClient('passwords')).getStore();
  return (await sh.loadClient('passwords')).getStore();
}

async function initialize(): Promise<Stronghold> {
  const dir = await appDataDir();
  const status = await invoke<{ protectedExists: boolean; legacyExists: boolean }>('bookmark_vault_status');
  return new Promise((resolve, reject) => {
    usePasswordVaultPrompt.setState({
      mode: status.protectedExists ? 'unlock' : 'create',
      cancel: () => {
        usePasswordVaultPrompt.setState({ mode: null });
        reject(new Error('Saved passwords remain locked.'));
      },
      submit: async (passphrase) => {
        let sh: Stronghold | null = null;
        try {
          sh = await Stronghold.load(`${dir}/bookmark-passwords-v2.hold`, passphrase);
          const store = await passwordStore(sh, !status.protectedExists);
          if (status.legacyExists) {
            const old = await Stronghold.load(`${dir}/bookmark-passwords.hold`, 'hotline-navigator-passwords-v1');
            try {
              const oldStore = await passwordStore(old);
              const bookmarks = await invoke<Bookmark[]>('get_bookmarks');
              for (const bookmark of bookmarks) {
                const bytes = await oldStore.get(bookmark.id);
                if (bytes && !(await store.get(bookmark.id))) {
                  await store.insert(bookmark.id, Array.from(bytes));
                }
              }
            } finally { await old.unload(); }
          }
          await sh.save();
          status.protectedExists = true;
          // Only remove the legacy copy after the protected snapshot is durable.
          if (status.legacyExists) await invoke('finish_bookmark_vault_migration');
          instance = sh;
          usePasswordVaultPrompt.setState({ mode: null });
          resolve(sh);
          return true;
        } catch {
          if (sh) await sh.unload().catch(() => {});
          usePasswordVaultPrompt.setState({ mode: status.protectedExists ? 'unlock' : 'create' });
          return false;
        }
      },
    });
  });
}
async function getStronghold(): Promise<Stronghold> {
  if (instance) return instance;
  if (!initPromise) initPromise = initialize().finally(() => { initPromise = null; });
  return initPromise;
}
export async function savePassword(bookmarkId: string, password: string): Promise<void> {
  const sh = await getStronghold();
  await (await passwordStore(sh)).insert(bookmarkId, Array.from(encoder.encode(password)));
  await sh.save();
}
export async function getPassword(bookmarkId: string): Promise<string | null> {
  const sh = await getStronghold();
  const data = await (await passwordStore(sh)).get(bookmarkId);
  return data ? decoder.decode(data) : null;
}
export async function deletePassword(bookmarkId: string): Promise<void> {
  const sh = await getStronghold();
  await (await passwordStore(sh)).remove(bookmarkId);
  await sh.save();
}
