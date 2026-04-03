'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useChatManager } from './ChatManagerProvider';
import ChatWindow from './ChatWindow';

export default function ChatDock() {
  const { openChats, minimized, toggleMinimize } = useChatManager();
  const [agents, setAgents] = useState<any[]>([]);

  useEffect(() => {
    api.getAgents().then((res: any) => {
      setAgents(Array.isArray(res) ? res : res?.data || []);
    }).catch(() => {});
  }, []);

  if (openChats.length === 0) return null;

  // Gemma always last in array = rightmost in flex-row-reverse
  const gemma = openChats.find(c => c.isGemma);
  const others = openChats.filter(c => !c.isGemma);

  // On mobile: show only one expanded chat at a time
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

  if (isMobile) {
    // Find first non-minimized chat, or show Gemma bubble
    const activeChat = [...others, gemma].find(c => c && !minimized.has(c.isGemma ? '__gemma__' : c.channelId));

    return (
      <div className="fixed bottom-0 left-0 right-0 z-40">
        {/* Active expanded chat — full width */}
        {activeChat && (
          <div className="mx-2 mb-16">
            <ChatWindow chat={activeChat} agents={agents} />
          </div>
        )}
        {/* Bubble bar at bottom */}
        <div className="flex items-center gap-2 p-2 bg-[var(--bg)]/80 backdrop-blur border-t border-[var(--border)]">
          {[...others, gemma].filter(Boolean).map(chat => {
            const key = chat!.isGemma ? '__gemma__' : chat!.channelId;
            const isActive = activeChat && (activeChat.isGemma ? '__gemma__' : activeChat.channelId) === key;
            return (
              <button
                key={key}
                onClick={() => toggleMinimize(key)}
                className={`relative shrink-0 ${isActive ? 'ring-2 ring-[var(--accent)]' : ''} rounded-full`}
              >
                {chat!.avatar ? (
                  <img src={chat!.avatar} alt={chat!.name} className="w-10 h-10 rounded-full object-cover" />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-[var(--accent)]/20 flex items-center justify-center text-sm font-bold">
                    {chat!.name[0]}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // Desktop: horizontal stack from right to left
  return (
    <div className="fixed bottom-6 right-24 z-40 flex flex-row-reverse items-end gap-2">
      {/* Gemma is always rightmost (first in flex-row-reverse) */}
      {gemma && <ChatWindow chat={gemma} agents={agents} />}
      {/* Other chats stack to the left */}
      {others.map(chat => (
        <ChatWindow key={chat.channelId || chat.peerId} chat={chat} agents={agents} />
      ))}
    </div>
  );
}
