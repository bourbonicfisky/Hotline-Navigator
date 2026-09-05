import { it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import LinkPreview from './LinkPreview';
it('never inserts an unvalidated metadata image URL into the WebView', async () => {
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === 'fetch_link_preview') return { url: 'https://public.test', title: 'Test', image: 'http://127.0.0.1/private' };
    throw new Error('Private address blocked');
  });
  const { container } = render(<LinkPreview url="https://public.test" />);
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('fetch_external_image', { url: 'http://127.0.0.1/private' }));
  expect(container.querySelector('img')).toBeNull();
});
