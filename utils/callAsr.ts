/**
 * callAsr.ts — 通话语音识别（把录到的声音变成文字）
 *
 * 麦麦 2026-09-30：打电话功能第二阶段。
 * 第一阶段只能录，录完存本地给用户"听听看"；这一层负责把录音送去识别。
 *
 * 为什么能直接从手机发出去（2026-09-29 在真机上验证过）：
 *   app 里的网页走的是原生网络通道，不是浏览器的 fetch，
 *   所以**不会被跨域限制挡住**，不需要在服务器上建一层中转。
 *   验证方式：用假密钥直接打语音识别接口，手机原样收到了服务器返回的
 *   "密钥错误"（401）—— 说明请求真的到了对方服务器，只是密钥不对。
 *
 * 识别服务目前用的是 MiniMax（跟语音合成同一个密钥，省得再配一套）。
 * 暮色 330 项目里用的是硅基流动的免费模型，想换的话改 transcribeBySiliconFlow 即可，
 * 或者从设置里选（见 CallAsrProvider）。
 *
 * 规格说明：
 *   - 音频格式：单声道 / 16000 Hz / WAV（由 utils/callVoice.ts 生成）
 *     对方接口支持 wav / mp3 / aac / opus 等，wav 是最稳的，识别率不受采样率影响
 *   - 单次上限 50MB / 500 秒，通话场景远远碰不到
 */

import { getMinimaxBaseUrl, getMinimaxRegion } from './minimaxEndpoint';

/** 识别服务来源。 */
export type CallAsrProvider = 'minimax' | 'siliconflow';

export interface CallAsrOptions {
  /** 对应服务商的密钥 */
  apiKey: string;
  /** 用哪家识别 */
  provider: CallAsrProvider;
  /** 识别模型。硅基流动默认用项目里聊天语音输入同款那个 */
  model?: string;
  /** 语言提示。不传 / 'auto' = 自动判断 */
  language?: string;
  /** 超时（毫秒）。识别一般 1-2 秒，给宽松点 */
  timeoutMs?: number;
}

export interface CallAsrResult {
  /** 识别出来的文字。识别到静音会返回空字符串（这不算失败） */
  text: string;
  /** 音频时长（秒），对方返回的，用于计费核对 */
  duration: number;
  /** 这次实际用的哪家 */
  provider: CallAsrProvider;
}

/** 把对方返回的报错翻成人话，别把英文/JSON 甩给用户 */
const describeAsrError = (status: number, body: string): string => {
  const lower = (body || '').toLowerCase();
  if (status === 401 || lower.includes('login fail') || lower.includes('authoriz')) {
    return '识别接口密钥不对，检查一下 MiniMax 密钥';
  }
  if (status === 402 || lower.includes('insufficient') || lower.includes('balance')) {
    return 'MiniMax 余额不足，充值后才能识别';
  }
  if (status === 413 || lower.includes('too large')) {
    return '这段录音太长了';
  }
  if (status === 400 && lower.includes('500') === false && lower.includes('format')) {
    return '这段音频格式对方不认';
  }
  if (status >= 500) {
    return '识别服务那边出问题了，过会儿再试';
  }
  const detail = (body || '').slice(0, 120);
  return `识别失败（${status}）${detail ? '：' + detail : ''}`;
};

const buildUrl = (): string => `${getMinimaxBaseUrl(getMinimaxRegion())}/v1/speech_to_text`;

/**
 * 走项目里已有的硅基流动识别中转（`api/volink/stt.ts`）。
 *
 * 注意两件事：
 *  1. **它要的是硅基流动的 key，不是 Volink 的**。
 *     文件放在 volink 目录里是历史遗留，实际转发目标是 api.siliconflow.cn。
 *     填错 key 会一直 401，聊天里的语音输入也是同一个坑。
 *  2. **它需要服务端**（要转发 + 绕开跨域），
 *     所以离线包（页面打在本地、没有 /api）用不了这条，只能走 MiniMax 直连。
 */
