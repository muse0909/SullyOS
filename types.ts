
export enum AppID {
  Launcher = 'launcher',
  Settings = 'settings',
  Character = 'character',
  Chat = 'chat',
  GroupChat = 'group_chat', 
  Gallery = 'gallery',
  Music = 'music',
  Browser = 'browser',
  ThemeMaker = 'thememaker',
  Appearance = 'appearance',
  Date = 'date',
  User = 'user',
  Journal = 'journal',
  Schedule = 'schedule',
  Room = 'room',
  CheckPhone = 'check_phone',
  Social = 'social',
  Study = 'study',
  FAQ = 'faq',
  Game = 'game',
  Worldbook = 'worldbook', 
  Novel = 'novel', 
  Bank = 'bank', // New App
  XhsStock = 'xhs_stock', // XHS image stock for publishing
  SpecialMoments = 'special_moments', // Valentine's Day & future events
  XhsFreeRoam = 'xhs_free_roam', // Character autonomous XHS activity
  Songwriting = 'songwriting', // Songwriting / Lyric creation app
  Call = 'call', // 语音电话测试（MiniMax TTS）
  VoiceDesigner = 'voice_designer', // 捏声音 — MiniMax 音色设计器
  Guidebook = 'guidebook', // 攻略本 — 角色攻略用户小游戏
  LifeSim = 'lifesim', // 模拟人生 — 与角色共同经营的小世界
  MemoryPalace = 'memory_palace', // 记忆宫殿 — 七个房间可视化
  Handbook = 'handbook', // 手账 — 跨角色聚合的生活留痕本（LLM 代笔 + 角色生活流陪伴）
  QQBridge = 'qq_bridge', // QQ 桥接 — 通过 NapCat 把 QQ 私聊接入当前角色，共享 IndexedDB 上下文
  VRWorld = 'vrworld', // 彼方 — 角色自主登入的虚拟世界
  CoupleSpace = 'couple_space', // 情侣空间 — 用户和 AI 角色的双人小窝（基础版 3 模块：打卡 / 时间线 / 悄悄话）
  DrawGuess = 'draw_guess', // 你画我猜 — 角色联动版（cjjc 移植，B 方案视觉模型 + 角色 API 拆开调）
}

export interface SystemLog {
    id: string;
    timestamp: number;
    type: 'error' | 'network' | 'system';
    source: string;
    message: string;
    detail?: string;
}

export interface AppConfig {
  id: AppID;
  name: string;
  icon: string;
  color: string;
}

export interface DesktopDecoration {
  id: string;
  type: 'image' | 'preset';
  content: string; // data URI for image, SVG data URI or emoji for preset
  x: number;       // percentage 0-100
  y: number;       // percentage 0-100
  scale: number;   // multiplier (0.2 - 3)
  rotation: number; // degrees (-180 to 180)
  opacity: number;  // 0-1
  zIndex: number;
  flip?: boolean;
}

export interface OSTheme {
  hue: number;
  saturation: number;
  lightness: number;
  wallpaper: string;
  darkMode: boolean;
  contentColor?: string;
  launcherWidgetImage?: string; // DEPRECATED: always stripped on load — never renders.
  launcherWidgets?: Record<string, string>; // slots: 'tl' | 'tr' | 'wide' | 'dsq' (legacy 'bl' / 'br' are banned)
  desktopDecorations?: DesktopDecoration[];
  customFont?: string;
  hideStatusBar?: boolean;
  // Chat UI customization (global)
  chatAvatarShape?: 'circle' | 'rounded' | 'square';
  chatAvatarSize?: 'small' | 'medium' | 'large';
  chatAvatarMode?: 'grouped' | 'every_message';
  chatBubbleStyle?: 'modern' | 'flat' | 'outline' | 'shadow' | 'wechat' | 'ios';
  chatMessageSpacing?: 'compact' | 'default' | 'spacious';
  chatShowTimestamp?: 'always' | 'hover' | 'never';
  chatHeaderStyle?: 'default' | 'minimal' | 'gradient' | 'wechat' | 'telegram' | 'discord' | 'pixel';
  chatInputStyle?: 'default' | 'rounded' | 'flat' | 'wechat' | 'ios' | 'telegram' | 'discord' | 'pixel';
  chatChromeStyle?: 'soft' | 'flat' | 'floating' | 'pixel';
  chatBackgroundStyle?: 'plain' | 'grid' | 'paper' | 'mesh';
  chatHeaderAlign?: 'left' | 'center';
  chatHeaderDensity?: 'compact' | 'default' | 'airy';
  chatStatusStyle?: 'subtle' | 'pill' | 'dot' | 'none';
  chatSendButtonStyle?: 'circle' | 'pill' | 'minimal';
}

export interface AppearancePreset {
  id: string;
  name: string;
  createdAt: number;
  theme: OSTheme;
  customIcons?: Record<string, string>;
  chatThemes?: ChatTheme[];
  chatLayout?: ChatLayoutPreset;
}

export interface ChatLayoutPreset {
  id: string;
  name: string;
  createdAt: number;
  chatBg?: string;
  chatBgOpacity?: number;
  headerStyle?: 'default' | 'minimal' | 'immersive';
  inputStyle?: 'default' | 'rounded' | 'flat';
  avatarShape?: 'circle' | 'rounded' | 'square';
  avatarSize?: 'small' | 'medium' | 'large';
  messageLayout?: 'default' | 'compact' | 'spacious';
  showTimestamp?: 'always' | 'hover' | 'never';
  bubbleThemeId?: string;
}

export interface TranslationConfig {
  enabled: boolean;
  sourceLang: string; // e.g. '日本語' - the language messages are displayed in (选)
  targetLang: string; // e.g. '中文' - the language to translate into (译)
}

export interface VirtualTime {
  hours: number;
  minutes: number;
  day: string;
}

export type MinimaxRegion = 'domestic' | 'overseas';

// 暮色 2026-08-04：见面 app 输入框上方的快捷键
//   - 全局共用（所有角色共享一套），存在 localStorage 'os_date_quick_phrases'
//   - display：显示用的字符（emoji 或文字），默认跟 content 一样，可单独改
//   - content：点击图标后插入到输入框的文字（支持多行）
//   - enabled：是否在快捷键栏显示（关闭就不显示但不删除）
//   - cursorPos：插入位置 — 'end'（末尾，默认）/'middle'（中间）/'start'（最前）
//     暮色 2026-08-04 v4：3 个固定位置替代之前的"光标处"（识别不到光标位置）
export interface DateQuickPhrase {
  id: string;
  display: string;     // 显示在按钮上的字符（emoji / 短文字），默认 = content
  content: string;     // 插入到输入框的文字，支持换行
  enabled: boolean;    // 是否在快捷键栏显示
  cursorPos?: 'start' | 'middle' | 'end';  // 插入位置（默认 'end'）
}

export interface APIConfig {
  baseUrl: string;
  apiKey: string;
  minimaxApiKey?: string;
  minimaxGroupId?: string;
  // 'domestic' → https://api.minimaxi.com (国内站)
  // 'overseas' → https://api.minimax.io  (海外站)
  // Missing / unknown falls back to domestic.
  minimaxRegion?: MinimaxRegion;
  // Replicate token (r8_xxx) for ACE-Step song generation in 写歌 App.
  aceStepApiKey?: string;
  model: string;
  visionBaseUrl?: string;
  visionApiKey?: string;
  visionModel?: string;
  imgbbApiKey?: string;       // imgbb 图床 API Key，用于发送图片自动转URL
  cloudinaryCloudName?: string;  // Cloudinary cloud_name（imgbb fallback）
  cloudinaryUploadPreset?: string;  // Cloudinary unsigned upload preset 名（imgbb fallback）
  bedKind?: 'imgbb' | 'cloudinary' | 'r2';  // 图床预设 tab 标记（暮色 2026-08-20：3 tab 互不打扰）

  // Cloudflare R2 对象存储（暮色 2026-07-14 换 R2 替代 imgbb，因为 imgbb 免费版会压缩图片）
  // 用于：1) 生图 b64 上传  2) 用户发图上传
  // 优先用 R2；R2 没配才回退 imgbb；都未配用 data URL 兜底
  r2AccountId?: string;        // Cloudflare Account ID（32 位 hex）
  r2AccessKeyId?: string;      // R2 API Token 的 Access Key ID
  r2SecretAccessKey?: string;  // R2 API Token 的 Secret Access Key（**只显示一次**）
  r2Bucket?: string;           // bucket 名（例 sullyos-images）
  r2PublicUrl?: string;        // 公网访问前缀（例 https://pub-xxxxx.r2.dev）

  imageBaseUrl?: string;
  imageApiKey?: string;
  imageModel?: string;
  // 任务 3：删生图多余协议选项（imageProtocol / imageClaude* / imageGemini*）
  //   生图代码只走 OpenAI 兼容协议（useChatAI.ts 生图分支硬编码 OpenAI），那些字段写了没人读
  //   生图 UI 改回单一组 imageBaseUrl/imageApiKey/imageModel（不再有协议 tab）
  // 当前生效的生图 provider。决定 AI 调 generate_image 时用哪条通道。
  // openai 兼容：URL/Key/Model 都用 apiConfig.imageBaseUrl/Key/Model（中转/OpenAI 官方）
  // comfyui：写死走本地 127.0.0.1:8190 桥（默认模型 Realistic Vision V6.0 B1）
  // nai：占位暂未实现
  // Missing → 'openai'（向后兼容）
  imageGenProvider?: 'openai' | 'comfyui' | 'nai';
  // Per-API streaming toggle. Some endpoints only support stream:true.
  // Missing → false (默认非流式).
  stream?: boolean;
  // Per-API temperature for chat / 约会 main calls. Missing → 0.85.
  temperature?: number;
  // 暮色 2026-07-17 → 2026-07-27：API 协议类型
  //   - 'openai' (默认): 发到 /v1/chat/completions，按 OpenAI 协议
  //   - 'gemini':         发到 /v1beta/models/{model}:generateContent，按 Google 官方 Gemini 协议
  //   Missing → 'openai'（向后兼容老用户）
  //   2026-08-12 任务 2：删 Claude 协议（基本不用）—— protocol 只剩 'openai' | 'gemini'
  protocol?: 'openai' | 'gemini';
  // 暮色 2026-07-27：主 API Gemini 独立 URL/Key/Model
  //   - baseUrl/apiKey/model 默认是 OpenAI 协议的（向后兼容老用户）
  //   - 切到 Gemini 时用 geminiBaseUrl/geminiApiKey/geminiModel（默认 URL https://generativelanguage.googleapis.com/v1beta）
  //   - 2026-08-12 任务 2：删 claudeBaseUrl/claudeApiKey/claudeModel（Claude 协议不再用）
  geminiBaseUrl?: string;
  geminiApiKey?: string;
  geminiModel?: string;
  // 暮色 2026-08-04：Gemini 直连 key 池（多 key 轮询 + 健康状态）
  //   - 读时优先用 geminiApiKeys（数组），兼容老数据用 geminiApiKey（单字符串）
  //   - 老 key 会自动包成 1 元素数组
  geminiApiKeys?: string[];
  // 暮色 2026-07-27：识图平台独立配置
  //   - visionBaseUrl/visionApiKey/visionModel 默认 OpenAI 协议
  //   - 切到 visionProtocol === 'gemini' 用 visionGeminiBaseUrl/visionGeminiApiKey/visionGeminiModel
  //   - 2026-08-12 任务 2：删 visionClaudeBaseUrl/visionClaudeApiKey/visionClaudeModel（Claude 协议不再用）
  visionProtocol?: 'openai' | 'gemini';
  visionGeminiBaseUrl?: string;
  visionGeminiApiKey?: string;
  visionGeminiModel?: string;
  // 暮色 2026-08-04：识图 Gemini 直连 key 池
  visionGeminiApiKeys?: string[];
  // 暮色 2026-07-27 晚：删 imageGemini* 字段（生图只走 OpenAI 兼容，暮色原话"生图不用"）
  ttsProvider?: 'minimax' | 'volink';
volinkTtsBaseUrl?: string;
volinkTtsApiKey?: string;
volinkTtsVoice?: string;   // 全局默认声音ID（角色没配时用这个）
volinkTtsModel?: string;
}

export type ActiveMsg2DbDriver = 'pg' | 'neon';
export type ActiveMsg2Mode = 'fixed' | 'auto' | 'prompted';
export type ActiveMsg2Recurrence = 'none' | 'daily' | 'weekly';

export interface ActiveMsg2ApiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface ActiveMsg2GlobalConfig {
  userId: string;
  driver: ActiveMsg2DbDriver;
  databaseUrl: string;
  initSecret?: string;
  tenantId?: string;
  tenantToken?: string;
  cronToken?: string;
  cronWebhookUrl?: string;
  masterKeyFingerprint?: string;
  initializedAt?: number;
  updatedAt?: number;
}

export interface ActiveMsg2CharacterConfig {
  enabled: boolean;
  mode: ActiveMsg2Mode;
  firstSendTime: string;
  recurrenceType: ActiveMsg2Recurrence;
  userMessage?: string;
  promptHint?: string;
  maxTokens?: number;
  taskUuid?: string;
  remoteStatus?: 'idle' | 'scheduled' | 'sent' | 'error';
  useSecondaryApi?: boolean;
  secondaryApi?: ActiveMsg2ApiConfig;
  lastSyncedAt?: number;
  lastError?: string;
}

export interface ActiveMsg2InboxMessage {
  messageId: string;
  charId: string;
  charName: string;
  body: string;
  avatarUrl?: string;
  source?: string;
  messageType?: string;
  messageSubtype?: string;
  taskId?: string | null;
  metadata?: Record<string, any>;
  sentAt?: number;
  receivedAt: number;
}

export interface ApiPreset {
  id: string;
  name: string;
  config: APIConfig;
  kind?: 'main' | 'vision' | 'image' | 'imagebed' | 'tts' | 'other' | 'emotion' | 'memoryPalaceLight';
}

