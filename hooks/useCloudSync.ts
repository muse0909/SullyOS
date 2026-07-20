/**
 * useCloudSync — 云端同步 hook
 *
 * 暮色的多端互通：电脑手机共享聊天记录 + 记忆宫殿。
 *
 * 设计：
 *   - 全局单例（module-level singleton + 订阅），多个组件共享同一份同步状态
 *   - 轮询 30 秒一次（pull）+ 主动触发（upload，聊天/记忆变更后立刻调）
 *   - **异步 fire-and-forget**：所有上传调用都不 await，失败静默
 *   - 拉取通过 callback 通知订阅者（Chat 订阅 → 注入新消息到 UI）
 *   - 后端未配置（Neon 没装）时轮询不启动，UI 提示"未配置"
 *
 * 使用：
 *   - Chat 组件：useCloudSync 拿到 uploadMessage, onNewMessages
 *   - 记忆宫殿：useCloudSync 拿到 uploadMemory, onNewMemories
 *   - 设置页：useCloudSync 拿到 status, initPair, joinPair, resetPair
 *
 * ⚠️ 跟 OSContext 解耦：sync 状态独立管理，避免触碰 3000 行 context。
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import {
    loadSyncConfig, saveSyncConfig, DEFAULT_SYNC_CONFIG,
    type SyncConfig, type CloudMessage, type CloudMemory,
    initPair as apiInitPair, joinPair as apiJoinPair, getSyncStatus,
    uploadMessages as apiUploadMessages, pullMessages as apiPullMessages,
    uploadMemories as apiUploadMemories, pullMemories as apiPullMemories,
    checkBackendAvailable, humanReadableError,
} from '../utils/syncClient';

const POLL_INTERVAL_MS = 30_000;        // 30 秒轮询
const UPLOAD_BATCH_SIZE = 100;          // 上传每批最多 100 条
const MEMORY_BATCH_SIZE = 50;
const MAX_PENDING_MESSAGES = 1000;      // 待上传队列上限（防失控）
const MAX_PENDING_MEMORIES = 500;

// ─── 同步状态（对外暴露的轻量状态） ────────────────

export type SyncStatus = 'unconfigured' | 'disabled' | 'no_backend' | 'idle' | 'syncing' | 'error';

export interface SyncState {
    config: SyncConfig;
    status: SyncStatus;
    errorMessage: string | null;
    lastSuccessAt: number | null;
    /** 累计上传消息数（自启动） */
    uploadedMessages: number;
    /** 累计拉取消息数（自启动） */
    pulledMessages: number;
    /** 累计上传记忆数 */
    uploadedMemories: number;
    /** 累计拉取记忆数 */
    pulledMemories: number;
}

const DEFAULT_STATE: SyncState = {
    config: DEFAULT_SYNC_CONFIG,
    status: 'unconfigured',
    errorMessage: null,
    lastSuccessAt: null,
    uploadedMessages: 0,
    pulledMessages: 0,
    uploadedMemories: 0,
    pulledMemories: 0,
};

// ─── 全局单例 ──────────────────────────────────────

// 订阅者回调
type MessageSubscriber = (msgs: CloudMessage[]) => void;
type MemorySubscriber = (mems: CloudMemory[]) => void;
type StateSubscriber = (state: SyncState) => void;

class CloudSyncEngine {
    state: SyncState = { ...DEFAULT_STATE, config: loadSyncConfig() };
    private stateSubscribers = new Set<StateSubscriber>();
    private messageSubscribers = new Set<MessageSubscriber>();
    private memorySubscribers = new Set<MemorySubscriber>();
    private pollTimer: ReturnType<typeof setInterval> | null = null;
    private pendingMessages: any[] = [];  // 待上传
    private pendingMemories: any[] = [];
    private uploadScheduled = false;
    private inFlightPoll = false;
    private backendAvailable: boolean | null = null;
    private backendCheckPromise: Promise<boolean> | null = null;

    /** 启动（应用启动时由 useCloudSync 触发） */
    start() {
        // 启动时检查一次后端
        this.checkBackend();

        // 根据状态决定要不要起轮询
        this.maybeStartPolling();
    }

    /** 订阅状态变化 */
    subscribeState(cb: StateSubscriber): () => void {
        this.stateSubscribers.add(cb);
        cb(this.state);  // 立即推一次
        return () => { this.stateSubscribers.delete(cb); };
    }

    subscribeNewMessages(cb: MessageSubscriber): () => void {
        this.messageSubscribers.add(cb);
        return () => { this.messageSubscribers.delete(cb); };
    }

    subscribeNewMemories(cb: MemorySubscriber): () => void {
        this.memorySubscribers.add(cb);
        return () => { this.memorySubscribers.delete(cb); };
    }

