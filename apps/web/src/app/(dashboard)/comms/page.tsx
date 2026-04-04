'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { Settings, Plus, ChevronDown, MessageSquare, ArrowLeft, Users, User, Bot } from 'lucide-react';
import ChatPanel, { Avatar } from '@/components/ChatPanel';

const isViewerMode = process.env.NEXT_PUBLIC_PUBLIC_MODE === 'viewer';

export default function CommsPage() {
  const isAdmin = api.getUserFromToken()?.role === 'ADMIN';
  const isReadOnly = isViewerMode && !api.getToken();
  const searchParams = useSearchParams();
  const [channels, setChannels] = useState<any[]>([]);
  const [selectedChannel, setSelectedChannel] = useState<any>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newChannelName, setNewChannelName] = useState('');
  const [newChannelType, setNewChannelType] = useState('GROUP');
  const [selectedParticipants, setSelectedParticipants] = useState<{type: string; id: string}[]>([]);
  const [agents, setAgents] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'direct' | 'group' | 'agent'>('all');
  const [agentChats, setAgentChats] = useState<any[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string>('');
  const [showEditChannel, setShowEditChannel] = useState(false);
  const [editChannelForm, setEditChannelForm] = useState({ name: '', description: '', avatar: '' });
  const [showChatHistory, setShowChatHistory] = useState(false);
  const chatHistoryRef = useRef<HTMLDivElement>(null);
  const autoSelectedRef = useRef(false);

  // Build lookup maps for names, avatars, and roles
  const nameMap = useCallback((type: string, id: string) => {
    if (type === 'AGENT') {
      const a = agents.find((a: any) => a.id === id);
      const role = a?.positions?.[0]?.title || a?.type || 'Agent';
      return { name: a?.name || 'Agent', avatar: a?.avatar || null, role };
    }
    const u = users.find((u: any) => u.id === id);
    const role = u?.role === 'ADMIN' ? 'Admin' : u?.role === 'MANAGER' ? 'Manager' : 'Employee';
    return { name: u?.name || 'User', avatar: null, role };
  }, [agents, users]);

  // For DIRECT chats, get the "other" participant info
  const getDirectInfo = useCallback((ch: any) => {
    if (ch.type !== 'DIRECT' || !ch.participants) return null;
    const other = ch.participants.find((p: any) => !(p.participantType === 'HUMAN' && p.participantId === currentUserId));
    if (!other) return ch.participants[0] ? nameMap(ch.participants[0].participantType, ch.participants[0].participantId) : null;
    return nameMap(other.participantType, other.participantId);
  }, [currentUserId, nameMap]);

  useEffect(() => {
    api.fetch('/auth/profile').then((p: any) => setCurrentUserId(p.id)).catch(() => {});
    api.getChannels().then((chs) => {
      setChannels(chs);
      const direct = searchParams.get('direct');
      if (direct && !autoSelectedRef.current) {
        autoSelectedRef.current = true;
        const [type, id] = direct.split(':');
        const match = chs.find((ch: any) =>
          ch.type === 'DIRECT' &&
          ch.participants?.some((p: any) => p.participantType === type && p.participantId === id),
        );
        if (match) {
          setSelectedChannel(match);
          // ChatPanel handles message loading internally
        }
      }
    }).finally(() => setLoading(false));
    api.getAgents({ pageSize: '100' }).then((r: any) => setAgents(r.data || []));
    api.getUsers().then((r: any) => setUsers(Array.isArray(r) ? r : []));
  }, [searchParams]);

  const selectChannel = useCallback((ch: any) => {
    setSelectedChannel(ch);
  }, []);

  const openEditChannel = () => {
    if (!selectedChannel) return;
    const meta = selectedChannel.metadata || {};
    setEditChannelForm({
      name: selectedChannel.name || '',
      description: meta.description || '',
      avatar: meta.avatar || '',
    });
    setShowEditChannel(true);
  };

  const saveEditChannel = async () => {
    if (!selectedChannel) return;
    const updated = await api.updateChannel(selectedChannel.id, {
      name: editChannelForm.name,
      metadata: {
        ...(selectedChannel.metadata || {}),
        description: editChannelForm.description,
        avatar: editChannelForm.avatar,
      },
    });
    setChannels((prev) => prev.map((c) => c.id === updated.id ? { ...c, ...(updated as Record<string, any>) } : c));
    setSelectedChannel({ ...selectedChannel, ...(updated as Record<string, any>) });
    setShowEditChannel(false);
  };

  const addParticipantToChannel = async (type: string, id: string) => {
    if (!selectedChannel) return;
    await api.addParticipant(selectedChannel.id, { participantType: type, participantId: id });
    const ch = await api.getChannel(selectedChannel.id);
    setChannels((prev) => prev.map((c) => c.id === ch.id ? { ...c, ...ch } : c));
    setSelectedChannel({ ...selectedChannel, ...ch });
  };

  const removeParticipantFromChannel = async (participantId: string) => {
    if (!selectedChannel) return;
    await api.removeParticipant(selectedChannel.id, participantId);
    const ch = await api.getChannel(selectedChannel.id);
    setChannels((prev) => prev.map((c) => c.id === ch.id ? { ...c, ...ch } : c));
    setSelectedChannel({ ...selectedChannel, ...ch });
  };

  const toggleParticipant = (type: string, id: string) => {
    setSelectedParticipants((prev) => {
      const exists = prev.some((p) => p.type === type && p.id === id);
      return exists ? prev.filter((p) => !(p.type === type && p.id === id)) : [...prev, { type, id }];
    });
  };

  const createChannel = async () => {
    if (!newChannelName.trim() || selectedParticipants.length === 0) return;
    try {
      const ch = await api.createChannel({
        name: newChannelName,
        type: newChannelType,
        participantIds: selectedParticipants,
      });
      setChannels((prev) => [ch, ...prev]);
      setShowCreateModal(false);
      setNewChannelName('');
      setSelectedParticipants([]);
    } catch (err: any) {
      alert(err.message || 'Failed to create channel');
    }
  };

  // Get the "other" participant in a DIRECT channel
  const getOtherParticipant = useCallback((ch: any) => {
    if (ch.type !== 'DIRECT' || !ch.participants) return null;
    const other = ch.participants.find((p: any) => !(p.participantType === 'HUMAN' && p.participantId === currentUserId));
    return other || ch.participants[0] || null;
  }, [currentUserId]);

  // Get all DIRECT chats with the same participant as the selected channel
  const getRelatedChats = useCallback(() => {
    if (!selectedChannel || selectedChannel.type !== 'DIRECT') return [];
    const other = getOtherParticipant(selectedChannel);
    if (!other) return [];
    return channels
      .filter(ch => {
        if (ch.type !== 'DIRECT') return false;
        const otherP = getOtherParticipant(ch);
        return otherP && otherP.participantType === other.participantType && otherP.participantId === other.participantId;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [selectedChannel, channels, getOtherParticipant]);

  // Create a new chat with the same participant
  const createNewChat = async () => {
    if (!selectedChannel || selectedChannel.type !== 'DIRECT') return;
    const other = getOtherParticipant(selectedChannel);
    if (!other) return;
    const info = nameMap(other.participantType, other.participantId);
    const now = new Date();
    const label = now.toLocaleDateString('ru', { day: 'numeric', month: 'short' }) + ' ' + now.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
    try {
      const ch = await api.createChannel({
        name: `${info.name} ${label}`,
        type: 'DIRECT',
        participantIds: [{ type: other.participantType, id: other.participantId }],
      });
      setChannels(prev => [ch, ...prev]);
      setSelectedChannel(ch);
      setShowChatHistory(false);
    } catch (err: any) {
      alert(err.message || 'Failed to create chat');
    }
  };

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (chatHistoryRef.current && !chatHistoryRef.current.contains(e.target as Node)) {
        setShowChatHistory(false);
      }
    };
    if (showChatHistory) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showChatHistory]);

  const filtered = (filter === 'agent'
    ? agentChats
    : channels.filter((ch) =>
        filter === 'all' || (filter === 'direct' ? ch.type === 'DIRECT' : ch.type !== 'DIRECT'),
      )
  ).sort((a, b) => {
    const aTime = a.messages?.[0]?.createdAt || a.createdAt;
    const bTime = b.messages?.[0]?.createdAt || b.createdAt;
    return new Date(bTime).getTime() - new Date(aTime).getTime();
  });

  // Get display info for a channel
  const channelDisplay = (ch: any) => {
    if (ch.type === 'DIRECT') {
      // Agent-to-agent channel: show both names
      const isAgentOnly = ch.participants?.every((p: any) => p.participantType === 'AGENT');
      if (isAgentOnly && ch.participants?.length === 2) {
        const a1 = nameMap('AGENT', ch.participants[0].participantId);
        const a2 = nameMap('AGENT', ch.participants[1].participantId);
        return { name: `${a1.name} ↔ ${a2.name}`, avatar: a1.avatar, sub: 'Agent Chat' };
      }
      const info = getDirectInfo(ch);
      return { name: info?.name || ch.name, avatar: info?.avatar || null, sub: info?.role || 'Direct' };
    }
    const meta = ch.metadata || {};
    return { name: ch.name, avatar: meta.avatar || null, sub: meta.description || `${ch.participants?.length || 0} members` };
  };

  // Selected channel display info
  const selectedDisplay = selectedChannel ? channelDisplay(selectedChannel) : null;

  return (
    <div className="flex h-[calc(100vh-3.5rem)] lg:h-[calc(100vh)]">
      {/* Channel list */}
      <div className={`w-full md:w-80 border-r border-[var(--border)] flex flex-col ${selectedChannel ? 'hidden md:flex' : ''}`}>
        <div className="p-4 border-b border-[var(--border)] flex items-center justify-between">
          <h2 className="font-semibold text-lg">Channels</h2>
          {!isReadOnly && (
            <button
              onClick={() => setShowCreateModal(true)}
              className="w-8 h-8 rounded-lg bg-[var(--accent)] text-white flex items-center justify-center text-lg hover:opacity-90"
            >+</button>
          )}
        </div>
        <div className="flex gap-1 px-3 py-2 border-b border-[var(--border)]">
          {(['all', 'direct', 'group', 'agent'] as const).map((f) => (
            <button key={f} onClick={() => {
              setFilter(f);
              if (f === 'agent' && agentChats.length === 0) {
                api.getAgentChats().then(setAgentChats).catch(() => {});
              }
            }}
              className={`px-3 py-1 rounded-md text-xs font-medium transition ${filter === f ? 'bg-[var(--accent)] text-white' : 'text-[var(--muted)] hover:bg-[var(--hover)]'}`}
            >{f === 'all' ? 'All' : f === 'direct' ? <><User size={12} className="inline mr-1" />Direct</> : f === 'group' ? <><Users size={12} className="inline mr-1" />Group</> : <><Bot size={12} className="inline mr-1" />A2A</>}</button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <p className="p-4 text-[var(--muted)]">Loading...</p>
          ) : filtered.length === 0 ? (
            <p className="p-4 text-[var(--muted)] text-sm">No channels yet. Create one!</p>
          ) : (
            filtered.map((ch) => {
              const display = channelDisplay(ch);
              const lastMsg = ch.messages?.[0];
              return (
                <div
                  key={ch.id}
                  onClick={() => selectChannel(ch)}
                  className={`w-full text-left px-3 py-3 border-b border-[var(--border)] hover:bg-[var(--hover)] transition cursor-pointer group flex items-center gap-3 ${
                    selectedChannel?.id === ch.id ? 'bg-[var(--hover)]' : ''
                  }`}
                >
                  <Avatar name={display.name} avatar={display.avatar} size={40} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">{display.name}</span>
                      {ch.type !== 'DIRECT' && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--accent)]/10 text-[var(--accent)] shrink-0">{ch.type}</span>
                      )}
                    </div>
                    <div className="text-xs text-[var(--muted)] truncate mt-0.5">
                      {lastMsg ? lastMsg.content?.substring(0, 40) : display.sub}
                    </div>
                  </div>
                  {ch._count?.messages > 0 && (
                    <span className="min-w-[20px] h-[20px] flex items-center justify-center text-[11px] font-bold rounded-full bg-[var(--accent)] text-white shrink-0">{ch._count.messages}</span>
                  )}
                  {!isReadOnly && (
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (!confirm(`Delete "${display.name}"?`)) return;
                        await api.deleteChannel(ch.id);
                        setChannels((prev) => prev.filter((c) => c.id !== ch.id));
                        if (selectedChannel?.id === ch.id) setSelectedChannel(null);
                      }}
                      className="opacity-0 group-hover:opacity-100 text-[var(--muted)] hover:text-red-400 p-1 transition shrink-0"
                      title="Delete"
                    >✕</button>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Chat area */}
      <div className={`flex-1 flex flex-col ${!selectedChannel ? 'hidden md:flex' : ''}`}>
        {selectedChannel && selectedDisplay ? (
          <>
            <div className="p-3 md:p-4 border-b border-[var(--border)] flex items-center gap-2 md:gap-3">
              <button onClick={() => setSelectedChannel(null)} className="p-1 text-[var(--muted)] hover:text-white md:hidden">
                <ArrowLeft size={20} />
              </button>
              <Avatar name={selectedDisplay.name} avatar={selectedDisplay.avatar} size={36} />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold">{selectedDisplay.name}</h3>
                  {selectedDisplay.sub && (
                    <span className="text-xs text-[var(--muted)] font-normal">{selectedDisplay.sub}</span>
                  )}
                </div>
                {selectedChannel.type !== 'DIRECT' && (
                  <p className="text-xs text-[var(--muted)]">
                    {selectedChannel.participants?.map((p: any) => nameMap(p.participantType, p.participantId).name).join(', ')}
                  </p>
                )}
              </div>
              {selectedChannel.type === 'DIRECT' && !isReadOnly && (
                <div className="flex items-center gap-1" ref={chatHistoryRef}>
                  {/* Chat history dropdown */}
                  <div className="relative">
                    <button
                      onClick={() => setShowChatHistory(!showChatHistory)}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs text-[var(--muted)] hover:text-white hover:bg-[var(--hover)] transition"
                      title="Chat history"
                    >
                      <MessageSquare size={14} />
                      <span>{getRelatedChats().length}</span>
                      <ChevronDown size={12} />
                    </button>
                    {showChatHistory && (() => {
                      const related = getRelatedChats();
                      return (
                        <div className="absolute right-0 top-full mt-1 w-72 bg-[var(--card)] border border-[var(--border)] rounded-xl shadow-lg z-50 overflow-hidden">
                          <div className="p-2 border-b border-[var(--border)] flex items-center justify-between">
                            <span className="text-xs font-medium text-[var(--muted)]">Chat History</span>
                            <span className="text-[10px] text-[var(--muted)]">{related.length} chat{related.length !== 1 ? 's' : ''}</span>
                          </div>
                          <div className="max-h-64 overflow-y-auto">
                            {related.map((ch) => {
                              const lastMsg = ch.messages?.[0];
                              const date = new Date(ch.createdAt);
                              const isActive = ch.id === selectedChannel.id;
                              return (
                                <button
                                  key={ch.id}
                                  onClick={() => { setSelectedChannel(ch); setShowChatHistory(false); }}
                                  className={`w-full text-left px-3 py-2.5 hover:bg-[var(--hover)] transition flex items-start gap-2.5 border-b border-[var(--border)] last:border-0 ${
                                    isActive ? 'bg-[var(--accent)]/10' : ''
                                  }`}
                                >
                                  <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${isActive ? 'bg-[var(--accent)]' : 'bg-[var(--muted)]/30'}`} />
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="text-xs font-medium truncate">
                                        {date.toLocaleDateString('ru', { day: 'numeric', month: 'short', year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined })}
                                        {' '}
                                        {date.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })}
                                      </span>
                                      <span className="text-[10px] text-[var(--muted)] shrink-0">{ch._count?.messages || 0} msg</span>
                                    </div>
                                    {lastMsg && (
                                      <p className="text-[11px] text-[var(--muted)] truncate mt-0.5">{lastMsg.content?.substring(0, 60)}</p>
                                    )}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                  {/* New Chat button */}
                  <button
                    onClick={createNewChat}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs bg-[var(--accent)] text-white hover:opacity-90 transition"
                    title="New chat"
                  >
                    <Plus size={14} />
                    <span>New Chat</span>
                  </button>
                </div>
              )}
              {selectedChannel.type !== 'DIRECT' && !isReadOnly && (
                <button onClick={openEditChannel}
                  className="p-2 rounded-lg hover:bg-[var(--hover)] text-[var(--muted)] hover:text-white transition"
                  title="Channel Settings">
                  <Settings size={18} strokeWidth={1.5} />
                </button>
              )}
            </div>
            <ChatPanel
              channelId={selectedChannel.id}
              currentUserId={currentUserId}
              nameMap={nameMap}
              readOnly={isReadOnly}
            />
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-[var(--muted)]">
            <div className="text-center">
              <p className="text-4xl mb-4">💬</p>
              <p className="text-lg font-medium">Select a channel</p>
              <p className="text-sm">or create a new one to start chatting</p>
            </div>
          </div>
        )}
      </div>

      {/* Create channel modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowCreateModal(false)}>
          <div className="bg-[var(--card)] rounded-xl p-6 w-full max-w-[440px] mx-4 border border-[var(--border)]" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4">Create Channel</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Name</label>
                <input
                  value={newChannelName}
                  onChange={(e) => setNewChannelName(e.target.value)}
                  placeholder="Channel name"
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)]"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Type</label>
                <select
                  value={newChannelType}
                  onChange={(e) => setNewChannelType(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)]"
                >
                  <option value="DIRECT">Direct</option>
                  <option value="GROUP">Group</option>
                  <option value="BROADCAST">Broadcast</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Participants</label>
                <div className="max-h-48 overflow-y-auto border border-[var(--border)] rounded-lg divide-y divide-[var(--border)]">
                  {agents.map((a: any) => (
                    <label key={`agent-${a.id}`} className="flex items-center gap-2 px-3 py-2 hover:bg-[var(--hover)] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedParticipants.some((p) => p.type === 'AGENT' && p.id === a.id)}
                        onChange={() => toggleParticipant('AGENT', a.id)}
                        className="rounded"
                      />
                      <span className="text-sm">{a.name}</span>
                      <span className="text-[10px] text-[var(--muted)] ml-auto">{a.positions?.[0]?.title || 'Agent'}</span>
                    </label>
                  ))}
                  {users.map((u: any) => (
                    <label key={`user-${u.id}`} className="flex items-center gap-2 px-3 py-2 hover:bg-[var(--hover)] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedParticipants.some((p) => p.type === 'HUMAN' && p.id === u.id)}
                        onChange={() => toggleParticipant('HUMAN', u.id)}
                        className="rounded"
                      />
                      <span className="text-sm">{u.name || u.email}</span>
                      <span className="text-[10px] text-[var(--muted)] ml-auto">User</span>
                    </label>
                  ))}
                  {agents.length === 0 && users.length === 0 && (
                    <p className="px-3 py-2 text-sm text-[var(--muted)]">No participants available</p>
                  )}
                </div>
                {selectedParticipants.length === 0 && (
                  <p className="text-xs text-[var(--muted)] mt-1">Select at least 1 participant</p>
                )}
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => { setShowCreateModal(false); setSelectedParticipants([]); }} className="px-4 py-2 rounded-lg border border-[var(--border)] hover:bg-[var(--hover)]">Cancel</button>
              <button onClick={createChannel} disabled={selectedParticipants.length === 0} className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed">Create</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Group Channel Modal */}
      {showEditChannel && selectedChannel && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowEditChannel(false)}>
          <div className="bg-[var(--card)] rounded-xl p-6 w-full max-w-[500px] mx-4 max-h-[85vh] overflow-y-auto border border-[var(--border)]" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4">Channel Settings</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Name</label>
                <input value={editChannelForm.name}
                  onChange={(e) => setEditChannelForm({ ...editChannelForm, name: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)]" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Description</label>
                <textarea value={editChannelForm.description}
                  onChange={(e) => setEditChannelForm({ ...editChannelForm, description: e.target.value })}
                  rows={2} placeholder="What is this channel about?"
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Avatar (emoji or URL)</label>
                <input value={editChannelForm.avatar}
                  onChange={(e) => setEditChannelForm({ ...editChannelForm, avatar: e.target.value })}
                  placeholder="e.g. 🏢 or /avatars/team.png"
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)]" />
              </div>

              {/* Participants */}
              <div>
                <label className="block text-sm font-medium mb-2">Participants ({selectedChannel.participants?.length || 0})</label>
                <div className="space-y-1 mb-3">
                  {selectedChannel.participants?.map((p: any) => {
                    const info = nameMap(p.participantType, p.participantId);
                    return (
                      <div key={p.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--bg)] border border-[var(--border)]">
                        <Avatar name={info.name} avatar={info.avatar} size={28} />
                        <span className="text-sm flex-1">{info.name}</span>
                        <span className="text-[10px] text-[var(--muted)]">{p.participantType === 'AGENT' ? 'Agent' : 'User'}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--hover)] text-[var(--muted)]">{p.role}</span>
                        <button onClick={() => removeParticipantFromChannel(p.participantId)}
                          className="text-[10px] text-red-400 hover:text-red-300 px-1">Remove</button>
                      </div>
                    );
                  })}
                </div>

                {/* Add participant */}
                <p className="text-xs text-[var(--muted)] mb-1">Add participants:</p>
                <div className="max-h-40 overflow-y-auto border border-[var(--border)] rounded-lg divide-y divide-[var(--border)]">
                  {agents
                    .filter((a: any) => !selectedChannel.participants?.some((p: any) => p.participantType === 'AGENT' && p.participantId === a.id))
                    .map((a: any) => (
                      <button key={`add-agent-${a.id}`} onClick={() => addParticipantToChannel('AGENT', a.id)}
                        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-[var(--hover)] text-left">
                        <Avatar name={a.name} avatar={a.avatar} size={24} />
                        <span className="text-sm">{a.name}</span>
                        <span className="text-[10px] text-[var(--muted)] ml-auto">+ {a.positions?.[0]?.title || 'Agent'}</span>
                      </button>
                    ))}
                  {users
                    .filter((u: any) => !selectedChannel.participants?.some((p: any) => p.participantType === 'HUMAN' && p.participantId === u.id))
                    .map((u: any) => (
                      <button key={`add-user-${u.id}`} onClick={() => addParticipantToChannel('HUMAN', u.id)}
                        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-[var(--hover)] text-left">
                        <Avatar name={u.name || u.email} size={24} />
                        <span className="text-sm">{u.name || u.email}</span>
                        <span className="text-[10px] text-[var(--muted)] ml-auto">+ User</span>
                      </button>
                    ))}
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setShowEditChannel(false)} className="px-4 py-2 rounded-lg border border-[var(--border)] hover:bg-[var(--hover)]">Cancel</button>
              <button onClick={saveEditChannel} className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg hover:opacity-90">Save</button>
              {isAdmin && (
                deleteConfirm === selectedChannel.id ? (
                  <div className="flex gap-2 ml-auto">
                    <button onClick={async () => { await api.deleteChannel(selectedChannel.id); setChannels(c => c.filter(x => x.id !== selectedChannel.id)); setSelectedChannel(null); setShowEditChannel(false); setDeleteConfirm(null); }}
                      className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600">Confirm Delete</button>
                    <button onClick={() => setDeleteConfirm(null)}
                      className="px-4 py-2 border border-[var(--border)] rounded-lg">Cancel</button>
                  </div>
                ) : (
                  <button onClick={() => setDeleteConfirm(selectedChannel.id)}
                    className="px-4 py-2 border border-red-300/30 text-red-400 rounded-lg hover:bg-red-500/10 ml-auto">Delete Channel</button>
                )
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