export interface CharacterBuff {
  id: string;
  name: string;      // internal key, e.g. 'reconciliation_fragile'
  label: string;     // display text, e.g. '脆弱的和好'
  intensity?: 1 | 2 | 3;
  emoji?: string;
  color?: string;    // hex, e.g. '#f87171'
  description?: string;  // 用户可读的简短说明（给用户看的，不是给AI的）
  innerState?: string;
  createdAt?: number;
}

// 实时上下文配置 - 让AI角色感知真实世界
export interface RealtimeConfig {
  // 天气配置
  weatherEnabled: boolean;
  weatherApiKey: string;  // OpenWeatherMap API Key
  weatherCity: string;    // 城市名

  // 新闻配置
  newsEnabled: boolean;
  newsApiKey?: string;

  // Notion 配置
  notionEnabled: boolean;
  notionApiKey: string;   // Notion Integration Token
  notionDatabaseId: string; // 日记数据库ID
  notionNotesDatabaseId?: string; // 用户笔记数据库ID（可选，让角色读取用户的日常笔记）

  // 飞书配置 (中国区 Notion 替代)
  feishuEnabled: boolean;
  feishuAppId: string;      // 飞书应用 App ID
  feishuAppSecret: string;  // 飞书应用 App Secret
  feishuBaseId: string;     // 多维表格 App Token
  feishuTableId: string;    // 数据表 Table ID

  // 小红书配置 (MCP / Skills 双模式浏览器自动化)
  xhsEnabled: boolean;
  xhsMcpConfig?: XhsMcpConfig;

  // 缓存配置
  cacheMinutes: number;
}

export interface MemoryFragment {
  id: string;
  date: string;
  summary: string;
  mood?: string;
}

export interface SpriteConfig {
  scale: number;
  x: number;
  y: number;
}

export interface SkinSet {
  id: string;
  name: string;
  sprites: Record<string, string>; // emotion -> image URL or base64
}

export interface RoomItem {
    id: string;
    name: string;
    type: 'furniture' | 'decor';
    image: string;
    x: number;
    y: number;
    scale: number;
    rotation: number;
    isInteractive: boolean;
    descriptionPrompt?: string;
}

export interface RoomTodo {
    id: string;
    charId: string;
    date: string;
    items: { text: string; done: boolean }[];
    generatedAt: number;
}

export interface RoomNote {
    id: string;
    charId: string;
    timestamp: number;
    content: string;
    type: 'thought';
    relatedMessageId?: number;
}

// ─── 2026-07-31：情侣空间（CoupleSpace）
//   暮色 2026-07-31 启动的基础版：3 模块（打卡 / 时间线 / 悄悄话）
//   暮色 2026-07-31 确认：用户-角色一对一，每对独立数据
//   暮色 2026-07-31 确认：只服务暮色一个人，profile/char 数据隔离
//   关系开始日（annivDate）可设置，不强制从功能上线日开始算
//   邀请机制照抄 miya：发邀请消息 + AI 决策接受/拒绝
//   AI 主动打卡：30% 概率 / 一天最多 3 条 / 距离上次主动 > 6 小时
//   时间线条目来源：AI 自动从记忆宫殿抽取 + 用户/角色手动添加
export interface CoupleSpace {
  pairId: string;            // `${profileId}__${charId}` — 一对用户-角色一份
  profileId: string;         // 用户人设 ID（暮色只一个 profile，留扩展）
  charId: string;             // 角色 ID
  status: 'open' | 'pending' | 'declined' | 'expired';

  // 关系元数据
  annivDate: string;          // YYYY-MM-DD — 关系开始日（用户可改）
  openedAt: number;           // 空间开通时间戳
  lastInviteAt: number;       // 上次邀请时间戳

  // 打卡模块
  checkins: CoupleCheckin[];
  consecutiveDays: number;    // 连续打卡天数
  lastCheckinDate: string;    // YYYY-MM-DD — 上次打卡日期
  charLastProactiveDate: string;  // YYYY-MM-DD — 角色上次主动打卡日期（防刷屏）

  // 时间线模块
  timeline: CoupleTimelineItem[];

  // 悄悄话模块
  whispers: CoupleWhisper[];
  whisperUnread: number;      // 用户未读悄悄话数
}

export interface CoupleCheckin {
  id: string;
  date: string;               // YYYY-MM-DD
  taskId: string;             // 任务 ID
  taskName: string;           // 任务名（冗余存，任务可能被删）
  content: string;            // AI 生成的内容 / 用户填的内容
  fromUser: boolean;          // 用户打的卡
  fromChar: boolean;          // 角色打的卡
  createdAt: number;
}

export interface CoupleTimelineItem {
  id: string;
  date: string;               // YYYY-MM-DD
  title: string;
  content: string;
  mood?: 'happy' | 'sad' | 'neutral' | 'sweet' | 'angry' | 'miss';
  source: 'ai-extract' | 'user-manual' | 'char-manual';
  sourceRef?: string;         // 来源引用：聊天 msgId / 记忆节点 ID
  images?: string[];
  createdAt: number;
}

export interface CoupleWhisper {
  id: string;
  from: 'user' | 'char';
  content: string;
  createdAt: number;
  isRead: boolean;
  replyToId?: string;         // 悄悄话可以回复
}

// 邀请消息（嵌入聊天消息里，type: 'couple_space_invite'）
// 暮色 2026-07-31 确认：照抄 miya 的 miya-couple-invite.js
export interface CoupleInviteMessage {
  inviteId: string;
  contactId: string;          // 角色 contactId
  profileId: string;          // 用户 profileId
  profileName: string;        // 用户人设名（冗余存，避免改名找不到）
  charName: string;            // 角色名
  status: 'pending' | 'open' | 'declined' | 'expired';
  sentAt: number;
  decidedAt: number;
  responseNote: string;
}

// 默认任务清单（暮色 2026-07-31 确认去掉"和 ta 说早安"和"看 ta 的朋友圈"）
// "和 ta 说早安"：主动消息每天在做
// "看 ta 的朋友圈" → 改成"写悄悄话"
// "听 ta 推荐的歌"+"一起听一首歌"重复 → 合成"邀请一起听"
export const DEFAULT_COUPLE_TASKS: { id: string; name: string; emoji: string; trigger: string }[] = [
  { id: 'praise', name: '夸 ta 一下', emoji: '💗', trigger: 'ai-praise' },
  { id: 'write-whisper', name: '写悄悄话', emoji: '💌', trigger: 'ai-whisper' },
  { id: 'care-mood', name: '问 ta 今天心情', emoji: '🤔', trigger: 'ai-mood' },
  { id: 'hug', name: '和 ta 贴贴', emoji: '🤗', trigger: 'ai-hug' },
  { id: 'love-letter', name: '给 ta 写一封信', emoji: '✉️', trigger: 'ai-letter' },
  { id: 'goodnight-kiss', name: '晚安吻', emoji: '🌙', trigger: 'ai-goodnight' },
  { id: 'drink-water', name: '提醒 ta 喝水', emoji: '💧', trigger: 'ai-care' },
  { id: 'invite-listen', name: '邀请一起听', emoji: '🎧', trigger: 'ai-listen-together' },
  { id: 'write-diary', name: '写今天的日记', emoji: '📔', trigger: 'ai-diary' },
  { id: 'date-idea', name: '提一个约会建议', emoji: '🌸', trigger: 'ai-date' },
  { id: 'apologize', name: '主动道歉/和解', emoji: '🕊️', trigger: 'ai-apology' },
  { id: 'anniversary', name: '庆祝纪念日', emoji: '🎉', trigger: 'ai-celebrate' },
];


//   暮色要求"小纸条完全脱离小小窝 app" — 单独数据模型 + 单独 token + 单独 prompt
//   注：跟 RoomNote 结构相似但独立存表 / 独立 AI 写入路径，互不可见
export interface XiaoZhiTiao {
    id: string;
    charId: string;
    timestamp: number;
    content: string;
    // 暮色 2026-07-22：自定义小纸条样式（写入时从激活组随机选一张图存，便签背景用图覆盖）
    styleImageUrl?: string;
    replies?: XiaoZhiTiaoReply[];
    // 暮色 2026-08-23 v3：未拆封机制（三种 token 对应三种状态）
    //   visibility 缺失 = 'visible'（默认）
    //   藏信（HIDDEN/TIMED）不 addToast 通知；暮色主动点开详情才 revealedAt = Date.now()
    //   列表卡片：revealedAt 缺省 = 不显示文字（不管 visible 还是 hidden，统一规则）
    visibility?: 'visible' | 'hidden';
    hiddenUntil?: number;                 // 定时投递的解锁时间戳（仅 isTimed=true 有意义）
    isTimed?: boolean;                    // true=定时投递 false=等翻（仅 visibility='hidden' 有意义）
    revealedAt?: number;                  // 暮色查看时间戳；undefined = 没看过
    // 暮色 2026-08-23 v3：样式合并 — 8 套 cjjc 便签 CSS（与 styleImageUrl 并存；styleImageUrl 优先）
    style?: string;                       // 便签 CSS className（如 'note-pink'）
}

export interface XiaoZhiTiaoReply {
    id: string;
    parentNoteId: string;
    author: 'user' | 'character';
    content: string;
    timestamp: number;
}

export interface ScheduleSlot {
    startTime: string;    // "08:00"
    activity: string;     // "晨跑"
    description?: string; // "在河边慢跑"
    emoji?: string;       // "🏃"
    location?: string;    // "河边"
    innerThought?: string; // 该时段的内心独白，生成时由AI写好，运行时直接注入
}

export interface DailySchedule {
    id: string;           // `${charId}_${date}`
    charId: string;
    date: string;         // YYYY-MM-DD
    slots: ScheduleSlot[];
    generatedAt: number;
    coverImage?: string;  // 用户自定义角色看板图 (持久化)
    /**
     * 按时段生成的意识流独白。
     * key = slot 的 startTime（如 "08:00"），value = 截止该时段的完整内心独白。
     * 注入时根据当前时间找到最近的 key，直接使用整段文本，不做拼接。
     */
    flowNarrative?: Record<string, string>;
}

export interface RoomGeneratedState {
    actorStatus: string;
    welcomeMessage: string;
    items: Record<string, { description: string; reaction: string }>;
    actorAction?: string; // e.g. 'idle', 'sleep'
}

export interface UserImpression {
    version: number;
    lastUpdated?: number;
    value_map: {
        likes: string[];
        dislikes: string[];
        core_values: string;
    };
    behavior_profile: {
        tone_style: string;
        emotion_summary: string;
        response_patterns: string;
    };
    emotion_schema: {
        triggers: {
            positive: string[];
            negative: string[];
        };
        comfort_zone: string;
        stress_signals: string[];
    };
    personality_core: {
        observed_traits: string[];
        interaction_style: string;
        summary: string;
    };
    mbti_analysis?: {
        type: string; 
        reasoning: string;
        dimensions: {
            e_i: number; 
            s_n: number; 
            t_f: number; 
            j_p: number; 
        }
    };
    observed_changes?: string[];
}

export interface BubbleStyle {
    textColor: string;
    backgroundColor: string;
    backgroundImage?: string;
    backgroundImageOpacity?: number;
    borderRadius: number;
    opacity: number;
    
    decoration?: string;
    decorationX?: number;
    decorationY?: number;
    decorationScale?: number;
    decorationRotate?: number;

    avatarDecoration?: string;
    avatarDecorationX?: number;
    avatarDecorationY?: number;
    avatarDecorationScale?: number;
    avatarDecorationRotate?: number;

    voiceBarBg?: string;
    voiceBarActiveBg?: string;
    voiceBarBtnColor?: string;
    voiceBarWaveColor?: string;
    voiceBarTextColor?: string;
}

export interface ChatTheme {
    id: string;
    name: string;
    type: 'preset' | 'custom';
    user: BubbleStyle;
    ai: BubbleStyle;
    customCss?: string;
}

export interface PhoneCustomApp {
    id: string;
    name: string;
    icon: string; 
    color: string; 
    prompt: string; 
}

export interface PhoneEvidence {
    id: string;
    type: 'chat' | 'order' | 'social' | 'delivery' | string; 
    title: string; 
    detail: string; 
    timestamp: number;
    systemMessageId?: number; 
    value?: string; 
}

export interface Worldbook {
    id: string;
    title: string;
    content: string; 
    category: string; 
    createdAt: number;
    updatedAt: number;
}

// --- NOVEL / CO-WRITING TYPES ---
export interface NovelProtagonist {
    id: string;
    name: string;
    role: string; // e.g. "Protagonist", "Villain"
    description: string;
}

export interface NovelSegment {
    id: string;
    role?: 'writer' | 'commenter' | 'analyst'; 
    type: 'discussion' | 'story' | 'analysis'; 
    authorId: string; 
    content: string;
    timestamp: number;
    focus?: string; 
    targetSegId?: string;
    meta?: {
        tone?: string;
        suggestion?: string;
        reaction?: string;
        technique?: string;
        mood?: string;
    };
}

export interface NovelBook {
    id: string;
    title: string;
    subtitle?: string; 
    summary: string;
    coverStyle: string; 
    coverImage?: string; 
    worldSetting: string;
    collaboratorIds: string[]; 
    protagonists: NovelProtagonist[];
    segments: NovelSegment[];
    createdAt: number;
    lastActiveAt: number;
}

// --- SONGWRITING APP TYPES ---
export type SongMood = 'happy' | 'sad' | 'romantic' | 'angry' | 'chill' | 'epic' | 'nostalgic' | 'dreamy';
export type SongGenre = 'pop' | 'rock' | 'ballad' | 'rap' | 'folk' | 'electronic' | 'jazz' | 'rnb' | 'free';

export interface SongLine {
    id: string;
    authorId: string; // 'user' or charId
    content: string;
    section: 'intro' | 'verse' | 'pre-chorus' | 'chorus' | 'bridge' | 'outro' | 'free';
    annotation?: string; // AI guidance note on this line
    timestamp: number;
    isDraft?: boolean; // true = not selected as final lyrics, kept as draft record
}

