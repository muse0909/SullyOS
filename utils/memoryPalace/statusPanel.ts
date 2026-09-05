/**
 * 状态面板 — DEPRECATED
 *
 * 麦麦 2026-09-05：暮色 9-5 要求"彻底清理旧状态面板"—— 旧 per-user 状态面板已废弃。
 *
 * 新位置：状态面板数据存到 character_status_panels IDB store（per-char 独立）
 *   - 写：utils/characterMemo.ts 的 setStatusSlot / clearStatusSlot
 *   - 读：utils/characterMemo.ts 的 getStatusPanel
 *   - 拼 prompt：utils/characterMemo.ts 的 formatStatusPanelForPrompt（由 chatPrompts 注入）
 *
 * 旧 API（getStatusPanel() / setStatusPanel() / applyStatusUpdate() / buildStatusPanelSectionForInjection）
 *   全部保留为 stub（no-op + console.warn）—— 调用方不崩，但写不到任何地方。
 *   未来版本整体删除 statusPanel.ts。
 */

import type { UserStatusPanel, StatusSlot } from './types';

export const STATUS_SLOTS: StatusSlot[] = ['location', 'health', 'schedule', 'mood', 'reminder'];

// 旧的 type alias 保留（extraction.ts 等地方可能 type-only 引用）
// 实际数据走 character_status_panels IDB

function warnDeprecated(fn: string) {
    // 麦麦 2026-09-05：9-5 暮色清理旧状态面板 — 这些 API 已废弃
    if (typeof console !== 'undefined' && (console as any).__SULLYOS_DEPRECATED_WARNED__ !== true) {
        console.warn(`[DEPRECATED] statusPanel.${fn} 已废弃（暮色 9-5 清理）。新位置：utils/characterMemo.ts`);
        (console as any).__SULLYOS_DEPRECATED_WARNED__ = true;
    }
}

export function getStatusPanel(): UserStatusPanel {
    warnDeprecated('getStatusPanel');
    return {};
}

export function setStatusPanel(_panel: UserStatusPanel): void {
    warnDeprecated('setStatusPanel');
    // no-op
}

export function applyStatusUpdate(_update: any): UserStatusPanel {
    warnDeprecated('applyStatusUpdate');
    return {};
}

export function buildStatusPanelLine(_panel: UserStatusPanel): string {
    warnDeprecated('buildStatusPanelLine');
    return '';
}

export function buildStatusPanelSectionForExtraction(_panel: UserStatusPanel): string {
    warnDeprecated('buildStatusPanelSectionForExtraction');
    return '';
}

export function buildStatusPanelSectionForInjection(_panel: UserStatusPanel): string {
    warnDeprecated('buildStatusPanelSectionForInjection');
    return '';
}

export function ensureLegacyPinnedCleared(): void {
    warnDeprecated('ensureLegacyPinnedCleared');
    // no-op
}

export type { UserStatusPanel, StatusSlot } from './types';
