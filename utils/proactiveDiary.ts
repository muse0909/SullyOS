// 暮色 2026-08-22：定时自动写日记（借 ProactiveChat 机制，独立 schedule）
//   频率：每天 1 篇，22:00（miya 模式）
//   跟 ProactiveChat 共享 service worker 消息 + 定时器去重模式，但用独立 storage
//   单角色开关：char.autoDiaryEnabled 控制是否 start/stop（commit 2 接 UI）

import { CharacterProfile, APIConfig, UserProfile } from '../types';
import { generateCharDiary } from './charDiary';

interface ProactiveDiarySchedule {
  charId: string;
  lastFire: number;
  nextFire: number;
}

type ScheduleMap = Record<string, ProactiveDiarySchedule>;

const STORAGE_KEY = 'proactive_diary_schedules';

function loadSchedules(): ScheduleMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as ScheduleMap;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveSchedules(map: ScheduleMap) {
  if (Object.keys(map).length === 0) {
    localStorage.removeItem(STORAGE_KEY);
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
}

// 今天 22:00 已过 → 明天 22:00；没过 → 今天 22:00
function nextTriggerAt(now: number): number {
  const d = new Date(now);
  d.setHours(22, 0, 0, 0);
  if (d.getTime() <= now) {
    d.setDate(d.getDate() + 1);
  }
  return d.getTime();
}

// ---- 默认 callback 兜底（始终是函数，外部 onTrigger 可替换） ----
let depsProvider: (() => {
  characters: CharacterProfile[];
  apiConfig: APIConfig;
  userProfile: UserProfile;
  addToast?: (msg: string, type?: 'success' | 'error' | 'info') => void;
}) | null = null;

async function defaultTrigger(charId: string) {
  console.log(`[ProactiveDiary] defaultTrigger start: ${charId}`);
  if (!depsProvider) {
    console.warn('[ProactiveDiary] depsProvider not registered — 切到任意聊天页让 Chat.tsx 挂 setDeps');
    return;
  }
  const { characters, apiConfig, userProfile, addToast } = depsProvider();
  const char = characters.find(c => c.id === charId);
  if (!char) {
    console.warn(`[ProactiveDiary] Character ${charId} not found in characters[${characters.length}]`);
    return;
  }
  if (!apiConfig?.apiKey || !apiConfig?.baseUrl) {
    console.warn(`[ProactiveDiary] API not configured: apiKey=${!!apiConfig?.apiKey} baseUrl=${!!apiConfig?.baseUrl}`);
    return;
  }
  console.log(`[ProactiveDiary] generateCharDiary start for ${char.name}`);
  try {
    const entry = await generateCharDiary(char, apiConfig, { userProfile });
    addToast?.(`${char.name} 写了一篇日记`, 'success');
    console.log(`[ProactiveDiary] ${char.name} wrote a diary for ${entry.date}`);
  } catch (e: any) {
    // "今天已经写过" / API 错误：静默，只打日志
    console.log(`[ProactiveDiary] Skipped: ${e?.message || e}`);
  }
}

let triggerCallback: (charId: string) => Promise<void> = defaultTrigger;
let preciseTimer: ReturnType<typeof setTimeout> | null = null;
let mainThreadTimer: ReturnType<typeof setInterval> | null = null;
let visibilityListener: (() => void) | null = null;
let focusListener: (() => void) | null = null;

const MAIN_THREAD_CHECK_INTERVAL = 20_000;

async function runDiaryForChar(charId: string) {
  console.log(`[ProactiveDiary] runDiaryForChar start: ${charId}`);
  try {
    await triggerCallback(charId);
    console.log(`[ProactiveDiary] runDiaryForChar done: ${charId}`);
  } catch (e) {
    console.warn(`[ProactiveDiary] Trigger failed for ${charId}:`, e);
  }
}

async function fireDueSchedules() {
  const schedules = loadSchedules();
  const now = Date.now();
  let nextDue = Infinity;

  for (const charId of Object.keys(schedules)) {
    const sched = schedules[charId];
    if (now >= sched.nextFire) {
      // 去重：lastFire 后 1 分钟内不重复（visibility+focus+main 三路同帧）
      if (now - sched.lastFire < 60_000) continue;
      // 触发：先 update schedule 防 race
      sched.lastFire = now;
      sched.nextFire = nextTriggerAt(now);
      void runDiaryForChar(charId);
    }
    if (sched.nextFire < nextDue) nextDue = sched.nextFire;
  }

  saveSchedules(schedules);
  schedulePreciseTimer(nextDue);
}

function schedulePreciseTimer(nextDue: number = Infinity) {
  if (preciseTimer) {
    clearTimeout(preciseTimer);
    preciseTimer = null;
  }
  if (!Number.isFinite(nextDue)) {
    const schedules = Object.values(loadSchedules());
    nextDue = schedules.reduce(
      (min, s) => (s.nextFire < min ? s.nextFire : min),
      Infinity
    );
  }
  if (!Number.isFinite(nextDue)) return;

  const delay = Math.min(Math.max(nextDue - Date.now(), 500), 2_147_000_000);
  preciseTimer = setTimeout(() => {
    preciseTimer = null;
    void fireDueSchedules();
  }, delay);
}

function handleVisibility() {
  if (document.visibilityState !== 'visible') return;
  void fireDueSchedules();
}

function handleFocus() {
  void fireDueSchedules();
}

function attachListeners() {
  if (!visibilityListener) {
    visibilityListener = handleVisibility;
    document.addEventListener('visibilitychange', visibilityListener);
  }
  if (!focusListener) {
    focusListener = handleFocus;
    window.addEventListener('focus', focusListener);
  }
  if (!mainThreadTimer) {
    mainThreadTimer = setInterval(fireDueSchedules, MAIN_THREAD_CHECK_INTERVAL);
  }
  schedulePreciseTimer();
}

function detachListeners() {
  if (visibilityListener) {
    document.removeEventListener('visibilitychange', visibilityListener);
    visibilityListener = null;
  }
  if (focusListener) {
    window.removeEventListener('focus', focusListener);
    focusListener = null;
  }
  if (mainThreadTimer) {
    clearInterval(mainThreadTimer);
    mainThreadTimer = null;
  }
  if (preciseTimer) {
    clearTimeout(preciseTimer);
    preciseTimer = null;
  }
}

export const ProactiveDiary = {
  /**
   * 注册 deps — commit 2 启动时从 OSContext 喂数据
   */
  setDeps(provider: typeof depsProvider) {
    depsProvider = provider;
  },

  /**
   * 启动一个角色的日记 schedule（每天 22:00）
   */
  start(charId: string) {
    const schedules = loadSchedules();
    const now = Date.now();
    schedules[charId] = {
      charId,
      lastFire: 0,
      nextFire: nextTriggerAt(now),
    };
    saveSchedules(schedules);
    attachListeners();
    schedulePreciseTimer();
    console.log(`[ProactiveDiary] Started: ${charId}, next at ${new Date(schedules[charId].nextFire).toLocaleString()}`);
  },

  /**
   * 停止一个角色的日记 schedule
   */
  stop(charId: string) {
    const schedules = loadSchedules();
    delete schedules[charId];
    saveSchedules(schedules);
    if (Object.keys(schedules).length === 0) {
      detachListeners();
    } else {
      schedulePreciseTimer();
    }
    console.log(`[ProactiveDiary] Stopped: ${charId}`);
  },

  /**
   * 替换默认 trigger callback（不传 / 传 null 保持默认）
   */
  onTrigger(callback: ((charId: string) => Promise<void>) | null) {
    if (callback) triggerCallback = callback;
  },

  /**
   * 启动时恢复所有 schedule
   */
  resume() {
    const schedules = loadSchedules();
    if (Object.keys(schedules).length === 0) return;
    console.log(`[ProactiveDiary] Resuming ${Object.keys(schedules).length} schedule(s)`);
    attachListeners();
    void fireDueSchedules();
  },

  /**
   * 是否启用
   */
  isActiveFor(charId: string): boolean {
    return !!loadSchedules()[charId];
  },

  /**
   * 拿到 schedule（用于 UI 显示下次触发时间）
   */
  getSchedule(charId: string): ProactiveDiarySchedule | null {
    return loadSchedules()[charId] || null;
  },

  /**
   * 测试用：立即触发指定角色（不走定时器）
   *   不传 charId → 从 os_last_active_char_id 拿当前 activeCharacterId（暮色 2026-08-22 友好）
   *   控制台：ProactiveDiary.fireNow() / .fireNow('char-xxx')
   */
  async fireNow(charId?: string) {
    const targetId = charId || localStorage.getItem('os_last_active_char_id') || '';
    if (!targetId) {
      console.warn('[ProactiveDiary] fireNow: no charId provided and os_last_active_char_id empty');
      return;
    }
    const schedules = loadSchedules();
    const now = Date.now();
    if (schedules[targetId]) {
      schedules[targetId].lastFire = now;
      schedules[targetId].nextFire = nextTriggerAt(now);
      saveSchedules(schedules);
    }
    await runDiaryForChar(targetId);
  },
};

// 暴露给控制台调试
if (typeof window !== 'undefined') {
  (window as any).__ProactiveDiary__ = ProactiveDiary;
}
