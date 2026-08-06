// 暮色 2026-08-05：记忆宫殿"一键向量化"统一入口
//   - 之前有两个独立实现：
//     1) apps/Chat.tsx::handleForceVectorize （聊天设置抽屉里"一键向量化所有"）
//     2) apps/MemoryPalaceApp.tsx::runAutoArchiveCatchUp （记忆宫殿"立即追平历史"）
//   - 两个实现逻辑几乎一样（BATCH_SIZE 170, MAX_ROUNDS 50, force=true, isMessageSemanticallyRelevant）
//   - 但累计方式 / 错误提示 / 进度显示不同步 —— 典型的"抄两遍"导致的不一致
//   - 现在统一到一个函数，UI 层只管触发 + 显示进度 + 写回 char
//
// 设计决策（暮色 2026-08-05 确认）：
//   - 单次调用跑 5 轮（约 1-2 分钟，浏览器后台节流容忍范围内）
//   - 失败时已经存进去的保留（不撤回）
//   - 累计用 autoArchive.hideBeforeMessageId - hwm（真处理条数），不是 batch.length
//   - 走 onProgress 回调，UI 自己决定怎么显示（toast / 进度条 / 静默）
//   - 入口 2（记忆宫殿"立即追平"）被废弃，UI 改提示去聊天设置

import { DB } from '../db';
import {
    processNewMessages,
    getMemoryPalaceHighWaterMark,
    mergePalaceFragmentsIntoMemories,
} from './pipeline';
import { isMessageSemanticallyRelevant } from '../messageFormat';
import type { LightLLMConfig } from './pipeline';
import type { EmbeddingConfig } from './embedding';

export interface ForceVectorizeParams {
    charId: string;
    charName: string;
    mpEmb: EmbeddingConfig;
    mpLLM: LightLLMConfig;
    /** 用户名（传给 processNewMessages 当 system prompt 里的"用户"指代） */
    userName?: string;
    /** 单次调用跑几轮。默认 5（暮色 2026-08-05 拍板：1-2 分钟内可跑完，不切 tab 也行） */
    maxRounds?: number;
    /** 单批多少条。默认 170（=200*0.85，跟 processNewMessages 的 toProcess 比例对齐） */
    batchSize?: number;
    /** 多少条以下算"全部处理完"，提前停止。默认 10 */
    minRemainingToStop?: number;
    /** 进度回调：每跑完一轮触发一次。参数：round / processed / remaining */
    onProgress?: (info: { round: number; processed: number; remaining: number }) => void;
}

export interface ForceVectorizeResult {
    /** 真实处理的条数（autoArchive.hideBeforeMessageId 推进的部分） */
    processed: number;
    /** 跑了几轮 */
    rounds: number;
    /** 处理完后还剩多少条没向量化 */
    remaining: number;
    /** 是不是跑到"剩 < 阈值"自然结束（true）/ 还是遇到 LLM 失败中断（false） */
    finishedNaturally: boolean;
    /** 失败原因（finishedNaturally=false 时有） */
    errorMessage?: string;
    /** 累积的自动归档片段（用于上层 merge 进 char.memories） */
    accumulatedFragments: any[];
    /** 5 轮累积提取出的记忆节点（用于"提取后确认/编辑"弹窗） */
    allExtractedMemories: { id: string; content: string; room: string; importance: number; mood: string; tags: string[] }[];
    /** 最终 hideBeforeMessageId（用于上层写回 char） */
    latestHideBefore: number | undefined;
    /** 本次处理起始 hwm（用于上层判断"有没有动"） */
    startHwm: number;
    /** 本次处理结束 hwm（用于上层判断"有没有动"） */
    endHwm: number;
}

/**
 * 暮色 2026-08-05：统一"一键向量化"逻辑。
 * 单次调用跑 maxRounds 轮（默认 5），每轮从 DB 读最新未处理消息 → processNewMessages → 推进 hwm。
 * 处理完返回结果（包含累积的 autoArchive fragments），上层负责 merge 进 char.memories。
 *
 * 注意：本函数**不直接修改 char 状态**（不调 updateCharacter），避免依赖 OSContext。
 * 写回 char 的动作由 UI 层（Chat.tsx）拿到 result 后自己决定。
 */
