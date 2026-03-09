'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { MessageSquare, Camera } from 'lucide-react';

export default function EmployeesPage() {
  const router = useRouter();
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState<any>(null);
  const [form, setForm] = useState({ name: '', email: '', role: 'MEMBER', password: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);

  const handleAvatarClick = (userId: string) => {
    setUploadingId(userId);
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !uploadingId) return;
    try {
      const updated = await api.uploadUserAvatar(uploadingId, file);
      setUsers(users.map((u) => (u.id === uploadingId ? { ...u, ...(updated as Record<string, any>) } : u)));
    } catch (err: any) {
      alert(err.message || 'Upload failed');
    } finally {
      setUploadingId(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  useEffect(() => {
    api.getUsers().then(setUsers).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const openCreate = () => {
    setEditingUser(null);
    setForm({ name: '', email: '', role: 'MEMBER', password: '' });
    setError('');
    setShowModal(true);
  };

  const openEdit = (user: any) => {
    setEditingUser(user);
    setForm({ name: user.name, email: user.email, role: user.role, password: '' });
    setError('');
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.email.trim()) {
      setError('Name and email are required');
      return;
    }
    if (!editingUser && !form.password.trim()) {
      setError('Password is required for new employees');
      return;
    }
    setSaving(true);
    setError('');
    try {
      if (editingUser) {
        const data: any = { name: form.name, email: form.email, role: form.role };
        if (form.password.trim()) data.password = form.password;
        const updated = await api.updateUser(editingUser.id, data);
        setUsers(users.map((u) => (u.id === editingUser.id ? { ...u, ...(updated as Record<string, any>) } : u)));
      } else {
        const created = await api.createUser({
          name: form.name,
          email: form.email,
          password: form.password,
          role: form.role,
        });
        setUsers([...users, created]);
      }
      setShowModal(false);
    } catch (e: any) {
      setError(e.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (userId: string) => {
    try {
      await api.deleteUser(userId);
      setUsers(users.filter((u) => u.id !== userId));
      setDeleteConfirm(null);
    } catch (e: any) {
      alert(e.message || 'Failed to delete');
    }
  };

  const handleRoleChange = async (userId: string, role: string) => {
    try {
      const updated = await api.updateUser(userId, { role });
      setUsers(users.map((u) => (u.id === userId ? { ...u, ...(updated as Record<string, any>) } : u)));
    } catch { /* noop */ }
  };

  const roleBadge: Record<string, string> = {
    ADMIN: 'bg-purple-500/20 text-purple-400',
    MANAGER: 'bg-blue-500/20 text-blue-400',
    MEMBER: 'bg-gray-500/20 text-gray-400',
    VIEWER: 'bg-green-500/20 text-green-400',
  };

  const roleDesc: Record<string, string> = {
    ADMIN: 'Full access to all features',
    MANAGER: 'Manage agents and workflows',
    MEMBER: 'View and execute agents',
    VIEWER: 'Read-only access',
  };

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold mb-1">Employees</h1>
          <p className="text-[var(--muted)] text-sm">Manage team members and their access roles</p>
        </div>
        <button onClick={openCreate} className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg hover:opacity-90 text-sm">
          + Add Employee
        </button>
      </div>

      {loading ? (
        <p className="text-[var(--muted)]">Loading...</p>
      ) : users.length === 0 ? (
        <div className="text-center py-20 border border-dashed border-[var(--border)] rounded-xl">
          <p className="text-4xl mb-4">👥</p>
          <p className="text-lg font-medium mb-2">No employees yet</p>
          <p className="text-[var(--muted)] mb-4">Add team members to collaborate on agents</p>
          <button onClick={openCreate} className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg">
            + Add Employee
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {users.map((user) => (
            <div key={user.id} className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-3 md:p-4 flex items-center gap-2 md:gap-4 flex-wrap">
              <button
                onClick={() => handleAvatarClick(user.id)}
                className="relative w-10 h-10 rounded-full shrink-0 group cursor-pointer"
                title="Upload photo"
              >
                {user.avatarUrl ? (
                  <img src={user.avatarUrl} alt={user.name} className="w-10 h-10 rounded-full object-cover" />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-[var(--accent)]/20 flex items-center justify-center text-lg font-medium">
                    {user.name?.[0]?.toUpperCase() || '?'}
                  </div>
                )}
                <div className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <Camera size={14} className="text-white" />
                </div>
              </button>
              <div className="flex-1 min-w-0">
                <div className="font-medium">{user.name}</div>
                <div className="text-sm text-[var(--muted)] truncate">{user.email}</div>
              </div>
              <select
                value={user.role}
                onChange={(e) => handleRoleChange(user.id, e.target.value)}
                className={`px-3 py-1 rounded-lg text-xs font-medium border-0 cursor-pointer ${roleBadge[user.role] || 'bg-gray-500/20 text-gray-400'}`}
              >
                <option value="ADMIN">ADMIN</option>
                <option value="MANAGER">MANAGER</option>
                <option value="MEMBER">MEMBER</option>
                <option value="VIEWER">VIEWER</option>
              </select>
              <div className="text-xs text-[var(--muted)] w-24 text-right shrink-0 hidden md:block">
                {user.createdAt ? new Date(user.createdAt).toLocaleDateString() : ''}
              </div>
              <button
                onClick={() => router.push(`/comms?direct=HUMAN:${user.id}`)}
                className="p-2 rounded-lg hover:bg-[var(--card-hover)] text-[var(--muted)] hover:text-[var(--accent)] transition-colors"
                title="Open Chat"
              >
                <MessageSquare size={16} strokeWidth={1.5} />
              </button>
              <div className="flex gap-1">
                <button
                  onClick={() => openEdit(user)}
                  className="text-xs px-3 py-1.5 rounded border border-[var(--border)] hover:bg-[var(--hover)]"
                >Edit</button>
                {deleteConfirm === user.id ? (
                  <div className="flex gap-1">
                    <button
                      onClick={() => handleDelete(user.id)}
                      className="text-xs px-3 py-1.5 rounded bg-red-500 text-white hover:bg-red-600"
                    >Confirm</button>
                    <button
                      onClick={() => setDeleteConfirm(null)}
                      className="text-xs px-3 py-1.5 rounded border border-[var(--border)]"
                    >Cancel</button>
                  </div>
                ) : (
                  <button
                    onClick={() => setDeleteConfirm(user.id)}
                    className="text-xs px-3 py-1.5 rounded border border-red-300/30 text-red-400 hover:bg-red-500/10"
                  >Delete</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Create / Edit modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowModal(false)}>
          <div className="bg-[var(--card)] rounded-xl p-6 w-full max-w-[440px] mx-4 border border-[var(--border)]" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4">
              {editingUser ? 'Edit Employee' : 'Add Employee'}
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Name</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="John Doe"
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)]"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Email</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="john@company.com"
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)]"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  Password {editingUser && <span className="text-[var(--muted)] font-normal">(leave empty to keep current)</span>}
                </label>
                <input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder={editingUser ? 'Enter new password...' : 'Password'}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)]"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Role</label>
                <div className="grid grid-cols-2 gap-2">
                  {(['ADMIN', 'MANAGER', 'MEMBER', 'VIEWER'] as const).map((r) => (
                    <button
                      key={r}
                      onClick={() => setForm({ ...form, role: r })}
                      className={`p-3 rounded-lg border text-left transition ${
                        form.role === r
                          ? 'border-[var(--accent)] bg-[var(--accent)]/10'
                          : 'border-[var(--border)] hover:border-[var(--accent)]/50'
                      }`}
                    >
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium mb-1 ${roleBadge[r]}`}>
                        {r}
                      </span>
                      <p className="text-xs text-[var(--muted)]">{roleDesc[r]}</p>
                    </button>
                  ))}
                </div>
              </div>
              {error && (
                <p className="text-sm text-red-400">{error}</p>
              )}
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 rounded-lg border border-[var(--border)]">
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg hover:opacity-90 disabled:opacity-50"
              >
                {saving ? 'Saving...' : editingUser ? 'Save Changes' : 'Add Employee'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