    private setState(patch: Partial<SyncState>) {
        this.state = { ...this.state, ...patch };
        this.stateSubscribers.forEach(cb => cb(this.state));
    }

    private async checkBackend(): Promise<boolean> {
        if (this.backendCheckPromise) return this.backendCheckPromise;
        this.backendCheckPromise = (async () => {
            const ok = await checkBackendAvailable();
            this.backendAvailable = ok;
            if (!ok) {
                this.setState({ status: 'no_backend', errorMessage: '云端同步未配置：后端 Neon 数据库未启用' });
            } else {
                this.maybeStartPolling();
            }
            return ok;
        })();
        return this.backendCheckPromise;
    }

    // ─── 状态变更（用户操作） ────────────────────

    async initPair(deviceName: string): Promise<{ ok: boolean; error?: string }> {
        if (!this.backendAvailable) {
            await this.checkBackend();
            if (!this.backendAvailable) {
                return { ok: false, error: '云端同步未配置（后端不可用）' };
            }
        }

        this.setState({ status: 'syncing' });
        const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
        const result = await apiInitPair(deviceName, ua);
        if (!result.ok) {
            const msg = humanReadableError(result.error);
            this.setState({ status: 'error', errorMessage: msg });
            return { ok: false, error: msg };
        }

        const newConfig: SyncConfig = {
            ...this.state.config,
            pairCode: result.data.pairCode,
            deviceId: result.data.deviceId,
            enabled: true,
            deviceName,
            pairedAt: result.data.createdAt,
            lastMessageSyncAt: 0,
            lastMemorySyncAt: 0,
            lastSyncSuccessAt: null,
            lastSyncError: null,
        };
        saveSyncConfig(newConfig);
        this.setState({ config: newConfig, status: 'idle', errorMessage: null });
        this.maybeStartPolling();
        // 立刻拉一次（空水位 = 拉所有）
        setTimeout(() => this.pollAll(), 100);
        return { ok: true };
    }

    async joinPair(pairCode: string, deviceName: string): Promise<{ ok: boolean; error?: string }> {
        if (!this.backendAvailable) {
            await this.checkBackend();
            if (!this.backendAvailable) {
                return { ok: false, error: '云端同步未配置（后端不可用）' };
            }
        }

        this.setState({ status: 'syncing' });
        const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
        const result = await apiJoinPair(pairCode, deviceName, ua);
        if (!result.ok) {
            const msg = humanReadableError(result.error);
            this.setState({ status: 'error', errorMessage: msg });
            return { ok: false, error: msg };
        }

        const newConfig: SyncConfig = {
            ...this.state.config,
            pairCode: result.data.pairCode,
            deviceId: result.data.deviceId,
            enabled: true,
            deviceName,
            pairedAt: result.data.pairedAt,
            lastMessageSyncAt: 0,  // 加入新配对码时重置水位，拉全量
            lastMemorySyncAt: 0,
            lastSyncSuccessAt: null,
            lastSyncError: null,
        };
        saveSyncConfig(newConfig);
        this.setState({ config: newConfig, status: 'idle', errorMessage: null });
        this.maybeStartPolling();
        setTimeout(() => this.pollAll(), 100);
        return { ok: true };
    }

    setEnabled(enabled: boolean) {
        const newConfig = { ...this.state.config, enabled };
        saveSyncConfig(newConfig);
        this.setState({ config: newConfig });
        if (enabled) {
            this.maybeStartPolling();
            setTimeout(() => this.pollAll(), 100);
        } else {
            this.stopPolling();
            this.setState({ status: 'disabled' });
        }
    }

    /** 重置配对（清空配对码，生成新身份） */
    resetPair() {
        this.stopPolling();
        // 清掉 deviceId 也清掉，下次 init 时重新生成（避免跟旧数据关联）
        try { localStorage.removeItem('os_sync_device_id'); } catch { /* */ }
        const newConfig: SyncConfig = {
            ...DEFAULT_SYNC_CONFIG,
            deviceId: '',  // 触发 loadSyncConfig 重新生成
        };
        saveSyncConfig(newConfig);
        // 重新加载（确保 deviceId 重新生成）
        const reloaded = loadSyncConfig();
        this.setState({
            config: reloaded,
            status: 'unconfigured',
            errorMessage: null,
            uploadedMessages: 0,
            pulledMessages: 0,
            uploadedMemories: 0,
            pulledMemories: 0,
        });
    }

    // ─── 上传触发（fire-and-forget） ────────────

