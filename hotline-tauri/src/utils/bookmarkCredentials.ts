import type { Bookmark } from '../types';
import { getPassword } from './passwordVault';

// Resolve credentials only for IPC; never put the plaintext back in the store.
export async function withBookmarkPassword(bookmark: Bookmark): Promise<Bookmark> {
  const connection = { ...bookmark };
  if (connection.password === undefined && bookmark.hasPassword) {
    const password = await getPassword(bookmark.id);
    if (password === null) {
      throw new Error('Saved password was not found. Edit this bookmark to enter it again.');
    }
    connection.password = password;
  }
  return connection;
}