export interface SongComment {
    id: string;
    authorId: string; // charId
    type: 'guidance' | 'praise' | 'suggestion' | 'teaching' | 'reaction';
    content: string;
    targetLineId?: string; // which line this comment is about
    timestamp: number;
}

export interface ChordInfo {
    root: string;       // e.g. 'C', 'D', 'Ab'
    quality: string;    // e.g. 'maj', 'min', '7', 'maj7', 'sus4'
    display: string;    // e.g. 'C', 'Am', 'G7', 'Fmaj7'
    midi: number;       // root note MIDI number (for audio)
}

export interface MelodyNote {
    midi: number;       // MIDI note number
    duration: number;   // in beats
    vowel: number;      // index into vowel formant table (0=a,1=o,2=e,3=i,4=u)
}

export interface SectionArrangement {
    section: string;            // matches SongLine.section
    chords: ChordInfo[];        // one chord per line in this section
    melodies?: MelodyNote[][];  // melodies[lineIdx] = notes for that line
}

export interface SongArrangement {
    rootNote: string;           // e.g. 'C', 'A'
    scale: 'major' | 'minor';
    bpm: number;
    sections: SectionArrangement[];
    instruments: {
        piano: boolean;
        bass: boolean;
        drums: boolean;
        melody: boolean;
    };
    drumPattern: 'basic' | 'upbeat' | 'halftime' | 'shuffle';
}

// Provider identifier for AI-generated audio. Each one has its own pricing
// / length cap / API path; the actual call site decides which to use.
//   - 'minimax-free' → music-2.6-free, free tier, 60s cap
//   - 'minimax-paid' → music-2.6, Token-Plan price, 60s cap
//   - 'ace-step'     → Replicate lucataco/ace-step, $0.015/song, 4-min cap
export type MusicProvider = 'minimax-free' | 'minimax-paid' | 'ace-step';

// AI-rendered audio attached to a SongSheet.
// Audio blob lives in the IndexedDB assets store keyed by `assetKey`,
// so the sheet itself stays small and JSON-serializable for sync/export.
export interface SongAudio {
    assetKey: string;          // DB.getAssetRaw / saveAssetRaw key
    mimeType: string;          // e.g. "audio/mpeg", "audio/wav"
    durationSec?: number;
    generatedAt: number;
    provider: MusicProvider;
    // Snapshot of the inputs used so we can show "regenerate when lyrics changed"
    promptHash: string;
    tagsUsed: string;
    lyricsLineCount: number;
}

export interface SongSheet {
    id: string;
    title: string;
    subtitle?: string;
    genre: SongGenre;
    mood: SongMood;
    bpm?: number;
    key?: string; // e.g. "C major", "A minor"
    collaboratorId: string; // the character guiding the user
    lines: SongLine[];
    comments: SongComment[];
    status: 'draft' | 'completed';
    coverStyle: string; // gradient/color identifier
    createdAt: number;
    lastActiveAt: number;
    completedAt?: number;
    arrangement?: SongArrangement;
    audio?: SongAudio;
    // Custom style prompt — when set, overrides the preset/genre/mood-derived tags.
    // Plain comma-separated English string the user (or LLM helper) authored.
    // Reused by both ACE-Step (`tags` field) and MiniMax music (`prompt` field).
    aceStepCustomTags?: string;
    // Last-used music provider for this song — drives the modal's default selection.
    musicProvider?: MusicProvider;
    // Lyric structure template chosen at creation. Drives the structure-guide
    // banner shown in the write view so user/char don't write randomly.
    lyricTemplate?: string;
}

// --- DATE APP TYPES ---
export interface DialogueItem {
    text: string;
    emotion?: string;
}

export interface DateState {
    dialogueQueue: DialogueItem[];
    dialogueBatch: DialogueItem[];
    currentText: string;
    bgImage: string;
    currentSprite: string;
    isNovelMode: boolean;
    viewMode?: 'gal' | 'novel' | 'bubble'; // 三模式，替代 isNovelMode
    timestamp: number;
    peekStatus: string; 
}


export interface SpecialMomentRecord {
    content: string;
    image?: string; // base64 PNG (stored separately so export tools can handle it)
    timestamp: number;
    source?: 'generated' | 'migrated';
}

// --- BANK / SHOP GAME TYPES (NEW) ---
export interface BankTransaction {
    id: string;
    amount: number;
    category: string; 
    note: string;
    timestamp: number;
    dateStr: string; // YYYY-MM-DD
}

export interface SavingsGoal {
    id: string;
    name: string;
    targetAmount: number;
    currentAmount: number; 
    icon: string;
    isCompleted: boolean;
}

export interface ShopStaff {
    id: string;
    name: string;
    avatar: string; // Emoji or URL
    role: 'manager' | 'waiter' | 'chef';
    fatigue: number; // 0-100, >80 stops working
    maxFatigue: number;
    hireDate: number;
    personality?: string; // New: Custom personality
    x?: number; // New: Position X (0-100)
    y?: number; // New: Position Y (0-100)
    // Pet System
    ownerCharId?: string; // If set, this staff is a "pet" belonging to this character
    isPet?: boolean; // Flag to indicate this is a pet
    scale?: number; // Display scale (0.4-2)
}

export interface ShopRecipe {
    id: string;
    name: string;
    icon: string;
    cost: number; // AP cost to unlock
    appeal: number; // Contribution to shop appeal
    isUnlocked: boolean;
}

export interface BankConfig {
    dailyBudget: number;
    currencySymbol: string;
}

export interface BankGuestbookItem {
    id: string;
    authorName: string;
    avatar?: string;
    content: string;
    isChar: boolean;
    charId?: string;
    timestamp: number;
    systemMessageId?: number; // Linked system message ID for deletion
}

// --- DOLLHOUSE / ROOM DECORATION TYPES ---
export interface DollhouseSticker {
    id: string;
    url: string;       // image URL or emoji
    x: number;         // % position within the surface
    y: number;
    scale: number;
    rotation: number;
    zIndex: number;
    surface: 'floor' | 'leftWall' | 'rightWall';
}

export interface DollhouseRoom {
    id: string;
    name: string;
    floor: number;         // 0 = ground floor, 1 = second floor
    position: 'left' | 'right';
    isUnlocked: boolean;
    layoutId: string;      // references a RoomLayout template
    wallpaperLeft?: string;  // CSS gradient or image URL
    wallpaperRight?: string;
    floorStyle?: string;     // CSS gradient or image URL
    roomTextureUrl?: string; // optional full-room overlay image
    roomTextureScale?: number;
    stickers: DollhouseSticker[];
    staffIds: string[];      // staff assigned to this room
}

export interface RoomLayout {
    id: string;
    name: string;
    icon: string;
    description: string;
    apCost: number;
    floorWidthRatio: number;   // relative width (0-1)
    floorDepthRatio: number;   // relative depth (0-1)
    hasCounter: boolean;
    hasWindow: boolean;
}

export interface DollhouseState {
    rooms: DollhouseRoom[];
    activeRoomId: string | null;   // currently zoomed-in room
    selectedLayoutId?: string;
}

export interface BankShopState {
    actionPoints: number;
    shopName: string;
    shopLevel: number;
    appeal: number; // Total Appeal
    background: string; // Custom BG
    staff: ShopStaff[];
    unlockedRecipes: string[]; // IDs
    activeVisitor?: {
        charId: string;
        message: string;
        timestamp: number;
        giftAp?: number; // Optional gift from visitor
        roomId?: string;
        x?: number;
        y?: number;
        scale?: number;
    };
    guestbook?: BankGuestbookItem[];
    dollhouse?: DollhouseState;
}

export interface BankFullState {
    config: BankConfig;
    shop: BankShopState;
    goals: SavingsGoal[];
    firedStaff?: ShopStaff[]; // Fired staff pool: can rehire or permanently delete
    todaySpent: number;
    lastLoginDate: string;
    dataVersion?: number; // Migration version tracker (undefined = v0/v1 legacy)
}
// ---------------------------------

// --- CHAR MUSIC PROFILE (网易云风格 · 角色的音乐人格) ---

/** 角色本地歌单里的轻量歌曲快照 — 字段与 MusicContext 的 Song 对齐（无运行时 url） */
export interface CharPlaylistSong {
    id: number;
    name: string;
    artists: string;
    album: string;
    albumPic: string;
    duration: number;
    fee: number;
    /**
     * 'user' = 这首是从 user 那里"抄"过来的（user 在听 → char 加进自己歌单）。
     * 'discovered' = char 自己探索 / 初始化时找到的。
     * 不写默认按 'discovered' 处理（向后兼容已有数据）。
     * 用途：当 char 后续"在听"这首时，prompt 会告诉 LLM "这是从 user 那儿收来的"，
     * 让记忆/对话能自然带上这层关系，而不是当成一首中立的歌。
     */
    source?: 'user' | 'discovered';
    /** 加入歌单时间，用来排序 / 显示"最近收藏" */
    addedAt?: number;
}

export interface CharPlaylist {
    id: string;                 // 本地 id (不与网易云 playlistId 冲突)
    title: string;
    description: string;        // 角色自己写的歌单简介
    coverStyle: string;         // 渐变色标识 or 第一首歌封面
    songs: CharPlaylistSong[];
    mood?: SongMood;
    createdAt: number;
    updatedAt: number;
}

export interface CharPlayRecord {
    song: CharPlaylistSong;
    at: number;                 // 播放时间戳（真实时间）
    context?: string;           // 该时刻的心境备注，如 "失眠的时候"
}

export interface CharMusicReview {
    id: string;
    targetType: 'song' | 'user_playlist' | 'user_record';
    targetId: string;           // songId or playlistId as string
    targetTitle: string;        // 歌名 / 歌单名
    content: string;            // 评论正文
    createdAt: number;
}

/** 运行时"此刻在听" — 根据 Schedule 决定，不必持久化（可以随时 recompute） */
export interface CharCurrentListening {
    songId: number;
    songName: string;
    artists: string;
    albumPic: string;
    /** 心境 / 选曲理由（来自 slot.innerThought 或 description） */
    vibe?: string;
    startedAt: number;
}

export interface CharMusicProfile {
    /** 音乐品味简介（LLM 初始化生成） */
    bio: string;
    /** 曲风标签（可随听歌演化） */
    genreTags: string[];
    /** 偏爱的艺人 */
    signatureArtists: { name: string; artistId?: number }[];
    /** 本地歌单列表 */
    playlists: CharPlaylist[];
    /** 仿 likelist */
    likedSongIds: number[];
    /** 最近在听（仿 user/record） */
    recentPlays: CharPlayRecord[];
    /** 私人 FM 关键词种子（留给未来做 char FM） */
    fmSeed?: string;
    /** 角色对歌/user 歌单的点评 */
    reviews?: CharMusicReview[];
    /** 此刻在听（Schedule 运行时填充，UI 展示用） */
    currentListening?: CharCurrentListening;
    /** 是否允许 char 读取 user 的网易云数据（默认 true） */
    canReadUserMusic?: boolean;
    /** 初始化时间 */
    initializedAt?: number;
    updatedAt: number;
}

export interface CharacterProfile {
  id: string;
  name: string;
  avatar: string;
  description: string;
  systemPrompt: string;
  worldview?: string;
  memories: MemoryFragment[];
  refinedMemories?: Record<string, string>;
  activeMemoryMonths?: string[];
  
  writerPersona?: string;
  writerPersonaGeneratedAt?: number;

  mountedWorldbooks?: { id: string; title: string; content: string; category?: string }[];

  impression?: UserImpression;

  bubbleStyle?: string;
  chatBackground?: string;
  contextLimit?: number;
  hideSystemLogs?: boolean;
  hideBeforeMessageId?: number;
  // 暮色 2026-08-05 Phase 3：角色自定义时区（异国恋 / 角色身处异国等场景）
  //   开启后，注入给该角色的"当前时间 / 消息时间戳 / 夜间判断"都按这个时区折算
  //   让 ta 真的活在自己的本地时间里
  customTimezoneEnabled?: boolean;
  customTimezone?: string;  // IANA 时区 id，如 'America/New_York'，空 = 跟随设备
  
  dateBackground?: string;
  dateBubbleThemeStyle?: 'light' | 'dark'; // 长文气泡主题（亮色/暗色）
  dateLongformTheme?: 'half-novel' | 'long-bubble';
  dateLongformBubblePresetId?: string;
  dateDefaultBubbleOpacity?: number;
  dateDefaultBubbleFontSize?: number;
  dateShowThinking?: boolean;   // 在 AI 回复上方显示折叠的原生思维链（reasoning_content），默认 true
  sprites?: Record<string, string>;
  spriteConfig?: SpriteConfig;
  customDateSprites?: string[]; // User-added custom emotion names for date mode (per-character)
  dateLightReading?: boolean;   // Light reading mode for novel/text view in date
  dateSkinSets?: SkinSet[];     // Multiple skin sets for portrait mode
  activeSkinSetId?: string;     // Currently active skin set ID

  savedDateState?: DateState;
  specialMomentRecords?: Record<string, SpecialMomentRecord>;

  // 小红书 per-character toggle
  xhsEnabled?: boolean;

  socialProfile?: {
      handle: string;
      bio?: string;
  };

  roomConfig?: {
      bgImage?: string;
      wallImage?: string;
      floorImage?: string;
      items: RoomItem[];
      wallScale?: number; 
      wallRepeat?: boolean; 
      floorScale?: number;
      floorRepeat?: boolean;
  };
  
  // deprecated: per-character assets migrated to global room_custom_assets_list with assignedCharIds

  lastRoomDate?: string;
  savedRoomState?: RoomGeneratedState;

  phoneState?: {
      records: PhoneEvidence[];
      customApps?: PhoneCustomApp[]; 
  };