    /**
     * 把消息加入待上传队列，30 秒内批量上传。
     * 调用方不用 await，失败静默。
     */
    enqueueUploadMessage(msg: any) {
        if (!this.state.config.enabled || !this.state.config.pairCode) return;
        if (this.state.status === 'no_backend') return;
        if (this.pendingMessages.length >= MAX_PENDING_MESSAGES) {
            // 队列满，丢掉最早的（防止内存爆）
            this.pendingMessages.shift();
        }
        // 上传时只传必要字段
        this.pendingMessages.push({
            clientId: msg.clientId,
            charId: msg.charId,
            role: msg.role,
            type: msg.type,
            content: msg.content,
            timestamp: msg.timestamp,
            metadata: msg.metadata,
            replyTo: msg.replyTo,
        });
        this.scheduleUpload();
    }

    enqueueUploadMemory(memory: any, deleted: boolean = false) {
        if (!this.state.config.enabled || !this.state.config.pairCode) return;
        if (this.state.status === 'no_backend') return;
        if (this.pendingMemories.length >= MAX_PENDING_MEMORIES) {
            this.pendingMemories.shift();
        }
        this.pendingMemories.push({
            id: memory.id,
            charId: memory.charId,
            content: memory.content,
            room: memory.room,
            tags: memory.tags,
            importance: memory.importance,
            mood: memory.mood,
            valence: memory.valence,
            arousal: memory.arousal,
            sourceId: memory.sourceId,
            origin: memory.origin,
            archived: memory.archived,
            isBoxSummary: memory.isBoxSummary,
            eventBoxId: memory.eventBoxId,
            createdAt: memory.createdAt,
            lastAccessedAt: memory.lastAccessedAt,
            accessCount: memory.accessCount,
            pinnedUntil: memory.pinnedUntil,
            groupId: memory.groupId,
            groupName: memory.groupName,
            deleted,
        });
        this.scheduleUpload();
    }

    private scheduleUpload() {
        if (this.uploadScheduled) return;
        this.uploadScheduled = true;
        // 5 秒后批量上传（攒批 + 不阻塞用户操作）
        setTimeout(() => {
            this.uploadScheduled = false;
            this.flushUploads();
        }, 5_000);
    }

    private async flushUploads() {
        if (this.pendingMessages.length === 0 && this.pendingMemories.length === 0) return;
        const cfg = this.state.config;
        if (!cfg.enabled || !cfg.pairCode) return;

        // 消息上传
        while (this.pendingMessages.length > 0) {
            const batch = this.pendingMessages.splice(0, UPLOAD_BATCH_SIZE);
            const result = await apiUploadMessages(cfg.pairCode, cfg.deviceId, batch);
            if (result.ok) {
                this.setState({
                    uploadedMessages: this.state.uploadedMessages + result.data.uploaded,
                    lastSuccessAt: Date.now(),
                });
            } else {
                this.setState({ status: 'error', errorMessage: humanReadableError(result.error) });
                // 失败时把 batch 放回队列头（下次再试）
                this.pendingMessages.unshift(...batch);
                break;
            }
        }

        // 记忆上传
        while (this.pendingMemories.length > 0) {
            const batch = this.pendingMemories.splice(0, MEMORY_BATCH_SIZE);
            const result = await apiUploadMemories(cfg.pairCode, cfg.deviceId, batch);
            if (result.ok) {
                this.setState({
                    uploadedMemories: this.state.uploadedMemories + result.data.uploaded,
                    lastSuccessAt: Date.now(),
                });
            } else {
                this.setState({ status: 'error', errorMessage: humanReadableError(result.error) });
                this.pendingMemories.unshift(...batch);
                break;
            }
        }
    }

    // ─── 轮询 ─────────────────────────────────

    private maybeStartPolling() {
        if (this.pollTimer) return;
        if (!this.state.config.enabled || !this.state.config.pairCode) return;
        if (this.state.status === 'no_backend') return;
        this.pollTimer = setInterval(() => this.pollAll(), POLL_INTERVAL_MS);
        // 立刻跑一次
        this.pollAll();
    }

    private stopPolling() {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
    }

    /** 手动触发一次完整轮询（设置页"立即同步"按钮） */
    forceSyncNow() {
        this.pollAll(true);
    }

    private async pollAll(force: boolean = false) {
        if (this.inFlightPoll) return;
        if (!this.state.config.enabled || !this.state.config.pairCode) return;
        if (this.state.status === 'no_backend') return;
        this.inFlightPoll = true;
        this.setState({ status: 'syncing' });
        try {
            await this.flushUploads();   // 顺便把待上传的也 flush
            await this.pullNewMessages();
            await this.pullNewMemories();
            this.setState({ status: 'idle', lastSuccessAt: Date.now(), errorMessage: null });
        } catch (e: any) {
            this.setState({ status: 'error', errorMessage: e?.message || '同步失败' });
        } finally {
            this.inFlightPoll = false;
        }
    }