export async function runForceVectorizeForChar(
    params: ForceVectorizeParams
): Promise<ForceVectorizeResult> {
    const {
        charId,
        charName,
        mpEmb,
        mpLLM,
        userName = '',
        maxRounds = 5,
        batchSize = 170,
        minRemainingToStop = 10,
        onProgress,
    } = params;

    const startHwm = getMemoryPalaceHighWaterMark(charId);
    let accumulatedFragments: any[] = [];
    let allExtractedMemories: { id: string; content: string; room: string; importance: number; mood: string; tags: string[] }[] = [];
    let latestHideBefore: number | undefined = undefined;
    let totalProcessed = 0;
    let finishedNaturally = true;
    let errorMessage: string | undefined;
    let actualRounds = 0;

    console.log(`🏰 [ForceVectorize] 开始：char=${charName} (${charId}) maxRounds=${maxRounds} batchSize=${batchSize} minStop=${minRemainingToStop} startHwm=${startHwm}`);

    for (let round = 1; round <= maxRounds; round++) {
        actualRounds = round;
        const curHwm = getMemoryPalaceHighWaterMark(charId);
        const allMsgs = await DB.getMessagesByCharId(charId, true);
        const unprocessed = allMsgs
            .filter(m => isMessageSemanticallyRelevant(m) && m.id > curHwm)
            .sort((a, b) => a.id - b.id);

        if (unprocessed.length < minRemainingToStop) {
            console.log(`🏰 [ForceVectorize] 第 ${round} 轮：剩余 ${unprocessed.length} < 阈值 ${minRemainingToStop}，自然停止`);
            break;
        }

        const batch = unprocessed.slice(0, batchSize);
        console.log(`🏰 [ForceVectorize] 第 ${round}/${maxRounds} 轮：batch=${batch.length} hwm=${curHwm} 剩余=${unprocessed.length}`);

        let result: any;
        try {
            result = await processNewMessages(batch, charId, charName, mpEmb, mpLLM, userName, true);
        } catch (e: any) {
            finishedNaturally = false;
            errorMessage = e?.message || String(e);
            console.error(`🏰 [ForceVectorize] 第 ${round} 轮异常：${errorMessage}`);
            break;
        }

        // 软跳过：缓冲区没到阈值 / 热区还没被挤出 / 已有任务在跑 —— 不是 palace 失败
        if (result?.skipReason) {
            if (result.skipReason !== 'lock') {
                console.log(`🏰 [ForceVectorize] 第 ${round} 轮软跳过：${result.skipReason}（palace 自己放弃，不算失败）`);
            } else {
                console.log(`🏰 [ForceVectorize] 第 ${round} 轮 lock：已有任务在跑`);
            }
            break;
        }

        // 累计"真处理"的条数（不是 batch.length）
        //   autoArchive.hideBeforeMessageId 才是真推进的边界
        let realProcessed = 0;
        if (result?.autoArchive?.hideBeforeMessageId) {
            realProcessed = Math.max(0, result.autoArchive.hideBeforeMessageId - curHwm);
        } else {
            // 没 autoArchive 时 fallback 用 newHwm - hwm
            const newHwmTmp = getMemoryPalaceHighWaterMark(charId);
            realProcessed = Math.max(0, newHwmTmp - curHwm);
        }
        totalProcessed += realProcessed;
        console.log(`🏰 [ForceVectorize] 第 ${round} 轮真处理 ${realProcessed} 条（累计 ${totalProcessed}）`);

        // 累积自动归档片段（由 UI 层 merge）
        if (result?.autoArchive?.fragments) {
            accumulatedFragments = accumulatedFragments.concat(result.autoArchive.fragments);
            latestHideBefore = result.autoArchive.hideBeforeMessageId;
        }

        // 累积本轮提取的记忆节点（用于提取后确认/编辑弹窗）
        if (result?.memories?.length) {
            allExtractedMemories = allExtractedMemories.concat(result.memories);
        }

        // 检查 hwm 是否前进（如果没前进说明 LLM 提取失败）
        const newHwm = getMemoryPalaceHighWaterMark(charId);
        if (newHwm <= curHwm) {
            finishedNaturally = false;
            errorMessage = `LLM 提取失败（hwm 未推进：${curHwm} → ${newHwm}）`;
            console.error(`🏰 [ForceVectorize] 第 ${round} 轮 hwm 未推进：${errorMessage}`);
            break;
        }

        // 进度回调（用真实剩余，不是这一轮的 batch.length - realProcessed）
        const remaining = Math.max(0, unprocessed.length - realProcessed);
        onProgress?.({ round, processed: totalProcessed, remaining });
    }

    // 最终统计
    const endHwm = getMemoryPalaceHighWaterMark(charId);
    const finalAllMsgs = await DB.getMessagesByCharId(charId, true);
    const finalRemaining = finalAllMsgs
        .filter(m => isMessageSemanticallyRelevant(m) && m.id > endHwm)
        .length;

    const result: ForceVectorizeResult = {
        processed: totalProcessed,
        rounds: actualRounds,
        remaining: finalRemaining,
        finishedNaturally,
        errorMessage,
        accumulatedFragments,
        allExtractedMemories,
        latestHideBefore,
        startHwm,
        endHwm,
    };

    console.log(`🏰 [ForceVectorize] 完成：${actualRounds} 轮 / 真处理 ${totalProcessed} 条 / 剩余 ${finalRemaining} 条${finishedNaturally ? '' : ` / 失败: ${errorMessage}`}`);

    return result;
}