async function transcribeViaSiliconFlow(
  blob: Blob,
  options: CallAsrOptions,
): Promise<CallAsrResult> {
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error('读取录音失败'));
    reader.readAsDataURL(blob);
  });

  const response = await fetch('/api/volink/stt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey: options.apiKey,
      audioBase64: base64,
      mimeType: blob.type || 'audio/wav',
      model: options.model || 'FunAudioLLM/SenseVoiceSmall',
      language: options.language || 'auto',
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    // 401 最常见的原因就是把 Volink 的 key 填到了这个字段里
    if (response.status === 401) {
      throw new Error('识别密钥不对（这一项要填硅基流动的 key，不是 Volink 的）');
    }
    throw new Error(`识别失败（${response.status}）${body ? '：' + body.slice(0, 120) : ''}`);
  }

  const data = await response.json();
  return { text: (data?.text || '').trim(), duration: 0, provider: 'siliconflow' };
}

/**
 * 把录音送去识别。
 *
 * 注意 FormData 的写法：文件必须包成 Blob，不能直接塞字符串，
 * 否则浏览器会报 "parameter 2 is not of type 'Blob'"（这个坑踩过）。
 */
export async function transcribeCallAudio(
  blob: Blob,
  options: CallAsrOptions,
): Promise<CallAsrResult> {
  const apiKey = (options.apiKey || '').trim();
  if (!apiKey) {
    throw new Error(
      options.provider === 'siliconflow'
        ? '还没配识别密钥，识别用不了'
        : '还没配 MiniMax 密钥，识别用不了',
    );
  }
  if (!blob || blob.size === 0) {
    throw new Error('没有录音');
  }

  if (options.provider === 'siliconflow') {
    return transcribeViaSiliconFlow(blob, options);
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), options.timeoutMs ?? 20000);

  try {
    const form = new FormData();
    form.append('model', 'asr-1.0');
    form.append('file', blob, 'call.wav');
    if (options.language) form.append('language', options.language);

    const response = await fetch(buildUrl(), {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: controller.signal,
    });

    const text = await response.text();

    if (!response.ok) {
      // 对方错误格式是 { base_resp: { status_msg } } 或 { error: { message } }，都兜一下
      let message = '';
      try {
        const parsed = JSON.parse(text);
        message = parsed?.base_resp?.status_msg || parsed?.error?.message || text;
      } catch {
        message = text;
      }
      throw new Error(describeAsrError(response.status, message));
    }

    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('识别接口返回了看不懂的内容');
    }

    return {
      text: (parsed?.text || '').trim(),
      duration: Number(parsed?.duration || 0),
      provider: 'minimax',
    };
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error('识别超时了，再说一次试试');
    }
    // 网络层失败（断网 / 域名不通）跟接口报错要区分开，报错文案不一样
    if (err instanceof TypeError) {
      throw new Error('连不上识别服务，检查一下网络');
    }
    throw err;
  } finally {
    window.clearTimeout(timeout);
  }
}

/** 当前环境能不能识别（前端判一次，省得用户按了没反应） */
export const isCallAsrConfigured = (apiKey: string): boolean => (apiKey || '').trim().length > 0;

/**
 * 挑一家能用的识别服务。
 * 优先硅基流动（免费、聊天语音输入在用同一个），没有就退回 MiniMax。
 */
export function pickCallAsrProvider(apiConfig: any): { provider: CallAsrProvider; apiKey: string; model?: string } | null {
  const siliconKey = (apiConfig?.volinkApiKey || '').trim();
  if (siliconKey) {
    return {
      provider: 'siliconflow',
      apiKey: siliconKey,
      model: (apiConfig?.volinkModel || '').trim() || 'FunAudioLLM/SenseVoiceSmall',
    };
  }
  const minimaxKey = (apiConfig?.minimaxApiKey || '').trim();
  if (minimaxKey) {
    return { provider: 'minimax', apiKey: minimaxKey };
  }
  return null;
}
