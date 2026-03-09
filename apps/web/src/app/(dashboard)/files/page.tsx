'use client';

import { useState, useEffect, useRef } from 'react';
import { api } from '@/lib/api';
import { FileText, Image, Upload, Trash2, Search, Download, ExternalLink, FolderIcon, FolderPlus, ChevronRight, Home, MoreVertical, Pencil, FolderInput, ArrowLeft } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

function formatSize(bytes: number): string {
  if (!bytes) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

export default function FilesPage() {
  const [files, setFiles] = useState<any[]>([]);
  const [folders, setFolders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentFolder, setCurrentFolder] = useState<string | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<{ id: string; name: string }[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [typeFilter, setTypeFilter] = useState('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [preview, setPreview] = useState<any>(null);
  const [uploading, setUploading] = useState(false);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [contextMenu, setContextMenu] = useState<{ type: 'file' | 'folder'; item: any; x: number; y: number } | null>(null);
  const [moveTarget, setMoveTarget] = useState<any>(null);
  const [allFolders, setAllFolders] = useState<any[]>([]);
  const [renaming, setRenaming] = useState<any>(null);
  const [renameValue, setRenameValue] = useState('');
  const [syncing, setSyncing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [foldersRes, filesRes] = await Promise.all([
        api.getFolders(currentFolder || undefined),
        api.getFiles({
          page,
          type: typeFilter || undefined,
          search: search || undefined,
          folderId: search ? undefined : (currentFolder || 'root'),
        }),
      ]);
      setFolders(foldersRes || []);
      setFiles(filesRes.data || []);
      setTotal(filesRes.total || 0);

      // Load breadcrumbs
      if (currentFolder) {
        const folderData = await api.getFolder(currentFolder);
        setBreadcrumbs(folderData.breadcrumbs || []);
      } else {
        setBreadcrumbs([]);
      }
    } catch (err) {
      console.error('Failed to load', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [page, typeFilter, search, currentFolder]);

  // Close context menu on click outside
  useEffect(() => {
    const handler = () => setContextMenu(null);
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, []);

  const navigateToFolder = (folderId: string | null) => {
    setCurrentFolder(folderId);
    setPage(1);
    setSearch('');
    setSearchInput('');
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList?.length) return;
    setUploading(true);
    try {
      for (const file of Array.from(fileList)) {
        await api.uploadFileStandalone(file, currentFolder || undefined);
      }
      await load();
    } catch (err: any) {
      alert(err.message || 'Upload failed');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    try {
      await api.createFolder({ name: newFolderName.trim(), parentId: currentFolder || undefined });
      setNewFolderName('');
      setShowNewFolder(false);
      load();
    } catch (err: any) {
      alert(err.message || 'Failed to create folder');
    }
  };

  const handleDeleteFile = async (file: any) => {
    if (!confirm(`Delete "${file.originalName}"?`)) return;
    try {
      await api.deleteFile(file.id);
      setFiles((prev) => prev.filter((f) => f.id !== file.id));
    } catch (err: any) {
      alert(err.message || 'Delete failed');
    }
  };

  const handleDeleteFolder = async (folder: any) => {
    if (folder.isSystem) return;
    if (!confirm(`Delete folder "${folder.name}"? Files will be moved to parent.`)) return;
    try {
      await api.deleteFolder(folder.id);
      load();
    } catch (err: any) {
      alert(err.message || 'Delete failed');
    }
  };

  const handleRename = async () => {
    if (!renaming || !renameValue.trim()) return;
    try {
      if (renaming._type === 'folder') {
        await api.updateFolder(renaming.id, { name: renameValue.trim() });
      } else {
        await api.renameFile(renaming.id, renameValue.trim());
      }
      setRenaming(null);
      load();
    } catch (err: any) {
      alert(err.message || 'Rename failed');
    }
  };

  const openMoveDialog = async (item: any) => {
    setMoveTarget(item);
    try {
      const tree = await api.getFolderTree();
      setAllFolders(tree || []);
    } catch {}
  };

  const handleMove = async (targetFolderId: string | null) => {
    if (!moveTarget) return;
    try {
      if (moveTarget._type === 'folder') {
        await api.updateFolder(moveTarget.id, { parentId: targetFolderId });
      } else {
        await api.moveFile(moveTarget.id, targetFolderId);
      }
      setMoveTarget(null);
      load();
    } catch (err: any) {
      alert(err.message || 'Move failed');
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await api.syncFiles();
      if (res.synced > 0) {
        load();
      }
      alert(`Synced ${res.synced} files`);
    } catch (err: any) {
      alert(err.message || 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    setSearch(searchInput);
  };

  const isImage = (mimetype: string) => mimetype?.startsWith('image/');

  const showContextMenu = (e: React.MouseEvent, type: 'file' | 'folder', item: any) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ type, item: { ...item, _type: type }, x: e.clientX, y: e.clientY });
  };

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold mb-1">Files</h1>
          <p className="text-[var(--muted)]">
            File management &mdash; folders, uploads, agent files ({total})
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-2 px-3 py-2 border border-[var(--border)] rounded-lg hover:bg-[var(--hover)] text-sm disabled:opacity-50"
          >
            {syncing ? 'Syncing...' : 'Sync'}
          </button>
          <button
            onClick={() => setShowNewFolder(true)}
            className="flex items-center gap-2 px-3 py-2 border border-[var(--border)] rounded-lg hover:bg-[var(--hover)] text-sm"
          >
            <FolderPlus size={16} /> Folder
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            accept="image/*,.pdf,.txt,.csv,.json,.md"
            onChange={handleUpload}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-2 px-4 py-2 bg-[var(--accent)] text-white rounded-lg hover:opacity-90 disabled:opacity-50 text-sm"
          >
            <Upload size={16} />
            {uploading ? 'Uploading...' : 'Upload'}
          </button>
        </div>
      </div>

      {/* Breadcrumbs */}
      <div className="flex items-center gap-1 mb-4 text-sm overflow-x-auto">
        <button
          onClick={() => navigateToFolder(null)}
          className={`flex items-center gap-1 px-2 py-1 rounded hover:bg-[var(--hover)] shrink-0 ${!currentFolder ? 'text-[var(--accent)] font-medium' : 'text-[var(--muted)]'}`}
        >
          <Home size={14} /> Files
        </button>
        {breadcrumbs.map((bc) => (
          <div key={bc.id} className="flex items-center gap-1 shrink-0">
            <ChevronRight size={14} className="text-[var(--muted)]" />
            <button
              onClick={() => navigateToFolder(bc.id)}
              className={`px-2 py-1 rounded hover:bg-[var(--hover)] ${bc.id === currentFolder ? 'text-[var(--accent)] font-medium' : 'text-[var(--muted)]'}`}
            >
              {bc.name}
            </button>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-4 flex-wrap items-center">
        <form onSubmit={handleSearch} className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search all files..."
            className="pl-9 pr-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm w-full sm:w-64"
          />
        </form>
        <select
          value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm"
        >
          <option value="">All types</option>
          <option value="image">Images</option>
          <option value="document">Documents</option>
        </select>
        <div className="flex gap-1 ml-auto bg-[var(--card)] p-1 rounded-lg border border-[var(--border)]">
          <button
            onClick={() => setViewMode('grid')}
            className={`px-3 py-1.5 rounded-md text-sm ${viewMode === 'grid' ? 'bg-[var(--accent)] text-white' : 'hover:bg-[var(--hover)]'}`}
          >
            Grid
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`px-3 py-1.5 rounded-md text-sm ${viewMode === 'list' ? 'bg-[var(--accent)] text-white' : 'hover:bg-[var(--hover)]'}`}
          >
            List
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-[var(--muted)] text-center py-20">Loading...</p>
      ) : (
        <>
          {/* Back button when inside a folder */}
          {currentFolder && !search && (
            <button
              onClick={() => {
                const parentIdx = breadcrumbs.length - 2;
                navigateToFolder(parentIdx >= 0 ? breadcrumbs[parentIdx].id : null);
              }}
              className="flex items-center gap-2 text-sm text-[var(--muted)] hover:text-white mb-3 px-2 py-1 rounded hover:bg-[var(--hover)]"
            >
              <ArrowLeft size={14} /> Back
            </button>
          )}

          {/* Folders row */}
          {!search && folders.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-6">
              {folders.map((f) => (
                <div
                  key={f.id}
                  onDoubleClick={() => navigateToFolder(f.id)}
                  onClick={() => navigateToFolder(f.id)}
                  onContextMenu={(e) => showContextMenu(e, 'folder', f)}
                  className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-3 cursor-pointer hover:border-[var(--accent)]/50 transition group relative"
                >
                  <div className="flex items-center gap-2">
                    <FolderIcon size={20} className={f.isSystem ? 'text-amber-400' : 'text-blue-400'} />
                    <span className="text-sm font-medium truncate flex-1">{f.name}</span>
                    {!f.isSystem && (
                      <button
                        onClick={(e) => { e.stopPropagation(); showContextMenu(e, 'folder', f); }}
                        className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-[var(--hover)]"
                      >
                        <MoreVertical size={14} className="text-[var(--muted)]" />
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-[var(--muted)] mt-1">
                    {f._count?.children || 0} folders, {f._count?.files || 0} files
                  </p>
                </div>
              ))}
            </div>
          )}

          {/* Files */}
          {files.length === 0 && folders.length === 0 ? (
            <div className="text-center py-20 border border-dashed border-[var(--border)] rounded-xl">
              <FileText size={48} className="mx-auto text-[var(--muted)] mb-4" />
              <p className="text-lg font-medium mb-2">{search ? 'No files found' : 'Empty folder'}</p>
              <p className="text-[var(--muted)] mb-4">
                {search ? 'Try a different search term' : 'Upload files or create subfolders'}
              </p>
              <div className="flex gap-2 justify-center">
                <button
                  onClick={() => setShowNewFolder(true)}
                  className="px-4 py-2 border border-[var(--border)] rounded-lg hover:bg-[var(--hover)]"
                >
                  New Folder
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg"
                >
                  Upload File
                </button>
              </div>
            </div>
          ) : viewMode === 'grid' ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {files.map((f) => (
                <div
                  key={f.id}
                  onContextMenu={(e) => showContextMenu(e, 'file', f)}
                  className="bg-[var(--card)] border border-[var(--border)] rounded-xl overflow-hidden group hover:border-[var(--accent)]/50 transition"
                >
                  <div
                    className="aspect-square bg-[var(--bg)] flex items-center justify-center cursor-pointer relative overflow-hidden"
                    onClick={() => isImage(f.mimetype) ? setPreview(f) : window.open(f.url, '_blank')}
                  >
                    {isImage(f.mimetype) ? (
                      <img src={f.url} alt={f.originalName} className="w-full h-full object-cover" loading="lazy" />
                    ) : (
                      <FileText size={40} className="text-[var(--muted)]" />
                    )}
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition flex items-center justify-center opacity-0 group-hover:opacity-100">
                      <ExternalLink size={20} className="text-white" />
                    </div>
                  </div>
                  <div className="p-3">
                    <p className="text-sm font-medium truncate" title={f.originalName}>{f.originalName}</p>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-xs text-[var(--muted)]">{formatSize(f.size)}</span>
                      <div className="flex gap-1">
                        <a href={f.url} download={f.originalName} className="p-1 rounded hover:bg-[var(--hover)] text-[var(--muted)] hover:text-white" title="Download" onClick={(e) => e.stopPropagation()}>
                          <Download size={14} />
                        </a>
                        <button onClick={(e) => { e.stopPropagation(); showContextMenu(e, 'file', f); }} className="p-1 rounded hover:bg-[var(--hover)] text-[var(--muted)] hover:text-white" title="More">
                          <MoreVertical size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl overflow-x-auto">
              <table className="w-full text-sm min-w-[600px]">
                <thead>
                  <tr className="border-b border-[var(--border)] bg-[var(--bg)]">
                    <th className="text-left p-3 font-medium w-10"></th>
                    <th className="text-left p-3 font-medium">Name</th>
                    <th className="text-left p-3 font-medium">Type</th>
                    <th className="text-left p-3 font-medium">Size</th>
                    <th className="text-left p-3 font-medium">Date</th>
                    <th className="p-3 w-20"></th>
                  </tr>
                </thead>
                <tbody>
                  {files.map((f) => (
                    <tr key={f.id} className="border-b border-[var(--border)] hover:bg-[var(--hover)]/30" onContextMenu={(e) => showContextMenu(e, 'file', f)}>
                      <td className="p-3">
                        {isImage(f.mimetype) ? <Image size={18} className="text-blue-400" /> : <FileText size={18} className="text-[var(--muted)]" />}
                      </td>
                      <td className="p-3">
                        <button
                          onClick={() => isImage(f.mimetype) ? setPreview(f) : window.open(f.url, '_blank')}
                          className="text-left hover:text-[var(--accent)] truncate max-w-[300px] block"
                          title={f.originalName}
                        >
                          {f.originalName}
                        </button>
                      </td>
                      <td className="p-3 text-[var(--muted)]">{f.mimetype?.split('/')[1] || '?'}</td>
                      <td className="p-3 text-[var(--muted)]">{formatSize(f.size)}</td>
                      <td className="p-3 text-[var(--muted)] text-xs">{f.createdAt ? new Date(f.createdAt).toLocaleDateString() : '-'}</td>
                      <td className="p-3">
                        <div className="flex gap-1">
                          <a href={f.url} download={f.originalName} className="p-1 rounded hover:bg-[var(--hover)] text-[var(--muted)] hover:text-white"><Download size={14} /></a>
                          <button onClick={(e) => showContextMenu(e, 'file', f)} className="p-1 rounded hover:bg-[var(--hover)] text-[var(--muted)] hover:text-white"><MoreVertical size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Pagination */}
      {files.length > 0 && (
        <div className="flex items-center justify-center gap-4 mt-6">
          <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1} className="px-3 py-1.5 rounded border border-[var(--border)] text-sm disabled:opacity-40">Prev</button>
          <span className="text-sm text-[var(--muted)]">Page {page}</span>
          <button onClick={() => setPage(page + 1)} disabled={files.length < 50} className="px-3 py-1.5 rounded border border-[var(--border)] text-sm disabled:opacity-40">Next</button>
        </div>
      )}

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-[var(--card)] border border-[var(--border)] rounded-lg shadow-xl py-1 min-w-[180px]"
          style={{ left: Math.min(contextMenu.x, window.innerWidth - 200), top: Math.min(contextMenu.y, window.innerHeight - 200) }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => { setRenaming({ ...contextMenu.item, _type: contextMenu.type }); setRenameValue(contextMenu.type === 'folder' ? contextMenu.item.name : contextMenu.item.originalName); setContextMenu(null); }}
            className="w-full text-left px-4 py-2 text-sm hover:bg-[var(--hover)] flex items-center gap-2"
          >
            <Pencil size={14} /> Rename
          </button>
          <button
            onClick={() => { openMoveDialog({ ...contextMenu.item, _type: contextMenu.type }); setContextMenu(null); }}
            className="w-full text-left px-4 py-2 text-sm hover:bg-[var(--hover)] flex items-center gap-2"
          >
            <FolderInput size={14} /> Move to...
          </button>
          {contextMenu.type === 'file' && (
            <a
              href={contextMenu.item.url}
              download={contextMenu.item.originalName}
              className="w-full text-left px-4 py-2 text-sm hover:bg-[var(--hover)] flex items-center gap-2"
              onClick={() => setContextMenu(null)}
            >
              <Download size={14} /> Download
            </a>
          )}
          <button
            onClick={() => {
              if (contextMenu.type === 'folder') handleDeleteFolder(contextMenu.item);
              else handleDeleteFile(contextMenu.item);
              setContextMenu(null);
            }}
            className="w-full text-left px-4 py-2 text-sm hover:bg-[var(--hover)] flex items-center gap-2 text-red-400"
          >
            <Trash2 size={14} /> Delete
          </button>
        </div>
      )}

      {/* New Folder Modal */}
      {showNewFolder && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowNewFolder(false)}>
          <div className="bg-[var(--card)] rounded-xl p-6 w-full max-w-[400px] mx-4 border border-[var(--border)]" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4">New Folder</h3>
            <input
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="Folder name"
              className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] mb-4"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder()}
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowNewFolder(false)} className="px-4 py-2 rounded-lg border border-[var(--border)]">Cancel</button>
              <button onClick={handleCreateFolder} className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg">Create</button>
            </div>
          </div>
        </div>
      )}

      {/* Rename Modal */}
      {renaming && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setRenaming(null)}>
          <div className="bg-[var(--card)] rounded-xl p-6 w-full max-w-[400px] mx-4 border border-[var(--border)]" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4">Rename</h3>
            <input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] mb-4"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && handleRename()}
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setRenaming(null)} className="px-4 py-2 rounded-lg border border-[var(--border)]">Cancel</button>
              <button onClick={handleRename} className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg">Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Move Modal */}
      {moveTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setMoveTarget(null)}>
          <div className="bg-[var(--card)] rounded-xl p-6 w-full max-w-[400px] mx-4 border border-[var(--border)] max-h-[70vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4">Move &ldquo;{moveTarget.originalName || moveTarget.name}&rdquo;</h3>
            <div className="space-y-1 overflow-y-auto flex-1 mb-4">
              <button
                onClick={() => handleMove(null)}
                className="w-full text-left px-3 py-2 rounded-lg hover:bg-[var(--hover)] flex items-center gap-2 text-sm"
              >
                <Home size={16} className="text-[var(--muted)]" /> Root (no folder)
              </button>
              {allFolders
                .filter((f) => f.id !== moveTarget.id)
                .map((f) => (
                  <button
                    key={f.id}
                    onClick={() => handleMove(f.id)}
                    className="w-full text-left px-3 py-2 rounded-lg hover:bg-[var(--hover)] flex items-center gap-2 text-sm"
                    style={{ paddingLeft: f.parentId ? '2rem' : undefined }}
                  >
                    <FolderIcon size={16} className={f.isSystem ? 'text-amber-400' : 'text-blue-400'} />
                    {f.name}
                  </button>
                ))}
            </div>
            <div className="flex justify-end">
              <button onClick={() => setMoveTarget(null)} className="px-4 py-2 rounded-lg border border-[var(--border)]">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Image Preview Modal */}
      {preview && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 md:p-8" onClick={() => setPreview(null)}>
          <div className="max-w-4xl max-h-full relative" onClick={(e) => e.stopPropagation()}>
            <img src={preview.url} alt={preview.originalName} className="max-w-full max-h-[80vh] rounded-lg object-contain" />
            <div className="mt-3 flex items-center justify-between flex-wrap gap-2">
              <div>
                <p className="text-white font-medium">{preview.originalName}</p>
                <p className="text-white/60 text-sm">{formatSize(preview.size)}</p>
              </div>
              <div className="flex gap-2">
                <a href={preview.url} download={preview.originalName} className="px-3 py-1.5 rounded-lg bg-white/10 text-white text-sm hover:bg-white/20">Download</a>
                <button onClick={() => setPreview(null)} className="px-3 py-1.5 rounded-lg bg-white/10 text-white text-sm hover:bg-white/20">Close</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
