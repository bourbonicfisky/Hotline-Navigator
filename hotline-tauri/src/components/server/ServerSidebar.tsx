import UserList from '../users/UserList';
import type { ViewTab, User, PrivateChatRoom } from '../server/serverTypes';

interface ServerSidebarProps {
  serverId: string;
  activeTab: ViewTab;
  onTabChange: (tab: ViewTab) => void;
  users: User[];
  onUserClick: (user: User) => void;
  onUserRightClick?: (user: User, event: React.MouseEvent) => void;
  onOpenMessageDialog: (user: User) => void;
  unreadCounts: Map<number, number>;
  privateChatRooms?: PrivateChatRoom[];
  onLeaveChat?: (chatId: number) => void;
}

export default function ServerSidebar({
  serverId,
  activeTab,
  onTabChange,
  users,
  onUserClick,
  onUserRightClick,
  onOpenMessageDialog,
  unreadCounts,
  privateChatRooms = [],
  onLeaveChat,
}: ServerSidebarProps) {
  return (
    <div className="hidden md:flex w-[200px] bg-gray-50 dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex-col">
      {/* Tab navigation */}
      <div className="flex flex-col gap-1 p-2">
        <button
          onClick={() => onTabChange('chat')}
          className={`flex items-center gap-2 px-2 py-2 rounded transition-colors ${
            activeTab === 'chat'
              ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
              : 'text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 hover:text-gray-800 dark:hover:text-gray-200'
          }`}
          title="Public Chat"
        >
          <img 
            src="/icons/section-chat.png" 
            alt="Chat" 
            className="w-5 h-5"
            onError={(e) => {
              const target = e.target as HTMLImageElement;
              target.style.display = 'none';
            }}
          />
          <span className="text-sm font-medium">Chat</span>
        </button>
        {/* Private chat rooms indented below Chat */}
        {privateChatRooms.map((room) => {
          const tabId: ViewTab = `pchat-${room.chatId}`;
          const label = room.subject || `Chat Room ${room.chatId}`;
          return (
            <div key={room.chatId} className="flex items-center pl-6">
              <button
                onClick={() => onTabChange(tabId)}
                className={`flex-1 flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${
                  activeTab === tabId
                    ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                    : 'text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 hover:text-gray-700 dark:hover:text-gray-200'
                }`}
                title={label}
              >
                <span className="truncate">{label}</span>
              </button>
              {onLeaveChat && (
                <button
                  onClick={() => onLeaveChat(room.chatId)}
                  className="text-gray-400 hover:text-red-500 dark:hover:text-red-400 px-1 text-xs"
                  title="Leave chat room"
                >
                  x
                </button>
              )}
            </div>
          );
        })}
        <button
          onClick={() => onTabChange('board')}
          className={`flex items-center gap-2 px-2 py-2 rounded transition-colors ${
            activeTab === 'board'
              ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
              : 'text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 hover:text-gray-800 dark:hover:text-gray-200'
          }`}
          title="Message Board"
        >
          <img 
            src="/icons/section-board.png" 
            alt="Board" 
            className="w-5 h-5"
            onError={(e) => {
              const target = e.target as HTMLImageElement;
              target.style.display = 'none';
            }}
          />
          <span className="text-sm font-medium">Board</span>
        </button>
        <button
          onClick={() => onTabChange('news')}
          className={`flex items-center gap-2 px-2 py-2 rounded transition-colors ${
            activeTab === 'news'
              ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
              : 'text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 hover:text-gray-800 dark:hover:text-gray-200'
          }`}
          title="News"
        >
          <img 
            src="/icons/section-news.png" 
            alt="News" 
            className="w-5 h-5"
            onError={(e) => {
              const target = e.target as HTMLImageElement;
              target.style.display = 'none';
            }}
          />
          <span className="text-sm font-medium">News</span>
        </button>
        <button
          onClick={() => onTabChange('files')}
          className={`flex items-center gap-2 px-2 py-2 rounded transition-colors ${
            activeTab === 'files'
              ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
              : 'text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 hover:text-gray-800 dark:hover:text-gray-200'
          }`}
          title="Files"
        >
          <img 
            src="/icons/section-files.png" 
            alt="Files" 
            className="w-5 h-5"
            onError={(e) => {
              const target = e.target as HTMLImageElement;
              target.style.display = 'none';
            }}
          />
          <span className="text-sm font-medium">Files</span>
        </button>
      </div>

      {/* Divider */}
      <div className="border-t border-gray-200 dark:border-gray-700 my-2" />

      {/* User list */}
      <div className="flex-1 overflow-y-auto">
        <UserList
          serverId={serverId}
          users={users}
          onUserClick={onUserClick}
          onUserRightClick={onUserRightClick}
          onOpenMessageDialog={onOpenMessageDialog}
          unreadCounts={unreadCounts}
        />
      </div>
    </div>
  );
}