    private async pullNewMessages() {
        const cfg = this.state.config;
        if (!cfg.enabled || !cfg.pairCode) return;

        // 拉所有角色（不传 charId），单次 500 条上限
        let since = cfg.lastMessageSyncAt;
        let totalPulled = 0;
        let hasMore = true;

        while (hasMore) {
            const result = await apiPullMessages(cfg.pairCode, cfg.deviceId, since, undefined, 500);
            if (!result.ok) {
                this.setState({ status: 'error', errorMessage: humanReadableError(result.error) });
                return;
            }
            const msgs = result.data.messages;
            if (msgs.length > 0) {
                this.messageSubscribers.forEach(cb => cb(msgs));
                // 更新水位 = 这一批最大 timestamp
                const maxTs = msgs.reduce((m, x) => Math.max(m, x.timestamp), since);
                since = maxTs;
                totalPulled += msgs.length;
            }
            hasMore = result.data.hasMore;
            if (msgs.length === 0) break;
        }

        if (totalPulled > 0) {
            const newConfig = { ...cfg, lastMessageSyncAt: since };
            saveSyncConfig(newConfig);
            this.setState({ config: newConfig, pulledMessages: this.state.pulledMessages + totalPulled });
        }
    }

    private async pullNewMemories() {
        const cfg = this.state.config;
        if (!cfg.enabled || !cfg.pairCode) return;

        let since = cfg.lastMemorySyncAt;
        let totalPulled = 0;
        let hasMore = true;

        while (hasMore) {
            const result = await apiPullMemories(cfg.pairCode, cfg.deviceId, since, undefined, true, 500);
            if (!result.ok) {
                this.setState({ status: 'error', errorMessage: humanReadableError(result.error) });
                return;
            }
            const mems = result.data.memories;
            if (mems.length > 0) {
                this.memorySubscribers.forEach(cb => cb(mems));
                const maxTs = mems.reduce((m, x) => Math.max(m, x.cloudUpdatedAt), since);
                since = maxTs;
                totalPulled += mems.length;
            }
            hasMore = result.data.hasMore;
            if (mems.length === 0) break;
        }

        if (totalPulled > 0) {
            const newConfig = { ...cfg, lastMemorySyncAt: since };
            saveSyncConfig(newConfig);
            this.setState({ config: newConfig, pulledMemories: this.state.pulledMemories + totalPulled });
        }
    }
}

// 全局单例（整个 app 共享一个）
let _engine: CloudSyncEngine | null = null;
export function getEngine(): CloudSyncEngine {
    if (!_engine) {
        _engine = new CloudSyncEngine();
        _engine.start();
    }
    return _engine;
}

// ─── React hook 入口 ───────────────────────────────

export function useCloudSync() {
    const [state, setState] = useState<SyncState>(() => getEngine().state);
    const engine = getEngine();

    useEffect(() => {
        return engine.subscribeState(setState);
    }, [engine]);

    // 提供便捷包装
    const initPair = useCallback((deviceName: string) => engine.initPair(deviceName), [engine]);
    const joinPair = useCallback((code: string, deviceName: string) => engine.joinPair(code, deviceName), [engine]);
    const resetPair = useCallback(() => engine.resetPair(), [engine]);
    const setEnabled = useCallback((on: boolean) => engine.setEnabled(on), [engine]);
    const forceSyncNow = useCallback(() => engine.forceSyncNow(), [engine]);
    const enqueueUploadMessage = useCallback((msg: any) => engine.enqueueUploadMessage(msg), [engine]);
    const enqueueUploadMemory = useCallback((m: any, deleted?: boolean) => engine.enqueueUploadMemory(m, deleted), [engine]);

    return {
        ...state,
        initPair,
        joinPair,
        resetPair,
        setEnabled,
        forceSyncNow,
        enqueueUploadMessage,
        enqueueUploadMemory,
    };
}

/** 单独订阅"云端拉取到的新消息"（Chat 用） */
export function useCloudMessages(callback: (msgs: CloudMessage[]) => void) {
    const engine = getEngine();
    const cbRef = useRef(callback);
    cbRef.current = callback;
    useEffect(() => {
        return engine.subscribeNewMessages((msgs) => cbRef.current(msgs));
    }, [engine]);
}

/** 单独订阅"云端拉取到的新记忆"（MemoryPalace 用） */
export function useCloudMemories(callback: (mems: CloudMemory[]) => void) {
    const engine = getEngine();
    const cbRef = useRef(callback);
    cbRef.current = callback;
    useEffect(() => {
        return engine.subscribeNewMemories((mems) => cbRef.current(mems));
    }, [engine]);
}
