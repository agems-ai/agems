'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '@/lib/api';
import { getCommsSocket } from '@/lib/socket';
import {
  Paperclip, X, FileText, Send, Square,
  ChevronDown, ChevronRight, Wrench, Cpu, Clock, Zap, BookOpen, Brain,
} from 'lucide-react';
import ApprovalCard from '@/components/ApprovalCard';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/* ── Types ── */

interface ChatPanelProps {
  /** Channel ID to connect to. If empty, chat is disabled. */
  channelId: string;
  /** Current user ID for "isMe" detection */
  currentUserId: string;
  /** Resolve sender name + avatar from type + id */
  nameMap: (type: string, id: string) => { name: string; avatar?: string | null; role?: string };
  /** Optional placeholder text */
  placeholder?: string;
  /** Height override (default: flex-1) */
  height?: string;
  /** Called when approval is resolved (to refresh external data) */
  onApprovalResolved?: () => void;
  /** Auto-create direct channel if needed */
  autoCreateChannel?: { targetType: string; targetId: string };
  /** External channel ID setter (for auto-create flow) */
  onChannelCreated?: (channelId: string) => void;
  /** Empty state JSX */
  emptyState?: React.ReactNode;
  /** Class overrides */
  className?: string;
}

/* ── Avatar ── */

function Avatar({ name, avatar, size = 28 }: { name: string; avatar?: string | null; size?: number }) {
  if (avatar && avatar.startsWith('/')) {
    return <img src={avatar} alt={name} className="rounded-full object-cover shrink-0" style={{ width: size, height: size }} />;
  }
  const letter = avatar || name?.[0]?.toUpperCase() || '?';
  return (
    <div className="rounded-full bg-[var(--accent)]/20 flex items-center justify-center shrink-0 text-xs font-medium"
      style={{ width: size, height: size }}>
      {letter}
    </div>
  );
}

/* ── Execution Details (tool calls, thinking, skills) ── */

