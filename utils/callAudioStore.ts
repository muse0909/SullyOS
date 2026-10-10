/**
 * 通话语音的**长期留存**——让通话记录里每句话都能随时回听，不重新调模型、不花钱。
 *
 * ## 为什么需要它
 *
 * 合成出来的音频其实**早就存进 IndexedDB 了**（`utils/ttsCache.ts`，键是按
 * 「文字 + 音色参数」算出来的哈希，而且当初是按用户要求故意不清缓存的）。所以
 * 「再要一次同样的声音」是命中本地、不花钱的。
 *
 * 但通话消息本身**没有记下音频在哪**——`DB.saveMessage` 只写了 `source` 和
 * `callSessionId`。于是：
 *   - 通话过程中能重播：音频地址还挂在内存里的气泡上
 *   - 退出通话再看记录：地址没了 → 「重播语音」按钮不出现
 * 音频文件本身在库里躺着，只是没人知道它在哪。这不是缓存会过期，是压根没连线。
 *
 * ## 为什么自己存一份，不复用 TTS 缓存的键
 *
 * 三个理由：
 *   1. TTS 缓存是**按内容哈希**的，长回复会被 `splitTextForTts` 切块后合并，
 *      合并出来的音频不对应任何单个哈希键，没法只记一个键指过去。
 *   2. TTS 缓存那边的写入是 fire-and-forget（`saveCachedTts(...).catch()`），
 *      不 await。紧接着就按键回读会时序错乱，拿不到刚写的音频。
 *   3. 各管各的更耐用：以后给 TTS 缓存加配额清理（迟早要做）时，
 *      通话记录的回放不受影响——那是两个人的事。
 *
 * 代价是同一段音频存了两份（TTS 缓存一份、这里一份）。换来的是回放不依赖任何
 * 别的模块的内部结构。多占的空间在可接受范围：一段 5 秒的话约 100–300 KB。
 *
 * 键的形状跟消息 id 绑定（`call_audio_<消息id>`），所以一条消息对应一份音频，
 * 重新合成（换一种说法）会覆盖同一份——不会越攒越多。
 */

import { DB } from './db';

/** 音频在 assets 表里的键。一条通话消息一份。 */
export const callAudioKey = (messageId: number | string): string => `call_audio_${messageId}`;

/**
 * 把最终用于播放的那份音频存下来，返回键（存不进去返回空串，不抛）。
 *
 * 传 `dbId` 而不是气泡 id：只有落到数据库的消息才谈得上「以后还能听」，
 * 气泡 id 是内存里的临时值。
 */
export const saveCallAudio = async (dbId: number | undefined, blob: Blob | null | undefined): Promise<string> => {
  if (!dbId || !blob || !blob.size) return '';
  try {
    const key = callAudioKey(dbId);
    await DB.saveAssetRaw(key, { blob, createdAt: Date.now() });
    return key;
  } catch (e) {
    // 存不进去不打断通话——文字已经发出去了，音频回放是加分项不是必需品
    console.warn('[call-audio] 保存失败', e);
    return '';
  }
};

/** 按键取回音频。取不到返回 null（老记录没存过 / 被清了 / 存储不可用）。 */
export const loadCallAudio = async (key: string | undefined): Promise<Blob | null> => {
  if (!key) return null;
  try {
    const entry = await DB.getAssetRaw(key);
    if (entry && entry.blob instanceof Blob) return entry.blob;
    return null;
  } catch {
    return null;
  }
};
