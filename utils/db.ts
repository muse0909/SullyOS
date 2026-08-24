


import {
    CharacterProfile, ChatTheme, Message, UserProfile,
    Task, Anniversary, DiaryEntry, RoomTodo, RoomNote, DailySchedule,
    GalleryImage, FullBackupData, GroupProfile, SocialPost, StudyCourse, GameSession, Worldbook, NovelBook, Emoji, EmojiCategory,
    BankTransaction, SavingsGoal, BankFullState, DollhouseState, XhsStockImage, XhsActivityRecord, SongSheet, QuizSession, GuidebookSession,
    LifeSimState, HandbookEntry, Tracker, TrackerEntry,
    VRWorldNovel, VRNovelAnnotation, VRMusicRoomState, VRGuestbookState, VRScript, VRStagedPlay, VRLetter,
    XiaoZhiTiao  // 2026-07-22：小纸条独立于 RoomNote
} from '../types';
import { exportPostOfficeLocal, importPostOfficeLocal } from './vrWorld/postOffice';
import { pruneMemoryLinksByTopN } from './memoryPalace/links';
// 暮色 2026-07-21：暴露 MemoryLinkDB 到 DB 上，方便 console 一键 dedup / 修剪
//   - 背景：memoryLinks 295555 条是 bug 累积（saveMany 不去重）
//   - 修法 1：DB.memoryLinkDB.deduplicateAll() 一次性 dedup（约 278k）
//   - 修法 2：DB.memoryLinkDB.pruneAllByTopN(50) 按节点 topN 修剪（约 5-6 万）
//   - 推荐：先跑 pruneAllByTopN（已包含 dedup 阶段）
import { MemoryLinkDB } from './memoryPalace/db';

const DB_NAME = 'AetherOS_Data';
const DB_VERSION = 64; // Bumped: v64 add mcp_call_logs store（暮色 8-24 E 计划：MCP 调用统计）

const STORE_CHARACTERS = 'characters';
const STORE_MESSAGES = 'messages';
const STORE_EMOJIS = 'emojis';
const STORE_EMOJI_CATEGORIES = 'emoji_categories'; 
const STORE_THEMES = 'themes';
const STORE_ASSETS = 'assets'; 
const STORE_SCHEDULED = 'scheduled_messages'; 
const STORE_GALLERY = 'gallery';
const STORE_USER = 'user_profile'; 
const STORE_DIARIES = 'diaries';
const STORE_TASKS = 'tasks'; 
const STORE_ANNIVERSARIES = 'anniversaries';
const STORE_ROOM_TODOS = 'room_todos'; 
const STORE_ROOM_NOTES = 'room_notes';
// 2026-07-22：小纸条独立 store（与 room_notes 互不可见）
const STORE_XIAO_ZHI_TIAOS = 'xiao_zhi_tiaos';
const STORE_GROUPS = 'groups'; 
const STORE_JOURNAL_STICKERS = 'journal_stickers';
const STORE_SOCIAL_POSTS = 'social_posts';
const STORE_COURSES = 'courses';
const STORE_GAMES = 'games';
const STORE_WORLDBOOKS = 'worldbooks'; 
const STORE_NOVELS = 'novels'; 
const STORE_BANK_TX = 'bank_transactions';
const STORE_BANK_DATA = 'bank_data';
const STORE_XHS_STOCK = 'xhs_stock';
const STORE_XHS_ACTIVITIES = 'xhs_activities';
const STORE_SONGS = 'songs';
const STORE_QUIZZES = 'quizzes';
const STORE_GUIDEBOOK = 'guidebook';
const STORE_LIFE_SIM = 'life_sim';
const STORE_DAILY_SCHEDULE = 'daily_schedule';
const STORE_HANDBOOK = 'handbook'; // 跨角色聚合手账，每天一条 entry，id = 'YYYY-MM-DD'
const STORE_TRACKERS = 'trackers';                // 手账打卡 tracker 定义
const STORE_TRACKER_ENTRIES = 'tracker_entries';  // tracker 每日打卡数据

export interface ScheduledMessage {
    id: string;
    charId: string;
    content: string;
    dueAt: number;
    createdAt: number;
}

/**
 * 生成 UUID v4（云端同步用作消息稳定 ID）。
 * 优先用 crypto.randomUUID（Chrome 92+ / Safari 15.4+ 全支持），老环境走 fallback。
 * Message.clientId 在 saveMessage 时自动生成，已有则保留。
 */
export function generateClientId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    // Fallback: RFC 4122 v4-ish（Math.random 强度足够，因为只是去重 key）
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

export const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onerror = () => {
        console.error("DB Open Error:", request.error);
        reject(request.error);
    };
    
    request.onsuccess = () => resolve(request.result);
    
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      
      const createStore = (name: string, options?: IDBObjectStoreParameters) => {
          if (!db.objectStoreNames.contains(name)) {
              db.createObjectStore(name, options);
          }
      };

      createStore(STORE_CHARACTERS, { keyPath: 'id' });
      
      if (!db.objectStoreNames.contains(STORE_MESSAGES)) {
        const msgStore = db.createObjectStore(STORE_MESSAGES, { keyPath: 'id', autoIncrement: true });
        msgStore.createIndex('charId', 'charId', { unique: false });
        msgStore.createIndex('groupId', 'groupId', { unique: false }); 
      } else {
          const msgStore = (event.target as IDBOpenDBRequest).transaction?.objectStore(STORE_MESSAGES);
          if (msgStore && !msgStore.indexNames.contains(STORE_MESSAGES) && !msgStore.indexNames.contains('groupId')) {
              try {
                  msgStore.createIndex('groupId', 'groupId', { unique: false });
              } catch (e) { console.log('Index already exists'); }
          }
      }
      
      createStore(STORE_EMOJIS, { keyPath: 'name' });
      createStore(STORE_EMOJI_CATEGORIES, { keyPath: 'id' });

      createStore(STORE_THEMES, { keyPath: 'id' });
      createStore(STORE_ASSETS, { keyPath: 'id' });
      
      if (!db.objectStoreNames.contains(STORE_SCHEDULED)) {
        const schedStore = db.createObjectStore(STORE_SCHEDULED, { keyPath: 'id' });
        schedStore.createIndex('charId', 'charId', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_GALLERY)) {
          const galleryStore = db.createObjectStore(STORE_GALLERY, { keyPath: 'id' });
          galleryStore.createIndex('charId', 'charId', { unique: false });
      }

      createStore(STORE_USER, { keyPath: 'id' });
      
      if (!db.objectStoreNames.contains(STORE_DIARIES)) {
          const diaryStore = db.createObjectStore(STORE_DIARIES, { keyPath: 'id' });
          diaryStore.createIndex('charId', 'charId', { unique: false });
      }
      
      createStore(STORE_TASKS, { keyPath: 'id' });
      createStore(STORE_ANNIVERSARIES, { keyPath: 'id' });

      if (!db.objectStoreNames.contains(STORE_ROOM_TODOS)) {
          db.createObjectStore(STORE_ROOM_TODOS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_ROOM_NOTES)) {
          const notesStore = db.createObjectStore(STORE_ROOM_NOTES, { keyPath: 'id' });
          notesStore.createIndex('charId', 'charId', { unique: false });
      }

      // 2026-07-22：小纸条独立 store（跟 room_notes 互不可见）
      if (!db.objectStoreNames.contains(STORE_XIAO_ZHI_TIAOS)) {
          const xztStore = db.createObjectStore(STORE_XIAO_ZHI_TIAOS, { keyPath: 'id' });
          xztStore.createIndex('charId', 'charId', { unique: false });
      }

      // 2026-08-24：MCP 工具调用日志（暮色 8-24 E 计划）
      //   记录每次 callMcpTool 的 serverId / toolName / success / duration / cached
      //   30 天保留，懒清理（打开统计面板时清）
      if (!db.objectStoreNames.contains('mcp_call_logs')) {
          const logsStore = db.createObjectStore('mcp_call_logs', { keyPath: 'id', autoIncrement: true });
          logsStore.createIndex('serverId', 'serverId', { unique: false });
          logsStore.createIndex('timestamp', 'timestamp', { unique: false });
      }

      createStore(STORE_GROUPS, { keyPath: 'id' });
      createStore(STORE_JOURNAL_STICKERS, { keyPath: 'name' });
      createStore(STORE_SOCIAL_POSTS, { keyPath: 'id' });
      createStore(STORE_COURSES, { keyPath: 'id' });
      createStore(STORE_GAMES, { keyPath: 'id' }); 
      createStore(STORE_WORLDBOOKS, { keyPath: 'id' }); 
      createStore(STORE_NOVELS, { keyPath: 'id' });
      
      createStore(STORE_BANK_TX, { keyPath: 'id' });
      createStore(STORE_BANK_DATA, { keyPath: 'id' });
      createStore(STORE_XHS_STOCK, { keyPath: 'id' });

      if (!db.objectStoreNames.contains(STORE_XHS_ACTIVITIES)) {
          const xhsActStore = db.createObjectStore(STORE_XHS_ACTIVITIES, { keyPath: 'id' });
          xhsActStore.createIndex('characterId', 'characterId', { unique: false });
      }

      createStore(STORE_SONGS, { keyPath: 'id' });
      createStore(STORE_QUIZZES, { keyPath: 'id' });
      createStore(STORE_GUIDEBOOK, { keyPath: 'id' });
      createStore(STORE_LIFE_SIM, { keyPath: 'id' });
      createStore(STORE_DAILY_SCHEDULE, { keyPath: 'id' });
      createStore(STORE_HANDBOOK, { keyPath: 'id' });

      createStore(STORE_TRACKERS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE_TRACKER_ENTRIES)) {
          const teStore = db.createObjectStore(STORE_TRACKER_ENTRIES, { keyPath: 'id' });
          teStore.createIndex('trackerId', 'trackerId', { unique: false });
          teStore.createIndex('date', 'date', { unique: false });
      }

      // ─── Memory Palace (记忆宫殿) stores ───
      if (!db.objectStoreNames.contains('memory_nodes')) {
          const mnStore = db.createObjectStore('memory_nodes', { keyPath: 'id' });
          mnStore.createIndex('charId', 'charId', { unique: false });
          mnStore.createIndex('room', 'room', { unique: false });
          mnStore.createIndex('embedded', 'embedded', { unique: false });
          mnStore.createIndex('boxId', 'boxId', { unique: false }); // deprecated，保留索引兼容旧数据
          mnStore.createIndex('eventBoxId', 'eventBoxId', { unique: false });
      } else {
          // Migration: 为已有 memory_nodes 表补建 eventBoxId 索引（v47 新增）
          const mnStore = (event.target as IDBOpenDBRequest).transaction?.objectStore('memory_nodes');
          if (mnStore && !mnStore.indexNames.contains('eventBoxId')) {
              try { mnStore.createIndex('eventBoxId', 'eventBoxId', { unique: false }); }
              catch (e) { console.log('memory_nodes eventBoxId index migration skipped'); }
          }
      }

      if (!db.objectStoreNames.contains('memory_vectors')) {
          const mvStore = db.createObjectStore('memory_vectors', { keyPath: 'memoryId' });
          mvStore.createIndex('charId', 'charId', { unique: false });
      } else {
          // Migration: add charId index to existing memory_vectors store
          const mvStore = (event.target as IDBOpenDBRequest).transaction?.objectStore('memory_vectors');
          if (mvStore && !mvStore.indexNames.contains('charId')) {
              try { mvStore.createIndex('charId', 'charId', { unique: false }); } catch (e) { console.log('memory_vectors charId index migration skipped'); }
          }
      }

      if (!db.objectStoreNames.contains('memory_links')) {
          const mlStore = db.createObjectStore('memory_links', { keyPath: 'id' });
          mlStore.createIndex('sourceId', 'sourceId', { unique: false });
          mlStore.createIndex('targetId', 'targetId', { unique: false });
      }

      if (!db.objectStoreNames.contains('memory_batches')) {
          const mbStore = db.createObjectStore('memory_batches', { keyPath: 'id' });
          mbStore.createIndex('charId', 'charId', { unique: false });
      }

      if (!db.objectStoreNames.contains('topic_boxes')) {
          const tbStore = db.createObjectStore('topic_boxes', { keyPath: 'id' });
          tbStore.createIndex('charId', 'charId', { unique: false });
          tbStore.createIndex('status', 'status', { unique: false });
      }

      if (!db.objectStoreNames.contains('anticipations')) {
          const antStore = db.createObjectStore('anticipations', { keyPath: 'id' });
          antStore.createIndex('charId', 'charId', { unique: false });
          antStore.createIndex('status', 'status', { unique: false });
      }

      // ─── EventBox（事件盒，v47 新增） ───────────────
      if (!db.objectStoreNames.contains('event_boxes')) {
          const ebStore = db.createObjectStore('event_boxes', { keyPath: 'id' });
          ebStore.createIndex('charId', 'charId', { unique: false });
      }

      // ─── v48 一次性强制清空记忆宫殿（EventBox 体系，旧 boxId 数据不兼容） ───
      //     oldVersion === 0 = 全新安装，没东西可清
      //     oldVersion >= 48 = 已经清过，跳过
      //     0 < oldVersion < 48 = 现有用户升级 → 清一次
      const oldVersion = event.oldVersion || 0;
      if (oldVersion > 0 && oldVersion < 48) {
          const upgradeTx = (event.target as IDBOpenDBRequest).transaction;
          const MP_STORES_TO_CLEAR = [
              'memory_nodes', 'memory_vectors', 'memory_links',
              'memory_batches', 'topic_boxes', 'anticipations', 'event_boxes',
          ];
          let cleared = 0;
          for (const name of MP_STORES_TO_CLEAR) {
              if (db.objectStoreNames.contains(name) && upgradeTx) {
                  try {
                      upgradeTx.objectStore(name).clear();
                      cleared++;
                  } catch (e) {
                      console.warn(`[DB v48 wipe] skip ${name}:`, e);
                  }
              }
          }
          // 同步清理 localStorage 里的高水位标记
          let hwmCleared = 0;
          try {
              const toRemove: string[] = [];
              for (let i = 0; i < localStorage.length; i++) {
                  const key = localStorage.key(i);
                  if (key && key.startsWith('mp_lastMsgId_')) toRemove.push(key);
              }
              for (const key of toRemove) { localStorage.removeItem(key); hwmCleared++; }
          } catch { /* ignore */ }
          console.log(`🗑️ [DB v48] 一次性清空完成：${cleared} 个 store，${hwmCleared} 个高水位（oldVersion=${oldVersion}）`);
      }

      // ─── Pixel Home（像素家园）stores ───────────────
      if (!db.objectStoreNames.contains('pixel_home_assets')) {
          const phaStore = db.createObjectStore('pixel_home_assets', { keyPath: 'id' });
          phaStore.createIndex('createdAt', 'createdAt', { unique: false });
      }
      if (!db.objectStoreNames.contains('pixel_home_layouts')) {
          const phlStore = db.createObjectStore('pixel_home_layouts', { keyPath: ['charId', 'roomId'] });
          phlStore.createIndex('charId', 'charId', { unique: false });
      }

      // ─── VR World / 彼方 stores ──────────────────────
      // v62: messages 加 [charId, type] 复合索引。彼方动态按 (charId, 'vr_card') 直取。
      try {
          const msgStore = (event.target as IDBOpenDBRequest).transaction?.objectStore('messages');
          if (msgStore && !msgStore.indexNames.contains('charId_type')) {
              msgStore.createIndex('charId_type', ['charId', 'type'], { unique: false });
          }
      } catch (e) { console.log('charId_type index migration skipped', e); }

      createStore('vr_novels', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('vr_annotations')) {
          const vrAnnStore = db.createObjectStore('vr_annotations', { keyPath: 'id' });
          vrAnnStore.createIndex('novelId', 'novelId', { unique: false });
      }
      if (!db.objectStoreNames.contains('cc_custom_parts')) {
          const ccStore = db.createObjectStore('cc_custom_parts', { keyPath: 'id' });
          ccStore.createIndex('categoryKey', 'categoryKey', { unique: false });
      }
      createStore('vr_music', { keyPath: 'id' });
      createStore('vr_guestbook', { keyPath: 'id' });
      createStore('vr_scripts', { keyPath: 'id' });
      createStore('vr_plays', { keyPath: 'id' });
      createStore('vr_presets', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('vr_letters')) {
          const ltStore = db.createObjectStore('vr_letters', { keyPath: 'id' });
          ltStore.createIndex('box', 'box', { unique: false });
          ltStore.createIndex('status', 'status', { unique: false });
      }
      createStore('vr_settings', { keyPath: 'id' });
      createStore('api_call_log', { keyPath: 'id' });
    };
  });
};

