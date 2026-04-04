'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Minus, X, Maximize2 } from 'lucide-react';
import ChatPanel from '@/components/ChatPanel';
import { useChatManager } from './ChatManagerProvider';
import type { ChatInstance } from './types';

interface ChatWindowProps {
  chat: ChatInstance;
  agents: any[];
}

export default function ChatWindow({ chat, agents }: ChatWindowProps) {
  const router = useRouter();
  const { minimized, unreadCounts, currentUserId, toggleMinimize, closeChat, clearUnread, openChats } = useChatManager();
  const key = chat.isGemma ? '__gemma__' : chat.channelId;
  const isMinimized = minimized.has(key);
  const unread = unreadCounts.get(key) || 0;
  const [channelId, setChannelId] = useState(chat.channelId);

  const handleExpand = () => {
    if (isMinimized) {
      toggleMinimize(key);
      clearUnread(key);
    }
  };

  const handleMinimize = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isMinimized) toggleMinimize(key);
  };

  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation();
    closeChat(key);
  };

  const handleFullscreen = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (channelId) {
      router.push(`/comms?channel=${channelId}`);
    } else {
      router.push('/comms');
    }
  };

  const nameMap = useCallback((type: string, id: string) => {
    if (type === 'AGENT') {
      const agent = agents.find((a: any) => a.id === id);
      return { name: agent?.name || 'Agent', avatar: agent?.avatar || null };
    }
    if (id === currentUserId) return { name: 'You' };
    return { name: 'User' };
  }, [agents, currentUserId]);

  // Minimized state — compact bubble bar
  if (isMinimized) {
    return (
      <button
        onClick={handleExpand}
        className="flex items-center gap-2 px-3 py-2 bg-[var(--card)] border border-[var(--border)] rounded-xl shadow-lg hover:bg-[var(--hover)] transition-all cursor-pointer min-w-[180px] max-w-[220px]"
      >
        <div className="relative shrink-0">
          {chat.avatar ? (
            <img src={chat.avatar} alt={chat.name} className="w-8 h-8 rounded-full object-cover" />
          ) : (
            <div className="w-8 h-8 rounded-full bg-[var(--accent)]/20 flex items-center justify-center text-xs font-bold">
              {chat.name[0]}
            </div>
          )}
          {unread > 0 && (
            <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full text-[10px] text-white flex items-center justify-center font-bold animate-pulse">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </div>
        <span className="text-sm font-medium truncate flex-1 text-left">{chat.name}</span>
        {!chat.isGemma && (
          <X
            size={14}
            className="shrink-0 text-[var(--muted)] hover:text-white"
            onClick={handleClose}
          />
        )}
      </button>
    );
  }

  // Expanded state — full chat window
  return (
    <div className="w-[380px] h-[480px] bg-[var(--card)] border border-[var(--border)] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border)] bg-[var(--bg)] shrink-0">
        {chat.avatar ? (
          <img src={chat.avatar} alt={chat.name} className="w-7 h-7 rounded-full object-cover shrink-0" />
        ) : (
          <div className="w-7 h-7 rounded-full bg-[var(--accent)]/20 flex items-center justify-center text-xs font-bold shrink-0">
            {chat.name[0]}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm leading-tight truncate">{chat.name}</div>
          <div className="text-[10px] text-[var(--muted)]">
            {chat.isGemma ? 'System Director' : chat.peerType === 'agent' ? 'Agent' : 'Team member'}
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          <button onClick={handleFullscreen} className="text-[var(--muted)] hover:text-white transition p-1.5 rounded hover:bg-[var(--hover)]" title="Open fullscreen">
            <Maximize2 size={14} />
          </button>
          <button onClick={handleMinimize} className="text-[var(--muted)] hover:text-white transition p-1.5 rounded hover:bg-[var(--hover)]" title="Minimize">
            <Minus size={14} />
          </button>
          {!chat.isGemma && (
            <button onClick={handleClose} className="text-[var(--muted)] hover:text-white transition p-1.5 rounded hover:bg-[var(--hover)]" title="Close">
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Chat body */}
      <div className="flex-1 overflow-hidden">
        <ChatPanel
          channelId={channelId || ''}
          currentUserId={currentUserId}
          nameMap={nameMap}
          autoCreateChannel={!channelId ? { targetType: chat.peerType === 'agent' ? 'AGENT' : 'HUMAN', targetId: chat.peerId } : undefined}
          onChannelCreated={(id) => setChannelId(id)}
          placeholder={`Message ${chat.name}...`}
          height="100%"
          emptyState={
            <div className="text-center text-[var(--muted)] py-12 px-4">
              {chat.avatar ? (
                <img src={chat.avatar} alt={chat.name} className="w-16 h-16 rounded-full object-cover mx-auto mb-3" />
              ) : (
                <div className="w-16 h-16 rounded-full bg-[var(--accent)]/20 flex items-center justify-center text-2xl font-bold mx-auto mb-3">
                  {chat.name[0]}
                </div>
              )}
              <p className="text-sm font-medium">
                {chat.isGemma ? `Hi! I'm ${chat.name}` : chat.name}
              </p>
              <p className="text-xs mt-1">
                {chat.isGemma
                  ? 'Your AGEMS System Director. Ask me anything about the platform, your agents, or get help.'
                  : `Start a conversation with ${chat.name}`}
              </p>
            </div>
          }
        />
      </div>
    </div>
  );
}
