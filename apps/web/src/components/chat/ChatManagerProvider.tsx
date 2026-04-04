'use client';

import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { api } from '@/lib/api';
import { getCommsSocket } from '@/lib/socket';
import type { ChatInstance, ChatManagerContextValue } from './types';

const ChatManagerContext = createContext<ChatManagerContextValue | null>(null);

export function useChatManager() {
  const ctx = useContext(ChatManagerContext);
  if (!ctx) throw new Error('useChatManager must be used within ChatManagerProvider');
  return ctx;
}

const MAX_OPEN_CHATS = 5;

export default function ChatManagerProvider({ children }: { children: React.ReactNode }) {
  const [openChats, setOpenChats] = useState<ChatInstance[]>([]);
  const [minimized, setMinimized] = useState<Set<string>>(new Set());
  const [unreadCounts, setUnreadCounts] = useState<Map<string, number>>(new Map());
  const [currentUserId, setCurrentUserId] = useState('');
  const initRef = useRef(false);

  // Refs for stable socket listener (no stale closures)
  const agentsRef = useRef<any[]>([]);
  const usersRef = useRef<any[]>([]);
  const openChatsRef = useRef<ChatInstance[]>([]);
  const minimizedRef = useRef<Set<string>>(new Set());
  const currentUserIdRef = useRef('');

  // Keep refs in sync
  useEffect(() => { openChatsRef.current = openChats; }, [openChats]);
  useEffect(() => { minimizedRef.current = minimized; }, [minimized]);

  // Get current user ID from JWT
  useEffect(() => {
    try {
      const token = localStorage.getItem('token');
      if (token) {
        const payload = JSON.parse(atob(token.split('.')[1]));
        const uid = payload.sub || payload.id || '';
        setCurrentUserId(uid);
        currentUserIdRef.current = uid;
      }
    } catch {}
  }, []);

  // Load agents and org members for resolving names
  useEffect(() => {
    api.getAgents().then((res: any) => {
      const arr = Array.isArray(res) ? res : res?.data || [];
      agentsRef.current = arr;
    }).catch(() => {});

    api.getOrgMembers?.().then((res: any) => {
      const arr = Array.isArray(res) ? res : res?.data || [];
      usersRef.current = arr;
    }).catch(() => {});
  }, []);

  // Initialize Gemma chat
  useEffect(() => {
    if (initRef.current) return;

    // Wait for agents to load
    const tryInit = () => {
      const agents = agentsRef.current;
      if (agents.length === 0) return false;

      initRef.current = true;
      const meta = agents.find((a: any) => a.type === 'META' && a.status === 'ACTIVE')
        || agents.find((a: any) => a.name?.toLowerCase().includes('gemma'));

      if (meta) {
        const gemmaChat: ChatInstance = {
          channelId: '',
          name: meta.name || 'Gemma',
          avatar: meta.avatar || null,
          peerType: 'agent',
          peerId: meta.id,
          isGemma: true,
        };

        api.findDirectChannel('AGENT', meta.id).then((found: any) => {
          if (found?.id) gemmaChat.channelId = found.id;
          setOpenChats([gemmaChat]);
          setMinimized(new Set(['__gemma__']));
        }).catch(() => {
          setOpenChats([gemmaChat]);
          setMinimized(new Set(['__gemma__']));
        });
      }
      return true;
    };

    if (!tryInit()) {
      // Retry until agents are loaded
      const interval = setInterval(() => {
        if (tryInit()) clearInterval(interval);
      }, 500);
      return () => clearInterval(interval);
    }
  }, []);

  // Connect socket and listen for ALL incoming messages — single stable listener
  useEffect(() => {
    const socket = getCommsSocket();
    if (!socket.connected) socket.connect();

    const handleNotification = async (data: { channelId: string; message: any }) => {
      const { channelId, message } = data;
      const userId = currentUserIdRef.current;

      // Skip own messages (only if userId is known)
      if (userId && message.senderType === 'HUMAN' && message.senderId === userId) return;

      // Skip SYSTEM messages
      if (message.senderType === 'SYSTEM') return;

      const chats = openChatsRef.current;
      const mins = minimizedRef.current;

      // Check if this is the Gemma chat
      const gemmaChat = chats.find(c => c.isGemma);
      if (gemmaChat && gemmaChat.channelId === channelId) {
        if (mins.has('__gemma__')) {
          setUnreadCounts(m => new Map(m).set('__gemma__', (m.get('__gemma__') || 0) + 1));
        }
        return;
      }

      // Check if chat is already open
      const existing = chats.find(c => c.channelId === channelId);
      if (existing) {
        const key = existing.isGemma ? '__gemma__' : existing.channelId;
        if (mins.has(key)) {
          setUnreadCounts(m => new Map(m).set(key, (m.get(key) || 0) + 1));
        }
        return;
      }

      // New incoming chat — the message sender IS the peer (they wrote to us)
      const senderId = message.senderId;
      const senderType = message.senderType;
      let peerName = 'Chat';
      let peerAvatar: string | null = null;
      let peerType: 'agent' | 'human' = 'agent';

      if (senderType === 'AGENT') {
        const agent = agentsRef.current.find((a: any) => a.id === senderId);
        peerName = agent?.name || senderId;
        peerAvatar = agent?.avatar || null;
        peerType = 'agent';
      } else if (senderType === 'HUMAN') {
        const member = usersRef.current.find(
          (u: any) => u.id === senderId || u.user?.id === senderId
        );
        peerName = member?.user?.name || member?.name || senderId;
        peerAvatar = member?.user?.avatarUrl || member?.avatarUrl || null;
        peerType = 'human';
      } else {
        // SYSTEM messages — skip
        return;
      }

      const peer: ChatInstance = {
        channelId,
        name: peerName,
        avatar: peerAvatar,
        peerType,
        peerId: senderId,
        isGemma: false,
      };

      // Add chat — minimized with unread badge
      setOpenChats(prev => {
        // Double-check not already added (race condition)
        if (prev.find(c => c.channelId === channelId)) return prev;

        let updated = [...prev, peer];
        if (updated.length > MAX_OPEN_CHATS) {
          const toRemove = updated.find(c => !c.isGemma && minimizedRef.current.has(c.channelId));
          if (toRemove) updated = updated.filter(c => c !== toRemove);
        }
        return updated;
      });
      setMinimized(s => new Set(s).add(channelId));
      setUnreadCounts(m => new Map(m).set(channelId, 1));
    };

    socket.on('new_message_notification', handleNotification);

    // Also handle reconnect
    const handleConnect = () => {
      // Server auto-joins user room in handleConnection, nothing needed client-side
    };
    socket.on('connect', handleConnect);

    return () => {
      socket.off('new_message_notification', handleNotification);
      socket.off('connect', handleConnect);
    };
  }, []); // Empty deps — stable listener using refs

  const chatKey = useCallback((chat: ChatInstance) => {
    return chat.isGemma ? '__gemma__' : chat.channelId;
  }, []);

  const openChat = useCallback((chat: ChatInstance) => {
    setOpenChats(prev => {
      const existing = prev.find(c => c.channelId === chat.channelId || (!c.channelId && c.peerId === chat.peerId));
      if (existing) {
        setMinimized(s => {
          const next = new Set(s);
          next.delete(existing.isGemma ? '__gemma__' : existing.channelId);
          return next;
        });
        return prev;
      }

      let updated = [...prev, chat];
      if (updated.length > MAX_OPEN_CHATS) {
        const toRemove = updated.find(c => !c.isGemma && minimizedRef.current.has(c.channelId));
        if (toRemove) updated = updated.filter(c => c !== toRemove);
      }
      return updated;
    });
  }, []);

  const closeChat = useCallback((channelId: string) => {
    setOpenChats(prev => prev.filter(c => {
      if (c.isGemma) return true;
      return (c.isGemma ? '__gemma__' : c.channelId) !== channelId;
    }));
    setMinimized(s => { const next = new Set(s); next.delete(channelId); return next; });
    setUnreadCounts(m => { const next = new Map(m); next.delete(channelId); return next; });
  }, []);

  const toggleMinimize = useCallback((key: string) => {
    setMinimized(s => {
      const next = new Set(s);
      if (next.has(key)) {
        next.delete(key);
        setUnreadCounts(m => { const nm = new Map(m); nm.delete(key); return nm; });
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const clearUnread = useCallback((key: string) => {
    setUnreadCounts(m => { const next = new Map(m); next.delete(key); return next; });
  }, []);

  return (
    <ChatManagerContext.Provider value={{
      openChats, minimized, unreadCounts, currentUserId,
      openChat, closeChat, toggleMinimize, clearUnread,
    }}>
      {children}
    </ChatManagerContext.Provider>
  );
}