export const DB = {
  // 暮色 2026-07-21：暴露 MemoryLinkDB — console 一键 dedup / 修剪暴增的 278206 条 link
  //   用法 1：await DB.memoryLinkDB.deduplicateAll()            — 仅 dedup（~278k）
  //   用法 2：await DB.memoryLinkDB.pruneAllByTopN(50)         — dedup + 每节点 topN（推荐，约 5-6 万）
  memoryLinkDB: MemoryLinkDB,
  deleteDB: async (): Promise<void> => {
      return new Promise((resolve, reject) => {
          const req = indexedDB.deleteDatabase(DB_NAME);
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
          req.onblocked = () => console.warn('Delete blocked');
      });
  },

  getAllCharacters: async (): Promise<CharacterProfile[]> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_CHARACTERS, 'readonly');
      const store = transaction.objectStore(STORE_CHARACTERS);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  },

  saveCharacter: async (character: CharacterProfile): Promise<void> => {
    const db = await openDB();
    const transaction = db.transaction(STORE_CHARACTERS, 'readwrite');
    transaction.objectStore(STORE_CHARACTERS).put(character);
  },

  deleteCharacter: async (id: string): Promise<void> => {
    const db = await openDB();
    const transaction = db.transaction(STORE_CHARACTERS, 'readwrite');
    transaction.objectStore(STORE_CHARACTERS).delete(id);
  },

  /**
   * 获取角色的私聊消息。
   * @param includeProcessed 是否包含已被记忆宫殿处理的消息（默认 false，即自动过滤）。
   *                         记忆归档、批量总结等需要完整历史的场景应传 true。
   */
  getMessagesByCharId: async (charId: string, includeProcessed: boolean = false): Promise<Message[]> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_MESSAGES, 'readonly');
      const store = transaction.objectStore(STORE_MESSAGES);
      const index = store.index('charId');
      const request = index.getAll(IDBKeyRange.only(charId));
      request.onsuccess = () => {
          let results = (request.result || []).filter((m: Message) => !m.groupId);
          // 记忆宫殿：过滤已处理的消息（高水位标记之前的），用向量记忆替代
          if (!includeProcessed) {
              try {
                  const hwm = parseInt(localStorage.getItem(`mp_lastMsgId_${charId}`) || '0', 10);
                  if (hwm > 0) {
                      results = results.filter((m: Message) => m.id > hwm);
                  }
              } catch {}
          }
          resolve(results);
      };
      request.onerror = () => reject(request.error);
    });
  },

  // Performance: Load only the most recent N messages for a character
  getRecentMessagesByCharId: async (charId: string, limit: number, includeProcessed: boolean = false): Promise<Message[]> => {
    const db = await openDB();
    const hwm = includeProcessed ? 0 : (() => {
        try { return parseInt(localStorage.getItem(`mp_lastMsgId_${charId}`) || '0', 10) || 0; } catch { return 0; }
    })();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_MESSAGES, 'readonly');
      const store = transaction.objectStore(STORE_MESSAGES);
      const index = store.index('charId');
      const collected: Message[] = [];
      const cursorReq = index.openCursor(IDBKeyRange.only(charId), 'prev');
      cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (cursor && collected.length < limit) {
              const m = cursor.value as Message;
              if (!m.groupId && (includeProcessed || m.id > hwm)) collected.push(m);
              cursor.continue();
          } else {
              resolve(collected.reverse());
          }
      };
      cursorReq.onerror = () => reject(cursorReq.error);
    });
  },

  // Same as getRecentMessagesByCharId but also returns the total count (for UI display)
  getRecentMessagesWithCount: async (charId: string, limit: number): Promise<{ messages: Message[], totalCount: number }> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_MESSAGES, 'readonly');
      const store = transaction.objectStore(STORE_MESSAGES);
      const index = store.index('charId');
      const countReq = index.count(IDBKeyRange.only(charId));
      countReq.onsuccess = () => {
          const totalCount = countReq.result;
          // Use reverse cursor to only collect the last N messages
          const collected: Message[] = [];
          const cursorReq = index.openCursor(IDBKeyRange.only(charId), 'prev');
          cursorReq.onsuccess = () => {
              const cursor = cursorReq.result;
              if (cursor && collected.length < limit) {
                  const m = cursor.value as Message;
                  if (!m.groupId) collected.push(m);
                  cursor.continue();
              } else {
                  resolve({ messages: collected.reverse(), totalCount });
              }
          };
          cursorReq.onerror = () => reject(cursorReq.error);
      };
      countReq.onerror = () => reject(countReq.error);
    });
  },

  // Get all messages for a character from a given message ID onward (for hideBeforeMessageId)
  getMessagesFromId: async (charId: string, fromId: number): Promise<{ messages: Message[], totalCount: number }> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_MESSAGES, 'readonly');
      const store = transaction.objectStore(STORE_MESSAGES);
      const index = store.index('charId');
      const collected: Message[] = [];
      const cursorReq = index.openCursor(IDBKeyRange.only(charId));
      cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (cursor) {
              const m = cursor.value as Message;
              if (!m.groupId && m.id >= fromId) {
                  collected.push(m);
              }
              cursor.continue();
          } else {
              resolve({ messages: collected, totalCount: collected.length });
          }
      };
      cursorReq.onerror = () => reject(cursorReq.error);
    });
  },

  saveMessage: async (msg: Omit<Message, 'id' | 'timestamp'> & { timestamp?: number }): Promise<number> => {
    const db = await openDB();
    const id = await new Promise<number>((resolve, reject) => {
        const transaction = db.transaction(STORE_MESSAGES, 'readwrite');
        const store = transaction.objectStore(STORE_MESSAGES);
        const timestamp = typeof msg.timestamp === 'number' ? msg.timestamp : Date.now();
        const { timestamp: _ignored, ...payload } = msg;
        // 云端同步：自动生成 clientId（已有则保留），用作多端去重 key
        const clientId = (payload as any).clientId || generateClientId();
        const request = store.add({ ...payload, timestamp, clientId });
        request.onsuccess = () => resolve(request.result as number);
        request.onerror = () => reject(request.error);
    });
    // 云端同步：保存到本地后立刻把消息推入云端同步队列
    // 暮色多端互通的关键 hook；不动它会让"另一台设备"看不到这条消息
    try {
        const { getEngine } = await import('../hooks/useCloudSync');
        getEngine().enqueueUploadMessage({
            ...msg,
            id,
            timestamp: msg.timestamp ?? Date.now(),
        });
    } catch {
        // 同步静默失败（不影响主流程）
    }
    return id;
  },

  updateMessageMeta: async (id: number, patch: Record<string, any>): Promise<void> => {
    const db = await openDB();
    const transaction = db.transaction(STORE_MESSAGES, 'readwrite');
    const store = transaction.objectStore(STORE_MESSAGES);
    return new Promise((resolve, reject) => {
        const req = store.get(id);
        req.onsuccess = () => {
            const data = req.result;
            if (data) {
                data.metadata = { ...(data.metadata || {}), ...patch };
                store.put(data);
                resolve();
            } else {
                reject(new Error('Message not found'));
            }
        };
        req.onerror = () => reject(req.error);
    });
},

    updateMessage: async (id: number, content: string): Promise<void> => {
    const db = await openDB();
    const transaction = db.transaction(STORE_MESSAGES, 'readwrite');
    const store = transaction.objectStore(STORE_MESSAGES);
    return new Promise((resolve, reject) => {
        const req = store.get(id);
        req.onsuccess = () => {
            const data = req.result;
            if (data) {
                data.content = content;
                store.put(data);
                resolve();
            } else {
                reject(new Error('Message not found'));
            }
        };
        req.onerror = () => reject(req.error);
    });
},


  deleteMessage: async (id: number): Promise<void> => {
    const db = await openDB();
    const transaction = db.transaction(STORE_MESSAGES, 'readwrite');
    transaction.objectStore(STORE_MESSAGES).delete(id);
  },

  deleteMessages: async (ids: number[]): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_MESSAGES, 'readwrite');
      const store = transaction.objectStore(STORE_MESSAGES);
      ids.forEach(id => store.delete(id));
      return new Promise((resolve) => {
          transaction.oncomplete = () => resolve();
      });
  },

  clearMessages: async (charId: string): Promise<void> => {
    const db = await openDB();
    const transaction = db.transaction(STORE_MESSAGES, 'readwrite');
    const store = transaction.objectStore(STORE_MESSAGES);
    const index = store.index('charId');
    const request = index.openCursor(IDBKeyRange.only(charId));
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) { 
          const m = cursor.value as Message;
          if (!m.groupId) { 
              store.delete(cursor.primaryKey); 
          }
          cursor.continue(); 
      }
    };
  },

  getGroups: async (): Promise<GroupProfile[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_GROUPS)) return [];
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_GROUPS, 'readonly');
          const store = transaction.objectStore(STORE_GROUPS);
          const request = store.getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
      });
  },

  saveGroup: async (group: GroupProfile): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_GROUPS, 'readwrite');
      transaction.objectStore(STORE_GROUPS).put(group);
  },

  deleteGroup: async (id: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_GROUPS, 'readwrite');
      transaction.objectStore(STORE_GROUPS).delete(id);
  },

  getGroupMessages: async (groupId: string): Promise<Message[]> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_MESSAGES, 'readonly');
          const store = transaction.objectStore(STORE_MESSAGES);
          const index = store.index('groupId');
          const request = index.getAll(IDBKeyRange.only(groupId));
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
      });
  },

  getRecentGroupMessagesWithCount: async (groupId: string, limit: number): Promise<{ messages: Message[], totalCount: number }> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_MESSAGES, 'readonly');
          const store = transaction.objectStore(STORE_MESSAGES);
          const index = store.index('groupId');
          const countReq = index.count(IDBKeyRange.only(groupId));
          countReq.onsuccess = () => {
              const totalCount = countReq.result;
              const collected: Message[] = [];
              const cursorReq = index.openCursor(IDBKeyRange.only(groupId), 'prev');
              cursorReq.onsuccess = () => {
                  const cursor = cursorReq.result;
                  if (cursor && collected.length < limit) {
                      collected.push(cursor.value as Message);
                      cursor.continue();
                  } else {
                      resolve({ messages: collected.reverse(), totalCount });
                  }
              };
              cursorReq.onerror = () => reject(cursorReq.error);
          };
          countReq.onerror = () => reject(countReq.error);
      });
  },

  getSocialPosts: async (): Promise<SocialPost[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_SOCIAL_POSTS)) return [];
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_SOCIAL_POSTS, 'readonly');
          const store = transaction.objectStore(STORE_SOCIAL_POSTS);
          const request = store.getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
      });
  },

  saveSocialPost: async (post: SocialPost): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_SOCIAL_POSTS, 'readwrite');
      transaction.objectStore(STORE_SOCIAL_POSTS).put(post);
  },

  deleteSocialPost: async (id: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_SOCIAL_POSTS, 'readwrite');
      transaction.objectStore(STORE_SOCIAL_POSTS).delete(id);
  },

  clearSocialPosts: async (): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_SOCIAL_POSTS, 'readwrite');
      transaction.objectStore(STORE_SOCIAL_POSTS).clear();
  },

  getEmojis: async (): Promise<Emoji[]> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_EMOJIS, 'readonly');
      const store = transaction.objectStore(STORE_EMOJIS);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  },

  saveEmoji: async (name: string, url: string, categoryId?: string, order?: number): Promise<void> => {
    const db = await openDB();
    const transaction = db.transaction(STORE_EMOJIS, 'readwrite');
    const payload: Emoji = { name, url, categoryId };
    if (typeof order === 'number') payload.order = order;
    transaction.objectStore(STORE_EMOJIS).put(payload);
  },

  // 改名/更新表情包：name 是主键，要先读旧记录拿到 url/categoryId，再 put 新 key。
  // 保留 order 字段（如果旧记录有的话）。
  updateEmoji: async (oldName: string, updates: { name?: string; url?: string; categoryId?: string; order?: number }): Promise<void> => {
    const db = await openDB();
    const transaction = db.transaction(STORE_EMOJIS, 'readwrite');
    const store = transaction.objectStore(STORE_EMOJIS);
    const getReq = store.get(oldName);
    await new Promise<void>((resolve, reject) => {
      getReq.onsuccess = () => {
        const old = getReq.result as Emoji | undefined;
        if (!old) {
          // 旧记录不存在，直接 put 新记录（兜底）
          store.put({
            name: updates.name ?? oldName,
            url: updates.url ?? '',
            categoryId: updates.categoryId,
            ...(typeof updates.order === 'number' ? { order: updates.order } : {}),
          });
          resolve();
          return;
        }
        const merged: Emoji = {
          ...old,
          ...(typeof updates.name === 'string' ? { name: updates.name } : {}),
          ...(typeof updates.url === 'string' ? { url: updates.url } : {}),
          // categoryId 用 'in' 检测而不是 typeof === 'string'，这样 caller 显式传 undefined
          // 可以清空 categoryId（搬到默认分类时关键）—— typeof undefined === 'undefined' 会被跳过
          ...('categoryId' in updates ? { categoryId: updates.categoryId } : {}),
          ...(typeof updates.order === 'number' ? { order: updates.order } : {}),
        };
        if (oldName !== merged.name) {
          store.delete(oldName);
        }
        store.put(merged);
        resolve();
      };
      getReq.onerror = () => reject(getReq.error);
    });
  },

  // 批量调整顺序：传入完整顺序的 emoji 数组（按用户排好的），统一重写 order 字段。
  // 注意：只更新传入的 emoji，其他不动。如果新顺序里有未传入的，不影响。
  reorderEmojis: async (orderedEmojis: Emoji[]): Promise<void> => {
    const db = await openDB();
    const transaction = db.transaction(STORE_EMOJIS, 'readwrite');
    const store = transaction.objectStore(STORE_EMOJIS);
    orderedEmojis.forEach((e, idx) => {
      const merged: Emoji = { ...e, order: idx };
      store.put(merged);
    });
  },

  // 按 name 删除单个表情包（commit 6d36218 重构时漏补回来，2026-07-01 恢复）
  deleteEmoji: async (name: string): Promise<void> => {
    const db = await openDB();
    const transaction = db.transaction(STORE_EMOJIS, 'readwrite');
    transaction.objectStore(STORE_EMOJIS).delete(name);
  },

  getEmojiCategories: async (): Promise<EmojiCategory[]> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          if (!db.objectStoreNames.contains(STORE_EMOJI_CATEGORIES)) {
              resolve([]);
              return;
          }
          const transaction = db.transaction(STORE_EMOJI_CATEGORIES, 'readonly');
          const store = transaction.objectStore(STORE_EMOJI_CATEGORIES);
          const request = store.getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
      });
  },

  saveEmojiCategory: async (category: EmojiCategory): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_EMOJI_CATEGORIES, 'readwrite');
      transaction.objectStore(STORE_EMOJI_CATEGORIES).put(category);
  },

  deleteEmojiCategory: async (id: string): Promise<void> => {
      const db = await openDB();
      const tx = db.transaction([STORE_EMOJI_CATEGORIES, STORE_EMOJIS], 'readwrite');
      tx.objectStore(STORE_EMOJI_CATEGORIES).delete(id);
      const emojiStore = tx.objectStore(STORE_EMOJIS);
      const request = emojiStore.getAll();
      request.onsuccess = () => {
          const allEmojis = request.result as Emoji[];
          allEmojis.forEach(e => {
              if (e.categoryId === id) {
                  emojiStore.delete(e.name);
              }
          });
      };
      return new Promise((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
      });
  },

  initializeEmojiData: async (): Promise<void> => {
      const cats = await DB.getEmojiCategories();
      if (!cats.some(c => c.id === 'default')) {
          await DB.saveEmojiCategory({ id: 'default', name: '默认', isSystem: true });
      }
      // 一次性清理：老数据里如果还存着 Sully 专属分类 + 该分类下所有 emoji（URL 走 sharkpan.xyz 经常挂），自动删
      if (cats.some(c => c.id === 'cat_sully_exclusive')) {
          const db = await openDB();
          const tx = db.transaction([STORE_EMOJIS, STORE_EMOJI_CATEGORIES], 'readwrite');
          const emojiStore = tx.objectStore(STORE_EMOJIS);
          const catStore = tx.objectStore(STORE_EMOJI_CATEGORIES);
          const allEmojisReq = emojiStore.getAll();
          allEmojisReq.onsuccess = () => {
              const toDelete = (allEmojisReq.result || []).filter((e: any) => e.categoryId === 'cat_sully_exclusive');
              toDelete.forEach((e: any) => emojiStore.delete(e.name));
          };
          catStore.delete('cat_sully_exclusive');
          await new Promise(resolve => { tx.oncomplete = resolve; });
      }
  },

  getThemes: async (): Promise<ChatTheme[]> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_THEMES, 'readonly');
      const store = transaction.objectStore(STORE_THEMES);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  },

  saveTheme: async (theme: ChatTheme): Promise<void> => {
    const db = await openDB();
    const transaction = db.transaction(STORE_THEMES, 'readwrite');
    transaction.objectStore(STORE_THEMES).put(theme);
  },

  deleteTheme: async (id: string): Promise<void> => {
    const db = await openDB();
    const transaction = db.transaction(STORE_THEMES, 'readwrite');
    transaction.objectStore(STORE_THEMES).delete(id);
  },

  getAllAssets: async (): Promise<{id: string, data: string}[]> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_ASSETS, 'readonly');
      const store = transaction.objectStore(STORE_ASSETS);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  },

  getAsset: async (id: string): Promise<string | null> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_ASSETS, 'readonly');
          const store = transaction.objectStore(STORE_ASSETS);
          const request = store.get(id);
          request.onsuccess = () => resolve(request.result?.data || null);
          request.onerror = () => reject(request.error);
      });
  },

  saveAsset: async (id: string, data: string): Promise<void> => {
    const db = await openDB();
    const transaction = db.transaction(STORE_ASSETS, 'readwrite');
    transaction.objectStore(STORE_ASSETS).put({ id, data });
  },

  getAssetRaw: async (id: string): Promise<any | null> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_ASSETS, 'readonly');
          const store = transaction.objectStore(STORE_ASSETS);
          const request = store.get(id);
          request.onsuccess = () => resolve(request.result?.data ?? null);
          request.onerror = () => reject(request.error);
      });
  },

  saveAssetRaw: async (id: string, data: any): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_ASSETS, 'readwrite');
      transaction.objectStore(STORE_ASSETS).put({ id, data });
  },

  deleteAsset: async (id: string): Promise<void> => {
    const db = await openDB();
    const transaction = db.transaction(STORE_ASSETS, 'readwrite');
    transaction.objectStore(STORE_ASSETS).delete(id);
  },

  getJournalStickers: async (): Promise<{name: string, url: string}[]> => {
    const db = await openDB();
    if (!db.objectStoreNames.contains(STORE_JOURNAL_STICKERS)) return [];
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_JOURNAL_STICKERS, 'readonly');
      const store = transaction.objectStore(STORE_JOURNAL_STICKERS);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  },

  saveJournalSticker: async (name: string, url: string): Promise<void> => {
    const db = await openDB();
    const transaction = db.transaction(STORE_JOURNAL_STICKERS, 'readwrite');
    transaction.objectStore(STORE_JOURNAL_STICKERS).put({ name, url });
  },

  deleteJournalSticker: async (name: string): Promise<void> => {
    const db = await openDB();
    const transaction = db.transaction(STORE_JOURNAL_STICKERS, 'readwrite');
    transaction.objectStore(STORE_JOURNAL_STICKERS).delete(name);
  },

  saveGalleryImage: async (img: GalleryImage): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_GALLERY, 'readwrite');
      transaction.objectStore(STORE_GALLERY).put(img);
  },

  getGalleryImages: async (charId?: string, source?: 'user' | 'ai'): Promise<GalleryImage[]> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_GALLERY, 'readonly');
          const store = transaction.objectStore(STORE_GALLERY);
          let request;
          if (charId) {
              const index = store.index('charId');
              request = index.getAll(IDBKeyRange.only(charId));
          } else {
              request = store.getAll();
          }
          request.onsuccess = () => {
              let result = request.result || [];
              // 老数据 source undefined → 视为 'user'
              if (source) {
                  result = result.filter(img => (img.source || 'user') === source);
              }
              resolve(result);
          };
          request.onerror = () => reject(request.error);
      });
  },

  updateGalleryImageReview: async (id: string, review: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_GALLERY, 'readwrite');
      const store = transaction.objectStore(STORE_GALLERY);
      return new Promise((resolve, reject) => {
          const req = store.get(id);
          req.onsuccess = () => {
              const data = req.result as GalleryImage;
              if (data) {
                  data.review = review;
                  data.reviewTimestamp = Date.now();
                  store.put(data);
                  resolve();
              } else reject(new Error('Image not found'));
          };
          req.onerror = () => reject(req.error);
      });
  },

  deleteGalleryImage: async (id: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_GALLERY, 'readwrite');
      transaction.objectStore(STORE_GALLERY).delete(id);
  },

  // --- XHS Stock Images ---
  getXhsStockImages: async (): Promise<XhsStockImage[]> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_XHS_STOCK, 'readonly');
          const request = transaction.objectStore(STORE_XHS_STOCK).getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
      });
  },

  saveXhsStockImage: async (img: XhsStockImage): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_XHS_STOCK, 'readwrite');
      transaction.objectStore(STORE_XHS_STOCK).put(img);
  },

  deleteXhsStockImage: async (id: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_XHS_STOCK, 'readwrite');
      transaction.objectStore(STORE_XHS_STOCK).delete(id);
  },

  updateXhsStockImageUsage: async (id: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_XHS_STOCK, 'readwrite');
      const store = transaction.objectStore(STORE_XHS_STOCK);
      return new Promise((resolve, reject) => {
          const req = store.get(id);
          req.onsuccess = () => {
              const data = req.result as XhsStockImage;
              if (data) {
                  data.usedCount = (data.usedCount || 0) + 1;
                  data.lastUsedAt = Date.now();
                  store.put(data);
                  resolve();
              } else reject(new Error('Stock image not found'));
          };
          req.onerror = () => reject(req.error);
      });
  },

  // --- XHS Activities (Free Roam) ---
  saveXhsActivity: async (activity: XhsActivityRecord): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_XHS_ACTIVITIES, 'readwrite');
      transaction.objectStore(STORE_XHS_ACTIVITIES).put(activity);
  },

  getXhsActivities: async (characterId: string, limit?: number): Promise<XhsActivityRecord[]> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_XHS_ACTIVITIES, 'readonly');
          const store = transaction.objectStore(STORE_XHS_ACTIVITIES);
          const index = store.index('characterId');
          const request = index.getAll(IDBKeyRange.only(characterId));
          request.onsuccess = () => {
              let results = (request.result || []) as XhsActivityRecord[];
              results.sort((a, b) => b.timestamp - a.timestamp);
              if (limit) results = results.slice(0, limit);
              resolve(results);
          };
          request.onerror = () => reject(request.error);
      });
  },

  getAllXhsActivities: async (): Promise<XhsActivityRecord[]> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_XHS_ACTIVITIES, 'readonly');
          const request = transaction.objectStore(STORE_XHS_ACTIVITIES).getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
      });
  },

  deleteXhsActivity: async (id: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_XHS_ACTIVITIES, 'readwrite');
      transaction.objectStore(STORE_XHS_ACTIVITIES).delete(id);
  },

  clearXhsActivities: async (characterId: string): Promise<void> => {
      const activities = await DB.getXhsActivities(characterId);
      const db = await openDB();
      const transaction = db.transaction(STORE_XHS_ACTIVITIES, 'readwrite');
      const store = transaction.objectStore(STORE_XHS_ACTIVITIES);
      for (const a of activities) {
          store.delete(a.id);
      }
  },

  saveScheduledMessage: async (msg: ScheduledMessage): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_SCHEDULED, 'readwrite');
      transaction.objectStore(STORE_SCHEDULED).put(msg);
  },

  getDueScheduledMessages: async (charId: string): Promise<ScheduledMessage[]> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_SCHEDULED, 'readonly');
          const store = transaction.objectStore(STORE_SCHEDULED);
          const index = store.index('charId');
          const request = index.getAll(IDBKeyRange.only(charId));
          request.onsuccess = () => {
              const all = request.result as ScheduledMessage[];
              const now = Date.now();
              const due = all.filter(m => m.dueAt <= now);
              resolve(due);
          };
          request.onerror = () => reject(request.error);
      });
  },

  deleteScheduledMessage: async (id: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_SCHEDULED, 'readwrite');
      transaction.objectStore(STORE_SCHEDULED).delete(id);
  },

  saveUserProfile: async (profile: UserProfile): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_USER, 'readwrite');
      transaction.objectStore(STORE_USER).put({ ...profile, id: 'me' });
  },

  getUserProfile: async (): Promise<UserProfile | null> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_USER, 'readonly');
          const store = transaction.objectStore(STORE_USER);
          const request = store.get('me');
          request.onsuccess = () => {
              if (request.result) {
                  const { id, ...profile } = request.result;
                  resolve(profile as UserProfile);
              } else {
                  resolve(null);
              }
          };
          request.onerror = () => reject(request.error);
      });
  },

  getDiariesByCharId: async (charId: string): Promise<DiaryEntry[]> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_DIARIES, 'readonly');
          const store = transaction.objectStore(STORE_DIARIES);
          const index = store.index('charId');
          const request = index.getAll(IDBKeyRange.only(charId));
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
      });
  },

  // 暮色 2026-08-21：只取角色独白日记（source='char-only'），内存过滤
  // 复用 charId 索引查全量再 filter — 数据量小（角色日均 0-1 篇），无需新建 source 索引
  getCharOnlyDiariesByCharId: async (charId: string): Promise<DiaryEntry[]> => {
      const all = await DB.getDiariesByCharId(charId);
      return all.filter(d => d.source === 'char-only');
  },

  saveDiary: async (diary: DiaryEntry): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_DIARIES, 'readwrite');
      transaction.objectStore(STORE_DIARIES).put(diary);
  },

  deleteDiary: async (id: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_DIARIES, 'readwrite');
      transaction.objectStore(STORE_DIARIES).delete(id);
  },

  getAllTasks: async (): Promise<Task[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_TASKS)) return [];
      
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_TASKS, 'readonly');
          const store = transaction.objectStore(STORE_TASKS);
          const request = store.getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
      });
  },

  saveTask: async (task: Task): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_TASKS, 'readwrite');
      transaction.objectStore(STORE_TASKS).put(task);
  },

  deleteTask: async (id: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_TASKS, 'readwrite');
      transaction.objectStore(STORE_TASKS).delete(id);
  },

  getAllAnniversaries: async (): Promise<Anniversary[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_ANNIVERSARIES)) return [];

      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_ANNIVERSARIES, 'readonly');
          const store = transaction.objectStore(STORE_ANNIVERSARIES);
          const request = store.getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
      });
  },

  saveAnniversary: async (anniversary: Anniversary): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_ANNIVERSARIES, 'readwrite');
      transaction.objectStore(STORE_ANNIVERSARIES).put(anniversary);
  },

  deleteAnniversary: async (id: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_ANNIVERSARIES, 'readwrite');
      transaction.objectStore(STORE_ANNIVERSARIES).delete(id);
  },

  getRoomTodo: async (charId: string, date: string): Promise<RoomTodo | null> => {
      const db = await openDB();
      const id = `${charId}_${date}`;
      return new Promise((resolve, reject) => {
          if (!db.objectStoreNames.contains(STORE_ROOM_TODOS)) { resolve(null); return; }
          const transaction = db.transaction(STORE_ROOM_TODOS, 'readonly');
          const store = transaction.objectStore(STORE_ROOM_TODOS);
          const req = store.get(id);
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => reject(req.error);
      });
  },

  saveRoomTodo: async (todo: RoomTodo): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_ROOM_TODOS, 'readwrite');
      transaction.objectStore(STORE_ROOM_TODOS).put(todo);
  },

  getRoomNotes: async (charId: string): Promise<RoomNote[]> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          if (!db.objectStoreNames.contains(STORE_ROOM_NOTES)) { resolve([]); return; }
          const transaction = db.transaction(STORE_ROOM_NOTES, 'readonly');
          const store = transaction.objectStore(STORE_ROOM_NOTES);
          const index = store.index('charId');
          const request = index.getAll(IDBKeyRange.only(charId));
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
      });
  },

  saveRoomNote: async (note: RoomNote): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_ROOM_NOTES, 'readwrite');
      transaction.objectStore(STORE_ROOM_NOTES).put(note);
  },

  deleteRoomNote: async (id: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_ROOM_NOTES, 'readwrite');
      transaction.objectStore(STORE_ROOM_NOTES).delete(id);
  },

  // ─── 2026-07-22：小纸条独立 CRUD（跟 room_notes 完全分离，互不可见） ───
  getXiaoZhiTiaos: async (charId: string): Promise<XiaoZhiTiao[]> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          if (!db.objectStoreNames.contains(STORE_XIAO_ZHI_TIAOS)) { resolve([]); return; }
          const transaction = db.transaction(STORE_XIAO_ZHI_TIAOS, 'readonly');
          const store = transaction.objectStore(STORE_XIAO_ZHI_TIAOS);
          const index = store.index('charId');
          const request = index.getAll(IDBKeyRange.only(charId));
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
      });
  },

  saveXiaoZhiTiao: async (xzt: XiaoZhiTiao): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_XIAO_ZHI_TIAOS, 'readwrite');
      transaction.objectStore(STORE_XIAO_ZHI_TIAOS).put(xzt);
  },

  deleteXiaoZhiTiao: async (id: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_XIAO_ZHI_TIAOS, 'readwrite');
      transaction.objectStore(STORE_XIAO_ZHI_TIAOS).delete(id);
  },

  // ─── Daily Schedule (角色日程表) ───
  getDailySchedule: async (charId: string, date: string): Promise<DailySchedule | null> => {
      const db = await openDB();
      const id = `${charId}_${date}`;
      return new Promise((resolve, reject) => {
          if (!db.objectStoreNames.contains(STORE_DAILY_SCHEDULE)) { resolve(null); return; }
          const transaction = db.transaction(STORE_DAILY_SCHEDULE, 'readonly');
          const store = transaction.objectStore(STORE_DAILY_SCHEDULE);
          const req = store.get(id);
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => reject(req.error);
      });
  },

  saveDailySchedule: async (schedule: DailySchedule): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_DAILY_SCHEDULE, 'readwrite');
      transaction.objectStore(STORE_DAILY_SCHEDULE).put(schedule);
  },

  getScheduleCoverImage: async (charId: string): Promise<string | null> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          if (!db.objectStoreNames.contains(STORE_DAILY_SCHEDULE)) { resolve(null); return; }
          const transaction = db.transaction(STORE_DAILY_SCHEDULE, 'readonly');
          const store = transaction.objectStore(STORE_DAILY_SCHEDULE);
          const req = store.openCursor();
          req.onsuccess = () => {
              const cursor = req.result;
              if (cursor) {
                  const val = cursor.value as DailySchedule;
                  if (val.charId === charId && val.coverImage) {
                      resolve(val.coverImage);
                      return;
                  }
                  cursor.continue();
              } else {
                  resolve(null);
              }
          };
          req.onerror = () => reject(req.error);
      });
  },

  // ─── Handbook (手账) ───
  getHandbook: async (date: string): Promise<HandbookEntry | null> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          if (!db.objectStoreNames.contains(STORE_HANDBOOK)) { resolve(null); return; }
          const transaction = db.transaction(STORE_HANDBOOK, 'readonly');
          const store = transaction.objectStore(STORE_HANDBOOK);
          const req = store.get(date);
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => reject(req.error);
      });
  },

  getAllHandbooks: async (): Promise<HandbookEntry[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_HANDBOOK)) return [];
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_HANDBOOK, 'readonly');
          const store = transaction.objectStore(STORE_HANDBOOK);
          const req = store.getAll();
          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => reject(req.error);
      });
  },

  saveHandbook: async (entry: HandbookEntry): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_HANDBOOK, 'readwrite');
      transaction.objectStore(STORE_HANDBOOK).put(entry);
  },

  deleteHandbook: async (date: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_HANDBOOK, 'readwrite');
      transaction.objectStore(STORE_HANDBOOK).delete(date);
  },

  // ─── Trackers (手账打卡引擎) ───
  getAllTrackers: async (): Promise<Tracker[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_TRACKERS)) return [];
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_TRACKERS, 'readonly');
          const req = tx.objectStore(STORE_TRACKERS).getAll();
          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => reject(req.error);
      });
  },

  saveTracker: async (tracker: Tracker): Promise<void> => {
      const db = await openDB();
      const tx = db.transaction(STORE_TRACKERS, 'readwrite');
      tx.objectStore(STORE_TRACKERS).put(tracker);
  },

  deleteTracker: async (id: string): Promise<void> => {
      const db = await openDB();
      // 同时删掉该 tracker 的所有 entries
      const tx = db.transaction([STORE_TRACKERS, STORE_TRACKER_ENTRIES], 'readwrite');
      tx.objectStore(STORE_TRACKERS).delete(id);
      const teStore = tx.objectStore(STORE_TRACKER_ENTRIES);
      const idx = teStore.index('trackerId');
      const req = idx.openCursor(IDBKeyRange.only(id));
      req.onsuccess = () => {
          const cursor = req.result;
          if (cursor) { cursor.delete(); cursor.continue(); }
      };
  },

  getTrackerEntriesByTracker: async (trackerId: string): Promise<TrackerEntry[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_TRACKER_ENTRIES)) return [];
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_TRACKER_ENTRIES, 'readonly');
          const idx = tx.objectStore(STORE_TRACKER_ENTRIES).index('trackerId');
          const req = idx.getAll(IDBKeyRange.only(trackerId));
          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => reject(req.error);
      });
  },

  getTrackerEntry: async (trackerId: string, date: string): Promise<TrackerEntry | null> => {
      // 复合查询:用 tracker 索引,客户端再过滤 date(简单且足够快)
      const all = await DB.getTrackerEntriesByTracker(trackerId);
      return all.find(e => e.date === date) || null;
  },

  saveTrackerEntry: async (entry: TrackerEntry): Promise<void> => {
      const db = await openDB();
      const tx = db.transaction(STORE_TRACKER_ENTRIES, 'readwrite');
      tx.objectStore(STORE_TRACKER_ENTRIES).put(entry);
  },

  deleteTrackerEntry: async (id: string): Promise<void> => {
      const db = await openDB();
      const tx = db.transaction(STORE_TRACKER_ENTRIES, 'readwrite');
      tx.objectStore(STORE_TRACKER_ENTRIES).delete(id);
  },

  getAllCourses: async (): Promise<StudyCourse[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_COURSES)) return [];
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_COURSES, 'readonly');
          const store = transaction.objectStore(STORE_COURSES);
          const request = store.getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
      });
  },

  saveCourse: async (course: StudyCourse): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_COURSES, 'readwrite');
      transaction.objectStore(STORE_COURSES).put(course);
  },

  deleteCourse: async (id: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_COURSES, 'readwrite');
      transaction.objectStore(STORE_COURSES).delete(id);
  },

  // --- Quiz / Practice Book ---
  getAllQuizzes: async (): Promise<QuizSession[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_QUIZZES)) return [];
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_QUIZZES, 'readonly');
          const store = transaction.objectStore(STORE_QUIZZES);
          const request = store.getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
      });
  },

  saveQuiz: async (quiz: QuizSession): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_QUIZZES, 'readwrite');
      transaction.objectStore(STORE_QUIZZES).put(quiz);
  },

  deleteQuiz: async (id: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_QUIZZES, 'readwrite');
      transaction.objectStore(STORE_QUIZZES).delete(id);
  },

  getAllGames: async (): Promise<GameSession[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_GAMES)) return [];
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_GAMES, 'readonly');
          const store = transaction.objectStore(STORE_GAMES);
          const request = store.getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
      });
  },

  saveGame: async (game: GameSession): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_GAMES, 'readwrite');
      transaction.objectStore(STORE_GAMES).put(game);
  },

  deleteGame: async (id: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_GAMES, 'readwrite');
      transaction.objectStore(STORE_GAMES).delete(id);
  },

  getAllWorldbooks: async (): Promise<Worldbook[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_WORLDBOOKS)) return [];
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_WORLDBOOKS, 'readonly');
          const store = transaction.objectStore(STORE_WORLDBOOKS);
          const request = store.getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
      });
  },

  saveWorldbook: async (book: Worldbook): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_WORLDBOOKS, 'readwrite');
      transaction.objectStore(STORE_WORLDBOOKS).put(book);
  },

  deleteWorldbook: async (id: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_WORLDBOOKS, 'readwrite');
      transaction.objectStore(STORE_WORLDBOOKS).delete(id);
  },

  getAllNovels: async (): Promise<NovelBook[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_NOVELS)) return [];
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_NOVELS, 'readonly');
          const store = transaction.objectStore(STORE_NOVELS);
          const request = store.getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
      });
  },

  saveNovel: async (novel: NovelBook): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_NOVELS, 'readwrite');
      transaction.objectStore(STORE_NOVELS).put(novel);
  },

  deleteNovel: async (id: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_NOVELS, 'readwrite');
      transaction.objectStore(STORE_NOVELS).delete(id);
  },

  // --- BANK / PET APP LOGIC ---
  getBankState: async (): Promise<BankFullState | null> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          if (!db.objectStoreNames.contains(STORE_BANK_DATA)) { resolve(null); return; }
          const transaction = db.transaction(STORE_BANK_DATA, 'readonly');
          const store = transaction.objectStore(STORE_BANK_DATA);
          const req = store.get('main_state');
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => reject(req.error);
      });
  },

  saveBankState: async (state: BankFullState): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_BANK_DATA, 'readwrite');
      // Strip dollhouse from the main state save (dollhouse is saved separately)
      const { dollhouse: _dh, ...shopWithoutDollhouse } = (state.shop || {}) as any;
      const cleanState = { ...state, shop: shopWithoutDollhouse };
      transaction.objectStore(STORE_BANK_DATA).put({ ...cleanState, id: 'main_state' });
      return new Promise((resolve, reject) => {
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
      });
  },

  // Dollhouse state saved separately (same pattern as RoomApp's per-character roomConfig)
  getBankDollhouse: async (): Promise<DollhouseState | null> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          if (!db.objectStoreNames.contains(STORE_BANK_DATA)) { resolve(null); return; }
          const transaction = db.transaction(STORE_BANK_DATA, 'readonly');
          const store = transaction.objectStore(STORE_BANK_DATA);
          const req = store.get('dollhouse_state');
          req.onsuccess = () => resolve(req.result?.data || null);
          req.onerror = () => reject(req.error);
      });
  },

  saveBankDollhouse: async (state: DollhouseState): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_BANK_DATA, 'readwrite');
      transaction.objectStore(STORE_BANK_DATA).put({ id: 'dollhouse_state', data: state });
      return new Promise((resolve, reject) => {
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
      });
  },

  getAllTransactions: async (): Promise<BankTransaction[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_BANK_TX)) return [];
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_BANK_TX, 'readonly');
          const store = transaction.objectStore(STORE_BANK_TX);
          const request = store.getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
      });
  },

  saveTransaction: async (txData: BankTransaction): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_BANK_TX, 'readwrite');
      transaction.objectStore(STORE_BANK_TX).put(txData);
  },

  deleteTransaction: async (id: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_BANK_TX, 'readwrite');
      transaction.objectStore(STORE_BANK_TX).delete(id);
  },

  // --- Songs (Songwriting App) ---
  getAllSongs: async (): Promise<SongSheet[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_SONGS)) return [];
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_SONGS, 'readonly');
          const store = transaction.objectStore(STORE_SONGS);
          const request = store.getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
      });
  },

  saveSong: async (song: SongSheet): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_SONGS, 'readwrite');
      transaction.objectStore(STORE_SONGS).put(song);
  },

  deleteSong: async (id: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_SONGS, 'readwrite');
      transaction.objectStore(STORE_SONGS).delete(id);
  },

  // --- Guidebook (攻略本) ---
  getAllGuidebookSessions: async (): Promise<GuidebookSession[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_GUIDEBOOK)) return [];
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_GUIDEBOOK, 'readonly');
          const store = transaction.objectStore(STORE_GUIDEBOOK);
          const request = store.getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
      });
  },

  saveGuidebookSession: async (session: GuidebookSession): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_GUIDEBOOK, 'readwrite');
      transaction.objectStore(STORE_GUIDEBOOK).put(session);
  },

  deleteGuidebookSession: async (id: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_GUIDEBOOK, 'readwrite');
      transaction.objectStore(STORE_GUIDEBOOK).delete(id);
  },

  // ── LifeSim (模拟人生) ────────────────────────────────────
  getLifeSimState: async (): Promise<LifeSimState | null> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_LIFE_SIM)) return null;
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_LIFE_SIM, 'readonly');
          const request = transaction.objectStore(STORE_LIFE_SIM).get('main');
          request.onsuccess = () => resolve(request.result || null);
          request.onerror = () => reject(request.error);
      });
  },

  saveLifeSimState: async (state: LifeSimState): Promise<void> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_LIFE_SIM, 'readwrite');
          transaction.objectStore(STORE_LIFE_SIM).put({ ...state, id: 'main' });
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
      });
  },

  clearLifeSimState: async (): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_LIFE_SIM, 'readwrite');
      transaction.objectStore(STORE_LIFE_SIM).clear();
  },

  getRawStoreData: async (storeName: string): Promise<any[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(storeName)) return [];
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(storeName, 'readonly');
          const store = transaction.objectStore(storeName);
          const request = store.getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
      });
  },

  // ============ 暮色 2026-07-31：彼方（VRWorldApp）缺失的 DB 方法 ============
  // 暮色反馈彼方 app 一进就卡"载入彼方…"——根因是 schema 创了 vr_novels / vr_settings / api_call_log 三个 store，
  // 但对应的 get/save/delete 方法从来没写。VRWorldApp 调 DB.getVRNovels() / DB.getVRCardsByCharId() 抛 TypeError，
  // reloadAll await Promise.all 抛错 → setLoading(false) 永远不跑 → 永远卡 loading。
  // API 配置页同样：getVRApi() → DB.getVRApiConfig() 抛错 → vrApi 永远 null → UI 一直"未配置"。

  /** 彼方书架：拉所有 vr_novels，按 updatedAt desc。 */
  getVRNovels: async (): Promise<any[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains('vr_novels')) return [];
      return new Promise((resolve, reject) => {
          const transaction = db.transaction('vr_novels', 'readonly');
          const request = transaction.objectStore('vr_novels').getAll();
          request.onsuccess = () => {
              const all = (request.result || []) as any[];
              all.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
              resolve(all);
          };
          request.onerror = () => reject(request.error);
      });
  },

  /** 彼方书架：存/更新一条 vr_novel。novel.id 存在则覆盖（put），不存在则新建。 */
  saveVRNovel: async (novel: any): Promise<void> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains('vr_novels')) {
          console.warn('[DB] vr_novels store missing, cannot save');
          return;
      }
      const transaction = db.transaction('vr_novels', 'readwrite');
      transaction.objectStore('vr_novels').put(novel);
      await new Promise<void>((resolve, reject) => {
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
      });
  },

  /** 彼方书架：删一条 vr_novel。 */
  deleteVRNovel: async (id: string): Promise<void> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains('vr_novels')) return;
      const transaction = db.transaction('vr_novels', 'readwrite');
      transaction.objectStore('vr_novels').delete(id);
      await new Promise<void>((resolve, reject) => {
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
      });
  },

  /**
   * 彼方动态：按 charId 拉该角色所有 type='vr_card' 的 messages。
   * 用 schema 里的 charId_type 复合索引（v62 加的），不在全表扫。
   * 不过 getAllFromIndex 配合 keyPath 范围比较复杂，直接用 charId 索引拿全 charId 的消息
   * 然后在内存里 filter type='vr_card'——vr_card 数量级不大，性能 OK。
   */
  getVRCardsByCharId: async (charId: string): Promise<any[]> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_MESSAGES, 'readonly');
          const store = transaction.objectStore(STORE_MESSAGES);
          const index = store.index('charId');
          const request = index.getAll(IDBKeyRange.only(charId));
          request.onsuccess = () => {
              const all = (request.result || []) as any[];
              resolve(all.filter(m => m && m.type === 'vr_card'));
          };
          request.onerror = () => reject(request.error);
      });
  },

  /** 彼方独立 API 配置：vr_settings 里用固定 id 'vr_api_config' 存 APIConfig。 */
  getVRApiConfig: async (): Promise<any | null> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains('vr_settings')) return null;
      return new Promise((resolve, reject) => {
          const transaction = db.transaction('vr_settings', 'readonly');
          const request = transaction.objectStore('vr_settings').get('vr_api_config');
          request.onsuccess = () => {
              const row = request.result as any | undefined;
              if (!row) { resolve(null); return; }
              // 行结构: { id: 'vr_api_config', cfg: APIConfig } ——拆出 cfg
              resolve(row.cfg ?? null);
          };
          request.onerror = () => reject(request.error);
      });
  },

  /** 彼方独立 API 配置：null = 跟随聊天默认。 */
  saveVRApiConfig: async (cfg: any | null): Promise<void> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains('vr_settings')) return;
      const transaction = db.transaction('vr_settings', 'readwrite');
      const store = transaction.objectStore('vr_settings');
      if (cfg) {
          store.put({ id: 'vr_api_config', cfg });
      } else {
          store.delete('vr_api_config');
      }
      await new Promise<void>((resolve, reject) => {
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
      });
  },

  /** 彼方 API 调用记录：api_call_log 全量，按 ts desc。 */
  getVRApiLog: async (): Promise<any[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains('api_call_log')) return [];
      return new Promise((resolve, reject) => {
          const transaction = db.transaction('api_call_log', 'readonly');
          const request = transaction.objectStore('api_call_log').getAll();
          request.onsuccess = () => {
              const all = (request.result || []) as any[];
              all.sort((a, b) => (b.ts || 0) - (a.ts || 0));
              resolve(all);
          };
          request.onerror = () => reject(request.error);
      });
  },

  /** 彼方 API 调用记录：整体替换（vrApi.ts migrateOnce 用）。 */
  setVRApiLog: async (log: any[]): Promise<void> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains('api_call_log')) return;
      const transaction = db.transaction('api_call_log', 'readwrite');
      const store = transaction.objectStore('api_call_log');
      store.clear();
      for (const entry of log) {
          // VRApiCall 没 id，存的时候包一层 id
          store.put({ ...entry, id: entry.id || `vrapi-${entry.ts}-${Math.random().toString(36).slice(2, 8)}` });
      }
      await new Promise<void>((resolve, reject) => {
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
      });
  },

  /** 彼方 API 调用记录：追加一条（runSession.ts 每次调用后写）。 */
  appendVRApiLog: async (entry: any): Promise<void> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains('api_call_log')) return;
      const transaction = db.transaction('api_call_log', 'readwrite');
      const store = transaction.objectStore('api_call_log');
      const id = `vrapi-${entry.ts}-${Math.random().toString(36).slice(2, 8)}`;
      store.put({ ...entry, id });
      await new Promise<void>((resolve, reject) => {
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
      });
  },

  /** 彼方 API 调用记录：清空。 */
  clearVRApiLog: async (): Promise<void> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains('api_call_log')) return;
      const transaction = db.transaction('api_call_log', 'readwrite');
      transaction.objectStore('api_call_log').clear();
      await new Promise<void>((resolve, reject) => {
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
      });
  },

  // ============ 暮色 2026-08-24：补完彼方其余 20 个 DB 方法 ============
  // 暮色反馈：留言点着没反应、听歌报错、图书馆一直翻着书、WRScripts/VRGuestbook 抛 TypeError
  // 根因：schema 创了 store，但 get/save/delete 方法只补了 8 个（vr_novels/卡/ApiConfig/ApiLog）
  // 这里补剩下 20 个：annotations(3) + music(2) + guestbook(2) + scripts(3) + plays(3) + presets(3) + letters(4)

  // --- 批注（vr_annotations, master 已有 novelId 索引）---
  getVRAnnotations: async (novelId?: string): Promise<any[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains('vr_annotations')) return [];
      return new Promise((resolve, reject) => {
          const transaction = db.transaction('vr_annotations', 'readonly');
          const store = transaction.objectStore('vr_annotations');
          const request = novelId ? store.index('novelId').getAll(novelId) : store.getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
      });
  },

  saveVRAnnotation: async (annotation: any): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction('vr_annotations', 'readwrite');
      transaction.objectStore('vr_annotations').put(annotation);
      await new Promise<void>((resolve, reject) => {
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
      });
  },

  deleteVRAnnotation: async (id: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction('vr_annotations', 'readwrite');
      transaction.objectStore('vr_annotations').delete(id);
      await new Promise<void>((resolve, reject) => {
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
      });
  },

  // --- 听歌房共享状态（单例 id='state'） ---
  getVRMusicRoom: async (): Promise<any | null> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains('vr_music')) return null;
      return new Promise((resolve) => {
          const transaction = db.transaction('vr_music', 'readonly');
          const request = transaction.objectStore('vr_music').get('state');
          request.onsuccess = () => resolve(request.result || null);
          request.onerror = () => resolve(null);
      });
  },

  saveVRMusicRoom: async (state: any): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction('vr_music', 'readwrite');
      transaction.objectStore('vr_music').put({ ...state, id: 'state' });
      await new Promise<void>((resolve, reject) => {
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
      });
  },

  // --- 留言簿共享状态（单例 id='board'） ---
  getVRGuestbook: async (): Promise<any | null> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains('vr_guestbook')) return null;
      return new Promise((resolve) => {
          const transaction = db.transaction('vr_guestbook', 'readonly');
          const request = transaction.objectStore('vr_guestbook').get('board');
          request.onsuccess = () => resolve(request.result || null);
          request.onerror = () => resolve(null);
      });
  },

  saveVRGuestbook: async (state: any): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction('vr_guestbook', 'readwrite');
      // 不限存储条数：留言墙已支持每 50 条翻页，旧留言全部保留可翻看
      const messages = state.messages || [];
      transaction.objectStore('vr_guestbook').put({ ...state, id: 'board', messages });
      await new Promise<void>((resolve, reject) => {
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
      });
  },

  // --- 剧院·投稿剧本库（vr_scripts）---
  getVRScripts: async (): Promise<any[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains('vr_scripts')) return [];
      return new Promise((resolve) => {
          const request = db.transaction('vr_scripts', 'readonly').objectStore('vr_scripts').getAll();
          request.onsuccess = () => resolve((request.result || []).sort((a: any, b: any) => b.createdAt - a.createdAt));
          request.onerror = () => resolve([]);
      });
  },
  saveVRScript: async (script: any): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction('vr_scripts', 'readwrite');
      transaction.objectStore('vr_scripts').put(script);
      await new Promise<void>((resolve, reject) => {
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
      });
  },
  deleteVRScript: async (id: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction('vr_scripts', 'readwrite');
      transaction.objectStore('vr_scripts').delete(id);
      await new Promise<void>((resolve, reject) => {
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
      });
  },

  // --- 剧院·历史舞台剧（vr_plays）---
  getVRStagedPlays: async (): Promise<any[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains('vr_plays')) return [];
      return new Promise((resolve) => {
          const request = db.transaction('vr_plays', 'readonly').objectStore('vr_plays').getAll();
          request.onsuccess = () => resolve((request.result || []).sort((a: any, b: any) => b.createdAt - a.createdAt));
          request.onerror = () => resolve([]);
      });
  },
  saveVRStagedPlay: async (play: any): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction('vr_plays', 'readwrite');
      transaction.objectStore('vr_plays').put(play);
      await new Promise<void>((resolve, reject) => {
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
      });
  },
  deleteVRStagedPlay: async (id: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction('vr_plays', 'readwrite');
      transaction.objectStore('vr_plays').delete(id);
      await new Promise<void>((resolve, reject) => {
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
      });
  },

  // --- 剧院·用户自定义写作风格预设（vr_presets）---
  getVRPresets: async (): Promise<any[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains('vr_presets')) return [];
      return new Promise((resolve) => {
          const request = db.transaction('vr_presets', 'readonly').objectStore('vr_presets').getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => resolve([]);
      });
  },
  saveVRPreset: async (preset: { key: string; name: string; prompt: string; blurb?: string }): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction('vr_presets', 'readwrite');
      transaction.objectStore('vr_presets').put(preset);
      await new Promise<void>((resolve, reject) => {
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
      });
  },
  deleteVRPreset: async (key: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction('vr_presets', 'readwrite');
      transaction.objectStore('vr_presets').delete(key);
      await new Promise<void>((resolve, reject) => {
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
      });
  },

  // --- 邮局信件（vr_letters）---
  getVRLetters: async (): Promise<any[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains('vr_letters')) return [];
      return new Promise((resolve, reject) => {
          const transaction = db.transaction('vr_letters', 'readonly');
          const request = transaction.objectStore('vr_letters').getAll();
          request.onsuccess = () => resolve((request.result || []).sort((a: any, b: any) => b.createdAt - a.createdAt));
          request.onerror = () => reject(request.error);
      });
  },

  saveVRLetter: async (letter: any): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction('vr_letters', 'readwrite');
      transaction.objectStore('vr_letters').put(letter);
      await new Promise<void>((resolve, reject) => {
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
      });
  },

  saveVRLetters: async (letters: any[]): Promise<void> => {
      if (letters.length === 0) return;
      const db = await openDB();
      const transaction = db.transaction('vr_letters', 'readwrite');
      const store = transaction.objectStore('vr_letters');
      for (const l of letters) store.put(l);
      return new Promise((resolve, reject) => {
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
      });
  },

  deleteVRLetter: async (id: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction('vr_letters', 'readwrite');
      transaction.objectStore('vr_letters').delete(id);
      await new Promise<void>((resolve, reject) => {
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
      });
  },
  // ============ 彼方缺失方法 end ============

  exportFullData: async (): Promise<Partial<FullBackupData>> => {
      const db = await openDB();
      
      const getAllFromStore = (storeName: string): Promise<any[]> => {
          if (!db.objectStoreNames.contains(storeName)) {
              return Promise.resolve([]);
          }
          return new Promise((resolve) => {
              const tx = db.transaction(storeName, 'readonly');
              const store = tx.objectStore(storeName);
              const req = store.getAll();
              req.onsuccess = () => resolve(req.result || []);
              req.onerror = () => resolve([]); 
          });
      };

      const [characters, messages, themes, emojis, emojiCategories, assets, galleryImages, userProfiles, diaries, tasks, anniversaries, roomTodos, roomNotes, groups, journalStickers, socialPosts, courses, games, worldbooks, novels, bankTx, bankData, xhsActivities, xhsStockImages, songs, quizzes, guidebookSessions, scheduledMessages, lifeSimStates, handbooks, trackers, trackerEntries, memoryNodes, memoryVectors, memoryLinks, topicBoxes, anticipations, eventBoxes, memoryBatches] = await Promise.all([
          getAllFromStore(STORE_CHARACTERS),
          getAllFromStore(STORE_MESSAGES),
          getAllFromStore(STORE_THEMES),
          getAllFromStore(STORE_EMOJIS),
          getAllFromStore(STORE_EMOJI_CATEGORIES),
          getAllFromStore(STORE_ASSETS),
          getAllFromStore(STORE_GALLERY),
          getAllFromStore(STORE_USER),
          getAllFromStore(STORE_DIARIES),
          getAllFromStore(STORE_TASKS),
          getAllFromStore(STORE_ANNIVERSARIES),
          getAllFromStore(STORE_ROOM_TODOS),
          getAllFromStore(STORE_ROOM_NOTES),
          getAllFromStore(STORE_GROUPS),
          getAllFromStore(STORE_JOURNAL_STICKERS),
          getAllFromStore(STORE_SOCIAL_POSTS),
          getAllFromStore(STORE_COURSES),
          getAllFromStore(STORE_GAMES),
          getAllFromStore(STORE_WORLDBOOKS),
          getAllFromStore(STORE_NOVELS),
          getAllFromStore(STORE_BANK_TX),
          getAllFromStore(STORE_BANK_DATA),
          getAllFromStore(STORE_XHS_ACTIVITIES),
          getAllFromStore(STORE_XHS_STOCK),
          getAllFromStore(STORE_SONGS),
          getAllFromStore(STORE_QUIZZES),
          getAllFromStore(STORE_GUIDEBOOK),
          getAllFromStore(STORE_SCHEDULED),
          getAllFromStore(STORE_LIFE_SIM),
          getAllFromStore(STORE_HANDBOOK),
          getAllFromStore(STORE_TRACKERS),
          getAllFromStore(STORE_TRACKER_ENTRIES),
          // 记忆宫殿 7 个 store（之前 exportFullData 根本不读，备份丢 memoryPalace）
          getAllFromStore('memory_nodes'),
          getAllFromStore('memory_vectors'),
          getAllFromStore('memory_links'),
          getAllFromStore('topic_boxes'),
          getAllFromStore('anticipations'),
          getAllFromStore('event_boxes'),
          getAllFromStore('memory_batches'),
      ]);

      // 读 memoryPalaceHighWaterMarks（高水位线，存在 localStorage 不是 IndexedDB）
      // 见 OSContext.tsx 解析逻辑：key 是 mp_lastMsgId_<charId>，value 是 lastProcessedMsgId
      let memoryPalaceHighWaterMarks: Record<string, number> | undefined = undefined;
      try {
          for (let i = 0; i < localStorage.length; i++) {
              const key = localStorage.key(i);
              if (key && key.startsWith('mp_lastMsgId_')) {
                  const charId = key.replace('mp_lastMsgId_', '');
                  const val = parseInt(localStorage.getItem(key) || '0', 10);
                  if (charId && val) {
                      if (!memoryPalaceHighWaterMarks) memoryPalaceHighWaterMarks = {};
                      memoryPalaceHighWaterMarks[charId] = val;
                  }
              }
          }
      } catch (e) { /* localStorage 不可用时忽略 */ }

      const userProfile = userProfiles.length > 0 ? {
          name: userProfiles[0].name,
          avatar: userProfiles[0].avatar,
          bio: userProfiles[0].bio
      } : undefined;

      const mainState = bankData.find((d: any) => d.id === 'main_state');
      const dollhouseRecord = bankData.find((d: any) => d.id === 'dollhouse_state');

      return {
          characters, messages, customThemes: themes, savedEmojis: emojis, emojiCategories, assets, galleryImages, userProfile, diaries, tasks, anniversaries, roomTodos, roomNotes, groups, savedJournalStickers: journalStickers, socialPosts, courses, games, worldbooks, novels,
          bankState: mainState ? { ...mainState, id: undefined } : undefined,
          bankDollhouse: dollhouseRecord?.data || undefined,
          bankTransactions: bankTx,
          xhsActivities,
          xhsStockImages,
          songs,
          quizSessions: quizzes,
          guidebookSessions,
          scheduledMessages,
          lifeSimState: lifeSimStates[0] || null,
          handbooks,
          trackers,
          trackerEntries,
          // 记忆宫殿 8 个字段（之前没被导出所以备份丢）
          memoryNodes,
          memoryVectors,
          memoryLinks,
          topicBoxes,
          anticipations,
          eventBoxes,
          memoryBatches,
          memoryPalaceHighWaterMarks,
      };
  },

  importFullData: async (data: FullBackupData): Promise<void> => {
      const db = await openDB();
      
      const availableStores = [
          STORE_CHARACTERS, STORE_MESSAGES, STORE_THEMES, STORE_EMOJIS, STORE_EMOJI_CATEGORIES,
          STORE_ASSETS, STORE_GALLERY, STORE_USER, STORE_DIARIES,
          STORE_TASKS, STORE_ANNIVERSARIES, STORE_ROOM_TODOS, STORE_ROOM_NOTES,
          STORE_GROUPS, STORE_JOURNAL_STICKERS, STORE_SOCIAL_POSTS, STORE_COURSES, STORE_GAMES, STORE_WORLDBOOKS, STORE_NOVELS, STORE_SONGS,
          STORE_BANK_TX, STORE_BANK_DATA,
          STORE_XHS_ACTIVITIES, STORE_XHS_STOCK,
          STORE_QUIZZES,
          STORE_GUIDEBOOK,
          STORE_SCHEDULED,
          STORE_LIFE_SIM,
          STORE_DAILY_SCHEDULE,
          STORE_HANDBOOK,
          STORE_TRACKERS,
          STORE_TRACKER_ENTRIES,
          'memory_nodes', 'memory_vectors', 'memory_links', 'topic_boxes', 'anticipations', 'event_boxes',
          'memory_batches', 'pixel_home_assets', 'pixel_home_layouts'
      ].filter(name => db.objectStoreNames.contains(name));

      const tx = db.transaction(availableStores, 'readwrite');

      const clearAndAdd = (storeName: string, items: any[]) => {
          if (!availableStores.includes(storeName)) return;
          if (items === undefined || items === null) return;
          
          const store = tx.objectStore(storeName);
          store.clear();
          items.forEach(item => store.put(item));
      };

      const mergeStore = (storeName: string, items: any[]) => {
          if (!availableStores.includes(storeName)) return;
          if (!items || items.length === 0) return;
          
          const store = tx.objectStore(storeName);
          items.forEach(item => store.put(item));
      };

      const applyMediaToChar = (c: CharacterProfile, media: NonNullable<FullBackupData['mediaAssets']>[number]): CharacterProfile => {
          return {
              ...c,
              avatar: media.avatar || c.avatar,
              sprites: media.sprites || c.sprites,
              dateSkinSets: media.dateSkinSets || c.dateSkinSets,
              activeSkinSetId: media.activeSkinSetId || c.activeSkinSetId,
              customDateSprites: media.customDateSprites || c.customDateSprites,
              spriteConfig: media.spriteConfig || c.spriteConfig,
              chatBackground: media.backgrounds?.chat || c.chatBackground,
              dateBackground: media.backgrounds?.date || c.dateBackground,
              roomConfig: c.roomConfig ? {
                  ...c.roomConfig,
                  wallImage: media.backgrounds?.roomWall || c.roomConfig.wallImage,
                  floorImage: media.backgrounds?.roomFloor || c.roomConfig.floorImage,
                  items: c.roomConfig.items.map(item => {
                      const img = media.roomItems?.[item.id];
                      return img ? { ...item, image: img } : item;
                  })
              } : c.roomConfig
          } as CharacterProfile;
      };

      // characters 处理：
      //   - text_only 模式：不修改本机已有角色；如果本机没该角色则创建空壳
      //     （带文字无图，暮色要求"轻量不覆盖"——phone A 自导自导保留本机；
      //      phone B 新设备没角色则创建空壳，让聊天流能用）
      //   - full / media_only 模式：维持现状（media_only 是叠加图片，full 是整库替换）
      if (data.characters) {
          if (data.backupMode === 'text_only') {
              const charStore = tx.objectStore(STORE_CHARACTERS);
              const req = charStore.getAll();
              req.onsuccess = () => {
                  const existing = (req.result || []) as CharacterProfile[];
                  const existingMap = new Map(existing.map(c => [c.id, c]));
                  for (const bc of data.characters!) {
                      if (existingMap.has(bc.id)) {
                          // 本机已有该角色 → 跳过，不覆盖（保留本机美化/头像）
                          continue;
                      }
                      // 本机没该角色 → 创建空壳（带文字，图片字段是 stripBase64 清空的空字符串）
                      charStore.put(bc);
                  }
              };
          } else {
              if (data.mediaAssets) {
                  data.characters = data.characters.map(c => {
                      const media = data.mediaAssets?.find(m => m.charId === c.id);
                      return media ? applyMediaToChar(c, media) : c;
                  });
              }
              clearAndAdd(STORE_CHARACTERS, data.characters);
          }
      } else if (data.mediaAssets && availableStores.includes(STORE_CHARACTERS)) {
          const charStore = tx.objectStore(STORE_CHARACTERS);
          const request = charStore.getAll();
          request.onsuccess = () => {
              const existingChars = request.result as CharacterProfile[];
              if (existingChars && existingChars.length > 0) {
                  const updatedChars = existingChars.map(c => {
                      const media = data.mediaAssets?.find(m => m.charId === c.id);
                      return media ? applyMediaToChar(c, media) : c;
                  });
                  updatedChars.forEach(c => charStore.put(c));
              }
          };
      }

      // messages 处理：
      //   暮色 2026-07-25：所有 mode 都按 ID 合并（patch mode），不整库替换
      //   改前：full / media_only 模式 store.clear() → 本地独有消息被吃
      //     场景：phone A 11:00 上传 → phone B 恢复 11:00 → phone A 跟 TA 11:00-12:00 聊 5 轮
      //           → phone B 12:00 上传（江澈有 3 轮新，麦麦没新）→ phone A 恢复 12:00
      //           → 麦麦窗口 11:00-12:00 之间的 5 轮被覆盖没了
      //   改后：所有 mode 都按 ID put（idempotent）
      //     - 本地有同 ID → 跳过（不丢本地内容）
      //     - 本地没有 ID → put（合并新内容）
      //   副作用：失去"整机恢复 messages"的语义
      //     - 如果用户想"完全替换本地 messages"，先手动清空（Settings 危险区）再恢复
      //     - 实际场景：多端同步 > 单向恢复，这个 trade-off 可接受
      if (data.messages) {
           if (availableStores.includes(STORE_MESSAGES) && data.messages.length > 0) {
               const store = tx.objectStore(STORE_MESSAGES);
               data.messages.forEach(m => store.put(m));
           }
      }
      
      if (data.customThemes) mergeStore(STORE_THEMES, data.customThemes);
      // 暮色 2026-07-21：text_only 模式不导入 emoji store — 修 2 个 bug：
      //   1) mergeStore 只 put 不 delete → phone A 删了的 emoji 在 phone B 备份里 → phone A 导入后"复活"
      //   2) text_only 导出时 stripBase64 把 data:image 转 '' → 导入时 put('') 覆盖 phone B 本机的 base64 → 图标损坏（但 emoji.name 还在，所以还能正常发）
      // 代价：跨设备 emoji 不同步（phone A 独有的 emoji 不会同步到 phone B）— 暮色接受这个 trade-off（手动加）
      if (data.backupMode !== 'text_only') {
          if (data.savedEmojis) mergeStore(STORE_EMOJIS, data.savedEmojis);
          if (data.emojiCategories) mergeStore(STORE_EMOJI_CATEGORIES, data.emojiCategories);
      }
      if (data.assets !== undefined) clearAndAdd(STORE_ASSETS, data.assets || []);
      if (data.savedJournalStickers) mergeStore(STORE_JOURNAL_STICKERS, data.savedJournalStickers);

      if (data.galleryImages) clearAndAdd(STORE_GALLERY, data.galleryImages);
      if (data.diaries) clearAndAdd(STORE_DIARIES, data.diaries);
      if (data.tasks) clearAndAdd(STORE_TASKS, data.tasks);
      if (data.anniversaries) clearAndAdd(STORE_ANNIVERSARIES, data.anniversaries);
      if (data.roomTodos) clearAndAdd(STORE_ROOM_TODOS, data.roomTodos);
      if (data.roomNotes) clearAndAdd(STORE_ROOM_NOTES, data.roomNotes);
      if (data.groups) clearAndAdd(STORE_GROUPS, data.groups);
      if (data.socialPosts) clearAndAdd(STORE_SOCIAL_POSTS, data.socialPosts);
      if (data.courses) clearAndAdd(STORE_COURSES, data.courses);
      if (data.games) clearAndAdd(STORE_GAMES, data.games);
      if (data.worldbooks) clearAndAdd(STORE_WORLDBOOKS, data.worldbooks);
      if (data.novels) clearAndAdd(STORE_NOVELS, data.novels);
      if (data.songs) clearAndAdd(STORE_SONGS, data.songs);
      if (data.quizSessions) clearAndAdd(STORE_QUIZZES, data.quizSessions);
      if (data.guidebookSessions) clearAndAdd(STORE_GUIDEBOOK, data.guidebookSessions);
      if (data.scheduledMessages !== undefined && availableStores.includes(STORE_SCHEDULED)) {
          const store = tx.objectStore(STORE_SCHEDULED);
          store.clear();
          (data.scheduledMessages || []).forEach(item => store.put(item));
      }
      if (data.lifeSimState !== undefined && availableStores.includes(STORE_LIFE_SIM)) {
          const store = tx.objectStore(STORE_LIFE_SIM);
          store.clear();
          if (data.lifeSimState) {
              store.put({ ...data.lifeSimState, id: 'main' });
          }
      }
      if (data.bankTransactions) clearAndAdd(STORE_BANK_TX, data.bankTransactions);
      if (data.xhsActivities) clearAndAdd(STORE_XHS_ACTIVITIES, data.xhsActivities);
      if (data.xhsStockImages) clearAndAdd(STORE_XHS_STOCK, data.xhsStockImages);

      // Memory Palace (记忆宫殿)
      if (data.memoryNodes) clearAndAdd('memory_nodes', data.memoryNodes);
      if (data.memoryVectors) {
          // 暮色 2026-07-21：vector 字段识别 3 种格式
          //   - 新格式：base64 字符串（暮色 7-21 改成，磁盘 16M → 8M 压缩）
          //   - 老格式：number[]（老备份，JSON 友好但体积大 3.5x）
          //   - 已经是 Uint8Array：跳过（理论上不会从 JSON 来，但兜底）
          //   全部还原成 Uint8Array 写入磁盘（紧凑）
          const base64ToUint8 = (b64: string): Uint8Array => {
              const binary = atob(b64);
              const u8 = new Uint8Array(binary.length);
              for (let i = 0; i < binary.length; i++) {
                  u8[i] = binary.charCodeAt(i);
              }
              return u8;
          };
          const upgraded = data.memoryVectors.map((v: any) => {
              if (!v || !v.vector) return v;
              let u8: Uint8Array;
              if (typeof v.vector === 'string') {
                  // 新 base64 格式
                  u8 = base64ToUint8(v.vector);
              } else if (v.vector instanceof Uint8Array) {
                  // 已经是紧凑形态
                  u8 = v.vector;
              } else if (Array.isArray(v.vector)) {
                  // 老 number[] 格式
                  const f32 = new Float32Array(v.vector);
                  u8 = new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength);
              } else {
                  return v;
              }
              return { ...v, vector: u8 };
          });
          clearAndAdd('memory_vectors', upgraded);
      }
      if (data.memoryLinks) clearAndAdd('memory_links', pruneMemoryLinksByTopN(data.memoryLinks, 70));
      if (data.topicBoxes) clearAndAdd('topic_boxes', data.topicBoxes);
      if (data.anticipations) clearAndAdd('anticipations', data.anticipations);
      if (data.eventBoxes && db.objectStoreNames.contains('event_boxes')) clearAndAdd('event_boxes', data.eventBoxes);
      if (data.memoryBatches && db.objectStoreNames.contains('memory_batches')) clearAndAdd('memory_batches', data.memoryBatches);

      // 角色日程表（每日日程 + 意识流）
      if (data.dailySchedules) clearAndAdd(STORE_DAILY_SCHEDULE, data.dailySchedules);

      // 手账（跨角色聚合留痕本）
      if (data.handbooks) clearAndAdd(STORE_HANDBOOK, data.handbooks);

      // 手账 Tracker（健康/生活打卡引擎）
      if (data.trackers) clearAndAdd(STORE_TRACKERS, data.trackers);
      if (data.trackerEntries) clearAndAdd(STORE_TRACKER_ENTRIES, data.trackerEntries);

      // Pixel Home（小屋像素界面）
      if (data.pixelHomeAssets && db.objectStoreNames.contains('pixel_home_assets')) clearAndAdd('pixel_home_assets', data.pixelHomeAssets);
      if (data.pixelHomeLayouts && db.objectStoreNames.contains('pixel_home_layouts')) clearAndAdd('pixel_home_layouts', data.pixelHomeLayouts);

      if (data.userProfile) {
          // 暮色 2026-07-21：text_only 模式不覆盖 user profile — 修头像覆盖 bug
          //   根因：phone A 头像 = R2 URL（美化过的）→ text_only 导出 → phone B 恢复 → clear+put 覆盖本机 → R2 域名 phone B 访问不到 → 头像显示空方块
          //   user profile 是个人数据，不该跨设备同步
          //   full 模式保留（整机恢复场景需要覆盖）
          if (data.backupMode !== 'text_only' && availableStores.includes(STORE_USER)) {
              const store = tx.objectStore(STORE_USER);
              store.clear();
              store.put({ ...data.userProfile, id: 'me' });
          }
      }

      if (data.bankState || data.bankDollhouse) {
          if (availableStores.includes(STORE_BANK_DATA)) {
              const store = tx.objectStore(STORE_BANK_DATA);
              store.clear();
              if (data.bankState) {
                  store.put({ ...data.bankState, id: 'main_state' });
              }
              if (data.bankDollhouse) {
                  store.put({ id: 'dollhouse_state', data: data.bankDollhouse });
              }
          }
      }

      return new Promise((resolve, reject) => {
          tx.oncomplete = () => {
              // 暮色 2026-07-21：text_only 模式恢复成功时记录 lastRestoreAt — 下次导出增量用
              //   - 只在 text_only 模式写：full / media_only 是整机恢复，会重置"老数据点"语义
              //   - 写在 tx.oncomplete：事务成功才写，失败不写（避免把 lastRestoreAt 写到一半）
              if (data.backupMode === 'text_only') {
                  try {
                      localStorage.setItem('sullyos:lastRestoreAt', String(Date.now()));
                  } catch { /* quota 忽略 */ }
              }
              resolve();
          };
          tx.onerror = () => reject(tx.error);
      });
  }
};
