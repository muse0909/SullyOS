// 麦麦 2026-09-08：图床管理 Modal(暮色 9-8 14:50 要求)
//   入口:聊天+号 → "图床" 按钮
//   功能:扫描所有 messages,找 (type==='image' || type==='emoji') && content 是 base64 的
//        显示列表,单条 / 全选后重传 / 一键全部重传 / 删除
//   重传:调 utils/imageBedUpload,成功直接更新 IDB 里的 content 为 URL

import React, { useEffect, useMemo, useState } from 'react';
import { useOS } from '../../context/OSContext';
import { uploadImageToBed, extractMimeFromDataUrl, ImageBedConfig } from '../../utils/imageBedUpload';
import { X, CloudArrowUp, Trash, ArrowsClockwise, CheckSquare, Square } from '@phosphor-icons/react';
import Modal from '../os/Modal';

interface ImageBedManagerModalProps {
    isOpen: boolean;
    onClose: () => void;
}

interface B64Entry {
    /** IndexedDB 主键(id),删/更新都要用 */
    id: number;
    charId: string;
    type: 'image' | 'emoji';
    content: string;
    timestamp: number;
    /** 估算的 base64 字节数,UI 显示 KB 用 */
    approxKB: number;
}

const DB_NAME = 'SullyOS';
const DB_VERSION = 72;

// 扫描所有 messages,过滤 (type==='image' || type==='emoji') && content.startsWith('data:image/')
async function scanB64Messages(): Promise<B64Entry[]> {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });

    if (!db.objectStoreNames.contains('messages')) return [];

    return new Promise<B64Entry[]>((resolve) => {
        const tx = db.transaction('messages', 'readonly');
        const store = tx.objectStore('messages');
        const req = store.getAll();
        req.onsuccess = () => {
            const list: B64Entry[] = [];
            for (const m of (req.result || []) as any[]) {
                if (!m || typeof m !== 'object') continue;
                if (m.type !== 'image' && m.type !== 'emoji') continue;
                if (typeof m.content !== 'string' || !m.content.startsWith('data:image/')) continue;
                list.push({
                    id: m.id,
                    charId: m.charId,
                    type: m.type,
                    content: m.content,
                    timestamp: typeof m.timestamp === 'number' ? m.timestamp : 0,
                    approxKB: Math.round((m.content.length * 0.75) / 1024),
                });
            }
            resolve(list);
        };
        req.onerror = () => resolve([]);
    });
}

// 更新 message.content(直接用 IDB,DB.saveMessage 只能 add)
async function updateMessageContent(id: number, newContent: string): Promise<void> {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
    return new Promise<void>((resolve, reject) => {
        const tx = db.transaction('messages', 'readwrite');
        const store = tx.objectStore('messages');
        const getReq = store.get(id);
        getReq.onsuccess = () => {
            const m = getReq.result;
            if (!m) { resolve(); return; }
            m.content = newContent;
            const putReq = store.put(m);
            putReq.onsuccess = () => resolve();
            putReq.onerror = () => reject(putReq.error);
        };
        getReq.onerror = () => reject(getReq.error);
    });
}