  voiceProfile?: {
      provider?: 'minimax' | 'custom';
      voiceId?: string;
      voiceName?: string;
    volinkVoiceId?: string;    // 每个角色单独的 Volink 声音ID
      source?: 'system' | 'voice_cloning' | 'voice_generation' | 'custom';
      model?: string;
      notes?: string;
      timberWeights?: { voice_id: string; weight: number }[];
      voiceModify?: { pitch?: number; intensity?: number; timbre?: number; sound_effects?: string };
      emotion?: string;
      speed?: number;
      vol?: number;
      pitch?: number;
  };

  // Chat & Date voice TTS settings
  chatVoiceEnabled?: boolean;
  chatVoiceLang?: string;
  dateVoiceEnabled?: boolean;
  dateVoiceLang?: string;

  // Cross-session guidebook insights: what char has discovered about user across games
  guidebookInsights?: string[];

  // 主动消息配置
  proactiveConfig?: {
    enabled: boolean;
    intervalMinutes: number; // 30, 60, 120, 240, etc.
    useSecondaryApi?: boolean;
    secondaryApi?: {
      baseUrl: string;
      apiKey: string;
      model: string;
    };
    // 暮色 2026-07-27：增加「角色独立 API 开关」
    //   - 优先级：useSecondaryApi > useCharApi > 全局主 API
    //   - 三个开关都关 → 走全局主 API
    useCharApi?: boolean;
    // 暮色 2026-08-23：睡眠时间（不触发主动消息的时间段）
    //   - enabled: 是否启用
    //   - startHour / endHour: 0-23（local 时区）
    //   - 跨午夜：startHour > endHour（如 23-08 = 23:00 到次日 08:00）
    //   - 默认：enabled=false, startHour=23, endHour=8
    quietHours?: {
      enabled: boolean;
      startHour: number;
      endHour: number;
    };
  };

  // 情绪Buff系统
  activeMsg2Config?: ActiveMsg2CharacterConfig;
  activeBuffs?: CharacterBuff[];
  emotionHistory?: CharacterBuff[];
  buffInjection?: string;   // 注入到systemPrompt的叙事型情绪底色描述
  emotionConfig?: {
    enabled: boolean;
    api?: {
      baseUrl: string;
      apiKey: string;
      model: string;
    };
  };

  // 记忆宫殿 (Memory Palace)
  memoryPalaceEnabled?: boolean;
  digestionEnabled?: boolean;

  /**
   * 是否启用"palace 提取后自动同步归档"：开启后每次 buffer 处理成功都会把新记忆按日期
   * 合成 YAML MemoryFragment 追加到 char.memories，并推 hideBeforeMessageId 自动隐藏
   * 已处理的聊天。默认 false（opt-in）——首次启用建议让用户做一次 force 追平历史。
   */
  autoArchiveEnabled?: boolean;
  embeddingConfig?: {
    baseUrl: string;
    apiKey: string;
    model: string;        // 默认 text-embedding-3-small
    dimensions: number;   // 默认 1024
  };
  personalityStyle?: 'emotional' | 'narrative' | 'imagery' | 'analytical';
  ruminationTendency?: number;  // 反刍倾向 0-1，默认 0.3
  memoryPalaceInjection?: string;  // 记忆宫殿检索结果，注入到 System Prompt（运行时填充，不持久化）

  // 自我领悟词条：消化过程中 self_room 反刍产生的常驻认知
  // 像情绪 buff 一样注入到 contextBuilder 的角色设定下方
  selfInsights?: string[];

  // 音乐人格 — 角色自己的网易云式歌单 / 品味 / 正在听
  // 在音乐 App 里以"拜访"形式访问
  musicProfile?: CharMusicProfile;

  /**
   * 日程风格：
   * - 'lifestyle'（生活系，默认）：虚构角色，拥有日常物理生活（晨跑、做饭、逛街……）
   * - 'mindful'（意识系）：角色诚实面对自身存在，内心活动基于真实能力（回忆对话、整理想法、等待用户……），不虚构物理行为
   */
  scheduleStyle?: 'lifestyle' | 'mindful';

  /**
   * 日程 / 情绪 Buff 总开关。
   * - true：启用日程生成、意识流、情绪 buff 评估与注入（消耗副 API）。
   * - false：完全关闭，不调副 API，不注入情绪，不生成日程。
   * - undefined：向后兼容——若 scheduleStyle 已设（老用户已隐式选风格）视为开启；否则默认关闭。
   */
  scheduleFeatureEnabled?: boolean;

  /**
   * 心声（情绪 / 意识流）独立开关。
   * - true：主 LLM 在每次回复末尾附 <emotion>...</emotion> 心声块，心声卡片正常生成。
   * - false：完全不发心声、不生成心声卡片。
   * - undefined：向后兼容——老用户默认走 `scheduleFeatureEnabled && emotionConfig?.enabled` 旧逻辑；
   *   新用户在聊天设置里首次切换后写入明确值。
   *
   * 与 scheduleFeatureEnabled 完全解耦：日程可以独立开/关,心声也可以独立开/关。
   */
  emotionEnabled?: boolean;

  /**
   * 工具开关：生图 / 放歌
   * - true：开，AI 可调对应工具（默认开）
   * - false：关，AI 看不到该工具，工具数组里不带
   * - undefined：老用户兜底——等同 true（保持现有行为）
   * 跟 emotionEnabled 不同：心声是"输出"层开关，工具开关是"注册到 LLM 请求体"层
   */
  imageGenEnabled?: boolean;
  playSongEnabled?: boolean;

  // 暮色 2026-08-22：自动写日记开关（per-character）
  //   - true：开，角色每天 22:00 自动写一篇日记
  //   - false / undefined：关（默认关，用户主动开才生效）
  //   单角色独立：开 A 不影响 B；通过 ProactiveDiary.start/stop 触发实际定时器
  autoDiaryEnabled?: boolean;

  /**
   * HTML 模块模式（per-character）。
   * - htmlModeEnabled：开启后，给 LLM 注入"用 [html]...[/html] 包裹的富 HTML 卡片"提示词，
   *   AI 输出里的 [html] 块会被解析成单独的 html_card 消息（沙盒 iframe 渲染）。
   * - htmlModeCustomPrompt：用户自定义内容，**追加**在内置提示词之后（不会覆盖内置内容）。
   * - 上下文 / 归档 总结读到的 html_card 消息内容是已剥离 HTML 的纯文字摘要，避免 token 浪费。
   */
  htmlModeEnabled?: boolean;
  htmlModeCustomPrompt?: string;

  /**
   * 聊天模式（per-character）。
   * - 'full' (默认): 完整模式，注入所有 awareness 段（朋友圈/音乐/群聊/日记列表/笔记列表/心声底色/slotHeader）
   * - 'pure':       纯聊天模式，只保留对话必要内容（角色卡+世界书+基础 IM 规范+表情包+戳+引用+主动发消息+生图识图）
   *                  关闭朋友圈/音乐/群聊/日记列表/笔记列表/心声底色/slotHeader/小红书/Notion/飞书/搜索/转账
   *                  目的：降输入 token（暮色 2026-07-18 — 即享 ccmax2 cache_creation 比 input 贵 88%，纯走 input 更省）
   * - undefined:    兼容老用户——等同 'full'
   */
  chatMode?: 'full' | 'pure';

  /**
   * 角色独立 API 配置（暮色 2026-07-24 需求）
   * - undefined / 缺字段：回退到全局 apiConfig
   * - 设了：用这个角色的 baseUrl/apiKey/model
   * - 协议（OpenAI/Claude）、minimaxRegion 等其他字段都是**全局的**，不参与角色级覆盖
   * - visionBaseUrl/imgbbApiKey/R2/image* 等子资源也不参与角色级覆盖
   */
  apiConfig?: {
    baseUrl?: string;
    apiKey?: string;
    model?: string;
  };
}

export interface GroupProfile {
    id: string;
    name: string;
    members: string[];
    avatar?: string;
    createdAt: number;
    /**
     * 私聊里"近期群活动"上下文从这个群最多取最后多少条消息。
     * 不设默认 80。设大点能让活跃群更完整，设小点节省 token、避免某个活跃群把其他群挤掉。
     */
    privateContextCap?: number;
}

export interface CharacterExportData extends Omit<CharacterProfile, 'id' | 'memories' | 'refinedMemories' | 'activeMemoryMonths' | 'impression'> {
    version: number;
    type: 'sully_character_card';
    embeddedTheme?: ChatTheme;
}

export interface UserProfile {
    name: string;
    avatar: string;
    bio: string;
    /**
     * 全局"是否隐藏悬浮迷你播放器"开关
     * 暮色 2026-08-01：以前是 sessionStorage 临时隐藏（切歌会复活），现在改成持久设置。
     * 在音乐 app 设置页有 toggle。
     */
    miniPlayerHidden?: boolean;
    /**
     * AI 主动放歌功能总开关
     * 暮色 2026-08-01：LLM 用 play_song / play_song_and_join token 时会触发放歌。
     *   默认 true（开）。关掉后 LLM 仍然能看到 prompt 说明，但 playSongFromChar 会被拦截，
     *   搜不到 / 静默丢弃（跟"歌搜不到"一样的 fallback）。
     *   在音乐 app 设置页有 toggle。
     */
    musicAiAutoPlayEnabled?: boolean;
    /**
     * AI 主动放歌的每日每 char 次数上限计数
     * 暮色 2026-08-01：默认每天每个 char 最多 3 次，超过后 playSongFromChar 静默丢弃
     *   （让 LLM 当成"歌搜不到"处理）。每天 0 点重置（按本地日期）。
     *   格式：{ [YYYY-MM-DD]: { [charId]: count } }
     */
    musicAiAutoPlayCount?: Record<string, Record<string, number>>;
}

/** AI 主动放歌每日每 char 默认上限 */
export const MUSIC_AI_AUTOPLAY_DAILY_LIMIT = 3;

export interface Toast {
    id: string;
    message: string;
    // 暮色 2026-07-15：加 'bell' 类型 — 重要提示用铃铛胶囊样式（浅马卡龙背景 + 橙色铃铛）
    // 跟普通 info/error 区分开，触发"提醒占空间"那种需要用户注意但不阻塞的提示
    type: 'success' | 'error' | 'info' | 'bell';
}

export interface XhsStockImage {
    id: string;
    url: string;           // 图床URL (must be public https)
    tags: string[];        // 标签 e.g. ['美食','咖啡','下午茶']
    addedAt: number;       // timestamp
    usedCount: number;     // 被使用次数
    lastUsedAt?: number;   // 上次使用时间
}

export interface GalleryImage {
    id: string;
    charId: string;
    url: string;
    timestamp: number;
    source?: 'user' | 'ai'; // 老数据 undefined 当 'user' 处理
    review?: string;
    reviewTimestamp?: number;
    savedDate?: string; // YYYY-MM-DD format
    chatContext?: string[]; // Recent chat messages at time of save
}

export interface StickerData {
    id: string;
    url: string;
    x: number;
    y: number;
    rotation: number;
    scale?: number; 
}

export interface DiaryPage {
    text: string;
    paperStyle: string;
    stickers: StickerData[];
}

export interface DiaryEntry {
    id: string;
    charId: string;
    date: string;
    userPage?: DiaryPage;        // 'exchange' 时有，'char-only' 时无
    charPage?: DiaryPage;
    timestamp: number;
    isArchived: boolean;
    // 暮色 2026-08-21：新增 source 区分"交换日记"和"角色独白"
    source?: 'exchange' | 'char-only';   // 老数据兜底：userPage 存在则 'exchange'，否则 'char-only'
    mood?: string;                        // miya 风格：日记心情关键词
    title?: string;                       // 日记标题（角色独白日记存 JSON 里的 title）
}

// ─── HANDBOOK / 手账 (跨角色聚合·零负担留痕本) ───
//
// 设计哲学（user 共识）:
//   - 主体是 user 自己的一天,LLM 读今天跨角色聊天后用 user 的口吻替 ta 写一份草稿
//     (user 不必模仿,后续会二次编辑)
//   - 即便 user 一天没说话,生活系角色们也会"过自己的小生活",自动填一两页陪伴页
//     (绝不能写成 AI 捧场 / 等 user / 想 user)
//   - 反完美主义:留白即真实,不强制每天生成,不显示连续天数,不做 streak
//   - 一日一 entry,id 直接是 'YYYY-MM-DD'
//
// Section / tag 模型留位但暂不在 UI 实装(等 user 想清楚)。
export type HandbookPageType =
    | 'user_diary'       // LLM 代笔 user 第一人称当日日记
    | 'character_life'   // 生活系角色今日的生活流(陪伴页)
    | 'user_note'        // user 自己手写/补充的一页
    | 'free';            // 自由格式,未来扩展用

export interface HandbookPage {
    id: string;
    type: HandbookPageType;
    charId?: string;          // type=character_life 时绑定的角色
    title?: string;
    content: string;          // 主体文本(也是编辑/兜底渲染用)
    /**
     * 碎片化展示:LLM 生成时若返回 JSON 数组(社媒碎碎念体),解析出来存这里。
     * 前端有 fragments 走 FragmentCollage 拼贴渲染,无则走 content 段落渲染。
     * user 编辑后会清空 fragments,回退到 content 段落形态。
     */
    fragments?: HandbookFragment[];
    paperStyle?: string;      // 'plain' | 'grid' | 'lined' | 'dot' | 'pink' | 'dark'
    tags?: string[];          // 预留:section/标签(生理期/饮食/项目…),v1 不渲染
    generatedBy?: 'llm' | 'user';
    generatedAt?: number;
    excluded?: boolean;       // user 把这页标记为不入册
    isPinned?: boolean;
}