function ExecutionDetails({ execution }: { execution: any }) {
  const [expanded, setExpanded] = useState(true);
  const [expandedTools, setExpandedTools] = useState<Set<number>>(new Set());
  const [expandedThinking, setExpandedThinking] = useState(true);

  const toggleTool = (i: number) => {
    setExpandedTools(prev => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  };

  const toolCalls = execution.toolCalls || [];
  const skills = execution.skills || [];
  const thinking = execution.thinking || [];
  const screenshots = execution.screenshots || [];
  const [screenshotFull, setScreenshotFull] = useState<string | null>(null);
  if (toolCalls.length === 0 && skills.length === 0 && thinking.length === 0 && screenshots.length === 0 && execution.iterations <= 1) return null;

  return (
    <div className="mt-1.5">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-[10px] text-[var(--muted)] hover:text-white transition"
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Cpu size={10} />
        {thinking.length > 0 && <><Brain size={10} className="text-purple-400" /><span>{thinking.length} thought{thinking.length !== 1 ? 's' : ''}</span></>}
        {thinking.length > 0 && (skills.length > 0 || toolCalls.length > 0) && <span className="opacity-50">·</span>}
        {skills.length > 0 && <span>{skills.length} skill{skills.length !== 1 ? 's' : ''}</span>}
        {skills.length > 0 && toolCalls.length > 0 && <span className="opacity-50">·</span>}
        {toolCalls.length > 0 && <span>{toolCalls.length} tool call{toolCalls.length !== 1 ? 's' : ''}</span>}
        <span className="opacity-50">·</span>
        <span>{execution.iterations} step{execution.iterations !== 1 ? 's' : ''}</span>
        {execution.tokensUsed && (
          <>
            <span className="opacity-50">·</span>
            <Zap size={10} />
            <span>{execution.tokensUsed.input + execution.tokensUsed.output} tok</span>
          </>
        )}
        {execution.loopDetected && (
          <>
            <span className="opacity-50">·</span>
            <span className="text-yellow-400">loop detected</span>
          </>
        )}
      </button>
      {expanded && (
        <div className="mt-1.5 space-y-1 border-l-2 border-[var(--accent)]/30 pl-2">
          {thinking.length > 0 && (
            <div className="mb-1">
              <button
                onClick={() => setExpandedThinking(!expandedThinking)}
                className="flex items-center gap-1 text-[10px] text-[var(--muted)] uppercase mb-0.5 hover:text-white transition"
              >
                {expandedThinking ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                <Brain size={10} className="text-purple-400" />
                <span>Thinking</span>
              </button>
              {expandedThinking && (
                <div className="space-y-1.5 ml-1">
                  {thinking.map((t: string, i: number) => (
                    <pre key={i} className="text-[10px] text-purple-300/80 bg-purple-500/5 rounded px-2 py-1.5 whitespace-pre-wrap break-all font-mono max-h-40 overflow-y-auto overflow-x-hidden">
                      {t}
                    </pre>
                  ))}
                </div>
              )}
            </div>
          )}
          {skills.length > 0 && (
            <div className="mb-1">
              <div className="text-[10px] text-[var(--muted)] uppercase mb-0.5">Skills</div>
              {skills.map((name: string, i: number) => (
                <div key={i} className="flex items-center gap-1 text-[11px]">
                  <BookOpen size={10} className="text-blue-400" />
                  <span className="text-[var(--muted)]">{name}</span>
                </div>
              ))}
            </div>
          )}
          {toolCalls.length > 0 && (
            <div>
              {skills.length > 0 && <div className="text-[10px] text-[var(--muted)] uppercase mb-0.5">Tool Calls</div>}
              {toolCalls.map((tc: any, i: number) => (
                <div key={i} className="text-[11px]">
                  <button
                    onClick={() => toggleTool(i)}
                    className="flex items-center gap-1 text-[var(--muted)] hover:text-white transition w-full text-left"
                  >
                    {expandedTools.has(i) ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                    <Wrench size={10} className={tc.error ? 'text-red-400' : 'text-green-400'} />
                    <span className="font-mono">{tc.toolName}</span>
                    <Clock size={10} className="ml-auto opacity-50" />
                    <span className="opacity-50">{tc.durationMs}ms</span>
                  </button>
                  {expandedTools.has(i) && (
                    <div className="ml-4 mt-1 space-y-1">
                      <div>
                        <span className="text-[10px] text-[var(--muted)] uppercase">Input:</span>
                        <pre className="text-[10px] bg-black/20 rounded px-2 py-1 overflow-x-auto max-h-32 whitespace-pre-wrap font-mono">
                          {JSON.stringify(tc.input, null, 2)}
                        </pre>
                      </div>
                      <div>
                        <span className="text-[10px] text-[var(--muted)] uppercase">{tc.error ? 'Error:' : 'Output:'}</span>
                        <pre className={`text-[10px] rounded px-2 py-1 overflow-x-auto max-h-32 whitespace-pre-wrap font-mono ${tc.error ? 'bg-red-500/10 text-red-300' : 'bg-black/20'}`}>
                          {tc.error || JSON.stringify(tc.output, null, 2)?.substring(0, 500)}
                        </pre>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Screenshots */}
          {screenshots.length > 0 && (
            <div>
              <div className="text-[10px] text-[var(--muted)] uppercase mb-0.5">Browser Screenshots</div>
              <div className="flex gap-2 flex-wrap">
                {screenshots.map((frame: string, i: number) => (
                  <img
                    key={i}
                    src={`data:image/jpeg;base64,${frame}`}
                    alt={`Screenshot ${i + 1}`}
                    className="rounded-lg border border-[var(--border)] w-28 h-16 object-cover cursor-pointer hover:border-cyan-400/50 transition"
                    onClick={() => setScreenshotFull(frame)}
                  />
                ))}
              </div>
              {screenshotFull && (
                <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center" onClick={() => setScreenshotFull(null)}>
                  <img src={`data:image/jpeg;base64,${screenshotFull}`} alt="Screenshot" className="rounded-xl border border-white/10 max-w-[90vw] max-h-[90vh] object-contain" />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Main ChatPanel Component ── */

export default function ChatPanel({
  channelId: externalChannelId,
  currentUserId,
  nameMap,
  placeholder = 'Type a message...',
  height,
  onApprovalResolved,
  autoCreateChannel,
  onChannelCreated,
  emptyState,
  className = '',
}: ChatPanelProps) {
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<Array<{ file: File; preview?: string }>>([]);
  const [uploading, setUploading] = useState(false);
  const [agentThinking, setAgentThinking] = useState<Map<string, {
    agentName: string;
    executionId: string;
    toolCalls: Array<{ toolName: string; status: string; durationMs?: number; error?: string }>;
    thinkingText: string;
    streamingText: string;
    browserFrame?: string;
  }>>(new Map());
  const [chatBrowserExpanded, setChatBrowserExpanded] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<any>(null);
  const prevChannelRef = useRef('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const channelIdRef = useRef(externalChannelId);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  channelIdRef.current = externalChannelId;

  // Load messages when channel changes
  useEffect(() => {
    if (externalChannelId) {
      api.getMessages(externalChannelId, { pageSize: '100' }).then((res: any) => {
        setMessages(res.data || []);
      }).catch(() => setMessages([]));
    } else {
      setMessages([]);
    }
    setAgentThinking(new Map());
  }, [externalChannelId]);

  // Socket connection
  useEffect(() => {
    const socket = getCommsSocket();
    socketRef.current = socket;
    socket.connect();

    socket.on('new_message', (msg: any) => {
      setMessages(prev => {
        // Dedup: skip if already added via optimistic update
        if (msg.id && prev.some(m => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
    });

    socket.on('approval_resolved', () => {
      if (channelIdRef.current) {
        api.getMessages(channelIdRef.current, { pageSize: '100' }).then((res: any) => setMessages(res.data || []));
      }
      onApprovalResolved?.();
    });

    // Agent execution live tracking — filtered by channel
    socket.on('agent_thinking', (data: any) => {
      if (data.channelId && data.channelId !== channelIdRef.current) return;
      setAgentThinking(prev => {
        const next = new Map(prev);
        if (data.status === 'done') {
          next.delete(data.agentId);
        } else {
          const prev_entry = next.get(data.agentId);
          next.set(data.agentId, {
            agentName: data.agentName,
            executionId: data.executionId,
            toolCalls: prev_entry?.toolCalls || [],
            thinkingText: prev_entry?.thinkingText || '',
            streamingText: prev_entry?.streamingText || '',
          });
        }
        return next;
      });
    });

    // Re-join channel room after reconnect (server lost room state)
    socket.on('connect', () => {
      if (channelIdRef.current) {
        socket.emit('join_channel', { channelId: channelIdRef.current });
      }
    });

    socket.on('agent_tool_update', (data: any) => {
      if (data.channelId && data.channelId !== channelIdRef.current) return;
      setAgentThinking(prev => {
        const next = new Map(prev);
        const entry = next.get(data.agentId);
        if (!entry) return prev;
        const existing = entry.toolCalls.findIndex(
          tc => tc.toolName === data.toolName && tc.status === 'running',
        );
        if (data.status === 'running') {
          entry.toolCalls.push({ toolName: data.toolName, status: 'running' });
        } else if (existing >= 0) {
          entry.toolCalls[existing] = {
            toolName: data.toolName,
            status: data.status,
            durationMs: data.durationMs,
            error: data.error,
          };
        }
        next.set(data.agentId, { ...entry });
        return next;
      });
    });

    socket.on('agent_thinking_chunk', (data: any) => {
      if (data.channelId && data.channelId !== channelIdRef.current) return;
      setAgentThinking(prev => {
        const next = new Map(prev);
        const entry = next.get(data.agentId);
        if (!entry) return prev;
        next.set(data.agentId, { ...entry, thinkingText: entry.thinkingText + data.chunk });
        return next;
      });
    });

    socket.on('agent_text_chunk', (data: any) => {
      if (data.channelId && data.channelId !== channelIdRef.current) return;
      setAgentThinking(prev => {
        const next = new Map(prev);
        const entry = next.get(data.agentId);
        if (!entry) return prev;
        next.set(data.agentId, { ...entry, streamingText: entry.streamingText + data.chunk });
        return next;
      });
    });

    // Browser live frame
    socket.on('agent_browser_frame', (data: any) => {
      if (data.channelId && data.channelId !== channelIdRef.current) return;
      setAgentThinking(prev => {
        const next = new Map(prev);
        const entry = next.get(data.agentId);
        if (!entry) return prev;
        next.set(data.agentId, { ...entry, browserFrame: data.frame });
        return next;
      });
    });

    return () => {
      socket.off('new_message');
      socket.off('approval_resolved');
      socket.off('agent_thinking');
      socket.off('agent_tool_update');
      socket.off('agent_thinking_chunk');
      socket.off('agent_text_chunk');
      socket.off('agent_browser_frame');
      socket.off('connect');
      socket.disconnect();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Join/leave channel rooms
  useEffect(() => {
    if (!socketRef.current) return;
    if (prevChannelRef.current) socketRef.current.emit('leave_channel', { channelId: prevChannelRef.current });
    if (externalChannelId) socketRef.current.emit('join_channel', { channelId: externalChannelId });
    prevChannelRef.current = externalChannelId;
  }, [externalChannelId]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, agentThinking]);

  // Send message
  const sendMessage = useCallback(async () => {
    if (!input.trim() && pendingFiles.length === 0) return;

    let chId = externalChannelId;

    // Auto-create channel on first message
    if (!chId && autoCreateChannel) {
      try {
        const ch = await api.createChannel({
          type: 'DIRECT',
          targetType: autoCreateChannel.targetType,
          targetId: autoCreateChannel.targetId,
        });
        chId = (ch as any).id;
        onChannelCreated?.(chId);
        socketRef.current?.emit('join_channel', { channelId: chId });
      } catch {
        const found = await api.findDirectChannel(autoCreateChannel.targetType, autoCreateChannel.targetId).catch(() => null) as any;
        if (found?.id) {
          chId = found.id;
          onChannelCreated?.(chId);
        }
      }
    }
    if (!chId) return;

    setSending(true);
    if (pendingFiles.length > 0) {
      setUploading(true);
      try {
        const uploaded = await Promise.all(pendingFiles.map(pf => api.uploadFile(chId, pf.file)));
        const msg = await api.sendMessage(chId, input.trim() || 'Sent files', 'FILE', {
          files: uploaded,
          text: input.trim() || undefined,
        });
        if (msg?.id) setMessages(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, msg]);
        pendingFiles.forEach(pf => pf.preview && URL.revokeObjectURL(pf.preview));
        setPendingFiles([]);
      } catch (err: any) {
        alert(err.message || 'Upload failed');
      }
      setUploading(false);
    } else {
      try {
        const msg = await api.sendMessage(chId, input.trim());
        if (msg?.id) setMessages(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, msg]);
      } catch {}
    }
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    setSending(false);
  }, [input, pendingFiles, externalChannelId, autoCreateChannel, onChannelCreated]);

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) setPendingFiles(prev => [...prev, { file, preview: URL.createObjectURL(file) }]);
        return;
      }
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    setPendingFiles(prev => [...prev, ...Array.from(files).map(file => ({
      file,
      preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
    }))]);
    e.target.value = '';
  };

  const removePendingFile = (index: number) => {
    setPendingFiles(prev => {
      const removed = prev[index];
      if (removed?.preview) URL.revokeObjectURL(removed.preview);
      return prev.filter((_, i) => i !== index);
    });
  };

  // Render a single message
  const renderMessage = (msg: any, i: number) => {
    const isMe = msg.senderType === 'HUMAN' && msg.senderId === currentUserId;
    const senderInfo = nameMap(msg.senderType, msg.senderId);

    // APPROVAL_REQUEST ACTION messages
    if (msg.contentType === 'ACTION') {
      try {
        const payload = typeof msg.content === 'string' ? JSON.parse(msg.content) : msg.content;
        if (payload.type === 'APPROVAL_REQUEST' && (payload.approval || payload.approvalId)) {
          const approvalData = payload.approval || {
            id: payload.approvalId,
            toolName: payload.toolName,
            category: payload.category,
            riskLevel: payload.riskLevel,
            description: payload.description,
            toolInput: payload.toolInput,
            status: payload.status,
            agentId: msg.senderId || '',
            createdAt: msg.createdAt,
          };
          return (
            <div key={msg.id || i} className="flex justify-start gap-2">
              <Avatar name={senderInfo.name} avatar={senderInfo.avatar} size={28} />
              <div className="max-w-[80%]">
                <div className="text-xs opacity-70 mb-1">{senderInfo.name}{senderInfo.role ? <span className="ml-1 opacity-60">· {senderInfo.role}</span> : ''}</div>
                <ApprovalCard
                  approval={approvalData}
                  agentName={payload.agentName}
                  compact
                  onResolved={() => {
                    if (channelIdRef.current) {
                      api.getMessages(channelIdRef.current, { pageSize: '100' }).then((res: any) => setMessages(res.data || []));
                    }
                    onApprovalResolved?.();
                  }}
                />
                <div className="text-[10px] opacity-50 mt-1">
                  {msg.createdAt ? new Date(msg.createdAt).toLocaleTimeString() : ''}
                </div>
              </div>
            </div>
          );
        }
      } catch { /* fall through to regular rendering */ }
      // Non-approval ACTION — render as muted text
      return (
        <div key={msg.id || i} className="flex justify-start gap-2">
          <Avatar name={senderInfo.name} avatar={senderInfo.avatar} size={28} />
          <div className="max-w-[75%] rounded-xl px-4 py-2 bg-[var(--card)] border border-[var(--border)]">
            <p className="text-xs text-[var(--muted)] italic">{msg.content}</p>
          </div>
        </div>
      );
    }

    // FILE messages
    if (msg.contentType === 'FILE' && msg.metadata?.files) {
      const meta = msg.metadata as any;
      const files = meta.files as any[];
      const textContent = meta.text;
      return (
        <div key={msg.id || i} className={`flex items-end gap-2 ${isMe ? 'justify-end' : 'justify-start'}`}>
          {!isMe && <Avatar name={senderInfo.name} avatar={senderInfo.avatar} size={28} />}
          <div className={`max-w-[70%] rounded-xl px-4 py-2 ${
            isMe ? 'bg-[var(--accent)] text-white' : 'bg-[var(--card)] border border-[var(--border)]'
          }`}>
            {!isMe && <div className="text-xs opacity-70 mb-1">{senderInfo.name}{senderInfo.role ? <span className="ml-1 opacity-60">· {senderInfo.role}</span> : ''}</div>}
            <div className="space-y-2">
              {files.map((f: any, fi: number) =>
                f.mimetype?.startsWith('image/') ? (
                  <a key={fi} href={f.url} target="_blank" rel="noopener noreferrer" className="block">
                    <img src={f.url} alt={f.originalName || 'Image'} className="rounded-lg max-w-[300px] max-h-[300px] object-contain" />
                  </a>
                ) : (
                  <a key={fi} href={f.url} target="_blank" rel="noopener noreferrer"
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${isMe ? 'border-white/20' : 'border-[var(--border)] bg-[var(--bg)]'}`}>
                    <FileText size={16} />
                    <div className="min-w-0">
                      <div className="text-xs font-medium truncate">{f.originalName || f.filename}</div>
                      <div className="text-[10px] opacity-60">{Math.round((f.size || 0) / 1024)} KB</div>
                    </div>
                  </a>
                ),
              )}
              {textContent && <div className="text-sm">{textContent}</div>}
            </div>
            <div className="text-[10px] opacity-50 mt-1">
              {msg.createdAt ? new Date(msg.createdAt).toLocaleTimeString() : ''}
            </div>
          </div>
        </div>
      );
    }

    // Regular TEXT messages
    return (
      <div key={msg.id || i} className={`flex items-end gap-2 ${isMe ? 'justify-end' : 'justify-start'}`}>
        {!isMe && <Avatar name={senderInfo.name} avatar={senderInfo.avatar} size={28} />}
        <div className={`max-w-[70%] rounded-xl px-4 py-2 overflow-hidden ${
          isMe ? 'bg-[var(--accent)] text-white' : 'bg-[var(--card)] border border-[var(--border)]'
        }`}>
          {!isMe && <div className="text-xs opacity-70 mb-1">{senderInfo.name}{senderInfo.role ? <span className="ml-1 opacity-60">· {senderInfo.role}</span> : ''}</div>}
          <div className="text-sm whitespace-pre-wrap break-words prose prose-sm prose-invert max-w-none
            prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5
            prose-headings:my-2 prose-headings:font-semibold
            prose-a:text-[var(--accent)] prose-a:underline
            prose-img:rounded-lg prose-img:max-w-[300px] prose-img:max-h-[300px]
            prose-strong:text-inherit prose-em:text-inherit
            prose-code:text-[var(--accent)] prose-code:bg-[var(--bg)] prose-code:px-1 prose-code:rounded
            prose-pre:bg-[var(--bg)] prose-pre:rounded-lg prose-pre:p-3 prose-pre:overflow-x-auto">
            <ReactMarkdown remarkPlugins={[remarkGfm]}
              components={{
                img: ({ src, alt }) => (
                  <a href={src as string} target="_blank" rel="noopener noreferrer" className="block">
                    <img src={src as string} alt={alt || 'Image'} className="rounded-lg max-w-[300px] max-h-[300px] object-contain" />
                  </a>
                ),
                p: ({ children }) => <p className="my-1">{children}</p>,
                a: ({ href, children }) => (
                  <a href={href} target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] underline">{children}</a>
                ),
              }}
            >{msg.content || ''}</ReactMarkdown>
          </div>
          {msg.metadata?.execution && <ExecutionDetails execution={msg.metadata.execution} />}
          <div className="text-[10px] opacity-50 mt-1">
            {msg.createdAt ? new Date(msg.createdAt).toLocaleTimeString() : ''}
          </div>
        </div>
      </div>
    );
  };

  const stopExecution = useCallback(() => {
    socketRef.current?.emit('stop_execution', { channelId: channelIdRef.current });
    setAgentThinking(new Map());
  }, []);

  const showInput = externalChannelId || autoCreateChannel;

  return (
    <div className={`flex flex-col min-h-0 ${className}`} style={height ? { height } : { flex: 1 }}>
      {/* Messages */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-4 flex flex-col">
        <div className="mt-auto space-y-3">
        {messages.length === 0 && emptyState ? (
          emptyState
        ) : messages.length === 0 ? (
          <p className="text-sm text-[var(--muted)] text-center py-8">No messages yet.</p>
        ) : (
          messages.map(renderMessage)
        )}

        {/* Live agent thinking indicators */}
        {Array.from(agentThinking.entries()).map(([agentId, state]) => {
          const info = nameMap('AGENT', agentId);
          const runningTools = state.toolCalls.filter(tc => tc.status === 'running');
          const completedTools = state.toolCalls.filter(tc => tc.status !== 'running');
          return (
            <div key={agentId} className="flex items-start gap-2">
              <Avatar name={info.name} avatar={info.avatar} size={28} />
              <div className="max-w-[80%] rounded-xl px-4 py-3 bg-[var(--card)] border border-[var(--border)] border-dashed overflow-hidden">
                <div className="text-xs opacity-70 mb-1 flex items-center justify-between">
                  <span>{info.name}</span>
                  <button
                    onClick={stopExecution}
                    className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 hover:text-red-300 transition"
                  >
                    <Square size={10} fill="currentColor" />
                    Stop
                  </button>
                </div>

                {/* Thinking text (reasoning) */}
                {state.thinkingText && (
                  <div className="mb-2 text-xs text-purple-300/80 bg-purple-500/5 rounded-lg px-3 py-2 max-h-[120px] overflow-y-auto overflow-x-hidden border border-purple-500/10 min-w-0">
                    <div className="flex items-center gap-1 mb-1 text-purple-400/60 text-[10px] font-medium">
                      <Brain size={10} />
                      <span>Thinking</span>
                    </div>
                    <div className="whitespace-pre-wrap break-all">{state.thinkingText}</div>
                  </div>
                )}

                {/* Streaming response text */}
                {state.streamingText ? (
                  <div className="text-sm whitespace-pre-wrap break-all mb-1">{state.streamingText}<span className="inline-block w-1.5 h-4 bg-[var(--accent)] animate-pulse ml-0.5 align-text-bottom" /></div>
                ) : !state.thinkingText && (
                  <div className="flex items-center gap-2 text-sm text-[var(--muted)] animate-pulse">
                    <div className="flex gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                    <span>Thinking...</span>
                  </div>
                )}

                {/* Tool calls */}
                {state.toolCalls.length > 0 && (
                  <div className="mt-2 space-y-1 border-l-2 border-[var(--accent)]/30 pl-2">
                    {completedTools.map((tc, i) => (
                      <div key={i} className="flex items-center gap-1 text-[11px]">
                        <Wrench size={10} className={tc.error ? 'text-red-400' : 'text-green-400'} />
                        <span className="font-mono text-[var(--muted)]">{tc.toolName}</span>
                        {tc.durationMs && <span className="text-[var(--muted)] opacity-50 ml-auto">{tc.durationMs}ms</span>}
                        {tc.error ? <span className="text-red-400 text-[10px]">failed</span> : <span className="text-green-400 text-[10px]">done</span>}
                      </div>
                    ))}
                    {runningTools.map((tc, i) => (
                      <div key={`r-${i}`} className="flex items-center gap-1 text-[11px]">
                        <Wrench size={10} className="text-yellow-400 animate-spin" />
                        <span className="font-mono text-white">{tc.toolName}</span>
                        <span className="text-yellow-400 text-[10px] ml-auto">running...</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Browser Live Preview */}
                {state.browserFrame && (
                  <div className="mt-2">
                    <div className="flex items-center gap-1 text-[10px] text-[var(--muted)] mb-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                      <span>Browser Live</span>
                    </div>
                    <img
                      src={`data:image/jpeg;base64,${state.browserFrame}`}
                      alt="Browser"
                      className="rounded-lg border border-[var(--border)] w-full max-w-[400px]"
                    />
                  </div>
                )}
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input area */}
      {showInput && (
        <div className="border-t border-[var(--border)] shrink-0">
          {/* File preview strip */}
          {pendingFiles.length > 0 && (
            <div className="px-4 pt-3 flex gap-2 flex-wrap">
              {pendingFiles.map((pf, i) => (
                <div key={i} className="relative group">
                  {pf.preview ? (
                    <img src={pf.preview} alt="" className="w-16 h-16 rounded-lg object-cover border border-[var(--border)]" />
                  ) : (
                    <div className="w-16 h-16 rounded-lg border border-[var(--border)] bg-[var(--bg)] flex flex-col items-center justify-center">
                      <FileText size={20} className="text-[var(--muted)]" />
                      <span className="text-[8px] text-[var(--muted)] mt-0.5 truncate max-w-[56px] px-1">{pf.file.name}</span>
                    </div>
                  )}
                  <button
                    onClick={() => removePendingFile(i)}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
              {uploading && <span className="text-xs text-[var(--muted)] self-center">Uploading...</span>}
            </div>
          )}
          {/* Input row */}
          <div className="flex gap-2 p-4">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,.pdf,.txt,.csv,.json,.md"
              onChange={handleFileSelect}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="p-2 rounded-lg border border-[var(--border)] text-[var(--muted)] hover:text-white hover:border-[var(--accent)] transition shrink-0"
              title="Attach file"
            >
              <Paperclip size={18} />
            </button>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={e => {
                setInput(e.target.value);
                const el = e.target;
                el.style.height = 'auto';
                el.style.height = Math.min(el.scrollHeight, 120) + 'px';
              }}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              onPaste={handlePaste}
              placeholder={pendingFiles.length > 0 ? 'Add a caption...' : placeholder}
              disabled={sending}
              rows={1}
              className="flex-1 px-4 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] focus:outline-none focus:border-[var(--accent)] text-sm disabled:opacity-50 resize-none overflow-y-auto overflow-x-hidden"
              style={{ maxHeight: '120px', lineHeight: '1.5' }}
            />
            <button
              onClick={sendMessage}
              disabled={sending || uploading || (!input.trim() && pendingFiles.length === 0)}
              className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg hover:opacity-90 disabled:opacity-40 transition shrink-0"
            >
              {uploading ? '...' : <Send size={16} />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Re-export for use by parent pages
export { Avatar, ExecutionDetails };
