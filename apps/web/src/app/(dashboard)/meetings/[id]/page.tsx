'use client';

import { useState, useEffect, useRef, useCallback, use } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { getMeetingsSocket } from '@/lib/socket';

export default function MeetingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [meeting, setMeeting] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [entryContent, setEntryContent] = useState('');
  const [voteDescription, setVoteDescription] = useState('');
  const [showVoteForm, setShowVoteForm] = useState(false);
  const [waitingForAgents, setWaitingForAgents] = useState(false);
  const [activeSpeakerId, setActiveSpeakerId] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const entryCountRef = useRef(0);
  const pendingAgentCountRef = useRef(0);
  const receivedAgentCountRef = useRef(0);

  const loadMeeting = useCallback(async () => {
    const m = await api.getMeeting(id);
    setMeeting(m);
    setLoading(false);
    return m;
  }, [id]);

  // WebSocket for real-time updates
  useEffect(() => {
    const socket = getMeetingsSocket();
    socket.connect();
    socket.emit('join_meeting', { meetingId: id });

    socket.on('new_entry', (entry: any) => {
      setMeeting((prev: any) => {
        if (!prev) return prev;
        const exists = prev.entries?.some((e: any) => e.id === entry.id);
        if (exists) return prev;
        // Enrich entry with agent/user info from participants
        const enriched = { ...entry };
        if (entry.speakerType === 'AGENT') {
          const p = prev.participants?.find((pp: any) => pp.participantId === entry.speakerId && pp.participantType === 'AGENT');
          if (p?.agent) enriched.agent = p.agent;
        } else if (entry.speakerType === 'HUMAN') {
          const p = prev.participants?.find((pp: any) => pp.participantId === entry.speakerId && pp.participantType === 'HUMAN');
          if (p?.user) enriched.user = p.user;
        }
        return { ...prev, entries: [...(prev.entries || []), enriched] };
      });
      setActiveSpeakerId(entry.speakerId);
      setTimeout(() => setActiveSpeakerId(prev => prev === entry.speakerId ? null : prev), 4000);

      // Track agent/system responses against expected count
      if (entry.speakerType === 'AGENT' || (entry.speakerType === 'SYSTEM' && entry.content?.includes('failed to respond'))) {
        receivedAgentCountRef.current++;
        if (receivedAgentCountRef.current >= pendingAgentCountRef.current) {
          setWaitingForAgents(false);
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
        }
      }
    });

    socket.on('agents_pending', (data: { count: number }) => {
      pendingAgentCountRef.current = data.count;
      receivedAgentCountRef.current = 0;
    });

    socket.on('meeting_started', () => loadMeeting());
    socket.on('vote_started', () => loadMeeting());
    socket.on('vote_tallied', () => loadMeeting());

    return () => {
      socket.emit('leave_meeting', { meetingId: id });
      socket.off('new_entry');
      socket.off('agents_pending');
      socket.off('meeting_started');
      socket.off('vote_started');
      socket.off('vote_tallied');
      socket.disconnect();
    };
  }, [id, loadMeeting]);

  useEffect(() => { loadMeeting(); }, [loadMeeting]);

  // Auto-scroll chat
  useEffect(() => {
    const len = meeting?.entries?.length || 0;
    if (len > entryCountRef.current) {
      entryCountRef.current = len;
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [meeting?.entries?.length]);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  // Fallback polling — stops when all expected agents have responded or timeout
  const startFallbackPoll = useCallback(() => {
    setWaitingForAgents(true);
    let count = 0;
    const initial = entryCountRef.current;
    const expectedAgents = pendingAgentCountRef.current || 1;
    pollRef.current = setInterval(async () => {
      count++;
      const m = await loadMeeting();
      const newEntries = (m.entries?.length || 0) - initial;
      if (newEntries >= expectedAgents || count > 60) {
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
        setWaitingForAgents(false);
      }
    }, 3000);
  }, [loadMeeting]);

  const handleStart = async () => {
    await api.startMeeting(id);
    loadMeeting();
  };

  const handleEnd = async () => {
    await api.endMeeting(id);
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    setWaitingForAgents(false);
    loadMeeting();
  };

  const handleAddEntry = async () => {
    if (!entryContent.trim()) return;
    const user = api.getUserFromToken();
    await api.addMeetingEntry(id, { content: entryContent, speakerType: 'HUMAN', speakerId: user?.id || '' });
    setEntryContent('');
    await loadMeeting();
    const hasAgents = meeting?.participants?.some((p: any) => p.participantType === 'AGENT');
    if (hasAgents) startFallbackPoll();
  };

  const handleStartVote = async () => {
    if (!voteDescription.trim()) return;
    await api.startVote(id, voteDescription);
    setVoteDescription('');
    setShowVoteForm(false);
    loadMeeting();
  };

  const handleCastVote = async (decisionId: string, vote: string) => {
    await api.castVote(id, decisionId, vote);
    loadMeeting();
  };

  const handleTally = async (decisionId: string) => {
    await api.tallyVote(id, decisionId);
    loadMeeting();
  };

  if (loading) return <div className="h-screen flex items-center justify-center text-[var(--muted)]">Loading...</div>;
  if (!meeting) return <div className="h-screen flex items-center justify-center">Meeting not found</div>;

  const isActive = meeting.status === 'IN_PROGRESS';
  const isScheduled = meeting.status === 'SCHEDULED';
  const isCompleted = meeting.status === 'COMPLETED';
  const participants = meeting.participants || [];
  const entries = meeting.entries || [];
  const decisions = meeting.decisions || [];

  return (
    <div className="h-[calc(100vh-3.5rem)] lg:h-[calc(100vh-56px)] flex flex-col overflow-hidden">
      {/* Compact header */}
      <div className="flex items-center justify-between px-3 md:px-6 py-3 border-b border-[var(--border)] flex-shrink-0">
        <div className="flex items-center gap-2 md:gap-4 min-w-0">
          <button onClick={() => router.push('/meetings')} className="text-sm text-[var(--muted)] hover:text-[var(--foreground)] shrink-0">&larr;</button>
          <div className="min-w-0">
            <h1 className="text-base md:text-lg font-bold leading-tight truncate">{meeting.title}</h1>
            {meeting.agenda && <p className="text-xs text-[var(--muted)] mt-0.5 truncate hidden md:block">{meeting.agenda}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2 md:gap-3 shrink-0">
          <span className={`px-3 py-1 rounded-full text-xs font-medium ${
            isActive ? 'bg-[var(--success)]/20 text-[var(--success)]' :
            isScheduled ? 'bg-blue-500/20 text-blue-400' :
            isCompleted ? 'bg-[var(--success)]/10 text-[var(--muted)]' :
            'bg-gray-500/20 text-gray-400'
          }`}>
            {isActive ? 'IN PROGRESS' : meeting.status}
          </span>
          {isScheduled && (
            <button onClick={handleStart} className="px-4 py-1.5 bg-[var(--success)] text-white rounded-lg text-sm font-semibold hover:brightness-110">Start</button>
          )}
          {isActive && (
            <button onClick={handleEnd} className="px-4 py-1.5 bg-[var(--danger)] text-white rounded-lg text-sm font-semibold hover:brightness-110">End</button>
          )}
        </div>
      </div>

      {/* Main: Round Table + Chat */}
      <div className="flex-1 flex overflow-hidden">

        {/* LEFT: Round Table — hidden on mobile */}
        <div className="hidden lg:flex w-[340px] flex-shrink-0 flex-col items-center justify-center border-r border-[var(--border)] p-6">
          <RoundTable participants={participants} activeSpeakerId={activeSpeakerId} meetingTitle={meeting.title} />
          <div className="flex gap-5 mt-6">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-[var(--accent)]" />
              <span className="text-[11px] text-[var(--muted)]">Agent</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-[var(--success)]" />
              <span className="text-[11px] text-[var(--muted)]">Human</span>
            </div>
          </div>
          {meeting.startedAt && (
            <div className="text-[10px] text-[var(--muted)] mt-4">
              Started {new Date(meeting.startedAt).toLocaleTimeString()}
              {meeting.endedAt && ` — Ended ${new Date(meeting.endedAt).toLocaleTimeString()}`}
            </div>
          )}
        </div>

        {/* RIGHT: Chat + Decisions */}
        <div className="flex-1 flex flex-col min-w-0">

          {/* Chat messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-1">
            {entries.length === 0 ? (
              <div className="h-full flex items-center justify-center">
                <p className="text-sm text-[var(--muted)]">
                  {isActive ? 'Say something to start the discussion.' :
                   isScheduled ? 'Start the meeting to begin.' : 'No entries.'}
                </p>
              </div>
            ) : (
              <>
                {entries.map((entry: any) => (
                  <ChatMessage key={entry.id} entry={entry} />
                ))}
                {waitingForAgents && (
                  <div className="flex items-center gap-3 px-3 py-3 animate-pulse">
                    <div className="w-7 h-7 rounded-full bg-[var(--accent)]/20 flex items-center justify-center">
                      <ThinkingDots />
                    </div>
                    <span className="text-xs text-[var(--muted)]">Agents are thinking...</span>
                  </div>
                )}
                <div ref={chatEndRef} />
              </>
            )}
          </div>

          {/* Input */}
          {isActive && (
            <div className="flex-shrink-0 border-t border-[var(--border)] p-3 flex gap-2">
              <input
                value={entryContent}
                onChange={(e) => setEntryContent(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleAddEntry()}
                placeholder="Say something..."
                disabled={waitingForAgents}
                className="flex-1 px-4 py-2.5 rounded-xl border border-[var(--border)] bg-[var(--card)] text-sm placeholder-[var(--muted)] disabled:opacity-40 focus:outline-none focus:border-[var(--accent)]"
              />
              <button
                onClick={handleAddEntry}
                disabled={waitingForAgents || !entryContent.trim()}
                className="px-5 py-2.5 bg-[var(--accent)] text-white rounded-xl text-sm font-semibold disabled:opacity-40 hover:bg-[var(--accent-hover)]"
              >
                Send
              </button>
              <button
                onClick={() => setShowVoteForm(!showVoteForm)}
                title="Start a vote"
                className="px-3 py-2.5 border border-[var(--border)] rounded-xl text-sm hover:bg-[var(--card)]"
              >
                Vote
              </button>
            </div>
          )}

          {/* Vote form */}
          {showVoteForm && isActive && (
            <div className="flex-shrink-0 border-t border-[var(--border)] p-3 flex gap-2 bg-[var(--card)]">
              <input
                value={voteDescription}
                onChange={(e) => setVoteDescription(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleStartVote()}
                placeholder="Vote description..."
                className="flex-1 px-4 py-2 rounded-xl border border-[var(--border)] bg-[var(--background)] text-sm placeholder-[var(--muted)] focus:outline-none focus:border-[var(--accent)]"
              />
              <button onClick={handleStartVote} className="px-4 py-2 bg-[var(--warning)] text-black rounded-xl text-sm font-semibold">Start Vote</button>
              <button onClick={() => setShowVoteForm(false)} className="px-3 py-2 border border-[var(--border)] rounded-xl text-sm">Cancel</button>
            </div>
          )}

          {/* Decisions panel */}
          {decisions.length > 0 && (
            <div className="flex-shrink-0 border-t border-[var(--accent)]/30 bg-[var(--card)] p-3 max-h-48 overflow-y-auto">
              <div className="text-[10px] font-semibold tracking-widest uppercase text-[var(--accent)] mb-2">Decisions & Votes</div>
              <div className="space-y-2">
                {decisions.map((d: any) => (
                  <div key={d.id} className="flex items-center gap-3 p-2.5 rounded-lg border border-[var(--border)] bg-[var(--background)]">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium truncate">{d.description}</div>
                      <div className="flex items-center gap-3 mt-1 text-[10px]">
                        <span className="text-[var(--success)]">For: {d.votesFor}</span>
                        <span className="text-[var(--danger)]">Against: {d.votesAgainst}</span>
                        <span className="text-[var(--muted)]">Abstain: {d.votesAbstain}</span>
                      </div>
                    </div>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                      d.result === 'APPROVED' ? 'bg-[var(--success)]/20 text-[var(--success)]' :
                      d.result === 'REJECTED' ? 'bg-[var(--danger)]/20 text-[var(--danger)]' :
                      'bg-[var(--warning)]/20 text-[var(--warning)]'
                    }`}>{d.result || 'OPEN'}</span>
                    {isActive && d.result === 'TABLED' && (
                      <div className="flex gap-1">
                        <button onClick={() => handleCastVote(d.id, 'FOR')} className="text-[10px] px-2 py-0.5 bg-[var(--success)]/20 text-[var(--success)] rounded hover:bg-[var(--success)]/30">For</button>
                        <button onClick={() => handleCastVote(d.id, 'AGAINST')} className="text-[10px] px-2 py-0.5 bg-[var(--danger)]/20 text-[var(--danger)] rounded hover:bg-[var(--danger)]/30">Against</button>
                        <button onClick={() => handleCastVote(d.id, 'ABSTAIN')} className="text-[10px] px-2 py-0.5 bg-gray-500/20 text-gray-400 rounded hover:bg-gray-500/30">Abstain</button>
                        <button onClick={() => handleTally(d.id)} className="text-[10px] px-2 py-0.5 bg-blue-500/20 text-blue-400 rounded hover:bg-blue-500/30">Tally</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tasks */}
          {meeting.tasks && meeting.tasks.length > 0 && (
            <div className="flex-shrink-0 border-t border-[var(--border)] bg-[var(--card)] p-3 max-h-36 overflow-y-auto">
              <div className="text-[10px] font-semibold tracking-widest uppercase text-[var(--accent)] mb-2">Tasks</div>
              <div className="space-y-1.5">
                {meeting.tasks.map((mt: any) => (
                  <div key={mt.id} className="flex items-center gap-2 text-xs p-2 rounded-lg bg-[var(--background)] border border-[var(--border)]">
                    <span>{mt.task?.title || 'Task'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ======================== Round Table ======================== */

function RoundTable({ participants, activeSpeakerId, meetingTitle }: {
  participants: any[];
  activeSpeakerId: string | null;
  meetingTitle: string;
}) {
  const count = participants.length;
  if (count === 0) return <div className="text-sm text-[var(--muted)]">No participants</div>;

  // For large groups (>12), use compact grid layout
  if (count > 12) {
    return <GridLayout participants={participants} activeSpeakerId={activeSpeakerId} meetingTitle={meetingTitle} />;
  }

  // Adaptive sizes based on participant count
  const tableSize = count <= 3 ? 140 : count <= 6 ? 180 : count <= 8 ? 200 : 230;
  const avatarSize = count <= 3 ? 44 : count <= 6 ? 40 : count <= 8 ? 36 : 32;
  const radius = tableSize / 2 + avatarSize / 2 + (count <= 3 ? 20 : 14);
  const containerSize = radius * 2 + avatarSize + 20;

  return (
    <div className="relative" style={{ width: containerSize, height: containerSize }}>
      {/* Table circle */}
      <div
        className="absolute rounded-full border-2 border-[var(--border)] flex items-center justify-center"
        style={{
          width: tableSize, height: tableSize,
          top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          background: 'rgba(18,18,26,0.8)',
        }}
      >
        <div className="text-center px-3">
          <div className="text-[9px] text-[var(--muted)] uppercase tracking-[3px]">Meeting</div>
          <div className="text-[11px] font-semibold text-[var(--accent)] mt-1 leading-tight line-clamp-2 max-w-[120px]">{meetingTitle}</div>
        </div>
      </div>

      {/* Seats around the table */}
      {participants.map((p: any, i: number) => {
        const angle = (2 * Math.PI * i) / count - Math.PI / 2;
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius;

        return (
          <SeatAvatar
            key={p.id}
            participant={p}
            isSpeaking={activeSpeakerId === p.participantId}
            size={avatarSize}
            style={{
              position: 'absolute',
              left: `calc(50% + ${x}px)`,
              top: `calc(50% + ${y}px)`,
              transform: 'translate(-50%, -50%)',
            }}
          />
        );
      })}
    </div>
  );
}

/* Grid layout for 13+ participants */
function GridLayout({ participants, activeSpeakerId, meetingTitle }: {
  participants: any[];
  activeSpeakerId: string | null;
  meetingTitle: string;
}) {
  const agents = participants.filter(p => p.participantType === 'AGENT');
  const humans = participants.filter(p => p.participantType !== 'AGENT');

  return (
    <div className="w-full flex flex-col items-center gap-4">
      {/* Central meeting badge */}
      <div className="w-24 h-24 rounded-full border-2 border-[var(--border)] flex items-center justify-center" style={{ background: 'rgba(18,18,26,0.8)' }}>
        <div className="text-center px-2">
          <div className="text-[8px] text-[var(--muted)] uppercase tracking-[2px]">Meeting</div>
          <div className="text-[10px] font-semibold text-[var(--accent)] mt-0.5 leading-tight line-clamp-2">{meetingTitle}</div>
        </div>
      </div>

      {/* Participants grid */}
      <div className="flex flex-wrap justify-center gap-3 max-w-[280px]">
        {[...humans, ...agents].map((p: any) => (
          <SeatAvatar
            key={p.id}
            participant={p}
            isSpeaking={activeSpeakerId === p.participantId}
            size={32}
          />
        ))}
      </div>
    </div>
  );
}

/* Reusable seat avatar — always shows name + role */
function SeatAvatar({ participant: p, isSpeaking, size, style }: {
  participant: any;
  isSpeaking: boolean;
  size: number;
  style?: React.CSSProperties;
}) {
  const isAgent = p.participantType === 'AGENT';
  const name = p.agent?.name || p.user?.name || '?';
  const role = p.role || 'MEMBER';
  const accentColor = isAgent ? 'var(--accent)' : 'var(--success)';
  const glowColor = isAgent ? 'rgba(108,92,231,0.5)' : 'rgba(0,206,201,0.5)';
  const shortName = name.length > 10 ? name.split(' ')[0] : name;

  return (
    <div className="flex flex-col items-center" style={style}>
      <div
        className="rounded-full flex items-center justify-center font-bold overflow-hidden"
        style={{
          width: size, height: size,
          fontSize: size * 0.36,
          background: accentColor,
          color: 'white',
          border: `2px solid var(--background)`,
          boxShadow: isSpeaking
            ? `0 0 0 3px var(--background), 0 0 0 5px ${accentColor}, 0 0 20px ${glowColor}`
            : 'none',
          transition: 'box-shadow 0.3s ease',
        }}
      >
        {(p.agent?.avatar || p.user?.avatarUrl) ? (
          <img src={p.agent?.avatar || p.user?.avatarUrl} alt="" className="w-full h-full object-cover" />
        ) : name[0]}
      </div>
      <div
        className="mt-0.5 text-center leading-tight truncate"
        style={{
          fontSize: size <= 32 ? 8 : 9,
          fontWeight: 600,
          maxWidth: 64,
          color: isSpeaking ? accentColor : 'var(--foreground)',
          transition: 'color 0.3s ease',
        }}
      >
        {shortName}
      </div>
      <div
        className="text-center leading-tight truncate"
        style={{
          fontSize: 7,
          maxWidth: 64,
          color: 'var(--muted)',
        }}
      >
        {role}{isAgent ? ' · AI' : ''}
      </div>
    </div>
  );
}

/* ======================== Chat Message ======================== */

function ChatMessage({ entry }: { entry: any }) {
  const isSystem = entry.speakerType === 'SYSTEM';
  const isAgent = entry.speakerType === 'AGENT';
  const name = isSystem ? 'System' :
    isAgent ? (entry.agent?.name || 'Agent') :
    (entry.user?.name || 'Human');
  const position = isAgent ? entry.agent?.positions?.[0]?.title : null;

  if (isSystem) {
    return (
      <div className="text-center py-2 px-4">
        <div className="inline-block px-4 py-1.5 rounded-full text-[11px] bg-[var(--warning)]/10 border border-[var(--warning)]/20 text-[var(--warning)]">
          {entry.content}
        </div>
      </div>
    );
  }

  const accentColor = isAgent ? 'var(--accent)' : 'var(--success)';
  const bgColor = isAgent ? 'rgba(108,92,231,0.06)' : 'rgba(0,206,201,0.06)';

  return (
    <div className="flex gap-2.5 px-3 py-2 rounded-lg" style={{ background: bgColor }}>
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0 overflow-hidden"
        style={{
          background: isAgent ? 'rgba(108,92,231,0.2)' : 'rgba(0,206,201,0.2)',
          color: accentColor,
        }}
      >
        {(entry.agent?.avatar || entry.user?.avatarUrl) ? (
          <img src={entry.agent?.avatar || entry.user?.avatarUrl} alt="" className="w-full h-full object-cover" />
        ) : name[0]}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-[11px] font-semibold" style={{ color: accentColor }}>{name}</span>
          {position && <span className="text-[9px] text-[var(--muted)]">· {position}</span>}
          {isAgent && (
            <span className="text-[9px] px-1.5 py-px rounded bg-[var(--accent)]/15 text-[var(--accent)]">AI</span>
          )}
          {entry.entryType !== 'SPEECH' && (
            <span className="text-[9px] text-[var(--muted)]">{entry.entryType}</span>
          )}
        </div>
        <p className="text-[13px] leading-relaxed whitespace-pre-wrap">{entry.content}</p>
      </div>
    </div>
  );
}

/* ======================== Thinking Dots ======================== */

function ThinkingDots() {
  return (
    <div className="flex gap-0.5">
      <div className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-bounce" style={{ animationDelay: '0ms' }} />
      <div className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-bounce" style={{ animationDelay: '150ms' }} />
      <div className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-bounce" style={{ animationDelay: '300ms' }} />
    </div>
  );
}