export interface HandbookFragment {
    id: string;
    text: string;             // 30~80 字社媒碎碎念体
    time?: string;            // 可选时段标签,如 "上午 10 点" / "下午" / "10:23"
    // ─── v2 槽位元数据 (新版式才有) ─────────────────────
    /** 来自 LayoutTemplate 的槽 id */
    slotId?: string;
    /** 槽语义角色 — 渲染时按这个分发 */
    slotRole?: SlotRole;
    /** 谁写的 — 'user' 或某 charId */
    authorKind?: 'user' | 'char';
    /** 若是反应型槽 (sticky-reaction), 引用的目标 slotId */
    refersTo?: string;
    /** 结构化数据 (todo / gratitude / mood-card 等需要) */
    payload?: SlotPayload;
}

/**
 * 结构化 slot 数据。普通文本槽不用,
 * 仅 todo/gratitude/mood-card/timeline-plan 这种"列表/打分"才填。
 */
export type SlotPayload =
    | { kind: 'todo'; items: { text: string; done?: boolean }[] }
    | { kind: 'gratitude'; items: string[] }
    | { kind: 'timeline'; items: { time: string; text: string; emoji?: string }[] }
    | { kind: 'mood'; rating: number; tag?: string }       // rating 1~5
    | { kind: 'photo'; src?: string; caption: string };   // src 由 user 贴, 也可暂缺

// ─── 单页拼贴排版 ──────────────────────────────────────
//
// v2 设计 (2026-05): "版式优先"。先 roll 一份 layout template (pre-baked JSON),
// 它已包含每个槽的 {位置, 视觉角色, 字数预算, 可写者} —— LLM 只填空,不排版。
// 角色按顺序看到 "已填的槽 + 剩余槽 + 自己人格", 选一个槽写,或 pass。
//
// 旧的 'main'|'side'|'corner'|'margin' 仍然保留 (老数据回放兼容),
// 新版式用更语义化的 SlotRole, 渲染时按 role 分发到专门组件。
//
// 坐标都用百分比,固定比例的纸面 → 任意尺寸下都不破。

/** v1 旧角色 — 仅为兼容历史 entry 数据保留, 新版式不要再产出 */
export type LayoutRole =
    | 'main'        // 主区,大块,正放或微旋转
    | 'side'        // 侧栏,中等尺寸
    | 'corner'      // 角落,小卡片,大旋转
    | 'margin';     // 页边,极小尺寸,可以纵向

/**
 * v2 槽角色 —— 一个 role = 一种 "内容类型 + 视觉皮肤 + 写作约束"。
 * Renderer 按 role 分发, prompt 按 role 出 hint。
 *
 * - hero-diary       主日记本体, 当天主叙事 (80~180 字)
 * - timeline-plan    时间表 / 今日计划 (6~10 行)
 * - todo             待办清单 (3~6 项)
 * - gratitude        今日感恩 / 三件好事 (3 项)
 * - mood-card        心情卡 + 评分 (20~50 字 + 1~5 ★)
 * - photo-caption    照片 + 短描述 (8~25 字, 图由 user 贴)
 * - sticky-reaction  反应便签 (15~50 字, char-only, 必须引用已填槽)
 * - corner-note      边角独白小字 (6~20 字)
 */
export type SlotRole =
    | 'hero-diary'
    | 'timeline-plan'
    | 'todo'
    | 'gratitude'
    | 'mood-card'
    | 'photo-caption'
    | 'sticky-reaction'
    | 'corner-note';

/** 谁能填这个槽 */
export type SlotAuthorKind = 'user' | 'char';

/**
 * 槽定义 —— template 里的一个空位, 渲染时也是 placement 的扩展。
 * 比 v1 的 LayoutPlacement 多: charBudget / eligibleAuthors / slotRole / hint
 */
export interface SlotDef {
    /** 槽 id, 在一份 template 内唯一 */
    id: string;
    /** 视觉 + 内容类型 */
    slotRole: SlotRole;
    /** 字数预算 [min, max] —— 给 LLM, 也给渲染器估高度 */
    charBudget: [number, number];
    /** 谁能填: ['user'] / ['char'] / ['user', 'char'] */
    eligibleAuthors: SlotAuthorKind[];
    /** 给 LLM 的一句话目的 (作为 prompt hint) */
    hint: string;
    /** 位置 — 整页百分比 */
    xPct: number;
    yPct: number;
    widthPct: number;
    /** 高度上限 (% of page) — 渲染器超出截断, 估高用 */
    maxHeightPct: number;
    rotate?: number;             // 默认 0
    zIndex?: number;             // 默认 10
    /** 是否本页 hero — 每页 ≤ 1, 字号最大, 视觉权重最高 */
    isHero?: boolean;
    /** 视觉皮肤变体 (例: sticky-reaction 的便签底色) */
    skinVariant?: string;
}

/** 一份预置版式 = 一组 SlotDef + 一些视觉装饰 */
export interface LayoutTemplate {
    id: string;                  // 'plan-day' / 'reflective-day' / 'photo-day' / ...
    name: string;                // 中文显示名
    /** 每页 SlotDef 列表; index 0 = page 1, 1 = page 2 ... */
    pages: SlotDef[][];
    /** 推荐使用条件提示 (orchestrator 选模板用) */
    suitFor?: string;
    /** 默认纸张底纹: 'plain' | 'grid' | 'lined' | 'dot' */
    paperStyle?: string;
}

/** v2 placement —— LayoutPlacement 的扩展, 携带 slot 元数据。
 *  老数据没有 slotRole 时, 渲染器走 v1 的 JournalFragmentCard。 */
export interface LayoutPlacement {
    pageId: string;             // 对应 HandbookPage.id
    fragmentId?: string;        // 对应 HandbookFragment.id;手写整页留空
    xPct: number;               // 0~100,左上角 x
    yPct: number;               // 0~100,左上角 y
    widthPct: number;           // 10~95,卡片宽度占页面百分比
    rotate: number;             // -10 ~ 10,角落可到 ±15
    zIndex: number;             // 越大越压上面
    role: LayoutRole;           // v1 角色 (兼容)
    /** 该页 hero — 字号最大、视觉最显眼。每页最多 1 个。 */
    isHero?: boolean;
    // ─── v2 字段 (新版式才有, 老数据为 undefined) ───
    /** 来自 template 的槽 id */
    slotId?: string;
    /** v2 语义角色 (有则按 SlotRole 分发渲染) */
    slotRole?: SlotRole;
    /** 高度上限 % */
    maxHeightPct?: number;
    /** 视觉变体 (跟随 SlotDef.skinVariant) */
    skinVariant?: string;
}

export interface HandbookLayout {
    pageNumber: number;         // 一张纸,1-based;超量时可有 page 2
    placements: LayoutPlacement[];
    generatedAt: number;
    /** v2 版式来源 template id (用于重生成时复用相同 template) */
    templateId?: string;
}

// ─── HANDBOOK TRACKER（自定义健康/生活打卡引擎）───
//
// 设计:
// - Tracker = 用户自定义的"打卡项"(生理期 / 饮食 / 喝水 / 心情 / 体重 / 服药 / 自定义……)
// - 每个 Tracker 有 schema(字段定义),系统提供模板,user 可改可建
// - TrackerEntry = 某 tracker 在某天的一条打卡记录,values 按 schema 存
// - 跟 HandbookPage 解耦:tracker 是结构化数据,page 是自由文本/碎片
//
export type TrackerFieldKind =
    | 'rating'       // 1~5 等级(滑块 / emoji 选择)
    | 'number'       // 数字(体重 / ml)
    | 'options'      // 多选 / 单选(经期流量:无/少/中/多)
    | 'photo'        // 一张图(饮食拍照)
    | 'text'         // 一句话备注
    | 'boolean';     // 是/否(今天有没有头痛)

export interface TrackerField {
    key: string;                     // values 字典里的 key
    label: string;                   // 显示名("评分" / "备注" / "流量")
    kind: TrackerFieldKind;
    required?: boolean;
    /** rating: 1~max 整数;number: 自由数字 */
    max?: number;
    min?: number;
    unit?: string;                   // 'kg' / 'ml' / '小时'
    /** options 时的可选项 */
    choices?: { value: string; label: string; emoji?: string }[];
    placeholder?: string;
}

export interface Tracker {
    id: string;
    name: string;                    // "心情" / "经期" / "今天有没有偏头痛"
    icon?: string;                   // emoji 或 sticker 名
    color: string;                   // tab/标记 底色
    schema: TrackerField[];
    createdAt: number;
    updatedAt: number;
    /** 系统预设 vs 用户自建（系统预设 user 可禁用但不可彻底删除）*/
    isBuiltin?: boolean;
    /** 在月历单元格上如何"一眼看到"今日 entry —— 默认显示主字段值 */
    cellRenderField?: string;        // schema field key
    sortOrder?: number;              // 在 tab 列表里的排序
}

export interface TrackerEntry {
    id: string;
    trackerId: string;
    date: string;                    // YYYY-MM-DD
    values: Record<string, any>;
    note?: string;
    createdAt: number;
    updatedAt: number;
}

export interface HandbookEntry {
    id: string;               // = date 'YYYY-MM-DD'
    date: string;
    pages: HandbookPage[];
    /** 二次 LLM 生成的整页排版;一天可能跨多张纸 */
    layouts?: HandbookLayout[];
    generatedAt?: number;     // 最后一次自动生成的时间
    updatedAt: number;
}

export interface Task {
    id: string;
    title: string;
    supervisorId: string;
    tone: 'gentle' | 'strict' | 'tsundere';
    deadline?: string;
    isCompleted: boolean;
    completedAt?: number;
    createdAt: number;
}

export interface Anniversary {
    id: string;
    title: string;
    date: string;
    charId: string;
    aiThought?: string;
    lastThoughtGeneratedAt?: number;
}

export interface SocialComment {
    id: string;
    authorName: string;
    authorAvatar?: string;
    content: string;
    likes: number;
    isCharacter?: boolean; 
}

export interface SocialPost {
    id: string;
    authorName: string;
    authorAvatar: string;
    title: string;
    content: string;
    images: string[]; 
    likes: number;
    isCollected: boolean;
    isLiked: boolean;
    comments: SocialComment[];
    timestamp: number;
    tags: string[];
    bgStyle?: string; 
}

export interface SubAccount {
    id: string;
    handle: string; 
    note: string;   
}

export interface SocialAppProfile {
    name: string;
    avatar: string;
    bio: string;
}

export interface StudyChapter {
    id: string;
    title: string;
    summary: string;
    difficulty: 'easy' | 'normal' | 'hard';
    isCompleted: boolean;
    rawContentRange?: { start: number, end: number }; 
    content?: string; 
}

export interface StudyCourse {
    id: string;
    title: string;
    rawText: string; 
    chapters: StudyChapter[];
    currentChapterIndex: number;
    createdAt: number;
    coverStyle: string; 
    totalProgress: number; 
    preference?: string; 
}

export interface StudyTutorPreset {
    id: string;
    name: string;
    prompt: string;
}

// --- QUIZ / PRACTICE BOOK TYPES ---
export interface QuizQuestionNote {
    question: string;
    answer: string;
    timestamp: number;
}

export interface QuizQuestion {
    id: string;
    type: 'choice' | 'true_false' | 'fill_blank';
    stem: string;
    options?: string[];
    answer: string;           // For choice: "A"/"B"/etc, true_false: "true"/"false", fill_blank: the text
    explanation: string;
    userAnswer?: string;
    isCorrect?: boolean;
    notes?: QuizQuestionNote[];  // Follow-up Q&A notes per question
}

export interface QuizSession {
    id: string;
    courseId: string;
    chapterId: string;
    chapterTitle: string;
    courseTitle: string;
    questions: QuizQuestion[];
    score: number;
    totalQuestions: number;
    aiReview: string;         // AI review/commentary full text
    status: 'in_progress' | 'graded';
    createdAt: number;
    gradedAt?: number;
}

export type GameTheme = 'fantasy' | 'cyber' | 'horror' | 'modern';

export interface GameActionOption {
    label: string;
    type: 'neutral' | 'chaotic' | 'evil';
}

export interface GameLog {
    id: string;
    role: 'gm' | 'player' | 'character' | 'system';
    speakerName?: string; 
    content: string;
    timestamp: number;
    diceRoll?: {
        result: number;
        max: number;
        check?: string; 
        success?: boolean;
    };
}

export interface GameSession {
    id: string;
    title: string;
    theme: GameTheme;
    worldSetting: string;
    playerCharIds: string[];
    logs: GameLog[];
    status: {
        location: string;
        health: number;
        sanity: number;
        gold: number;
        inventory: string[];
    };
    sanityLocked?: boolean;
    suggestedActions?: GameActionOption[];
    createdAt: number;
    lastPlayedAt: number;
}

export type MessageType = 'text' | 'image' | 'emoji' | 'interaction' | 'transfer' | 'system' | 'social_card' | 'chat_forward' | 'xhs_card' | 'score_card' | 'music_card' | 'mcd_card' | 'html_card' | 'couple_space_invite' | 'couple_space_event' | 'music_invite' | 'mcp_tool_call';

// 暮色 2026-08-24：MCP 工具调用摘要（聊天页灰色小气泡）
//   useChatAI 跑完 processMcpToolCalls 后，把 executed 的工具列表塞进 chat 消息
//   只记录"调了哪些 / 调了几个"，不重复发 addToast（addToast 已经在 mcpChatAI 内发了）
export interface McpToolCallRecord {
    /** 工具原始名（含 mcp__<serverId>__ 前缀已剥离） */
    name: string;
    /** UI 友好名（来自 tool.description / tool.name 截断 36 字） */
    label?: string;
    /** 所属 server id */
    serverId: string;
    /** 工具是否成功执行（false = callMcpTool 返回 success:false） */
    ok: boolean;
    /** 暮色 2026-08-24：是否命中缓存（5 分钟内同工具同参数复用结果，不重跑） */
    cached?: boolean;
}

export interface Message {
    id: number;
    charId: string;
    groupId?: string;
    role: 'user' | 'assistant' | 'system';
    type: MessageType;
    content: string;
    timestamp: number;
    metadata?: any;
    /** 暮色 2026-08-24：当 type='mcp_tool_call' 时，列出本轮 AI 调用的工具 */
    mcpToolCalls?: McpToolCallRecord[];
    replyTo?: {
        id: number;
        content: string;
        name: string;
    };
    /** 云端同步用的稳定 ID（UUID v4），本地 saveMessage 时自动生成；多端互通用来去重 */
    clientId?: string;
}

