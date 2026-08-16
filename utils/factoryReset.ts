/**
 * 格式化系统（恢复出厂设置）
 *
 * 暮色 8-16 要求：系统设置里加"格式化系统"按钮，保留云端备份设置，其他一键清空。
 *
 * 行为：
 *  - 清空所有 IDB 数据库（AetherOS_Data / ActiveMsg / 其他）
 *  - 清空 localStorage 大部分 key，保留云端备份相关（os_cloud_sync_config / os_sync_device_id / os_sync_*）
 *  - 不清远程（云端数据 + 配对码仍可用）
 *
 * 双重 confirm + prompt 输入"格式化"才执行。
 */

import { openDB } from './db';

export interface FactoryResetOptions {
    /** 是否清远程（默认 false，暮色只要保留云端备份设置） */
    includeRemote?: boolean;
}

export interface FactoryResetResult {
    indexedDBsDeleted: string[];
    localStorageKeysRemoved: number;
    localStorageKeysPreserved: string[];
    remoteAttempted: boolean;
}

/** 保留的 localStorage key 全名（云端备份相关） */
const PRESERVED_LS_KEYS = new Set([
    'os_cloud_sync_config',  // 配对码 + 设备 ID + 同步时间戳
    'os_sync_device_id',     // 设备 UUID v4
]);

/** 保留的 localStorage key 前缀（云端备份相关） */
const PRESERVED_LS_PREFIXES = [
    'os_sync_',  // 兜底
];

/** 删除单个 IDB 数据库 */
async function deleteIndexedDB(name: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.deleteDatabase(name);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
        req.onblocked = () => {
            // 阻塞通常因为有未关闭的 IDB 连接。提示但不 reject，
            // 用户后续刷新页面会真正删掉。
            console.warn(`[FactoryReset] ${name} 删除被阻塞（请关闭其他页面后刷新）`);
            resolve();
        };
    });
}

function isPreservedKey(key: string): boolean {
    if (PRESERVED_LS_KEYS.has(key)) return true;
    return PRESERVED_LS_PREFIXES.some(p => key.startsWith(p));
}

/**
 * 格式化系统（恢复出厂设置）
 *
 * 流程：
 *  1. 列出所有 IDB 数据库，逐个 deleteDatabase
 *  2. 遍历 localStorage，删非保留 key
 *  3. （可选）清远程
 *  4. 返回结果（不自动刷新，让调用方决定）
 */
export async function factoryReset(options: FactoryResetOptions = {}): Promise<FactoryResetResult> {
    console.log(`[FactoryReset] 开始格式化系统...`);

    // 1. 清 IDB 数据库
    const dbsDeleted: string[] = [];
    try {
        if (indexedDB.databases && typeof indexedDB.databases === 'function') {
            const dbs = await indexedDB.databases();
            for (const db of dbs) {
                if (db.name) {
                    try {
                        await deleteIndexedDB(db.name);
                        dbsDeleted.push(db.name);
                    } catch (e) {
                        console.warn(`[FactoryReset] 删 ${db.name} 失败：`, e);
                    }
                }
            }
        } else {
            // 浏览器不支持 indexedDB.databases() — 硬删已知库
            const known = ['AetherOS_Data', 'ActiveMsg'];
            for (const name of known) {
                try {
                    await deleteIndexedDB(name);
                    dbsDeleted.push(name);
                } catch (e) {
                    console.warn(`[FactoryReset] 删 ${name} 失败：`, e);
                }
            }
        }
    } catch (e) {
        console.warn('[FactoryReset] 列 IDB 失败：', e);
    }

    // 2. 清 localStorage
    const removed: string[] = [];
    const preserved: string[] = [];
    try {
        const toRemove: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!key) continue;
            if (isPreservedKey(key)) {
                preserved.push(key);
            } else {
                toRemove.push(key);
            }
        }
        for (const key of toRemove) {
            try {
                localStorage.removeItem(key);
                removed.push(key);
            } catch { /* ignore */ }
        }
    } catch (e) {
        console.warn('[FactoryReset] 清 localStorage 失败：', e);
    }

    // 3. 远程（默认不执行；暮色只要保留云端备份设置）
    const remoteAttempted = false;

    console.log(`[FactoryReset] 完成：IDB ${dbsDeleted.length} 个、localStorage 清 ${removed.length} / 保留 ${preserved.length} 条`);
    return {
        indexedDBsDeleted: dbsDeleted,
        localStorageKeysRemoved: removed.length,
        localStorageKeysPreserved: preserved,
        remoteAttempted,
    };
}
