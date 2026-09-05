import { beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { Stronghold } from '@tauri-apps/plugin-stronghold';
vi.mock('@tauri-apps/api/path', () => ({ appDataDir: async () => '/test' }));
vi.mock('@tauri-apps/plugin-stronghold', () => ({ Stronghold: { load: vi.fn() } }));
beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); });
function setup(legacy = true) {
  const values = new Map<string, Uint8Array>();
  const store = {
    get: vi.fn(async (key: string) => values.get(key) ?? null),
    insert: vi.fn(async (key: string, bytes: number[]) => { values.set(key, new Uint8Array(bytes)); }),
    remove: vi.fn(async (key: string) => { values.delete(key); }),
  };
  const sh = {
    createClient: vi.fn(async () => ({ getStore: () => store })),
    loadClient: vi.fn(async () => ({ getStore: () => store })),
    save: vi.fn().mockResolvedValue(undefined), unload: vi.fn().mockResolvedValue(undefined),
  };
  const old = { loadClient: vi.fn(async () => ({ getStore: () => ({ get: async () => new TextEncoder().encode('old-secret') }) })), unload: vi.fn().mockResolvedValue(undefined) };
  vi.mocked(Stronghold.load).mockImplementation(async (path) => (path.endsWith('-v2.hold') ? sh : old) as unknown as Stronghold);
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === 'bookmark_vault_status') return { protectedExists: false, legacyExists: legacy };
    if (command === 'get_bookmarks') return [{ id: 'bookmark' }];
    if (command === 'finish_bookmark_vault_migration') {
      expect(sh.save).toHaveBeenCalled();
      expect(new TextDecoder().decode(values.get('bookmark'))).toBe('old-secret');
    }
    return undefined;
  });
  return { sh, values };
}
async function waitForPrompt(vault: typeof import('./passwordVault')) {
  await vi.waitFor(() => expect(vault.usePasswordVaultPrompt.getState().mode).not.toBeNull());
}
it('migrates credentials before deleting the old vault and shares concurrent unlocks', async () => {
  setup();
  const vault = await import('./passwordVault');
  const first = vault.getPassword('bookmark');
  const second = vault.getPassword('bookmark');
  await waitForPrompt(vault);
  expect(await vault.usePasswordVaultPrompt.getState().submit('a unique test passphrase')).toBe(true);
  expect(await first).toBe('old-secret');
  expect(await second).toBe('old-secret');
  expect(Stronghold.load).toHaveBeenCalledWith('/test/bookmark-passwords-v2.hold', 'a unique test passphrase');
  expect(invoke).toHaveBeenCalledWith('finish_bookmark_vault_migration');
});
it('preserves the legacy snapshot when saving the protected copy fails', async () => {
  const { sh } = setup();
  sh.save.mockRejectedValueOnce(new Error('Disk full'));
  const vault = await import('./passwordVault');
  const pending = vault.getPassword('bookmark');
  const rejected = expect(pending).rejects.toThrow('remain locked');
  await waitForPrompt(vault);
  expect(await vault.usePasswordVaultPrompt.getState().submit('a unique test passphrase')).toBe(false);
  expect(invoke).not.toHaveBeenCalledWith('finish_bookmark_vault_migration');
  expect(sh.unload).toHaveBeenCalled();
  vault.usePasswordVaultPrompt.getState().cancel();
  await rejected;
});
it('allows a fresh unlock attempt after cancellation', async () => {
  setup(false);
  const vault = await import('./passwordVault');
  const first = vault.getPassword('bookmark');
  const rejected = expect(first).rejects.toThrow('remain locked');
  await waitForPrompt(vault);
  vault.usePasswordVaultPrompt.getState().cancel();
  await rejected;
  const second = vault.getPassword('bookmark');
  await waitForPrompt(vault);
  expect(await vault.usePasswordVaultPrompt.getState().submit('another test passphrase')).toBe(true);
  expect(await second).toBeNull();
});
