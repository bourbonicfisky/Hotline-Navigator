import { getPassword } from '../../../utils/passwordVault';
import { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { usePreferencesStore } from '../../../stores/preferencesStore';
import { useAppStore } from '../../../stores/appStore';
import { showNotification } from '../../../stores/notificationStore';
import type { ConnectionStatus, Bookmark } from '../../../types';

export type ReconnectStatus = 'idle' | 'waiting' | 'connecting' | 'exhausted';

export interface ReconnectState {
  status: ReconnectStatus;
  attempt: number;
  maxAttempts: number;
  countdown: number;       // seconds remaining
  currentInterval: number; // current interval in minutes
}

interface TrackerMatch {
  trackerName: string;
  name: string;
  address: string;
  port: number;
}

interface UseAutoReconnectProps {
  serverId: string;
  serverName: string;
  connectionStatus: ConnectionStatus;
  disconnectMessage: string | null;
  setDisconnectMessage: (msg: string | null) => void;
}

interface UseAutoReconnectReturn {
  reconnectState: ReconnectState;
  cancelReconnect: () => void;
  retryNow: () => void;
  searchTrackers: () => Promise<void>;
  trackerResults: TrackerMatch[] | null;
  clearTrackerResults: () => void;
  searchingTrackers: boolean;
}

const MAX_SLIDING_INTERVAL_MINUTES = 720; // 12 hours

function calculateInterval(base: number, attempt: number, sliding: boolean): number {
  if (!sliding) return base;
  return Math.min(base * Math.pow(2, attempt), MAX_SLIDING_INTERVAL_MINUTES);
}

export function useAutoReconnect({
  serverId,
  serverName,
  connectionStatus,
  disconnectMessage,
  setDisconnectMessage,
}: UseAutoReconnectProps): UseAutoReconnectReturn {
  const [reconnectState, setReconnectState] = useState<ReconnectState>({
    status: 'idle',
    attempt: 0,
    maxAttempts: 0,
    countdown: 0,
    currentInterval: 0,
  });
  const [trackerResults, setTrackerResults] = useState<TrackerMatch[] | null>(null);
  const [searchingTrackers, setSearchingTrackers] = useState(false);

  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);
  const reconnectingRef = useRef(false); // prevent duplicate triggers

  // Read preferences
  const {
    autoReconnect,
    autoReconnectInterval,
    autoReconnectMaxRetries,
    autoReconnectSliding,
    username,
    userIconId,
    autoDetectTls,
    allowLegacyTls,
  } = usePreferencesStore();

  const clearCountdown = useCallback(() => {
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
  }, []);

  const cancelReconnect = useCallback(() => {
    clearCountdown();
    reconnectingRef.current = false;
    setReconnectState({
      status: 'idle',
      attempt: 0,
      maxAttempts: 0,
      countdown: 0,
      currentInterval: 0,
    });
  }, [clearCountdown]);

  // Look up the bookmark for this server
  const findBookmark = useCallback((): Bookmark | null => {
    const info = useAppStore.getState().serverInfo.get(serverId);
    if (!info) return null;
    const bookmarks = useAppStore.getState().bookmarks;
    return bookmarks.find(b => b.address === info.address) || null;
  }, [serverId]);

  const attemptReconnect = useCallback(async () => {
    if (!mountedRef.current) return;

    setReconnectState(prev => ({ ...prev, status: 'connecting' }));

    // Clean up old client (may fail if already cleaned, that's fine)
    try {
      await invoke('disconnect_from_server', { serverId });
    } catch { /* ignore */ }

    if (!mountedRef.current) return;

    const bookmark = findBookmark();
    if (!bookmark) {
      setReconnectState(prev => ({ ...prev, status: 'exhausted' }));
      return;
    }

    try {
      await invoke('connect_to_server', {
        bookmark,
        username,
        userIconId,
        autoDetectTls,
        allowLegacyTls,
      });

      if (!mountedRef.current) return;

      // Success — events will update connectionStatus via listeners
      reconnectingRef.current = false;
      setDisconnectMessage(null);
      setTrackerResults(null);
      setReconnectState({
        status: 'idle',
        attempt: 0,
        maxAttempts: 0,
        countdown: 0,
        currentInterval: 0,
      });
    } catch {
      if (!mountedRef.current) return;

      setReconnectState(prev => {
        const nextAttempt = prev.attempt + 1;
        if (nextAttempt >= prev.maxAttempts) {
          reconnectingRef.current = false;
          return { ...prev, status: 'exhausted', attempt: nextAttempt, countdown: 0 };
        }
        const nextInterval = calculateInterval(autoReconnectInterval, nextAttempt, autoReconnectSliding);
        return {
          ...prev,
          status: 'waiting',
          attempt: nextAttempt,
          countdown: nextInterval * 60,
          currentInterval: nextInterval,
        };
      });
    }
  }, [serverId, findBookmark, username, userIconId, autoDetectTls, allowLegacyTls, autoReconnectInterval, autoReconnectSliding, setDisconnectMessage]);

  // Start countdown when in 'waiting' state
  useEffect(() => {
    if (reconnectState.status !== 'waiting' || reconnectState.countdown <= 0) return;

    countdownRef.current = setInterval(() => {
      setReconnectState(prev => {
        if (prev.countdown <= 1) {
          return { ...prev, countdown: 0 };
        }
        return { ...prev, countdown: prev.countdown - 1 };
      });
    }, 1000);

    return () => clearCountdown();
  }, [reconnectState.status, reconnectState.attempt, clearCountdown]);

  // Trigger reconnect when countdown reaches 0
  useEffect(() => {
    if (reconnectState.status === 'waiting' && reconnectState.countdown === 0) {
      attemptReconnect();
    }
  }, [reconnectState.status, reconnectState.countdown, attemptReconnect]);

  // Detect disconnect and start reconnect cycle
  useEffect(() => {
    if (
      connectionStatus === 'disconnected' &&
      disconnectMessage &&
      autoReconnect &&
      !reconnectingRef.current
    ) {
      reconnectingRef.current = true;
      const interval = calculateInterval(autoReconnectInterval, 0, autoReconnectSliding);
      setReconnectState({
        status: 'waiting',
        attempt: 0,
        maxAttempts: autoReconnectMaxRetries,
        countdown: interval * 60,
        currentInterval: interval,
      });
    }
  }, [connectionStatus, disconnectMessage, autoReconnect, autoReconnectInterval, autoReconnectMaxRetries, autoReconnectSliding]);

  // If connection succeeds externally (e.g., status changes to logged-in), reset
  useEffect(() => {
    if (connectionStatus === 'logged-in' && reconnectingRef.current) {
      cancelReconnect();
    }
  }, [connectionStatus, cancelReconnect]);

  // Retry now (skip countdown)
  const retryNow = useCallback(() => {
    clearCountdown();
    attemptReconnect();
  }, [clearCountdown, attemptReconnect]);

  // Search trackers for the server name
  const searchTrackers = useCallback(async () => {
    setSearchingTrackers(true);
    setTrackerResults(null);

    const trackers = useAppStore.getState().trackers;
    if (trackers.length === 0) {
      setSearchingTrackers(false);
      showNotification.warning('No trackers configured. Add trackers in the Tracker tab.', 'No Trackers');
      return;
    }

    const bookmark = findBookmark();
    const searchName = serverName.toLowerCase();
    const currentAddress = bookmark?.address || '';
    const matches: TrackerMatch[] = [];

    const results = await Promise.allSettled(
      trackers.map(async (tracker) => {
        const savedTracker = useAppStore.getState().bookmarks.find(b => b.id === tracker.id);
        const servers = await invoke<{ address: string; port: number; users: number; name: string | null; description: string | null }[]>(
          'fetch_tracker_servers',
          { address: tracker.address, port: tracker.port || undefined, tls: savedTracker?.tls ?? false, login: savedTracker?.login || 'guest', password: savedTracker?.hasPassword ? await getPassword(tracker.id) : (savedTracker?.password || null) },
        );
        return { trackerName: tracker.name, servers };
      })
    );

    for (const result of results) {
      if (result.status !== 'fulfilled') continue;
      const { trackerName, servers } = result.value;
      for (const server of servers) {
        if (!server.name) continue;
        if (server.name.toLowerCase().includes(searchName) && server.address !== currentAddress) {
          matches.push({
            trackerName,
            name: server.name,
            address: server.address,
            port: server.port,
          });
        }
      }
    }

    if (!mountedRef.current) return;

    setTrackerResults(matches);
    setSearchingTrackers(false);

    if (matches.length > 0) {
      showNotification.info(
        `Found ${matches.length} possible match${matches.length > 1 ? 'es' : ''} with a different address for "${serverName}".`,
        'Server May Have Moved',
        undefined,
        serverName,
      );
    } else {
      showNotification.info(
        `No matches found for "${serverName}" on configured trackers.`,
        'Tracker Search',
        undefined,
        serverName,
      );
    }
  }, [serverName, findBookmark]);

  // Cleanup on unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearCountdown();
    };
  }, [clearCountdown]);

  const clearTrackerResults = useCallback(() => setTrackerResults(null), []);

  return {
    reconnectState,
    cancelReconnect,
    retryNow,
    searchTrackers,
    trackerResults,
    clearTrackerResults,
    searchingTrackers,
  };
}