export interface EmojiCategory {
    id: string;
    name: string;
    isSystem?: boolean;
    allowedCharacterIds?: string[]; // If set, only these characters can see this category
}

export interface Emoji {
    name: string;
    url: string;
    categoryId?: string; 
    order?: number; // 排序字段：可选，老数据/未排序时按 IndexedDB 自然顺序处理
}

export interface FullBackupData {
    timestamp: number;
    version: number;
    /** 备份模式 — 导入时用这个判断合并策略（text_only → 合并；full → 整库替换） */
    backupMode?: 'text_only' | 'media_only' | 'full';
    theme?: OSTheme;
    apiConfig?: APIConfig;
    apiPresets?: ApiPreset[];
    availableModels?: string[];
    realtimeConfig?: RealtimeConfig;  // 实时感知配置（天气/新闻/Notion）
    customIcons?: Record<string, string>;
    appearancePresets?: AppearancePreset[];
    characters?: CharacterProfile[];
    groups?: GroupProfile[]; 
    messages?: Message[];
    customThemes?: ChatTheme[];
    savedEmojis?: Emoji[]; 
    emojiCategories?: EmojiCategory[]; 
    savedJournalStickers?: {name: string, url: string}[]; 
    assets?: { id: string, data: string }[];
    galleryImages?: GalleryImage[];
    userProfile?: UserProfile;
    diaries?: DiaryEntry[];
    tasks?: Task[];
    anniversaries?: Anniversary[];
    roomTodos?: RoomTodo[]; 
    roomNotes?: RoomNote[];
    socialPosts?: SocialPost[]; 
    courses?: StudyCourse[]; 
    games?: GameSession[];
    worldbooks?: Worldbook[]; 
    roomCustomAssets?: { id?: string; name: string; image: string; defaultScale: number; description?: string; visibility?: 'public' | 'character'; assignedCharIds?: string[] }[]; 
    
    novels?: NovelBook[];
    songs?: SongSheet[]; // Songwriting app data
    
    // Bank Data
    bankState?: BankFullState;
    bankDollhouse?: DollhouseState;
    bankTransactions?: BankTransaction[];

    socialAppData?: {
        charHandles?: Record<string, SubAccount[]>;
        userProfile?: SocialAppProfile;
        userId?: string;
        userBg?: string;
    };
    
    mediaAssets?: {
        charId: string;
        avatar?: string;
        sprites?: Record<string, string>;
        dateSkinSets?: SkinSet[];
        activeSkinSetId?: string;
        customDateSprites?: string[];
        spriteConfig?: SpriteConfig;
        roomItems?: Record<string, string>;
        backgrounds?: { chat?: string; date?: string; roomWall?: string; roomFloor?: string };
    }[];

    xhsActivities?: XhsActivityRecord[];
    xhsStockImages?: XhsStockImage[];

    // Study Room settings
    studyApiConfig?: Partial<APIConfig>;
    studyTutorPresets?: StudyTutorPreset[];

    // Quiz / Practice Book
    quizSessions?: QuizSession[];

    // Guidebook (攻略本)
    guidebookSessions?: GuidebookSession[];

    // Chat delayed actions
    scheduledMessages?: {
        id: string;
        charId: string;
        content: string;
        dueAt: number;
        createdAt: number;
    }[];

    // LifeSim
    lifeSimState?: LifeSimState | null;

    // Memory Palace (记忆宫殿)
    memoryNodes?: any[];
    memoryVectors?: any[];
    memoryLinks?: any[];
    topicBoxes?: any[];
    anticipations?: any[];
    eventBoxes?: any[];
    memoryPalaceHighWaterMarks?: Record<string, number>; // charId → lastProcessedMsgId
    memoryPalaceFlags?: Record<string, string>; // mp_personality_tried_* / mp_first_archive_notice_* 等 UI 标记
    cloudBackupConfig?: CloudBackupConfig;
    remoteVectorConfig?: { enabled: boolean; supabaseUrl: string; supabaseAnonKey: string; initialized: boolean };

    // Character daily schedule (角色日程表 — daily_schedule store)
    dailySchedules?: DailySchedule[];

    // 手账（跨角色聚合留痕本 — handbook store）
    handbooks?: HandbookEntry[];

    // 手账 Tracker（健康/生活打卡引擎）
    trackers?: Tracker[];
    trackerEntries?: TrackerEntry[];

    // 暮色 8-25：小纸条（独立于 room_notes，7-22 加的）
    xiaoZhiTiaos?: any[];

    // 暮色 8-25：彼方（VRWorld）9 个 store
    vrNovels?: any[];
    vrAnnotations?: any[];
    vrMusic?: any[];
    vrGuestbook?: any[];
    vrScripts?: any[];
    vrPlays?: any[];
    vrPresets?: any[];
    vrSettings?: any[];
    vrLetters?: any[];

    // 暮色 8-25：捏人自定义部件（8-24 加的，base64 图片）
    ccCustomParts?: any[];

    // 暮色 8-25：信箱（双向信件）
    mailboxLetters?: any[];

    // Memory Palace 批次处理元数据
    memoryBatches?: any[];

    // Pixel Home（小屋像素界面）
    pixelHomeAssets?: any[];
    pixelHomeLayouts?: any[];

    // Chat 设置（翻译 / 归档 / 润色 prompts）
    chatTranslateSourceLang?: string;
    chatTranslateTargetLang?: string;
    chatTranslateEnabledByChar?: Record<string, boolean>;
    chatArchivePrompts?: any;
    chatActiveArchivePromptId?: string;
    characterRefinePrompts?: any;
    characterActiveRefinePromptId?: string;

    // 其它 UI / 偏好
    scheduleAppTheme?: string;
    groupchatContextLimit?: number;
    browserConfig?: { braveKey?: string; useRealSearch?: boolean };
    bm25Mode?: string;
    lastActiveCharId?: string;
    eventNotifFlags?: Record<string, string>;  // sullyos_* 事件通知标记
    // 暮色 2026-08-24：MCP 服务器配置（mcpStorage 持久化的内容）
    //   text_only + full 模式都带（配置属于"基础数据"，纯文字同步应该带上）
    //   media_only 不带（媒体模式只同步图片/美化素材）
    mcpServers?: McpServerConfig[];
}

// --- CLOUD BACKUP TYPES ---
// Two providers share one config: WebDAV (legacy) and GitHub Releases (new,
// no GFW friction for most users — just paste a Personal Access Token).
export type CloudBackupProvider = 'webdav' | 'github';

export interface CloudBackupConfig {
    enabled: boolean;
    provider?: CloudBackupProvider;     // undefined = 'webdav' (back-compat)

    // WebDAV
    webdavUrl: string;          // e.g. https://dav.jianguoyun.com/dav/
    username: string;
    password: string;           // App-specific password
    remotePath: string;         // e.g. /SullyBackup/

    // GitHub Releases — uses a Personal Access Token. Owner is resolved from
    // GET /user during connect; repo defaults to 'sully-backup' (private).
    githubToken?: string;
    githubOwner?: string;
    githubRepo?: string;
    githubUseProxy?: boolean;   // route through Cloudflare Worker (for GFW)

    lastBackupTime?: number;    // timestamp
    lastBackupSize?: number;    // bytes
}

export interface CloudBackupFile {
    name: string;
    size: number;
    lastModified: string;       // ISO date string
    href: string;               // WebDAV: remote path. GitHub: 'releaseId:assetId'
}
// ==================== MCP 工具调用结果（v3 暮色 8-23 22:11）====================
//   暮色规格：超时/取消/HTTP 错误/协议错误统一返回 { success: false, content: [], error: { category, code, message } }
//   错误消息脱敏：不出现 Authorization / Bearer Token / 自定义 Header / 完整请求配置
//   isError 是 MCP 工具返回的（工具执行成功但业务失败），跟 success: false 区分
export interface McpContentBlock {
    type: string;            // 'text' | 'image' | 'audio' | 'resource' | 'resource_link'（MCP 2025-06-18）
    text?: string;
    data?: string;           // base64（image/audio）
    mimeType?: string;
    resource?: any;          // embedded resource
    [k: string]: any;        // 透传 MCP 协议其他字段（向前兼容）
}

export type McpCallErrorCategory =
    | 'cors' | 'network' | 'auth' | 'protocol' | 'toolsList'
    | 'timeout' | 'cancelled' | 'notFound' | 'notEnabled'
    | 'isError' | 'unknown';

export interface McpCallError {
    category: McpCallErrorCategory;
    code: string;            // 'HTTP_401' / 'TIMEOUT_30S' / 'CANCELLED' / 'JSONRPC_-32601' ...
    message: string;         // 脱敏后用户可见
}

export type McpCallResult =
    | {
        success: true;
        content: McpContentBlock[];
        isError: boolean;     // MCP 工具返回的 isError（业务失败），调用本身是成功的
        structuredContent?: any;
        /** 暮色 2026-08-24：是否命中缓存（true = 没真跑,从 utils/mcpCache 取的旧结果） */
        cached?: boolean;
    }
    | {
        success: false;
        content: [];
        error: McpCallError;
    };

// ==================== MCP (Model Context Protocol) 服务器配置 ====================
// 暮色 2026-08-23：cjjc 截图带来"自己添加 MCP"需求
// 第一版：配置存储 + UI 管理 + 测试连接（不接 useChatAI 实际 tool_call 链）
// 第二版：把 enabled 服务的 tools 转成模型可用 tools + 解析 tool_call + 回传 result
//   工具名内部采用 mcp__${serverId}__${toolName}（接口预留 listMcpTools / callMcpTool）
export type McpTransport = 'streamable-http';   // 第一版只实现 streamable-http；'sse' 占位不实现
export type McpAuthType = 'none' | 'bearer' | 'headers';
export type McpErrorType = 'cors' | 'network' | 'auth' | 'protocol' | 'toolsList' | 'unknown';

export interface McpTool {
    name: string;
    description?: string;
    inputSchema: any;   // JSON Schema，原样保存
    // 暮色 2026-08-23 v2：工具级开关
    //   兼容旧数据：旧工具没 enabled 字段时按 true 处理（mcpStorage.mergeTools 处理）
    //   server enabled=false 时，下面所有工具即使单独 enabled 也不能被注入模型（AND 逻辑）
    enabled?: boolean;
    // 暮色 2026-08-24 12:45：是否注入 LLM context（按需注入策略）
    //   跟 enabled 独立：enabled 控制"能不能调",inject 控制"要不要塞进 schema 吃 token"
    //   暮色指定默认（mergeTools 里设）：search_web / search_web_deep / read_url /
    //   capture_screenshot_url inject=true（高频），其他 inject=false
    //   未注入的工具在 system prompt 末尾以"工具名列表"形式告诉 LLM 存在
    inject?: boolean;
    // 暮色 2026-08-23 v2：风险标记（硬编码 KNOWN_SENSITIVE_TOOLS 决定，第一版只标记不自动禁用）
    isSensitive?: boolean;
    // 暮色 2026-08-23 v2.1：之前删过标记（mergeTools 时根据 deletedToolHistory 计算）
    //   不阻止重新出现，仅 UI 提示用户"这个工具之前被你删过"
    wasDeleted?: boolean;
}

export interface McpServerConfig {
    id: string;                          // stable unique id (crypto.randomUUID)
    name: string;                        // 展示名（不作为唯一键）
    url: string;                         // MCP server URL
    enabled: boolean;                    // 单独启用/禁用
    transport: McpTransport;             // 第一版恒为 'streamable-http'
    authType: McpAuthType;
    bearerToken?: string;                // 敏感字段，UI 脱敏，日志严禁打印
    customHeaders?: Record<string, string>;  // 敏感字段，UI 脱敏，日志严禁打印
    createdAt: number;
    lastConnectedAt?: number;            // 最近一次成功连接时间
    lastTestedAt?: number;               // 最近一次测试时间（成功或失败都更新）
    lastError?: string;                  // 最近一次错误信息（脱敏后）
    lastErrorType?: McpErrorType;        // 最近一次错误分类
    tools?: McpTool[];                   // tools/list 返回的工具列表
    // 暮色 2026-08-23 v2.1：删过工具的历史记录
    //   删除时记录到此处，mergeTools 时设 wasDeleted=true 标记
    //   不阻止重新出现（暮色规格"下次 testConnection 可重新出现"），仅作 UI 提示
    deletedToolHistory?: string[];
    // 暮色 2026-08-23 v3：启用风险工具授权（默认 false）
    //   true 时，isSensitive 工具也会被注入 LLM
    //   持久化在 server config 上，每 server 独立
    allowSensitive?: boolean;
    // 暮色 2026-08-23 v3：per-server 超时配置（覆盖默认 30s）
    //   用于慢工具（如 search_web_deep）
    timeoutMs?: number;
}

// --- GUIDEBOOK (攻略本) APP TYPES ---
export interface GuidebookOption {
    text: string;
    affinity: number;
}

export interface GuidebookRound {
    id: string;
    roundNumber: number;
    scenario: string;
    options: GuidebookOption[];
    gmNarration: string;
    charInnerThought: string;
    charChoice: number;
    charReaction: string;
    charExploration?: string;
    charInsight?: string;      // what user's scoring reveals about their personality
    affinityBefore: number;
    affinityAfter: number;
    timestamp: number;
}

export interface GuidebookEndCard {
    finalAffinity: number;
    charVerdict: string;
    title: string;
    highlights: string[];
    charSummary?: string;
    charNewInsight?: string;   // the one specific thing char learned about user this session
}