// 删除 message
async function deleteMessageById(id: number): Promise<void> {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
    return new Promise<void>((resolve, reject) => {
        const tx = db.transaction('messages', 'readwrite');
        const store = tx.objectStore('messages');
        const req = store.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

const ImageBedManagerModal: React.FC<ImageBedManagerModalProps> = ({ isOpen, onClose }) => {
    const { characters, addToast } = useOS();
    const [entries, setEntries] = useState<B64Entry[]>([]);
    const [selected, setSelected] = useState<Set<number>>(new Set());
    const [scanning, setScanning] = useState(false);
    const [reUploading, setReUploading] = useState(false);
    const [progress, setProgress] = useState({ done: 0, total: 0, success: 0, failed: 0 });
    const [imageBedConfig, setImageBedConfig] = useState<ImageBedConfig | null>(null);
    const [showOnlyB64, setShowOnlyB64] = useState(true);

    // 读取图床配置(os_api_config 里的 imgbbApiKey / cloudinary* / bedKind)
    useEffect(() => {
        if (!isOpen) return;
        try {
            const raw = localStorage.getItem('os_api_config');
            if (raw) {
                const parsed = JSON.parse(raw);
                setImageBedConfig({
                    imgbbApiKey: parsed.imgbbApiKey,
                    cloudinaryCloudName: parsed.cloudinaryCloudName,
                    cloudinaryUploadPreset: parsed.cloudinaryUploadPreset,
                    r2AccountId: parsed.r2AccountId,
                    r2AccessKeyId: parsed.r2AccessKeyId,
                    r2SecretAccessKey: parsed.r2SecretAccessKey,
                    r2Bucket: parsed.r2Bucket,
                    r2PublicUrl: parsed.r2PublicUrl,
                    bedKind: parsed.bedKind,
                });
            }
        } catch {}
    }, [isOpen]);

    // 加载时扫描
    useEffect(() => {
        if (!isOpen) return;
        let cancelled = false;
        (async () => {
            setScanning(true);
            const list = await scanB64Messages();
            if (!cancelled) {
                setEntries(list);
                setScanning(false);
            }
        })();
        return () => { cancelled = true; };
    }, [isOpen]);

    // 角色 id → name
    const charNameMap = useMemo(() => {
        const m: Record<string, string> = {};
        for (const c of characters) m[c.id] = c.name;
        return m;
    }, [characters]);

    const toggleOne = (id: number) => {
        setSelected(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const toggleAll = () => {
        if (selected.size === entries.length) {
            setSelected(new Set());
        } else {
            setSelected(new Set(entries.map(e => e.id)));
        }
    };

    // 单条重传
    const reuploadOne = async (entry: B64Entry) => {
        if (!imageBedConfig) {
            addToast('请先在设置 → 图床 配 imgbb / Cloudinary', 'info');
            return;
        }
        const mime = extractMimeFromDataUrl(entry.content);
        const result = await uploadImageToBed(entry.content, mime, imageBedConfig, (evt) => {
            if (evt.status === 'failed' && evt.stage === 'imgbb') addToast('imgbb 失败,正在试 Cloudinary', 'info');
            else if (evt.status === 'failed' && evt.stage === 'cloudinary') addToast('Cloudinary 也失败,已用 base64', 'info');
        });
        if (result.ok && result.url) {
            await updateMessageContent(entry.id, result.url);
            setEntries(prev => prev.filter(e => e.id !== entry.id));
            setSelected(prev => { const n = new Set(prev); n.delete(entry.id); return n; });
            addToast('已上传图床', 'success');
        } else if (result.reason === 'no_config') {
            addToast('未配图床', 'info');
        } else {
            addToast(result.error || '重传失败', 'error');
        }
    };

    // 批量重传(选中的 + 一键全部)
    const reuploadMany = async (targets: B64Entry[]) => {
        if (!imageBedConfig) {
            addToast('请先在设置 → 图床 配 imgbb / Cloudinary', 'info');
            return;
        }
        if (targets.length === 0) {
            addToast('没有要上传的图片', 'info');
            return;
        }
        setReUploading(true);
        setProgress({ done: 0, total: targets.length, success: 0, failed: 0 });
        let success = 0, failed = 0;
        for (let i = 0; i < targets.length; i++) {
            const entry = targets[i];
            const mime = extractMimeFromDataUrl(entry.content);
            const result = await uploadImageToBed(entry.content, mime, imageBedConfig);
            if (result.ok && result.url) {
                await updateMessageContent(entry.id, result.url);
                success++;
            } else {
                failed++;
            }
            setProgress({ done: i + 1, total: targets.length, success, failed });
        }
        setReUploading(false);
        // 重新扫描
        const list = await scanB64Messages();
        setEntries(list);
        setSelected(new Set());
        addToast(`完成:成功 ${success} / 失败 ${failed}`, success > 0 ? 'success' : 'info');
    };

    // 单条删除
    const deleteOne = async (entry: B64Entry) => {
        if (!confirm(`删除这条 ${entry.type === 'image' ? '图片' : '表情包'}?`)) return;
        await deleteMessageById(entry.id);
        setEntries(prev => prev.filter(e => e.id !== entry.id));
        setSelected(prev => { const n = new Set(prev); n.delete(entry.id); return n; });
    };

    // 批量删除
    const deleteMany = async (targets: B64Entry[]) => {
        if (targets.length === 0) return;
        if (!confirm(`确认删除 ${targets.length} 条?此操作不可恢复`)) return;
        for (const e of targets) {
            await deleteMessageById(e.id);
        }
        const list = await scanB64Messages();
        setEntries(list);
        setSelected(new Set());
        addToast(`已删除 ${targets.length} 条`, 'success');
    };

    const totalSize = useMemo(() => entries.reduce((s, e) => s + e.approxKB, 0), [entries]);
    const selectedEntries = useMemo(() => entries.filter(e => selected.has(e.id)), [entries, selected]);

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="图床管理"
            adaptiveHeight={false}
            zIndex={120}
        >
            <div className="flex flex-col h-[70vh]">
                {/* 顶部状态栏 */}
                <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between text-sm">
                    <div className="text-slate-600">
                        共 <span className="font-bold text-slate-800">{entries.length}</span> 条 base64,
                        约 <span className="font-bold text-slate-800">{(totalSize / 1024).toFixed(1)}</span> MB
                        {selected.size > 0 && (
                            <span className="ml-2 text-violet-600">已选 {selected.size}</span>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        {entries.length > 0 && (
                            <button onClick={toggleAll} className="px-3 py-1 text-xs font-bold rounded-lg bg-slate-100 active:scale-95 transition-all text-slate-600">
                                {selected.size === entries.length ? '取消全选' : '全选'}
                            </button>
                        )}
                    </div>
                </div>

                {/* 图床配置提示 */}
                {(!imageBedConfig?.imgbbApiKey && !(imageBedConfig?.cloudinaryCloudName && imageBedConfig?.cloudinaryUploadPreset)) && (
                    <div className="mx-4 mt-2 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs">
                        未检测到图床配置。请先到设置 → API → 图床 配 imgbb 或 Cloudinary
                    </div>
                )}

                {/* 进度条(批量操作时) */}
                {reUploading && (
                    <div className="mx-4 mt-2 p-3 rounded-xl bg-violet-50 border border-violet-200 text-violet-800 text-xs">
                        上传中... {progress.done} / {progress.total}
                        （成功 {progress.success} / 失败 {progress.failed}）
                    </div>
                )}

                {/* 列表 */}
                <div className="flex-1 overflow-y-auto no-scrollbar p-4 space-y-2">
                    {scanning ? (
                        <div className="text-center text-slate-400 py-8">扫描中...</div>
                    ) : entries.length === 0 ? (
                        <div className="text-center text-slate-400 py-8">
                            <CloudArrowUp className="w-12 h-12 mx-auto mb-2 opacity-30" weight="duotone" />
                            <div>没有 base64 格式的图片</div>
                            <div className="text-xs mt-1 opacity-70">所有图都已传图床 ✓</div>
                        </div>
                    ) : (
                        entries.map(entry => (
                            <div key={entry.id} className={`flex items-center gap-3 p-2 rounded-xl border ${selected.has(entry.id) ? 'border-violet-400 bg-violet-50' : 'border-slate-200 bg-white'}`}>
                                <button onClick={() => toggleOne(entry.id)} className="shrink-0">
                                    {selected.has(entry.id) ? <CheckSquare className="w-5 h-5 text-violet-600" weight="fill" /> : <Square className="w-5 h-5 text-slate-300" />}
                                </button>
                                <img src={entry.content} className="w-12 h-12 rounded-lg object-cover bg-slate-100 shrink-0" alt="" />
                                <div className="flex-1 min-w-0">
                                    <div className="text-sm font-bold text-slate-700 truncate">
                                        {charNameMap[entry.charId] || entry.charId} · {entry.type === 'image' ? '图片' : '表情包'}
                                    </div>
                                    <div className="text-xs text-slate-400">
                                        {entry.approxKB < 1024 ? `${entry.approxKB} KB` : `${(entry.approxKB / 1024).toFixed(1)} MB`}
                                        {' · '}
                                        {new Date(entry.timestamp).toLocaleDateString()}
                                    </div>
                                </div>
                                <button onClick={() => reuploadOne(entry)} disabled={reUploading} className="shrink-0 p-2 rounded-lg bg-emerald-50 active:scale-95 text-emerald-600 disabled:opacity-50" title="重新上传图床">
                                    <ArrowsClockwise className="w-4 h-4" weight="bold" />
                                </button>
                                <button onClick={() => deleteOne(entry)} disabled={reUploading} className="shrink-0 p-2 rounded-lg bg-red-50 active:scale-95 text-red-500 disabled:opacity-50" title="删除">
                                    <Trash className="w-4 h-4" weight="bold" />
                                </button>
                            </div>
                        ))
                    )}
                </div>

                {/* 底部操作 */}
                <div className="px-4 py-3 border-t border-slate-200 flex items-center gap-2">
                    <button
                        onClick={() => reuploadMany(selectedEntries.length > 0 ? selectedEntries : entries)}
                        disabled={entries.length === 0 || reUploading}
                        className="flex-1 py-3 rounded-xl text-sm font-bold bg-emerald-500 text-white active:scale-95 transition-all disabled:opacity-50"
                    >
                        {selectedEntries.length > 0 ? `上传选中 (${selectedEntries.length})` : `一键全部上传 (${entries.length})`}
                    </button>
                    {selectedEntries.length > 0 && (
                        <button
                            onClick={() => deleteMany(selectedEntries)}
                            disabled={reUploading}
                            className="px-4 py-3 rounded-xl text-sm font-bold bg-red-50 text-red-500 active:scale-95 transition-all"
                        >
                            删除选中
                        </button>
                    )}
                </div>
            </div>
        </Modal>
    );
};

export default ImageBedManagerModal;
