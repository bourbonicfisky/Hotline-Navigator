import AttachChip from './AttachChip';
import type { useChatAttachment } from './useChatAttachment';
export default function AttachmentControls({ attachment }: { attachment: ReturnType<typeof useChatAttachment> }) {
  const { staged, uploading, mediaStatus, attachEnabled, handleAttachClick, removeStaged } = attachment;
  return <div className="flex items-center gap-2 mb-2">
    {mediaStatus.serverSupports && <button type="button" disabled={!attachEnabled || uploading}
      onClick={handleAttachClick} className="text-sm text-blue-600 disabled:opacity-50"
      title={attachEnabled ? 'Attach image' : 'Image sending is unavailable'}>Attach image</button>}
    {staged && <AttachChip filename={staged.filename} mime={staged.mime} byteSize={staged.byteSize} onRemove={removeStaged} />}
  </div>;
}