export interface GuidebookSession {
    id: string;
    charId: string;
    initialAffinity: number;
    currentAffinity: number;
    maxRounds: number;
    currentRound: number;
    mode: 'manual' | 'auto';
    scenarioHint?: string;
    recentMessageCount?: number;
    rounds: GuidebookRound[];
    openingSequence?: string;
    status: 'setup' | 'opening' | 'playing' | 'ended';
    endCard?: GuidebookEndCard;
    createdAt: number;
    lastPlayedAt: number;
}

// --- XHS FREE ROAM / AUTONOMOUS ACTIVITY TYPES ---

export type XhsActionType = 'post' | 'browse' | 'search' | 'comment' | 'save_topic' | 'idle';

export interface XhsActivityRecord {
    id: string;
    characterId: string;
    timestamp: number;
    actionType: XhsActionType;
    content: {
        title?: string;
        body?: string;
        tags?: string[];
        keyword?: string;
        savedTopics?: { title: string; desc: string; noteId?: string }[];
        notesViewed?: { noteId: string; title: string; desc: string; author: string; likes: number }[];
        commentTarget?: { noteId: string; title: string };
        commentText?: string;
    };
    thinking: string;  // Character's internal monologue / reasoning
    result: 'success' | 'failed' | 'skipped';
    resultMessage?: string;
}

export interface XhsFreeRoamSession {
    id: string;
    characterId: string;
    startedAt: number;
    endedAt?: number;
    activities: XhsActivityRecord[];
    summary?: string;  // AI-generated session summary
}

export interface XhsMcpConfig {
    enabled: boolean;
    serverUrl: string;  // MCP: "http://localhost:18060/mcp" | Skills: "http://localhost:18061/api"
    loggedInUserId?: string;   // 登录用户的 user_id，连接测试成功后自动获取
    loggedInNickname?: string; // 登录用户的昵称
}

// ============================================================
// 模拟人生 (LifeSim) Types — 真人秀沙盒版
// ============================================================

export type SimActionType =
    | 'ADD_NPC'        // 创建NPC并丢进某家庭
    | 'MOVE_NPC'       // 把NPC移到另一个家庭
    | 'TRIGGER_EVENT'  // 触发事件（吵架/联谊/出走等）
    | 'GO_SOLO'        // NPC独立成家
    | 'DO_NOTHING';    // 观望

export type SimEventType =
    | 'fight'          // 吵架
    | 'party'          // 联谊/聚会
    | 'gossip'         // 搬弄是非
    | 'romance'        // 暧昧
    | 'rivalry'        // 竞争
    | 'alliance';      // 结盟

// 事件链效果代码
export type SimEffectCode =
    | 'fight_break'           // 矛盾爆发（离家出走）
    | 'mood_drop'             // 心情低落
    | 'relationship_change'   // 关系变化
    | 'revenge_plot'          // 复仇计划
    | 'love_triangle'         // 三角恋
    | 'jealousy_spiral'       // 嫉妒螺旋
    | 'family_feud'           // 家族世仇
    | 'betrayal'              // 背叛
    | 'romantic_confession'   // 浪漫告白
    | 'gossip_wildfire'       // 八卦野火
    | 'npc_runaway'           // NPC出走
    | 'mood_breakdown'        // 情绪崩溃
    | 'secret_alliance'       // 秘密同盟
    | 'power_shift'           // 权力更迭
    | 'reconciliation';       // 和解

// NPC 内驱力
export type NPCDesire =
    | { type: 'socialize'; targetNpcId: string }
    | { type: 'revenge'; targetNpcId: string }
    | { type: 'romance'; targetNpcId: string }
    | { type: 'leave_family' }
    | { type: 'recruit'; targetNpcId: string }
    | { type: 'gossip_about'; targetNpcId: string }
    | { type: 'start_rivalry'; targetNpcId: string };

// 角色叙事层
export interface CharNarrative {
    innerThought: string;      // 角色内心独白（100字内）
    dialogue: string;          // 角色说的话/场景描写（150字内）
    commentOnWorld: string;    // 对世界状态的吐槽（50字内）
    emotionalTone: 'vengeful' | 'romantic' | 'scheming' | 'chaotic' | 'peaceful' | 'amused' | 'anxious';
}

export type SimStoryKind = 'main_plot' | 'character_drama' | 'ambient' | 'system';
export type SimStoryAttachmentKind = 'image' | 'item' | 'fanfic' | 'evidence';
export type SimStoryAttachmentRarity = 'common' | 'rare' | 'epic';

export interface SimStoryAttachmentDraft {
    kind: SimStoryAttachmentKind;
    title: string;
    summary: string;
    detail?: string;
    visualPrompt?: string;
    rarity?: SimStoryAttachmentRarity;
}

export interface SimStoryAttachment {
    id: string;
    kind: SimStoryAttachmentKind;
    title: string;
    summary: string;
    detail?: string;
    imageUrl?: string;
    rarity?: SimStoryAttachmentRarity;
}

export interface SimAction {
    id: string;
    turnNumber: number;
    actor: string;       // 'user' | char.name
    actorAvatar: string; // char.avatar or '🧑'
    actorId: string;     // 'user' | char.id | 'system' | 'autonomous'
    type: SimActionType;
    description: string;      // 自然语言，CHAR们读这个
    immediateResult: string;  // 即时后果描述
    reasoning?: string;       // 角色内心独白（完整原文）
    reactionToUser?: string;  // 角色对玩家操作的评价
    narrative?: CharNarrative; // 角色叙事层（LLM回合使用）
    chainFromId?: string;     // 由哪个事件链引发
    storyKind?: SimStoryKind;
    headline?: string;
    involvedNpcIds?: string[];
    attachments?: SimStoryAttachment[];
    timestamp: number;
}

export interface SimPendingEffect {
    id: string;
    triggerTurn: number;
    npcId?: string;
    familyId?: string;
    description: string;
    effectCode: SimEffectCode;
    effectValue?: number;
    chainFrom?: string;        // 产生此效果的事件ID
    severity?: number;         // 1-5 严重程度
    involvedNpcIds?: string[]; // 涉及的NPC
}

export interface SimNPC {
    id: string;
    name: string;
    emoji: string;       // 角色头像 emoji（后续替换为像素头像seed）
    personality: string[]; // ["暴躁","善良","好奇"]
    mood: number;        // -100 ~ 100
    familyId: string | null; // null = 独立
    profession?: SimProfession; // 纯身份标签
    gold?: number;              // 财富指标
    // 人物故事系统
    gender?: SimGender;         // 性别（每局随机）
    bio?: string;               // 人物简介（1-2句）
    backstory?: string;         // 背景故事（2-3句）
    // 内驱力系统
    desires?: NPCDesire[];      // 当前欲望
    grudges?: string[];         // 记仇对象 NPC IDs
    crushes?: string[];         // 暗恋对象 NPC IDs
    // 向后兼容旧存档（迁移时删除）
    energy?: number;
    skills?: SimSkills;
    inventory?: Record<string, number>;
    currentActivity?: SimActivity;
    activityResult?: string;
}

export interface SimFamily {
    id: string;
    name: string;
    emoji: string;       // 家庭标志 emoji
    memberIds: string[];
    relationships: Record<string, Record<string, number>>; // npcId -> npcId -> [-100,100]
    homeX: number;       // 0-100 percent
    homeY: number;
}

// ── LifeSim 基础类型 ──────────────────────────────────────────

export type SimSeason = 'spring' | 'summer' | 'fall' | 'winter';
export type SimWeather = 'sunny' | 'cloudy' | 'rainy' | 'stormy' | 'snowy' | 'windy';
export type SimTimeOfDay = 'dawn' | 'morning' | 'afternoon' | 'evening' | 'night';
export type SimProfession = 'programmer' | 'designer' | 'finance' | 'influencer' | 'lawyer' | 'freelancer' | 'barista' | 'musician'
    | 'internet_troll' | 'fanfic_writer' | 'fan_artist' | 'college_student' | 'tired_worker' | 'old_fashioned' | 'fashion_designer';

export type SimGender = 'male' | 'female' | 'nonbinary';

// 保留但不再使用的旧类型（存档兼容）
export type SimActivity = 'farming' | 'mining' | 'fishing' | 'crafting' | 'socializing' | 'resting' | 'foraging' | 'trading';
export interface SimSkills { farming: number; mining: number; fishing: number; crafting: number; social: number; foraging: number; }
export interface SimBuilding { id: string; type: string; name: string; x: number; y: number; level: number; familyId?: string; }

export interface SimFestival {
    name: string;
    season: SimSeason;
    day: number;
    emoji: string;
    description: string;
    moodBonus: number;
    relBonus: number;
    chaosChange: number;
}

// 离线回顾事件
export interface OfflineRecapEvent {
    day: number;
    season: SimSeason;
    timeOfDay: SimTimeOfDay;
    headline: string;          // 戏剧性标题
    description: string;       // 事件描述
    involvedNpcs: { name: string; emoji: string }[];
    eventType: SimEventType | SimEffectCode;
    moodChanges?: Record<string, number>;   // npcId -> delta
    relChanges?: { a: string; b: string; delta: number }[];
    chaosChange?: number;
    narrativeQuote?: string;   // 离线模板旁白
}

export interface LifeSimState {
    id: string;
    createdAt: number;
    turnNumber: number;
    currentActorId: string; // 'user' | char.id — 当前谁的回合
    families: SimFamily[];
    npcs: SimNPC[];
    actionLog: SimAction[];  // 完整历史
    pendingEffects: SimPendingEffect[];
    chaosLevel: number;      // 0-100，乱度指数
    charQueue: string[];     // 待执行的CHAR id队列（用户结束后填入）
    replayPending: SimAction[]; // 用户回来后待回放的行动
    participantCharIds?: string[]; // 允许参与本局LifeSim的外部角色
    useIndependentApiConfig?: boolean;
    independentApiConfig?: Partial<APIConfig>;
    isProcessingCharTurn: boolean;
    gameOver: boolean;
    gameOverReason?: string;
    // 时间系统
    season?: SimSeason;
    day?: number;        // 1-28
    year?: number;
    timeOfDay?: SimTimeOfDay;
    weather?: SimWeather;
    lastFestival?: string;  // 上次触发的节日名
    // 离线模拟
    lastActiveTimestamp?: number; // 上次活跃时间
    offlineRecap?: OfflineRecapEvent[]; // 离线回顾数据
    // 旧字段（存档兼容，运行时忽略）
    buildings?: SimBuilding[];
    worldInventory?: Record<string, number>;
    worldGold?: number;
}

// =====================================================================
// --- VR WORLD ("彼方") TYPES ---
// 角色自主登入的虚拟世界。定时器驱动每个角色独立调用一次 LLM，在某个房间
// 完成一次活动，产出一张活动卡注入该角色的 1v1 聊天。
// =====================================================================

/** 虚拟世界里的房间。 */
export type VRRoomId = 'library' | 'music' | 'guestbook' | 'gym' | 'postoffice' | 'theater' | 'cafe';

/** 全局小说库里的一本书。 */
export interface VRWorldNovel {
    id: string;
    title: string;
    author?: string;
    summary?: string;
    segments: VRNovelSegment[];
    totalChars: number;
    createdAt: number;
    updatedAt: number;
}

/** 小说里的一个阅读单元。 */
export interface VRNovelSegment {
    idx: number;
    text: string;
    chars: number;
}

/** 一条批注。 */
export interface VRNovelAnnotation {
    id: string;
    novelId: string;
    segIdx: number;
    authorId: string;
    authorName: string;
    content: string;
    targetAnnotationId?: string;
    createdAt: number;
}

/** 角色在虚拟世界里的个人状态。 */
export interface VRWorldCharState {
    enabled: boolean;
    intervalMinutes: number;
    novelBookmarks?: Record<string, number>;
    currentRoom?: VRRoomId;
    lastActiveAt?: number;
    api?: { baseUrl: string; apiKey: string; model: string };
    chibi?: {
        img: string;
        state?: any;
        scale?: number;
        offsetY?: number;
        flip?: boolean;
    };
}

/** 注入聊天的 vr_card 消息的 metadata 结构。 */
export interface VRCardMeta {
    vrCard: true;
    room: VRRoomId;
    activity: string;
    novelId?: string;
    novelTitle?: string;
    segRange?: [number, number];
    annotationExcerpts?: string[];
    annotationRefs?: { segIdx: number; text: string }[];
    songLabel?: string;
    queuedLabel?: string;
    behavior?: string;
    boardPost?: string;
    boardPosts?: { content: string; replyToName?: string }[];
    boardReplyToName?: string;
    userBoardPost?: boolean;
    letterExcerpt?: string;
}

/** 邮局信件。 */
export interface VRLetterReply {
    pen: string;
    content: string;
    createdAt: number;
}

export interface VRLetter {
    id: string;
    box: 'outbox' | 'inbox';
    pen: string;
    content: string;
    createdAt: number;
    charId?: string;
    status?: 'queued' | 'sent' | 'archived' | 'sealed';
    remoteId?: string;
    released?: boolean;
    sentAt?: number;
    repliesReceived?: VRLetterReply[];
    reaction?: { content: string; createdAt: number };
    remoteLetterId?: string;
    replyStatus?: 'none' | 'queued' | 'sent';
    reply?: { charId: string; pen: string; content: string; createdAt: number; userNote?: string };
    fetchedAt?: number;
    likes?: number;
    dislikes?: number;
    views?: number;
    myVote?: 1 | -1 | 0;
}

/** 听歌房队列项。 */
export interface VRMusicQueueItem {
    song: CharPlaylistSong;
    charId: string;
    charName: string;
}

/** 留言簿共享状态。 */
export interface VRGuestbookMessage {
    id: string;
    authorId: string;
    authorName: string;
    content: string;
    replyToId?: string;
    replyToName?: string;
    isChar: boolean;
    charAvatar?: string;
    emoji?: string;
    attachments?: string[];
    createdAt: number;
}

export interface VRGuestbookState {
    messages: VRGuestbookMessage[];
    updatedAt: number;
}

