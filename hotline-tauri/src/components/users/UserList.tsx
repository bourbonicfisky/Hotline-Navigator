import GifAvatarControls from './GifAvatarControls';
import UserIcon, { UserBanner } from './UserIcon';
import { isIconBlocked } from '../../utils/iconBlocklist';
import { getDisplayColor } from '../../utils/displayColor';
import { useThemeBackground } from '../../hooks/useThemeBackground';
import { usePreferencesStore } from '../../stores/preferencesStore';

interface User {
  userId: number;
  userName: string;
  iconId: number;
  flags: number;
  isAdmin: boolean;
  isIdle: boolean;
  color?: string | null;
}

interface UserListProps {
  serverId: string;
  users: User[];
  unreadCounts: Map<number, number>;
  onUserClick: (user: User) => void;
  onUserRightClick?: (user: User, event: React.MouseEvent) => void;
  onOpenMessageDialog?: (user: User) => void;
}

export default function UserList({ serverId, users, unreadCounts, onUserClick, onUserRightClick }: UserListProps) {
  const themeBg = useThemeBackground();
  const displayUserColors = usePreferencesStore((s) => s.displayUserColors);
  const enforceColorLegibility = usePreferencesStore((s) => s.enforceColorLegibility);
  const colorPrefs = { displayUserColors, enforceColorLegibility };

  return (
    <div className="p-2">
      <h2 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2 px-2">
        Users ({users.length})
      </h2>
      <GifAvatarControls serverId={serverId} />
      <div className="space-y-1">
        {users.map((user) => {
          const displayColor = user.isIdle ? undefined : getDisplayColor(user.color, themeBg, colorPrefs);
          return (
          <div
            key={user.userId}
            onClick={() => onUserClick(user)}
            onContextMenu={(e) => onUserRightClick?.(user, e)}
            className={`relative flex items-center gap-2 text-sm py-1 px-2 rounded cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors overflow-hidden ${
              user.isIdle
                ? 'opacity-50 text-gray-500 dark:text-gray-500'
                : displayColor
                  ? ''
                  : 'text-gray-700 dark:text-gray-300'
            }`}
            style={displayColor ? { color: displayColor } : undefined}
            title={`Click to message${user.isAdmin ? ' (Admin)' : ''}${user.isIdle ? ' (Idle)' : ''} | Right-click for menu`}
          >
            {!isIconBlocked(user.iconId) && <UserBanner iconId={user.iconId} />}
            <UserIcon serverId={serverId} userId={user.userId} iconId={user.iconId} size={16} />
            <span className={`truncate flex-1 ${user.isIdle ? 'italic' : ''}`}>
              {user.userName}
              {isIconBlocked(user.iconId) && (
                <span className="ml-1 text-xs text-red-500 dark:text-red-400" title="This user's icon has been blocked for containing hateful imagery">
                  (blocked icon)
                </span>
              )}
            </span>
            {user.isAdmin && (
              <div className="bg-yellow-500 text-white text-xs font-bold rounded px-1" title="Admin">
                A
              </div>
            )}
            {unreadCounts.get(user.userId) ? (
              <div className="bg-red-600 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
                {unreadCounts.get(user.userId)}
              </div>
            ) : null}
          </div>
          );
        })}
      </div>
    </div>
  );
}
