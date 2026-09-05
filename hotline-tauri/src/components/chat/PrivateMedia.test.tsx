import { fireTauriEvent } from '../../test/setup';
import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import MessageDialog from './MessageDialog';
import PrivateChatTab from './PrivateChatTab';
import { usePreferencesStore } from '../../stores/preferencesStore';

const uploaded = { handle: 'aabb', mime: 'image/png', width: 2, height: 2, byteSize: 100 };
const room = { chatId: 42, subject: 'Room', users: [], messages: [] };
beforeEach(() => {
  vi.clearAllMocks();
  usePreferencesStore.setState({ inlineMediaEnabled: true, imageUploadSizeKb: 256 });
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === 'get_inline_media_status') return { serverSupports: true, canSend: true };
    if (command === 'pick_image_for_chat') return { bytesBase64: 'AA==', mime: 'image/png', filename: 'test.png', byteSize: 100 };
    if (command === 'upload_media') return uploaded;
    if (command === 'download_media') return { bytesBase64: 'AA==', mime: 'image/png', width: 2, height: 2 };
  });
});
async function attach() {
  await waitFor(() => expect(screen.getByTitle('Attach image')).toBeEnabled());
  fireEvent.click(screen.getByTitle('Attach image'));
  await screen.findByText('test.png');
}
it('private message retry keeps the caption and uploaded handle', async () => {
  const send = vi.fn().mockRejectedValueOnce(new Error('Network unavailable')).mockResolvedValue(undefined);
  render(<MessageDialog serverId="server" userId={7} userName="Alice" messages={[]} onSendMessage={send} onClose={() => {}} />);
  await attach();
  fireEvent.change(screen.getByPlaceholderText('Message Alice...'), { target: { value: 'caption' } });
  fireEvent.click(screen.getByText('Send', { selector: 'button' }));
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.getByText('Send', { selector: 'button' })).toBeEnabled());
  expect(screen.getByPlaceholderText('Message Alice...')).toHaveValue('caption');
  expect(screen.getByText('test.png')).toBeInTheDocument();
  fireEvent.click(screen.getByText('Send', { selector: 'button' }));
  await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
  expect(send).toHaveBeenLastCalledWith(7, 'caption', uploaded);
  expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === 'upload_media')).toHaveLength(1);
  await waitFor(() => expect(screen.getByPlaceholderText('Message Alice...')).toHaveValue(''));
});
it('private rooms can send an attachment without a caption', async () => {
  const send = vi.fn().mockResolvedValue(undefined);
  render(<PrivateChatTab serverId="server" room={room} onSendMessage={send} onLeave={() => {}} onSetSubject={() => {}} />);
  await attach();
  fireEvent.click(screen.getByText('Send', { selector: 'button' }));
  await waitFor(() => expect(send).toHaveBeenCalledWith(42, '[image]', uploaded));
});
it('both private views fetch received media', async () => {
  const media = { ...uploaded, state: 'placeholder' as const };
  render(<>
    <MessageDialog serverId="server" userId={7} userName="Alice" messages={[{ text: '[image]', isOutgoing: false, timestamp: new Date(), media }]} onSendMessage={async () => {}} onClose={() => {}} />
    <PrivateChatTab serverId="server" room={{ ...room, messages: [{ userId: 7, userName: 'Alice', message: '[image]', timestamp: new Date(), media }] }} onSendMessage={async () => {}} onLeave={() => {}} onSetSubject={() => {}} />
  </>);
  await waitFor(() => expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === 'download_media')).toHaveLength(2));
});
it('rejects attachments over the advertised server byte limit before uploading', async () => {
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === 'get_inline_media_status') return { serverSupports: true, canSend: true, limits: { maxBytes: 32 } };
    if (command === 'pick_image_for_chat') return { bytesBase64: 'AA==', mime: 'image/png', filename: 'large.png', byteSize: 100 };
  });
  render(<PrivateChatTab serverId="server" room={room} onSendMessage={async () => {}} onLeave={() => {}} onSetSubject={() => {}} />);
  await waitFor(() => expect(screen.getByTitle('Attach image')).toBeEnabled());
  fireEvent.click(screen.getByTitle('Attach image'));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('pick_image_for_chat'));
  expect(screen.getByText('Send', { selector: 'button' })).toBeDisabled();
  expect(screen.queryByText('large.png')).toBeNull();
  expect(vi.mocked(invoke).mock.calls.some(([command]) => command === 'upload_media')).toBe(false);
});

it('does not send an upload result from a disconnected session', async () => {
  let finishUpload!: (value: typeof uploaded) => void;
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === 'get_inline_media_status') return { serverSupports: true, canSend: true };
    if (command === 'pick_image_for_chat') return { bytesBase64: 'AA==', mime: 'image/png', filename: 'test.png', byteSize: 100 };
    if (command === 'upload_media') return new Promise((resolve) => { finishUpload = resolve; });
  });
  const send = vi.fn().mockResolvedValue(undefined);
  render(<PrivateChatTab serverId="server" room={room} onSendMessage={send} onLeave={() => {}} onSetSubject={() => {}} />);
  await attach();
  fireEvent.click(screen.getByText('Send', { selector: 'button' }));
  await waitFor(() => expect(finishUpload).toBeDefined());
  fireTauriEvent('status-changed-server', { status: 'disconnected' });
  finishUpload(uploaded);
  await waitFor(() => expect(screen.getByText('Send', { selector: 'button' })).toBeEnabled());
  expect(send).not.toHaveBeenCalled();
  expect(screen.getByText('test.png')).toBeInTheDocument();
});