/** 听歌房共享状态。 */
export interface VRMusicRoomState {
    song: CharPlaylistSong | null;
    queue: VRMusicQueueItem[];
    startTime: number;
    updatedAt: number;
}

/** 剧院·投稿剧本库。 */
export interface VRScript {
    id: string;
    title: string;
    setting: string;
    roles: string[];
    outline: string;
    contributorId: string;
    createdAt: number;
    updatedAt: number;
}

/** 剧院·历史舞台剧。 */
export interface VRStagedPlay {
    id: string;
    title: string;
    scriptId: string;
    directorId: string;
    cast: { actorCharId: string; roleName: string; avatarUrl?: string }[];
    performance: { actorCharId: string; roleName: string; line: string; stageDir?: string; emotion?: string }[];
    status: 'rehearsal' | 'performed' | 'archived';
    createdAt: number;
    performedAt?: number;
}

/** 捏脸系统自定义部件。 */
export interface CustomCreatorPart {
    id: string;
    categoryKey: string;
    label: string;
    transparentDataUrl: string;
    left?: number;
    top?: number;
    width?: number;
    height?: number;
    locked?: boolean;
    createdAt: number;
}

// 彼方设置单例：API + 调用记录
export interface VRApiCall {
    id: string;
    model: string;
    endpoint: string;
    tokens?: number;
    durationMs?: number;
    success: boolean;
    errorMsg?: string;
    timestamp: number;
}

// ============================================================================
// 暮色 2026-08-06：主动消息 2.0 类型（cherry-pick from 原作者 feat/amsg2-multitask-gate）
// 修前：之前 cherry-pick 了一整个 10 个类型的 block，但其中 ActiveMsg2GlobalConfig
//   跟暮色原版（D1 driver 详细版）重复声明——TS 用最后声明，原作者简化版会覆盖
//   暮色原版，丢 6 个字段（driver/databaseUrl/initSecret/tenantId/cronToken/...）
// 修后：删整块，只 cherry-pick 暮色原版缺的 6 个（ExpirePolicy/TaskSource/TaskStatus/
//   TaskRecord/ExpiredNoticeRecord/InboxMessage），不重复定义 GlobalConfig/CharacterConfig
// ============================================================================

/** 任务过期策略：到期让路 / 强制触发 */
export type ActiveMsg2ExpirePolicy = 'expire' | 'force';

/** 任务来源：用户排的 / 角色自己排的 */
export type ActiveMsg2TaskSource = 'user' | 'character';

/** 任务状态：待触发 / 已取消（取消后即从清单移除） */
export type ActiveMsg2TaskStatus = 'scheduled' | 'cancelled';

/** 单个主动消息任务记录 */
export interface ActiveMsg2TaskRecord {
  taskUuid: string;
  clientTaskId: string;
  mode: ActiveMsg2Mode;
  firstSendTime: string;
  nextSendAt?: string;
  recurrenceType: ActiveMsg2Recurrence;
  userMessage?: string;
  promptHint?: string;
  expirePolicy: ActiveMsg2ExpirePolicy;
  anchorLastUserMsgAt?: number;
  source: ActiveMsg2TaskSource;
  status: ActiveMsg2TaskStatus;
  createdAt: number;
  lastError?: string;
}

/** 任务"作废"回执记录：闸自动作废 / 用户手动取消 */
export interface Amsg2ExpiredNoticeRecord {
  id: string;
  charId: string;
  occurrenceMs: number;
  mode: ActiveMsg2Mode;
  promptHint?: string;
  recurrenceType: ActiveMsg2Recurrence;
  kind?: 'expired' | 'user-cancelled';
  notifiedAt?: number;
  createdAt: number;
}

/** 主动消息收件箱消息（从云端拉回来给前端展示） */
export interface ActiveMsg2InboxMessage {
  messageId: string;
  charId: string;
  charName: string;
  body: string;
  previewBody?: string;
  avatarUrl?: string;
  source?: string;
  messageType?: string;
  messageSubtype?: string;
  taskId?: string | null;
  taskUuid?: string | null;
  recurrenceType?: string | null;
  occurrenceMs?: number | null;
  metadata?: Record<string, any>;
  sentAt?: number;
  receivedAt: number;
  processAttempts?: number;
}

// ─── 剧情模式(Story Theater)类型 ─────────────────────
// 暮色 8-25:RP 模式是双人的,暮色 = 暮色,不需要"戴别的身份"
// 所以 Entry 里没有 mask 字段,只有一个角色

export interface StoryTheaterEntry {
    id: string;
    title: string;
    premise: string;            // 前提/世界观(用户最终选/写的)
    writingStyle?: string;      // 文风描述(暮色 8-25 第五步:中间页可改,buildRPSystemPrompt 注入)
    characterId: string;        // 当前对话角色(单人,不是 characterIds)
    writesToCharacterMemory: boolean;  // 退出时是否把摘要写回主记忆宫殿
    summary?: StorySessionSummary;     // 累积摘要(满 5 轮触发,合并式叙事体)
    /** 暮色 8-25 第五步+:老 generation,暮色 8-25 第二批:新 generationParams 4 字段,逻辑 fallback */
    generation?: { temperature: number; maxTokens: number };
    /** 暮色 8-25 第六步第一批:消息数(方案 A — 写时 +1,删 Entry 归零,老数据回填) */
    messageCount?: number;
    /** 暮色 8-25 第六步第一批:用哪套 RP API 配置(null = 主 apiConfig) */
    apiConfigId?: string;
    /** 暮色 8-25 第二批:A) 作者注释(Author's Note) — 用户随时可编辑,插入 system 后、recent 5 轮前 */
    authorNote?: string;
    /** 暮色 8-25 第二批:B) 状态栏定义 — 用户定义要追踪的变量(可增删),prompt 注入追踪指令,LLM 回复末尾 [状态] xxx=yyy 输出 */
    statusBarDefinitions?: StatusBarDefinition[];
    /** 暮色 8-25 第二批:C) 解锁提示词(Jailbreak) — 放在整段 prompt 最末尾 */
    jailbreakPrompt?: string;
    /** 暮色 8-26:角色指令 / RP System Prompt — 用户在中间页/session 弹窗里填的总行为指令
     *  buildRPSystemPrompt 注入到预留的 __RP_INJECTION_POINT__ 位置,空就不注入 */
    rpInstructions?: string;
    /** 暮色 8-25 第二批:D) 完整生成参数(temperature + maxTokens + topP + frequencyPenalty)— 老 generation fallback */
    generationParams?: {
        temperature: number;
        maxTokens: number;
        topP: number;
        frequencyPenalty: number;
        /** 暮色 8-25 第七批:加 presencePenalty(原版 5 字段之一) */
        presencePenalty: number;
    };
    /** 暮色 8-25 第七批:4 个叙事参数(选项卡片)— 不选(undefined)= 默认值,buildRPSystemPrompt 注入基础指令 */
    narrativePerson?: NarrativePerson;
    authorityLevel?: AuthorityLevel;
    lengthPreset?: LengthPreset;    // 篇幅预设(底层映射 generationParams.maxTokens)
    tensionLevel?: TensionLevel;
    createdAt: number;
    updatedAt: number;
}

/** 暮色 8-25 第二批:状态栏定义一项(暮色自定义要追踪的变量) */
export interface StatusBarDefinition {
    name: string;          // 变量名,如'好感度' / '信任' / '体力'
    initialValue: string;  // 初始值,如'50/100' / '高' / '未知'
}

/** 暮色 8-25 第七批:叙事参数 4 选项(暮色原版搬运,4 个单选类型) */
export type NarrativePerson = 'second' | 'third';   // 第二人称 / 第三人称
export type AuthorityLevel = 'none' | 'limited' | 'full';  // 执笔权 3 档
export type LengthPreset = 'short' | 'medium' | 'long';   // 篇幅 3 档(底层映射 maxTokens)
export type TensionLevel = 'natural' | 'warm' | 'intense';  // 场景张力 3 档

/**
 * 暮色 8-25 第六步第一批:RP 模式独立 API 配置
 *   - 默认走主 apiConfig(用户不指定)
 *   - 暮色可建多套(中转站/自建/不同模型)切换
 *   - 本步只实现 openai 协议的流式;claude/gemini 协议 fallback 非流式 + 提示
 *   - 3 协议独立 URL/Key/Model 字段照搬主 API 模式
 */
export interface RPApiConfig {
    id: string;
    name: string;                       // 'GPT-4o 中转' / 'Claude 备用' / 用户自命名
    baseUrl: string;
    apiKey: string;
    model: string;
    protocol: 'openai' | 'claude' | 'gemini';
    // 3 协议独立字段
    claudeBaseUrl?: string;
    claudeApiKey?: string;
    claudeModel?: string;
    geminiBaseUrl?: string;
    geminiApiKey?: string;
    geminiModel?: string;
    isDefault?: boolean;               // 标记"主聊天同款"(套壳主 apiConfig,不可删)
    createdAt: number;
    updatedAt: number;
}

/**
 * 剧情模式累积摘要(暮色 8-25 第三步)
 *   - narrative:第一人称叙事摘要(lightLLM 生成,新批会跟旧 narrative 用 lightLLM 合并成连贯叙事)
 *   - rawBatchCount:已摘要批数(每批 10 条 = 5 轮)
 *   - lastUpdatedAt:上次摘要时间
 * 不要结构化 JSON 数组(keyPlotPoints 等),叙事体对 LLM 拼上下文更自然。
 */
export interface StorySessionSummary {
    narrative: string;
    rawBatchCount: number;
    lastUpdatedAt: number;
}

/**
 * 剧情模式状态快照(暮色 8-25 第四步)
 *   - 每条 assistant 消息的 metadata 里存一份
 *   - 表层:角色当下表现(表情/动作) — 给"对方"看的
 *   - 底层:角色真实内心(真实情绪/想什么) — 隐藏,默认折叠
 *   - 字段都自由字符串(不做枚举),prompt 引导风格
 */
export interface StoryStatusSnapshot {
    surface: {
        emotion: string;    // 例:'心动' / '故作镇定' / '有点慌'
        action: string;     // 例:'微微低头' / '攥紧裙边' / '挤出一个笑'
    };
    deep: {
        realEmotion: string; // 例:'紧张' / '想靠近但不敢' / '其实很担心你'
        thought: string;    // 例:'该不该告诉他那件事'
    };
}

/**
 * 剧情场景模板(暮色 8-25 第五步)
 *   - 不直接带 premise(固定字符串),改成 premiseOptions 数组(3-5 个备选)
 *   - writingStyle:该场景的默认文风描述
 *   - allowCustomPremise:永远 true(显式声明,中间页有自定义输入框)
 *   - 点模板卡 → 进中间页(选前提/改文风) → 确认才建 Entry 进 session
 */
export interface StorySceneTemplate {
    id: string;
    name: string;
    emoji: string;
    description: string;          // 一句话简介,模板卡显示
    tags: string[];               // ['现代','日常','浪漫']
    premiseOptions: string[];     // 3-5 个备选前情提要
    writingStyle: string;         // 默认文风描述(一句话)
    allowCustomPremise: boolean;  // 永远 true,显式声明
    builtIn: boolean;             // true = 内置, false = 暮色自定义
    createdAt: number;
    updatedAt: number;
}

export interface StoryTheaterPreset {
    id: string;
    name: string;
    sourceFileName?: string;
    format: 'sullyos-story-preset';
    document: StoryTheaterPresetDocument;
    builtIn?: boolean;
    createdAt: number;
    updatedAt: number;
}

export interface StoryTheaterPresetDocument {
    schema: 'sullyos.story-preset';
    version: 1;
    name: string;
    description?: string;
    generation: {
        temperature: number;
        topP: number;
        frequencyPenalty: number;
        presencePenalty: number;
        maxTokens: number;
    };
    prompts: StoryTheaterPresetPrompt[];
    assistantPrefill?: string;
}

export interface StoryTheaterPresetPrompt {
    id: string;
    name: string;
    enabled: boolean;
    role: 'system' | 'user' | 'assistant';
    content: string;
    marker?: 'characters' | 'world_before' | 'user' | 'world_after' | 'scenario' | 'examples' | 'history';
}

/**
 * 暮色 8-26:RP 模式全局默认配置(剧情剧院齿轮 → API 设置 → 默认配置)
 *   - 改这里只影响"之后新建"的剧场
 *   - 已经建好的剧场不受影响(隔离)
 *   - 单独剧场在自己的中间页/session 弹窗改,跟全局互不干扰
 *   - 所有字段都可选,空 = 走主模型自身默认,不注入
 */
export interface RPGlobalDefaults {
    id: 'singleton';  // 永远只有一条记录,id 固定
    writingStyle?: string;                          // 文风描述(可填预设文本或手写)
    narrativePerson?: NarrativePerson;              // 人称默认
    authorityLevel?: AuthorityLevel;                // 执笔权默认
    lengthPreset?: LengthPreset;                    // 篇幅默认
    tensionLevel?: TensionLevel;                    // 场景张力默认
    rpInstructions?: string;                        // RP 总指令默认
    jailbreakPrompt?: string;                       // 解锁提示词默认
    authorNote?: string;                            // 作者注释默认(不写也行,这里留着)
    generationParams?: {                            // 生成参数 5 字段
        temperature: number;
        maxTokens: number;
        topP: number;
        frequencyPenalty: number;
        presencePenalty: number;
    };
    statusBarDefinitions?: StatusBarDefinition[];   // 状态栏定义默认
    /** 暮色 8-26 17:00:整个剧场的默认前提 — 新建剧场时填入,用户进中间页后可改/选备选前提覆盖 */
    defaultPremise?: string;
    /** 暮色 8-26:整个剧场的默认 API — 暮色不填 = 单剧场 ⚙ 弹窗里手动选;填了 = 新建剧场默认用这个
     *  暮色 8-26 扩展:支持 `__main__`(主聊天同款)、`__main_preset_${id}`(主 API 预设)、或 RP 独立 config id */
    apiConfigId?: string;
    updatedAt: number;
}
