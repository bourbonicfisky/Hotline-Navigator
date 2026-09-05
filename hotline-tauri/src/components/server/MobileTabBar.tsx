import { useState } from 'react';
import UserList from '../users/UserList';
import type { ViewTab, User } from '../server/serverTypes';

interface MobileTabBarProps {
  serverId: string;
  activeTab: ViewTab;
  onTabChange: (tab: ViewTab) => void;
  users: User[];
  onUserClick: (user: User) => void;
  onUserRightClick?: (user: User, event: React.MouseEvent) => void;
  onOpenMessageDialog: (user: User) => void;
  unreadCounts: Map<number, number>;
}

const tabs: { id: ViewTab; label: string; icon: string }[] = [
  { id: 'chat', label: 'Chat', icon: '/icons/section-chat.png' },
  { id: 'board', label: 'Board', icon: '/icons/section-board.png' },
  { id: 'news', label: 'News', icon: '/icons/section-news.png' },
  { id: 'files', label: 'Files', icon: '/icons/section-files.png' },
];

export default function MobileTabBar({
  serverId,
  activeTab,
  onTabChange,
  users,
  onUserClick,
  onUserRightClick,
  onOpenMessageDialog,
  unreadCounts,
}: MobileTabBarProps) {
  const [showUsers, setShowUsers] = useState(false);

  return (
    <div className="md:hidden">
      {/* Horizontal section tabs */}
      <div className="flex items-center bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => {
              onTabChange(tab.id);
              setShowUsers(false);
            }}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium transition-colors border-b-2 ${
              activeTab === tab.id && !showUsers
                ? 'border-blue-500 text-blue-600 dark:text-blue-400 bg-white dark:bg-gray-700'
                : showUsers && activeTab === tab.id
                  ? 'border-transparent text-gray-400 dark:text-gray-500'
                  : 'border-transparent text-gray-500 dark:text-gray-400'
            }`}
          >
            <img
              src={tab.icon}
              alt={tab.label}
              className="w-4 h-4"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
            {tab.label}
          </button>
        ))}
        {/* Users toggle */}
        <button
          onClick={() => setShowUsers(!showUsers)}
          className={`flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors border-b-2 ${
            showUsers
              ? 'border-blue-500 text-blue-600 dark:text-blue-400 bg-white dark:bg-gray-700'
              : 'border-transparent text-gray-500 dark:text-gray-400'
          }`}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
          </svg>
          {users.length > 0 && (
            <span className="text-[10px] bg-blue-500 text-white rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">
              {users.length}
            </span>
          )}
        </button>
      </div>

      {/* Users dropdown panel */}
      {showUsers && (
        <div className="border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 max-h-[40vh] overflow-y-auto">
          <UserList
          serverId={serverId}
            users={users}
            onUserClick={(user) => {
              onUserClick(user);
              setShowUsers(false);
            }}
            onUserRightClick={onUserRightClick}
            onOpenMessageDialog={onOpenMessageDialog}
            unreadCounts={unreadCounts}
          />
        </div>
      )}
    </div>
  );
}
