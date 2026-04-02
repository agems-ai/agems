'use client';

import { useState, useEffect, useRef, useCallback, use } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { getMeetingsSocket } from '@/lib/socket';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

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

  useEffect(() => {
    const socket = getMeetingsSocket();
    socket.connect();
    socket.emit('join_meeting', { meetingId: id });

    socket.on('new_entry', (entry: any) => {
      setMeeting((prev: any) => {
        if (!prev) return prev;
        const exists = prev.entries?.some((e: any) => e.id === entry.id);
        if (exists) return prev;
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

  useEffect(() => {
    const len = meeting?.entries?.length || 0;
    if (len > entryCountRef.current) {
      entryCountRef.current = len;
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [meeting?.entries?.length]);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

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

  const handleStart = async () => { await api.startMeeting(id); loadMeeting(); };
  const handleEnd = async () => { await api.endMeeting(id); if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } setWaitingForAgents(false); loadMeeting(); };

  const handleAddEntry = async () => {
    if (!entryContent.trim()) return;
    const user = api.getUserFromToken();
    await api.addMeetingEntry(id, { content: entryContent, speakerType: 'HUMAN', speakerId: user?.id || '' });
    setEntryContent('');
    await loadMeeting();
    const hasAgents = meeting?.participants?.some((p: any) => p.participantType === 'AGENT');
    if (hasAgents) startFallbackPoll();
  };

  const handleStartVote = async () => { if (!voteDescription.trim()) return; await api.startVote(id, voteDescription); setVoteDescription(''); setShowVoteForm(false); loadMeeting(); };
  const handleCastVote = async (decisionId: string, vote: string) => { await api.castVote(id, decisionId, vote); loadMeeting(); };
  const handleTally = async (decisionId: string) => { await api.tallyVote(id, decisionId); loadMeeting(); };

  if (loading) return <div className="h-screen flex items-center justify-center text-[var(--muted)]">Loading...</div>;
  if (!meeting) return <div className="h-screen flex items-center justify-center">Meeting not found</div>;

  const isActive = meeting.status === 'IN_PROGRESS';
  const isScheduled = meeting.status === 'SCHEDULED';
  const isCompleted = meeting.status === 'COMPLETED';
  const participants = meeting.participants || [];
  const entries = meeting.entries || [];
  const decisions = meeting.decisions || [];
  const summary = meeting.summary;

  return (
    <div className="h-[calc(100vh-3.5rem)] lg:h-[calc(100vh-56px)] flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 md:px-6 py-3 border-b border-[var(--border)] flex-shrink-0 bg-[var(--card)]">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={() => router.push('/meetings')} className="text-[var(--muted)] hover:text-[var(--foreground)] transition-colors">&larr;</button>
          <div className="min-w-0">
            <h1 className="text-base md:text-lg font-bold leading-tight truncate">{meeting.title}</h1>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[11px] text-[var(--muted)]">{participants.length} participants</span>
              {meeting.startedAt && (
                <span className="text-[11px] text-[var(--muted)]">
                  &middot; {new Date(meeting.startedAt).toLocaleDateString()} {new Date(meeting.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  {meeting.endedAt && ` — ${new Date(meeting.endedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <StatusBadge status={meeting.status} />
          {isScheduled && <button onClick={handleStart} className="px-4 py-1.5 bg-[var(--success)] text-white rounded-lg text-sm font-semibold hover:brightness-110 transition">Start</button>}
          {isActive && <button onClick={handleEnd} className="px-4 py-1.5 bg-[var(--danger)] text-white rounded-lg text-sm font-semibold hover:brightness-110 transition">End</button>}
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">

        {/* LEFT: Round Table — hidden on mobile */}
        <div className="hidden lg:flex w-[340px] flex-shrink-0 flex-col items-center justify-center border-r border-[var(--border)] p-6 bg-[var(--background)]">
          <RoundTable participants={participants} activeSpeakerId={activeSpeakerId} meetingTitle={meeting.title} />
          <div className="flex gap-5 mt-6">
            <div className="flex items-center gap-2"><div className="w-2.5 h-2.5 rounded-full bg-[var(--accent)]" /><span className="text-[11px] text-[var(--muted)]">Agent</span></div>
            <div className="flex items-center gap-2"><div className="w-2.5 h-2.5 rounded-full bg-[var(--success)]" /><span className="text-[11px] text-[var(--muted)]">Human</span></div>
          </div>
        </div>

        {/* RIGHT: Transcript */}
        <div className="flex-1 flex flex-col min-w-0">

          {/* Scrollable transcript */}
          <div className="flex-1 overflow-y-auto">
            {entries.length === 0 ? (
              <div className="h-full flex items-center justify-center">
                <p className="text-sm text-[var(--muted)]">{isActive ? 'Say something to start the discussion.' : isScheduled ? 'Start the meeting to begin.' : 'No entries.'}</p>
              </div>
            ) : (
              <div className="max-w-4xl mx-auto px-4 py-6 space-y-1">
                {entries.map((entry: any, i: number) => (
                  <EntryRenderer key={entry.id} entry={entry} prevEntry={entries[i - 1]} />
                ))}
                {waitingForAgents && (
                  <div className="flex items-center gap-3 px-4 py-4">
                    <div className="w-8 h-8 rounded-full bg-[var(--accent)]/15 flex items-center justify-center"><ThinkingDots /></div>
                    <span className="text-sm text-[var(--muted)] animate-pulse">Agents are thinking...</span>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>
            )}
          </div>

          {/* Summary card (if completed) */}
          {isCompleted && summary && (
            <div className="flex-shrink-0 border-t border-[var(--accent)]/30 bg-gradient-to-b from-[var(--accent)]/5 to-transparent max-h-[40vh] overflow-y-auto">
              <div className="max-w-4xl mx-auto px-6 py-5">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-lg">📋</span>
                  <span className="text-sm font-bold text-[var(--accent)]">Meeting Summary</span>
                </div>
                <div className="prose-meeting">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{summary}</ReactMarkdown>
                </div>
              </div>
            </div>
          )}

          {/* Decisions */}
          {decisions.length > 0 && (
            <div className="flex-shrink-0 border-t border-[var(--border)] bg-[var(--card)] p-4 max-h-48 overflow-y-auto">
              <div className="max-w-4xl mx-auto">
                <div className="text-[10px] font-semibold tracking-widest uppercase text-[var(--accent)] mb-2">Decisions & Votes</div>
                <div className="space-y-2">
                  {decisions.map((d: any) => (
                    <div key={d.id} className="flex items-center gap-3 p-3 rounded-lg border border-[var(--border)] bg-[var(--background)]">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium">{d.description}</div>
                        <div className="flex items-center gap-3 mt-1 text-xs">
                          <span className="text-[var(--success)]">For: {d.votesFor}</span>
                          <span className="text-[var(--danger)]">Against: {d.votesAgainst}</span>
                          <span className="text-[var(--muted)]">Abstain: {d.votesAbstain}</span>
                        </div>
                      </div>
                      <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${d.result === 'APPROVED' ? 'bg-[var(--success)]/20 text-[var(--success)]' : d.result === 'REJECTED' ? 'bg-[var(--danger)]/20 text-[var(--danger)]' : 'bg-[var(--warning)]/20 text-[var(--warning)]'}`}>{d.result || 'OPEN'}</span>
                      {isActive && d.result === 'TABLED' && (
                        <div className="flex gap-1">
                          <button onClick={() => handleCastVote(d.id, 'FOR')} className="text-xs px-2 py-1 bg-[var(--success)]/20 text-[var(--success)] rounded hover:bg-[var(--success)]/30">For</button>
                          <button onClick={() => handleCastVote(d.id, 'AGAINST')} className="text-xs px-2 py-1 bg-[var(--danger)]/20 text-[var(--danger)] rounded hover:bg-[var(--danger)]/30">Against</button>
                          <button onClick={() => handleCastVote(d.id, 'ABSTAIN')} className="text-xs px-2 py-1 bg-gray-500/20 text-gray-400 rounded hover:bg-gray-500/30">Abstain</button>
                          <button onClick={() => handleTally(d.id)} className="text-xs px-2 py-1 bg-blue-500/20 text-blue-400 rounded hover:bg-blue-500/30">Tally</button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Tasks from meeting */}
          {meeting.tasks && meeting.tasks.length > 0 && (
            <div className="flex-shrink-0 border-t border-[var(--border)] bg-[var(--card)] p-4 max-h-36 overflow-y-auto">
              <div className="max-w-4xl mx-auto">
                <div className="text-[10px] font-semibold tracking-widest uppercase text-[var(--accent)] mb-2">Action Items</div>
                <div className="space-y-1.5">
                  {meeting.tasks.map((mt: any) => (
                    <div key={mt.id} className="flex items-center gap-2 text-sm p-2.5 rounded-lg bg-[var(--background)] border border-[var(--border)]">
                      <span className="text-[var(--accent)]">●</span>
                      <span>{mt.task?.title || 'Task'}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Input bar */}
          {isActive && (
            <div className="flex-shrink-0 border-t border-[var(--border)] bg-[var(--card)] p-3">
              <div className="max-w-4xl mx-auto flex gap-2">
                <input
                  value={entryContent}
                  onChange={(e) => setEntryContent(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleAddEntry()}
                  placeholder="Say something..."
                  disabled={waitingForAgents}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-[var(--border)] bg-[var(--background)] text-sm placeholder-[var(--muted)] disabled:opacity-40 focus:outline-none focus:border-[var(--accent)] transition"
                />
                <button onClick={handleAddEntry} disabled={waitingForAgents || !entryContent.trim()} className="px-5 py-2.5 bg-[var(--accent)] text-white rounded-xl text-sm font-semibold disabled:opacity-40 hover:bg-[var(--accent-hover)] transition">Send</button>
                <button onClick={() => setShowVoteForm(!showVoteForm)} title="Start a vote" className="px-3 py-2.5 border border-[var(--border)] rounded-xl text-sm hover:bg-[var(--card)] transition">Vote</button>
              </div>
            </div>
          )}

          {showVoteForm && isActive && (
            <div className="flex-shrink-0 border-t border-[var(--border)] bg-[var(--card)] p-3">
              <div className="max-w-4xl mx-auto flex gap-2">
                <input value={voteDescription} onChange={(e) => setVoteDescription(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleStartVote()} placeholder="Vote description..." className="flex-1 px-4 py-2 rounded-xl border border-[var(--border)] bg-[var(--background)] text-sm placeholder-[var(--muted)] focus:outline-none focus:border-[var(--accent)]" />
                <button onClick={handleStartVote} className="px-4 py-2 bg-[var(--warning)] text-black rounded-xl text-sm font-semibold">Start Vote</button>
                <button onClick={() => setShowVoteForm(false)} className="px-3 py-2 border border-[var(--border)] rounded-xl text-sm">Cancel</button>
              </div>
            </div>
          )}
        </div>
      </div>

      <style jsx global>{`
        .prose-meeting { font-size: 13px; line-height: 1.7; color: var(--foreground); }
        .prose-meeting h1, .prose-meeting h2, .prose-meeting h3 { font-weight: 700; margin-top: 1em; margin-bottom: 0.4em; color: var(--foreground); }
        .prose-meeting h2 { font-size: 15px; }
        .prose-meeting h3 { font-size: 14px; }
        .prose-meeting p { margin: 0.3em 0; }
        .prose-meeting ul, .prose-meeting ol { padding-left: 1.5em; margin: 0.3em 0; }
        .prose-meeting li { margin: 0.15em 0; }
        .prose-meeting strong { color: var(--accent); font-weight: 600; }
        .prose-meeting code { background: var(--card); padding: 0.15em 0.4em; border-radius: 4px; font-size: 12px; }
        .prose-meeting pre { background: var(--card); padding: 12px; border-radius: 8px; overflow-x: auto; margin: 0.5em 0; }
        .prose-meeting pre code { background: none; padding: 0; }
        .prose-meeting a { color: var(--accent); text-decoration: underline; }

        .prose-entry { font-size: 13.5px; line-height: 1.65; color: var(--foreground); }
        .prose-entry h1, .prose-entry h2, .prose-entry h3 { font-weight: 700; margin-top: 0.6em; margin-bottom: 0.3em; }
        .prose-entry h2 { font-size: 14px; color: var(--foreground); }
        .prose-entry h3 { font-size: 13.5px; color: var(--foreground); }
        .prose-entry p { margin: 0.25em 0; }
        .prose-entry ul, .prose-entry ol { padding-left: 1.4em; margin: 0.25em 0; }
        .prose-entry li { margin: 0.1em 0; }
        .prose-entry strong { font-weight: 600; }
        .prose-entry code { background: rgba(255,255,255,0.06); padding: 0.1em 0.35em; border-radius: 3px; font-size: 12px; }
        .prose-entry pre { background: rgba(255,255,255,0.04); padding: 10px; border-radius: 6px; overflow-x: auto; margin: 0.4em 0; }
        .prose-entry pre code { background: none; padding: 0; }
      `}</style>
    </div>
  );
}

/* ======================== Status Badge ======================== */

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { bg: string; text: string; label: string }> = {
    SCHEDULED: { bg: 'bg-blue-500/20', text: 'text-blue-400', label: 'Scheduled' },
    IN_PROGRESS: { bg: 'bg-[var(--success)]/20', text: 'text-[var(--success)]', label: 'In Progress' },
    COMPLETED: { bg: 'bg-[var(--accent)]/15', text: 'text-[var(--accent)]', label: 'Completed' },
    CANCELLED: { bg: 'bg-[var(--danger)]/20', text: 'text-[var(--danger)]', label: 'Cancelled' },
  };
  const c = config[status] || config.SCHEDULED;
  return <span className={`px-3 py-1 rounded-full text-xs font-semibold ${c.bg} ${c.text}`}>{c.label}</span>;
}

/* ======================== Entry Renderer ======================== */

function EntryRenderer({ entry, prevEntry }: { entry: any; prevEntry?: any }) {
  const isSystem = entry.speakerType === 'SYSTEM';

  // "Meeting started" / "Meeting ended" — clean divider
  if (isSystem && (entry.content === 'Meeting started' || entry.content === 'Meeting ended')) {
    return (
      <div className="flex items-center gap-3 py-3">
        <div className="flex-1 h-px bg-[var(--border)]" />
        <span className="text-[11px] font-medium text-[var(--muted)] tracking-wide">
          {entry.content === 'Meeting started' ? '🟢 Meeting Started' : '🔴 Meeting Ended'}
        </span>
        <div className="flex-1 h-px bg-[var(--border)]" />
      </div>
    );
  }

  // System message with summary (## Meeting Summary)
  if (isSystem && entry.content?.includes('## Meeting Summary')) {
    return null; // Rendered separately in the summary card below the transcript
  }

  // System agenda/prompt — collapsible card
  if (isSystem && entry.content?.length > 100) {
    return <AgendaCard content={entry.content} />;
  }

  // Short system messages
  if (isSystem) {
    return (
      <div className="flex items-center gap-3 py-2">
        <div className="flex-1 h-px bg-[var(--border)]" />
        <span className="text-[11px] text-[var(--muted)]">{entry.content}</span>
        <div className="flex-1 h-px bg-[var(--border)]" />
      </div>
    );
  }

  // Agent or Human entry
  const isAgent = entry.speakerType === 'AGENT';
  const name = isAgent ? (entry.agent?.name || 'Agent') : (entry.user?.name || 'Human');
  const position = isAgent ? entry.agent?.positions?.[0]?.title : null;
  const avatar = entry.agent?.avatar || entry.user?.avatarUrl;
  const accentColor = isAgent ? 'var(--accent)' : 'var(--success)';

  // Check if same speaker as previous — compact style
  const sameSpeaker = prevEntry && !prevEntry.speakerType?.includes('SYSTEM') && prevEntry.speakerId === entry.speakerId;

  return (
    <div className={`group flex gap-3 px-3 rounded-xl transition-colors hover:bg-white/[0.02] ${sameSpeaker ? 'pt-0.5' : 'pt-3'}`}>
      {/* Avatar */}
      <div className="w-9 flex-shrink-0">
        {!sameSpeaker && (
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold overflow-hidden border-2"
            style={{ borderColor: accentColor, background: isAgent ? 'rgba(108,92,231,0.15)' : 'rgba(0,206,201,0.15)', color: accentColor }}
          >
            {avatar ? <img src={avatar} alt="" className="w-full h-full object-cover" /> : name[0]}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 pb-1">
        {!sameSpeaker && (
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-semibold" style={{ color: accentColor }}>{name}</span>
            {position && <span className="text-[10px] text-[var(--muted)]">{position}</span>}
            {isAgent && <span className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--accent)]/15 text-[var(--accent)] font-medium">AI</span>}
            {entry.createdAt && <span className="text-[10px] text-[var(--muted)] opacity-0 group-hover:opacity-100 transition">{new Date(entry.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
          </div>
        )}
        <div className="prose-entry">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{entry.content}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
}

/* ======================== Agenda Card ======================== */

function AgendaCard({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="my-3 mx-3 rounded-xl border border-[var(--warning)]/20 bg-[var(--warning)]/[0.04] overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-[var(--warning)]/[0.06] transition"
      >
        <span className="text-sm">📋</span>
        <span className="text-xs font-semibold text-[var(--warning)] flex-1">Agenda</span>
        <span className="text-[10px] text-[var(--muted)]">{expanded ? 'Collapse' : 'Expand'}</span>
        <span className="text-[var(--muted)] text-xs">{expanded ? '▲' : '▼'}</span>
      </button>
      {expanded && (
        <div className="px-4 pb-4 prose-entry text-[13px]">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </div>
      )}
    </div>
  );
}

/* ======================== Round Table ======================== */

function RoundTable({ participants, activeSpeakerId, meetingTitle }: { participants: any[]; activeSpeakerId: string | null; meetingTitle: string }) {
  const count = participants.length;
  if (count === 0) return <div className="text-sm text-[var(--muted)]">No participants</div>;
  if (count > 12) return <GridLayout participants={participants} activeSpeakerId={activeSpeakerId} meetingTitle={meetingTitle} />;

  const tableSize = count <= 3 ? 140 : count <= 6 ? 180 : count <= 8 ? 200 : 230;
  const avatarSize = count <= 3 ? 44 : count <= 6 ? 40 : count <= 8 ? 36 : 32;
  const radius = tableSize / 2 + avatarSize / 2 + (count <= 3 ? 20 : 14);
  const containerSize = radius * 2 + avatarSize + 20;

  return (
    <div className="relative" style={{ width: containerSize, height: containerSize }}>
      <div className="absolute rounded-full border-2 border-[var(--border)] flex items-center justify-center"
        style={{ width: tableSize, height: tableSize, top: '50%', left: '50%', transform: 'translate(-50%, -50%)', background: 'rgba(18,18,26,0.8)' }}>
        <div className="text-center px-3">
          <div className="text-[9px] text-[var(--muted)] uppercase tracking-[3px]">Meeting</div>
          <div className="text-[11px] font-semibold text-[var(--accent)] mt-1 leading-tight line-clamp-2 max-w-[120px]">{meetingTitle}</div>
        </div>
      </div>
      {participants.map((p: any, i: number) => {
        const angle = (2 * Math.PI * i) / count - Math.PI / 2;
        return (
          <SeatAvatar key={p.id} participant={p} isSpeaking={activeSpeakerId === p.participantId} size={avatarSize}
            style={{ position: 'absolute', left: `calc(50% + ${Math.cos(angle) * radius}px)`, top: `calc(50% + ${Math.sin(angle) * radius}px)`, transform: 'translate(-50%, -50%)' }} />
        );
      })}
    </div>
  );
}

function GridLayout({ participants, activeSpeakerId, meetingTitle }: { participants: any[]; activeSpeakerId: string | null; meetingTitle: string }) {
  return (
    <div className="w-full flex flex-col items-center gap-4">
      <div className="w-24 h-24 rounded-full border-2 border-[var(--border)] flex items-center justify-center" style={{ background: 'rgba(18,18,26,0.8)' }}>
        <div className="text-center px-2">
          <div className="text-[8px] text-[var(--muted)] uppercase tracking-[2px]">Meeting</div>
          <div className="text-[10px] font-semibold text-[var(--accent)] mt-0.5 leading-tight line-clamp-2">{meetingTitle}</div>
        </div>
      </div>
      <div className="flex flex-wrap justify-center gap-3 max-w-[280px]">
        {participants.map((p: any) => <SeatAvatar key={p.id} participant={p} isSpeaking={activeSpeakerId === p.participantId} size={32} />)}
      </div>
    </div>
  );
}

function SeatAvatar({ participant: p, isSpeaking, size, style }: { participant: any; isSpeaking: boolean; size: number; style?: React.CSSProperties }) {
  const isAgent = p.participantType === 'AGENT';
  const name = p.agent?.name || p.user?.name || '?';
  const role = p.role || 'MEMBER';
  const accentColor = isAgent ? 'var(--accent)' : 'var(--success)';
  const glowColor = isAgent ? 'rgba(108,92,231,0.5)' : 'rgba(0,206,201,0.5)';

  return (
    <div className="flex flex-col items-center" style={style}>
      <div className="rounded-full flex items-center justify-center font-bold overflow-hidden"
        style={{ width: size, height: size, fontSize: size * 0.36, background: accentColor, color: 'white', border: '2px solid var(--background)',
          boxShadow: isSpeaking ? `0 0 0 3px var(--background), 0 0 0 5px ${accentColor}, 0 0 20px ${glowColor}` : 'none', transition: 'box-shadow 0.3s ease' }}>
        {(p.agent?.avatar || p.user?.avatarUrl) ? <img src={p.agent?.avatar || p.user?.avatarUrl} alt="" className="w-full h-full object-cover" /> : name[0]}
      </div>
      <div className="mt-0.5 text-center leading-tight truncate" style={{ fontSize: size <= 32 ? 8 : 9, fontWeight: 600, maxWidth: 64, color: isSpeaking ? accentColor : 'var(--foreground)', transition: 'color 0.3s ease' }}>
        {name.length > 10 ? name.split(' ')[0] : name}
      </div>
      <div className="text-center leading-tight truncate" style={{ fontSize: 7, maxWidth: 64, color: 'var(--muted)' }}>
        {role}{isAgent ? ' · AI' : ''}
      </div>
    </div>
  );
}

function ThinkingDots() {
  return (
    <div className="flex gap-0.5">
      <div className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-bounce" style={{ animationDelay: '0ms' }} />
      <div className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-bounce" style={{ animationDelay: '150ms' }} />
      <div className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-bounce" style={{ animationDelay: '300ms' }} />
    </div>
  );
}
