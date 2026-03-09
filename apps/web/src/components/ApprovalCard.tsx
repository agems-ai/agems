'use client';

import { useState } from 'react';
import { api } from '@/lib/api';

const riskColors: Record<string, string> = {
  LOW: 'bg-gray-500/20 text-gray-400',
  MEDIUM: 'bg-yellow-500/20 text-yellow-400',
  HIGH: 'bg-orange-500/20 text-orange-400',
  CRITICAL: 'bg-red-500/20 text-red-400',
};

const categoryIcons: Record<string, string> = {
  READ: 'R',
  WRITE: 'W',
  DELETE: 'D',
  EXECUTE: 'X',
  SEND: 'S',
  ADMIN: 'A',
  TELEGRAM: 'TG',
};

const statusColors: Record<string, string> = {
  APPROVED: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  REJECTED: 'bg-red-500/20 text-red-400 border-red-500/30',
  EXPIRED: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  AUTO_APPROVED: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
};

interface ApprovalCardProps {
  approval: {
    id: string;
    toolName: string;
    category: string;
    riskLevel: string;
    description: string;
    toolInput: any;
    status: string;
    agentId: string;
    requestedFromType?: string | null;
    requestedFromId?: string | null;
    resolvedByType?: string;
    resolvedById?: string;
    resolvedAt?: string;
    rejectionReason?: string;
    createdAt: string;
  };
  agentName?: string;
  requestedFromName?: string | null;
  resolvedByName?: string | null;
  onResolved?: () => void;
  compact?: boolean;
}

export default function ApprovalCard({ approval, agentName, requestedFromName, resolvedByName, onResolved, compact }: ApprovalCardProps) {
  const [acting, setActing] = useState(false);
  const [localStatus, setLocalStatus] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectInput, setShowRejectInput] = useState(false);

  const effectiveStatus = localStatus || approval.status;
  const isPending = effectiveStatus === 'PENDING';
  const isTelegramAccess = approval.toolName === 'telegram_access';
  const isAgentApproval = approval.toolName === 'agent_approval_request';
  const tgInput = (isTelegramAccess && approval.toolInput) ? approval.toolInput as any : {};

  const handleApprove = async () => {
    setActing(true);
    try {
      await api.approveRequest(approval.id);
      setLocalStatus('APPROVED');
      onResolved?.();
    } catch { /* noop */ }
    setActing(false);
  };

  const handleReject = async () => {
    if (!showRejectInput) {
      setShowRejectInput(true);
      return;
    }
    setActing(true);
    try {
      await api.rejectRequest(approval.id, rejectReason || undefined);
      setLocalStatus('REJECTED');
      setShowRejectInput(false);
      onResolved?.();
    } catch { /* noop */ }
    setActing(false);
  };

  return (
    <div className={`rounded-xl border ${isPending ? 'border-amber-500/30 bg-amber-500/5' : 'border-[var(--border)] bg-[var(--card)]'} ${compact ? 'p-3' : 'p-4'}`}>
      {/* Header */}
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${riskColors[approval.riskLevel] || riskColors.MEDIUM}`}>
          {approval.riskLevel}
        </span>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--accent)]/10 text-[var(--accent)] font-medium">
          {isTelegramAccess ? 'TG TELEGRAM ACCESS' : isAgentApproval ? 'AP APPROVAL' : `${categoryIcons[approval.category] || '?'} ${approval.category}`}
        </span>

        {/* From → To flow */}
        <span className="text-xs flex items-center gap-1">
          <span className="text-[var(--accent)] font-medium">{agentName || 'Agent'}</span>
          {requestedFromName && (
            <>
              <span className="text-[var(--muted)]">&rarr;</span>
              <span className="text-white font-medium">{requestedFromName}</span>
            </>
          )}
        </span>

        {!isPending && (
          <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ml-auto ${statusColors[effectiveStatus] || ''}`}>
            {effectiveStatus}
          </span>
        )}
      </div>

      {/* Description */}
      <p className="text-sm mb-2">{approval.description}</p>

      {/* Telegram access — show user info */}
      {isTelegramAccess ? (
        <div className="text-xs text-[var(--muted)] mb-2 flex items-center gap-2">
          <span className="text-base">&#128172;</span>
          <span>
            {tgInput.firstName}{tgInput.username ? ` (@${tgInput.username})` : ''}
            {' '}&middot; Chat ID: <span className="font-mono">{tgInput.telegramChatId}</span>
          </span>
        </div>
      ) : (
        <>
          {/* Tool name — hide for agent_approval_request since description covers it */}
          {!isAgentApproval && (
            <div className="text-xs text-[var(--muted)] mb-2">
              Tool: <span className="font-mono text-[var(--accent)]">{approval.toolName}</span>
            </div>
          )}

          {/* Expandable details */}
          {approval.toolInput && (
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="text-[10px] text-[var(--muted)] hover:text-white transition mb-2"
            >
              {showDetails ? 'Hide details' : 'Show details'}
            </button>
          )}
          {showDetails && approval.toolInput && (
            <pre className="text-xs bg-[var(--bg)] border border-[var(--border)] rounded-lg p-3 mb-2 max-h-40 overflow-auto">
              {typeof approval.toolInput === 'string' ? approval.toolInput : JSON.stringify(approval.toolInput, null, 2)}
            </pre>
          )}
        </>
      )}

      {/* Rejection reason */}
      {approval.rejectionReason && (
        <p className="text-xs text-red-400 mb-2">Reason: {approval.rejectionReason}</p>
      )}

      {/* Resolution info */}
      {!isPending && approval.resolvedAt && (
        <p className="text-[10px] text-[var(--muted)]">
          {approval.status === 'AUTO_APPROVED'
            ? 'Auto-approved'
            : `Resolved by ${resolvedByName || approval.resolvedByType || 'unknown'}`
          } at {new Date(approval.resolvedAt).toLocaleString()}
        </p>
      )}

      {/* Action buttons */}
      {isPending && (
        <div className="flex items-center gap-2 mt-3">
          <button
            onClick={handleApprove}
            disabled={acting}
            className="px-4 py-1.5 bg-emerald-500 text-white rounded-lg text-xs font-medium hover:bg-emerald-600 disabled:opacity-40 transition"
          >
            {acting ? '...' : 'Approve'}
          </button>
          <button
            onClick={handleReject}
            disabled={acting}
            className="px-4 py-1.5 bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg text-xs font-medium hover:bg-red-500/30 disabled:opacity-40 transition"
          >
            Reject
          </button>
          {showRejectInput && (
            <input
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Reason (optional)"
              className="flex-1 px-3 py-1.5 text-xs rounded-lg border border-[var(--border)] bg-[var(--bg)]"
              onKeyDown={(e) => e.key === 'Enter' && handleReject()}
              autoFocus
            />
          )}
        </div>
      )}
    </div>
  );
}
