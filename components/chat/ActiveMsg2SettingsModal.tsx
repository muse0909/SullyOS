import React, { useEffect, useMemo, useState } from 'react';
import Modal from '../os/Modal';
import {
  ActiveMsg2CharacterConfig,
  ActiveMsg2ExpirePolicy,
  Amsg2ExpiredNoticeRecord,
  ActiveMsg2Mode,
  ActiveMsg2Recurrence,
  ActiveMsg2TaskRecord,
  APIConfig,
  CharacterProfile,
  GroupProfile,
  Message,
  RealtimeConfig,
  UserProfile,
} from '../../types';
import { ActiveMsgClient, getDefaultActiveMsgFirstSendTime } from '../../utils/activeMsgClient';
import { ActiveMsgStore } from '../../utils/activeMsgStore';
// 麦麦 2026-10-03：设置页底部的折叠版本信息。LOADED_HOST 是「手机实际在连的域名」，
// 跟 BUILD_LABEL（网页代码从哪个分支构建的）必须对着看，详见 buildInfo.ts 的注释。
import { APP_VERSION, BUILD_LABEL, BUILD_TIME_LABEL, LOADED_HOST } from '../../utils/buildInfo';
import { type AmsgLastSkip, DEFAULT_MAX_UNANSWERED_SENDS, AMSG_LAST_SKIP_KEY, amsgStateNamespace, describeLastSkip } from '../../utils/amsgFirePack';
import { isInstantChatReady } from '../../utils/amsgInstantChat';
import { syncAmsgLlmCredentials } from '../../utils/amsgStateSync';
import { buildUserCancelledNotices } from '../../utils/amsg2TaskContext';
import { describeMissedOccurrence, matchSkipToMissed, scanMissedOccurrences, type MissedOccurrence } from '../../utils/amsg2DeferredScan';
import { runFallbackReconcile } from '../../utils/amsg2FallbackPair';
import {
  buildMissedSummary,
  isAfterDismissal,
  readDismissedAt,
  writeDismissedAt,
} from '../../utils/amsg2MissedSummary';
import { AMSG_FALLBACK_DELAY_MS } from '../../utils/amsg2Tasks';
import { amsgDiag } from '../../utils/amsgDiag';
import { trackEvent } from '../../utils/analytics';
import {
  applyRemoteTaskDelta,
  applyScheduledTask,
  currentOccurrenceMs,
  describeExpirePolicy,
  describeRecurrence,
  describeRemoteLastError,
  describeTaskMode,
  describeTaskProgress,
  EXPIRE_POLICY_OPTIONS,
  formatTaskTime,
  fromDatetimeLocalValue,
  isAmsg2EnabledForChar,
  isPendingTask,
  isRemoteMissingTask,
  keepUncancelledTasks,
  pruneFiredTasks,
  reconcileTasksWithRemote,
  resolveExpirePolicy,
  type RemoteTaskLastError,
  type RemoteTaskProjection,
  shortTaskId,
  toDatetimeLocalValue,
  visibleTasks,
} from '../../utils/amsg2Tasks';
// 麦麦 2026-09-24 13:48：诊断日志 viewer（从全局弹窗迁过来的）
import { AmsgDiagLogViewer } from '../settings/AmsgDiagLogViewer';

interface ActiveMsg2SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  char: CharacterProfile;
  apiConfig: APIConfig;
  userProfile: UserProfile;
  groups: GroupProfile[];
  realtimeConfig: RealtimeConfig;
  /**
   * 这个角色当前的聊天记录（Chat.tsx 那边已经在内存里的那份）。
   *
   * 面板要判「这次到点、本地算不算该响」就必须有它——判据是"到点前 10 分钟用户
   * 有没有说过话"，而"说过话"只存在于聊天记录里，面板自己再去数据库捞一份会跟
   * 屏幕上的对不上（聊天是刚发出去、还没落库的话，那份就少一条）。
   */
  messages: Message[];
  /**
   * 落盘任务清单与角色级设置。
   *
   * 传的是 updater 而不是整份 config：面板的每次保存都要先 await 网络请求，这期间角色
   * 可能在聊天里用工具排了新任务（写的是同一个 activeMsg2Config）。拿渲染时的旧快照整份
   * 盖回去会把它抹掉——远端照发、面板却看不见，就是各处都在防的幽灵任务。
   * updater 由 OSContext 的函数式 setState 执行，拿到的 prev 是最新排队后的状态。
   */
  onSave: (
    updater: (prev: ActiveMsg2CharacterConfig | undefined) => ActiveMsg2CharacterConfig,
  ) => void;
  addToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

// 麦麦 2026-10-03（暮色拍板）：第四选项「角色自设」删掉。
//
//   它是 2026-09-18 加的 `disabled: true` 占位项——永远点不亮，只为让用户知道
//   「角色也能自己排任务」这件事。一个选不了的选项占掉四分之一的格子，信息价值
//   抵不上占位，暮色原话「把多余的去掉」。
//
//   信息没丢，两处都还在：
//     1. 「新建任务」按钮下面那行字（本次新加）——建任务时看得到；
//     2. 任务列表每行的来源标注（`t.source === 'character' ? '角色自设'`）——
//        角色排的那些照样列出来、照样标着「角色自设」。
//
//   ⚠️ 别再把这个选项加回来。角色自排走 schedule_next_wakeup → mode='prompted'
//   + source='character'，手动建任务会跟已存在的 character 任务产生归属歧义
//   （标记/计费/防穿帮闸的语义都不一样）。
const MODE_OPTIONS = [
  { id: 'fixed', label: '固定', desc: '闹钟模式，不调用模型，到点直接发写好的内容' },
  { id: 'auto', label: '自动', desc: '用当前角色设定和聊天快照生成。调用模型。' },
  { id: 'prompted', label: '提示词', desc: '围绕提前写好的提示词方向生成主动消息。调用模型。' },
] as const;

const RECURRENCE_OPTIONS = [
  { id: 'none', label: '一次' },
  { id: 'daily', label: '每天' },
  { id: 'weekly', label: '每周' },
] as const;

// 暮色 2026-09-18 12:59：首次发送时间的快捷预设 — 点 chip 直接设成「距现在 +N 分钟/小时」。
//   这些是「首次触发」绝对时刻的快捷，**不**影响 repeat 间隔（amsg-server 库对循环间隔
//   还是只支持 daily/weekly，循环的 X 小时版本来不及做；首次时间不受这个限制）。
const FIRST_SEND_PRESETS = [
  { label: '2 分钟后', offsetMs: 2 * 60_000 },
  { label: '10 分钟后', offsetMs: 10 * 60_000 },
  { label: '30 分钟后', offsetMs: 30 * 60_000 },
  { label: '1 小时后', offsetMs: 60 * 60_000 },
] as const;

const ActiveMsg2SettingsModal: React.FC<ActiveMsg2SettingsModalProps> = ({
  isOpen,
  onClose,
  char,
  messages,
  apiConfig,
  userProfile,
  groups,
  realtimeConfig,
  onSave,
  addToast,
}) => {
  const saved = char.activeMsg2Config;
  // 兜底（麦麦 2026-09-30）是系统替「强制发送」补的后路，不列给用户看：用户没排过它，
  // 面板里冒出一条自己没建过的重复任务只会让人以为系统出错。
  // 底下这一份保持完整——关 2.0 时要把它一并取消掉（远端拉清单失败时的兜底路径靠它）。
  const allTasks = saved?.tasks ?? [];
  const tasks = visibleTasks(allTasks);
  // 任务列表的判定基准时刻：一次 render 只取一次，同屏卡片不会踩在不同的时刻上。
  const now = Date.now();

  // 开关初值走和工具注入门同一个判定：面板显示「关」而角色其实还能排程，界面就在骗人。
  const [enabled, setEnabled] = useState(() => isAmsg2EnabledForChar(char));
  // 即时对话按角色单独关：undefined = 跟随全局默认开，所以只有显式 false 才显示成关。
  const [instantChatOn, setInstantChatOn] = useState(saved?.instantChatEnabled !== false);
  // 全局那道门开没开（isInstantChatReady 读回来的）。没开时下面那行开关置灰。
  const [globalInstantChatOn, setGlobalInstantChatOn] = useState(false);
  const [mode, setMode] = useState<ActiveMsg2Mode>('auto');
  const [firstSendTime, setFirstSendTime] = useState(getDefaultActiveMsgFirstSendTime());
  const [recurrenceType, setRecurrenceType] = useState<ActiveMsg2Recurrence>('none');
  const [userMessage, setUserMessage] = useState('');
  const [promptHint, setPromptHint] = useState('');
  const [maxTokens, setMaxTokens] = useState(String(saved?.maxTokens ?? ''));
  // '' = 没设（用默认值）；'0' = 不限；其余 1-10。
  const [maxUnanswered, setMaxUnanswered] = useState(
    saved?.maxUnansweredSends === undefined ? '' : String(saved.maxUnansweredSends),
  );
  const [useSecondaryApi, setUseSecondaryApi] = useState(saved?.useSecondaryApi ?? false);
  const [secUrl, setSecUrl] = useState(saved?.secondaryApi?.baseUrl ?? '');
  const [secKey, setSecKey] = useState(saved?.secondaryApi?.apiKey ?? '');
  const [secModel, setSecModel] = useState(saved?.secondaryApi?.model ?? '');
  const [globalReady, setGlobalReady] = useState(false);
  const [pushSummary, setPushSummary] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  // editingTaskUuid=null → 新建；非 null → 编辑该任务（保存时 replaceTaskUuid）。
  const [editingTaskUuid, setEditingTaskUuid] = useState<string | null>(null);
  // expandedTaskUuid=null → 行折叠；非 null → 该任务行展开完整详情。
  //   跟 editing 是独立两状态：expanded 只显示完整信息（不可改），editing 把任务灌进表单。
  //   暮色 2026-09-18 12:42：列表只看一行根本看不出实际设置（reason/promptHint 都截断），
  //   点 row 展开内联详情比弹窗顺。
  const [expandedTaskUuid, setExpandedTaskUuid] = useState<string | null>(null);
  // 麦麦 2026-09-30：正在编辑兜底内容的那条主任务 uuid。兜底内容是建任务时冻进
  // 加密 payload 的，云端没有改内容的接口（只有 schedule/cancel/list），所以改它
  // 走「取消旧兜底 + 按原时刻重建」——见 ActiveMsgClient.updateFallbackTaskText。
  const [editingFallbackFor, setEditingFallbackFor] = useState<string | null>(null);
  const [fallbackDraft, setFallbackDraft] = useState('');
  const [savingFallbackUuid, setSavingFallbackUuid] = useState<string | null>(null);
  // 麦麦 2026-09-24 13:48：诊断日志 viewer 开关（从全局弹窗迁过来的唯一入口）
  const [diagLogOpen, setDiagLogOpen] = useState(false);
  const [expirePolicy, setExpirePolicy] = useState<ActiveMsg2ExpirePolicy>('expire');
  // 远端对账底账：打开面板时拉一次全量任务，只留归属本角色的 uuid。null = 没对上账
  // （读失败/未拉完），此时不显示「远端不存在」徽标，免得半个清单误伤。
  // 之后不重拉，靠 applyRemoteTaskDelta 把每次远端操作的结果记进来（见 amsg2Tasks 注释）。
  const [knownRemoteUuids, setKnownRemoteUuids] = useState<Set<string> | null>(null);
  // 远端任务的 status / lastError 投影（对账那次一起拉的）。null = 没拉到，卡片上
  // 不显示失败说明。这份只在打开面板时取一次，不随 delta 维护——取消/重建后任务
  // 换了 uuid，旧条目自然失配，不会串行。
  const [remoteTaskInfo, setRemoteTaskInfo] = useState<Map<string, {
    status?: string;
    lastError: RemoteTaskLastError | null;
  }> | null>(null);
  // 防穿帮闸最近一次跳过的记录（worker 写的）。null = 没有记录 / 没读到。
  const [lastSkip, setLastSkip] = useState<AmsgLastSkip | null>(null);

  // 「到点了却什么都没来」——面板上每条任务都要能说清这次为什么没响。
  // 扫的是全部任务（含兜底）：兜底恒定无条件推，它没响同样是问题。
  //
  // 放在 lastSkip 之后是必须的：上面那两个 memo 要读它，写在前面就是 TDZ ——
  // 这个项目 2026-07-31 被同一个坑炸过一次（useEffect 放错位置导致聊天页崩）。
  const missedByTask = useMemo(() => {
    const map = new Map<string, MissedOccurrence[]>();
    for (const m of scanMissedOccurrences({ tasks: allTasks, messages, nowMs: now })) {
      const list = map.get(m.task.taskUuid);
      if (list) list.push(m);
      else map.set(m.task.taskUuid, [m]);
    }
    return map;
  }, [allTasks, messages, now]);
  // 每个 taskUuid 记它最近那次没响对应的云端记录（对不上就是 null = 云端没记原因）。
  // last_skip 只留最近一条，所以这里只对得上一次；更早的那些统一显示"云端没记原因"。
  const missedSkip = useMemo(() => {
    const map = new Map<string, AmsgLastSkip | null>();
    for (const [uuid, list] of missedByTask) {
      map.set(uuid, list.length ? matchSkipToMissed(lastSkip, list[0]) : null);
    }
    return map;
  }, [missedByTask, lastSkip]);

  // 表单值重置：面板打开或切换编辑对象时，用被编辑任务的字段填表单（新建则填默认值）。
  // 角色级共享设置（maxTokens / 单独 API）始终跟随保存值。
  useEffect(() => {
    if (!isOpen) return;

    const config = char.activeMsg2Config;
    const list = config?.tasks ?? [];
    // 跟 useState 初值同一个判定：这里自己写三元的话，面板显示的开关状态就会跟
    // 工具注入门分家（见 isAmsg2EnabledForChar 的注释）。
    setEnabled(isAmsg2EnabledForChar(char));
    setInstantChatOn(config?.instantChatEnabled !== false);
    setMaxTokens(config?.maxTokens ? String(config.maxTokens) : '');
    setMaxUnanswered(config?.maxUnansweredSends === undefined ? '' : String(config.maxUnansweredSends));
    setUseSecondaryApi(config?.useSecondaryApi ?? false);
    setSecUrl(config?.secondaryApi?.baseUrl ?? '');
    setSecKey(config?.secondaryApi?.apiKey ?? '');
    setSecModel(config?.secondaryApi?.model ?? '');

    const editing = editingTaskUuid ? list.find((t) => t.taskUuid === editingTaskUuid) : undefined;
    if (editing) {
      setMode(editing.mode);
      setFirstSendTime(toDatetimeLocalValue(editing.firstSendTime));
      setRecurrenceType(editing.recurrenceType);
      setUserMessage(editing.userMessage ?? '');
      setPromptHint(editing.promptHint ?? '');
      setExpirePolicy(resolveExpirePolicy(editing.mode, editing.expirePolicy));
    } else {
      setMode('auto');
      setFirstSendTime(getDefaultActiveMsgFirstSendTime());
      setRecurrenceType('none');
      setUserMessage('');
      setPromptHint('');
      setExpirePolicy('expire');
    }
  }, [isOpen, char.id, char.activeMsg2Config, editingTaskUuid]);

  // 打开面板时的 push 状态检查 + 远端对账（只随 isOpen / 角色变化跑，不随编辑对象重复请求）。
  useEffect(() => {
    if (!isOpen) return;
    setKnownRemoteUuids(null);
    setRemoteTaskInfo(null);

    // 全局即时对话开没开（现成的读取函数，别自己另读存储）。读失败按没开置灰。
    void isInstantChatReady().then(setGlobalInstantChatOn).catch(() => setGlobalInstantChatOn(false));

    void (async () => {
      const globalConfig = await ActiveMsgClient.getGlobalConfig();
      const pushStatus = await ActiveMsgClient.getPushStatus();
      setGlobalReady(Boolean(globalConfig.workerUrl));
      setPushSummary(pushStatus.supported
        ? `权限：${pushStatus.permission} / 订阅：${pushStatus.hasSubscription ? '已就绪' : '未创建'}`
        : '当前环境不支持 Web Push');
    })();

    // 防穿帮闸最近拦下了哪次触发。闸是静默的，不说一声的话「让路了」在用户看来
    // 跟「没发出去」一模一样。
    // 兜底对账紧跟着它跑：主任务是不是被云端那道「连续几声没回」停了，只有这条
    // 记录说得出来。放在同一个块里是因为要等它读完才能判，而单独开一个 effect
    // 就得多存一份"读没读完"的状态。
    void (async () => {
      const skip = await ActiveMsgClient.readLastSkip(char.id);
      setLastSkip(skip);
      // 作废台账一起拉：它是「最近没响的」那张卡另一半的素材（见 missedSummary）。
      // 读失败不挡面板——云端那条照样能显示，只是少了几行。
      try {
        setExpiredNotices(await ActiveMsgStore.getExpiredNotices(char.id));
      } catch (e) {
        console.warn('[ActiveMsg2Modal] 读作废台账失败', e);
      }
      setDismissedAt(readDismissedAt(char.id));
      await reconcileFallbacks(skip);
    })();

    void (async () => {
      let remote: Set<string>;
      let remoteTasks: RemoteTaskProjection[];
      try {
        // 全量投影一次拉齐：uuid 当对账底账，status / lastError 给任务卡片说明
        // 「上次到点为什么没发出去」，nextSendAt 给循环任务显示真正会响的时刻。
        remoteTasks = await ActiveMsgClient.listRemoteTasksForChar(char.id);
        remote = new Set(remoteTasks.map((t) => t.uuid));
        setRemoteTaskInfo(new Map(remoteTasks.map((t) => [
          t.uuid, { status: t.status, lastError: t.lastError },
        ])));
      } catch {
        // 对账失败不打扰：null 让「远端不存在」徽标整体不显示，也不清任何任务。
        setKnownRemoteUuids(null);
        return;
      }
      setKnownRemoteUuids(remote);

      // 对账两个方向都走：把已经走完的一次性任务清出列表（不然发过的任务会一直堆在
      // 这儿，得手动一条条取消），同时把远端有、本地没有的接回来——角色自排的任务是
      // 随 push 认领的，那条 push 推失败或被防穿帮闸吞掉，本地就永远不知道它存在，
      // 而它照常到点触发。先拿渲染时这份探一下有没有变化，避免每次开面板都写一次库。
      // 真正落盘时在 updater 里用最新的 prev 重算——面板保存要 await 网络请求，
      // 这期间角色可能在聊天里用工具排了新任务。
      const settle = (tasks: ActiveMsg2TaskRecord[]) =>
        pruneFiredTasks(reconcileTasksWithRemote(tasks, remoteTasks), remote, Date.now());
      const current = char.activeMsg2Config?.tasks ?? [];
      const settled = settle(current);
      const changed = settled.length !== current.length
        || settled.some((t, i) => t !== current[i]);
      if (changed) {
        onSave((prev) => ({
          ...(prev ?? {
            enabled: true,
            mode: 'auto' as ActiveMsg2Mode,
            firstSendTime: getDefaultActiveMsgFirstSendTime(),
            recurrenceType: 'none' as ActiveMsg2Recurrence,
          }),
          tasks: settle(prev?.tasks ?? []),
        }));
      }
    })();
    // char.activeMsg2Config 只在函数体里读当前值当探针，不进依赖——清理落盘会改它，
    // 进了依赖就是「清理 → 重跑 → 再清理」的自激循环。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, char.id]);

  /**
   * 拼一份要落盘的 config：
   *   - 角色级共享设置（enabled / maxTokens / 单独 API）以面板表单为准——只有面板编辑它们；
   *   - 任务清单以「落盘那一刻的最新清单」为准，面板只通过 tasksOf 声明自己动了哪一条。
   * 别把渲染时的 tasks 整份传下去，原因见 onSave 的注释。
   */
  const buildConfig = (
    prev: ActiveMsg2CharacterConfig | undefined,
    tasksOf: (prevTasks: ActiveMsg2TaskRecord[]) => ActiveMsg2TaskRecord[],
    extra?: Partial<ActiveMsg2CharacterConfig>,
  ): ActiveMsg2CharacterConfig => ({
    enabled: true,
    mode,
    firstSendTime,
    recurrenceType,
    tasks: tasksOf(prev?.tasks ?? []),
    // 开着就存 undefined（= 跟随全局默认开），只有显式关掉才落 false。
    instantChatEnabled: instantChatOn ? undefined : false,
    maxTokens: maxTokens.trim() ? Number(maxTokens) : undefined,
    maxUnansweredSends: maxUnanswered === '' ? undefined : Number(maxUnanswered),
    useSecondaryApi: useSecondaryApi && !!secUrl,
    secondaryApi: useSecondaryApi && secUrl
      ? { baseUrl: secUrl.trim(), apiKey: secKey.trim(), model: secModel.trim() }
      : undefined,
    lastSyncedAt: prev?.lastSyncedAt,
    ...extra,
  });

  /**
   * 拨开关本身就算一次保存。
   *
   * 这是设置弹窗，用户拨完开关就认为已经生效了。只改 React state 不写库的话，角色的
   * activeMsg2Config 还是空的（= 关）：聊天里不注入排程工具、fire_pack 的
   * selfScheduleEnabled 上传 false、重开面板开关又显示成「关」，全程一句提示都没有。
   *
   * 只有「开」这一侧就地落盘。「关」要走底部那颗「关闭 2.0」按钮：关掉的同时得把该
   * 角色在远端的任务全部取消，这里就地写一个 enabled:false，远端任务没人管，会变成
   * 面板看不见却照样到点触发的幽灵任务。
   */
  const handleToggleEnabled = () => {
    const turningOn = !enabled;
    setEnabled(!enabled);
    // 顺手把面板上其它角色级设置（maxTokens / 连发上限 / 单独 API）一起带上，与
    // buildConfig 的口径一致：这几项本来就只有面板会写。
    if (turningOn) {
      onSave((prev) => buildConfig(prev, (list) => list));
      // 开关保存时对一次账：开着的角色不该留着孤儿兜底，也该给缺后路的强制发送
      // 补上。（走"关闭 2.0"关掉的那一侧不用在这里补——那条路已经把远端任务连
      // 兜底一起取消了，本地清单是空的，这里自然是个空计划。）
      void reconcileFallbacks(lastSkip);
    }
  };

  /**
   * 兜底对账（麦麦 2026-10-01 step 7）。
   *
   * 兜底是独立的一条云端任务，跟主任务各活各的，所以有两条断链没人管：
   *   - 用户手动取消了主任务 → 兜底还在，到点照响（用户以为全取消了）
   *   - 主任务被云端那道「连续几声没回」停了 → 兜底照响（用户根本没取消过）
   * 另一半是建兜底失败之后没人重试，主任务从此没有后路。
   *
   * **计划为空时一次网络请求都不发**（planFallbackReconcile 内部短路），所以每次
   * 开面板都跑一遍没有代价，兜底真出了问题下一轮就自己对上。
   *
   * 落盘走 onSave → OSContext.updateCharacter，跟取消/新建任务同一条路：那边落库成功
   * 后会打脏 amsg2 快照，fire_pack 里的排程清单不会还留着已经取消的兜底。
   */
  const reconcileFallbacks = async (skipForPlan: AmsgLastSkip | null) => {
    if (!globalReady) return;
    try {
      const result = await runFallbackReconcile({
        char,
        delayMs: AMSG_FALLBACK_DELAY_MS,
        schedule: async ({ mainTask: t, nextOccurrenceMs }) => {
          const built = await ActiveMsgClient.scheduleFallbackTask({
            char,
            config: char.activeMsg2Config!,
            forClientTaskId: t.clientTaskId,
            forSource: t.source,
            mainOccurrenceMs: nextOccurrenceMs,
            mainMode: t.mode,
            // 落盘的任务记录里没有 reason 字段（那是建任务入参，worker 专用 metadata），
            // 提示方向统一走 promptHint；固定模式取原文。见 activeMsgRuntime 同款调用。
            mainHintOrReason: t.promptHint,
            mainUserMessage: t.userMessage,
            mainRecurrence: t.recurrenceType,
            userProfile, groups, realtimeConfig, apiConfig,
            enabledOverride: char.activeMsg2Config?.enabled === true,
          });
          return built?.record ?? null;
        },
        cancelRemote: async (uuid) => { await ActiveMsgClient.cancelTask(uuid); },
        persist: async (mutate) => {
          onSave((prev) => buildConfig(prev, mutate, { lastSyncedAt: Date.now() }));
        },
        diag: (extra) => amsgDiag({ stage: 'fallback-reconciled', charId: char.id, extra }),
        lastSkip: skipForPlan,
      });
      // 只在真的动了手才打扰用户：建兜底是系统行为不该刷屏，取消失败必须让他知道。
      if (result.rebuilt > 0) {
        // 麦麦 2026-10-03：原来这里写死「强制发送」。标签当天已经换成「你在忙就晚点提」
        //   了，提示里还冒旧名字，用户会以为是另一种任务。策略名一律走 describeExpirePolicy，
        //   别再在这手写一份。
        addToast(`已给 ${result.rebuilt} 条「${describeExpirePolicy('force')}」任务补上 30 分钟后的兜底。`, 'success');
      }
      if (result.failed.length > 0) {
        addToast(`有 ${result.failed.length} 条兜底在远端取消失败（主任务已经不在了），请稍后重开面板重试。`, 'error');
      }
    } catch (e) {
      // 对账失败绝不能挡住面板：它只是"把状态拉齐"，不是这次操作本身。
      console.warn('[ActiveMsg2Modal] 兜底对账失败', e);
    }
  };

  /**
   * 即时对话开关也是拨了就落盘（跟上面同一习惯）。它没有远端任务要清，关掉只影响
   * 之后每一轮的路由，所以开关两个方向都能就地保存。注意不能走 buildConfig：那份会
   * 把 enabled 钉成 true，而即时对话和排程是互相独立的两个开关，不能顺手把排程也打开。
   */
  const handleToggleInstantChat = () => {
    const next = !instantChatOn;
    // 全局那个开关有自己的事件，这里单独记：想知道「按角色区分」这件事有没有人真的用。
    trackEvent('切换角色的即时对话', { action: next ? '开' : '关' });
    setInstantChatOn(next);
    onSave((prev) => ({
      ...(prev ?? {
        enabled: false,
        mode: 'auto' as ActiveMsg2Mode,
        firstSendTime: getDefaultActiveMsgFirstSendTime(),
        recurrenceType: 'none' as ActiveMsg2Recurrence,
      }),
      // 开着存 undefined（= 跟随全局默认开），只有显式关掉才落 false。
      instantChatEnabled: next ? undefined : false,
    }));
  };

  /**
   * 给角色留一句「这几条被人工取消了」。
   *
   * 聊天历史里那句「明早八点叫你～」是角色自己许的承诺，任务在面板里被删掉之后它并不
   * 知道——下次聊天照旧说「放心我叫你」。所以取消也写进作废回执台账（按 id 幂等），
   * 下一轮的排程现状块会把它读出来告诉角色。写失败不打断取消本身：任务确实已经没了。
   */
  const writeCancelledNotices = async (cancelled: ActiveMsg2TaskRecord[]) => {
    const notices = buildUserCancelledNotices(char.id, cancelled, Date.now());
    if (!notices.length) return;
    try {
      await ActiveMsgStore.upsertExpiredNotices(char.id, notices);
    } catch (e) {
      console.warn('[ActiveMsg2Modal] 取消回执写入失败（角色可能还以为约定有效）', e);
    }
  };

  const handleCancelTask = async (t: ActiveMsg2TaskRecord) => {
    // alreadyGone = 远端本来就没有这一条（一次性任务发完就删行）。这也是取消成功，
    // 只是文案上说清楚，免得用户以为自己刚刚拦下了一条还没发的消息。
    let alreadyGone = false;
    try {
      ({ alreadyGone } = await ActiveMsgClient.cancelTask(t.taskUuid));
    } catch (e) {
      // 远端取消失败不移除本地记录（Codex #4）——否则远端照发、面板却看不见了。
      console.warn('[ActiveMsg2Modal] 远端取消失败（保留记录待重试）', e);
      onSave((prev) => buildConfig(prev, (list) =>
        list.map((x) => x.taskUuid === t.taskUuid ? { ...x, lastError: '远端取消失败，可重试' } : x)));
      addToast(`任务 [${shortTaskId(t.taskUuid)}] 取消失败（远端未确认），稍后重试。`, 'error');
      // 排程有埋点、取消没有的话，任务生命周期只记了一半。三个结果各有各的含义：
      // failed = 远端照发但面板以为拦下了，是对账不平里最难受的一种。
      trackEvent('取消定时消息', { result: 'failed' });
      return;
    }
    if (editingTaskUuid === t.taskUuid) setEditingTaskUuid(null);
    await writeCancelledNotices([t]);
    setKnownRemoteUuids((prev) => applyRemoteTaskDelta(prev, { gone: [t.taskUuid] }));
    // 落盘走 onSave → OSContext.updateCharacter，那里在落库成功后会给 amsg2 云端快照
    // 打脏（markAmsgStateDirty）——fire_pack 里角色能看到的排程清单因此不会还留着这条
    // 已取消的任务。别在这里用渲染时的 char 快照自己打脏：它的清单还是旧的。
    onSave((prev) => buildConfig(
      prev,
      (list) => list.filter((x) => x.taskUuid !== t.taskUuid),
      { lastSyncedAt: Date.now() },
    ));
    addToast(alreadyGone
      ? `任务 [${shortTaskId(t.taskUuid)}] 在远端已不存在（多半已经发过了），已从列表移除。`
      : `任务 [${shortTaskId(t.taskUuid)}] 已取消。`, 'info');
    trackEvent('取消定时消息', { result: alreadyGone ? '远端已不存在' : 'ok' });
  };

  // 兜底内容改了要同步到云端那条 —— 改的是"30 分钟后推过来的那句话"，不是本地显示。
  // 时刻和循环由 updateFallbackTaskText 原样带走，动的不该是这两样。
  const handleSaveFallbackText = async (mainTask: ActiveMsg2TaskRecord, fb: ActiveMsg2TaskRecord) => {
    const text = fallbackDraft.trim();
    if (!text) { addToast('兜底内容不能为空。', 'error'); return; }
    if (text === (fb.userMessage || '').trim()) { setEditingFallbackFor(null); return; }
    setSavingFallbackUuid(fb.taskUuid);
    try {
      const config = buildConfig(saved, () => allTasks);
      const { record } = await ActiveMsgClient.updateFallbackTaskText({
        char, config, fallback: fb, newText: text,
        userProfile, groups, realtimeConfig, apiConfig,
        enabledOverride: enabled,
      });
      onSave((prev) => buildConfig(
        prev,
        // 整条换掉：uuid / clientTaskId / 时刻都变了，只改内容字段会留下一条指向
        // 已取消任务的记录，第 5 步按 uuid 取消时取消的是那个不存在的旧号。
        (list) => list.map((t) => (t.taskUuid === fb.taskUuid ? record : t)),
        { lastSyncedAt: Date.now() },
      ));
      setKnownRemoteUuids((prev) => applyRemoteTaskDelta(prev, {
        present: [record.taskUuid], gone: [fb.taskUuid],
      }));
      setEditingFallbackFor(null);
      addToast('兜底内容已改，云端那条也换了。', 'success');
    } catch (error) {
      // 取消成功、重建失败的话旧那条已经没了：这条要让用户知道，否则兜底就此消失。
      addToast(`改兜底失败：${error instanceof Error ? error.message : String(error)}`, 'error');
    } finally {
      setSavingFallbackUuid(null);
    }
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      if (!enabled) {
        // 关闭 2.0 = 取消该角色全部远端任务（远端清单优先的口径见 cancelAllTasksForChar，
        // 与删角色共用一份）。取消失败的保留在本地清单里，下次重开面板可重试。
        // 用 allTasks 而不是给人看的 tasks：兜底用户没建过，但关 2.0 就该跟着一起没，
        // 不然远端清单那次拉取失败时它会留在云端继续响（麦麦 2026-09-30）。
        const { targets, failed } = await ActiveMsgClient.cancelAllTasksForChar(
          char.id,
          allTasks.map((t) => t.taskUuid),
        );
        const attempted = new Set(targets);
        // 真被取消掉的那些（试过且没失败）要给角色一句交代，否则关掉 2.0 之后它还挂着
        // 一堆没人会兑现的承诺。留在清单里的（取消失败 / 期间新出现的）不写——它们还会响。
        await writeCancelledNotices(tasks.filter((t) =>
          attempted.has(t.taskUuid) && !failed.has(t.taskUuid)));
        onSave((prev) => buildConfig(
          prev,
          (list) => keepUncancelledTasks(list, attempted, failed, {
            failed: '关闭时远端取消失败，可重试',
            appeared: '关闭主动消息时新出现，未被取消，请单独处理',
          }),
          { enabled: false, lastSyncedAt: Date.now() },
        ));
        addToast(failed.size
          ? `主动消息 2.0 已关闭，但有 ${failed.size} 个任务远端取消失败，请稍后重开面板重试。`
          : '主动消息 2.0 已关闭，全部任务已取消。', failed.size ? 'error' : 'info');
        onClose();
        return;
      }

      if (!globalReady) throw new Error('请先去系统设置里完成“主动消息 2.0”的全局配置。');

      // 时间框里的是用户桌上的钟，先折成绝对时刻再往下传。裸墙钟交出去的话，排程接口
      // 会按角色时区解释它（那条规则是给角色自己排程用的），角色一开自定义时区就差一个
      // 时差。落盘也存这一份，面板显示与远端对账因此认的是同一个时刻。
      const firstSendAt = fromDatetimeLocalValue(firstSendTime);

      // 传给排程接口的这份只用来读角色级设置（封顶校验 / 副 API），不参与落盘。
      const config = buildConfig(saved, () => tasks);
      const result = await ActiveMsgClient.scheduleCharacterTask({
        char, config,
        task: {
          mode, firstSendTime: firstSendAt, recurrenceType,
          promptHint: promptHint.trim() || undefined,
          userMessage: userMessage.trim() || undefined,
          expirePolicy,
        },
        replaceTaskUuid: editingTaskUuid ?? undefined,
        userProfile, groups, realtimeConfig, apiConfig,
        // 麦麦 2026-09-24：把当前面板开关传给排程接口做客户端闸。上面 `if (!enabled)` 的分支
        // 走到 onClose 已经 return 了，这里 enabled 一定是 true；显式传是给 scheduleCharacterTask
        // 一个稳定的判断口径，不让它再去翻 buildConfig 算 enabled（那里把 enabled 钉 true）。
        enabledOverride: enabled,
      });

      const record: ActiveMsg2TaskRecord = {
        taskUuid: result.uuid,
        clientTaskId: result.clientTaskId,
        mode, firstSendTime: result.firstSendAt, recurrenceType,
        promptHint: promptHint.trim() || undefined,
        userMessage: userMessage.trim() || undefined,
        expirePolicy: resolveExpirePolicy(mode, expirePolicy),
        source: 'user',
        status: 'scheduled',
        createdAt: Date.now(),
      };
      onSave((prev) => buildConfig(
        prev,
        // 并清单的规则（含替换失败时保留旧记录）与角色工具路径共用 applyScheduledTask。
        // 兜底（麦麦 2026-09-30）跟主任务**同一次**落账：拆成两次写会跟面板自己的
        // setTasks 抢先后——面板拿的是渲染时的旧 tasks，晚一步的那次会把先写进去的兜底盖掉，
        // 本地清单就此少一条兜底，第 5 步再也取消不掉它。
        (list) => {
          const merged = applyScheduledTask(list, record, {
            replaceTaskUuid: editingTaskUuid ?? undefined,
            replacedCancelFailed: result.replacedCancelFailed,
          }, Date.now());
          return result.fallback
            ? applyScheduledTask(merged, result.fallback.record, {}, Date.now())
            : merged;
        },
        { lastSyncedAt: Date.now() },
      ));
      // 排程接口回了 success = 这条在远端确实存在，记进底账，别让它被当成「远端不存在」。
      // 编辑时旧任务已被取消才出账；取消失败的话远端新旧并存，旧 uuid 要留着。
      setKnownRemoteUuids((prev) => applyRemoteTaskDelta(prev, {
        present: [result.uuid],
        gone: editingTaskUuid && !result.replacedCancelFailed ? [editingTaskUuid] : [],
      }));
      // 只报枚举构成，内容、时间、编号一概不带。mode/recurrence 虽有 TS 类型，但编辑路径
      // 是从持久化任务记录读回来的（导入的备份可携带任意字符串），上报前运行时收敛一遍。
      trackEvent('排程定时消息', {
        mode: mode === 'fixed' || mode === 'prompted' ? mode : 'auto',
        recurrence: recurrenceType === 'daily' || recurrenceType === 'weekly' ? recurrenceType : 'none',
        source: 'user',
        isEdit: editingTaskUuid ? 'yes' : 'no',
      });
      setEditingTaskUuid(null);
      // 编辑走的是「先建新的再取消旧的」，编号必然换一个——只说「已更新」的话，
      // 用户会以为列表里那条陌生编号是多出来的。
      addToast(result.replacedCancelFailed
        ? '新任务已创建，但旧任务取消失败，请稍后重试。'
        : (editingTaskUuid
          ? `任务已更新，编号换成 [${shortTaskId(result.uuid)}]。`
          : `任务已创建 [${shortTaskId(result.uuid)}]。`),
      result.replacedCancelFailed ? 'error' : 'success');

      // 角色级 API（单独 API 开关 / 三件套）这次可能刚改过：支持凭据表的 Worker 上
      // 只要把这个角色那几行覆盖掉，已排的任务（含角色自排的）下次触发就跟上了。
      // 老 Worker 上是 no-op，凭据靠下面逐条补刷。
      syncAmsgLlmCredentials(apiConfig);
      // 角色级 API（单独 API 开关 / 三件套）也可能这次刚改过：刚排的这条已带新凭据
      // （排程时现算），但同角色**其它** pending AI 任务里冻结的还是旧的，就地刷一遍。
      // 用渲染时清单近似「其它任务」——保存期间角色刚用工具排的新任务会漏，下次保存
      // 或全局 API 保存时会补上。失败只提示，不能掉进外层 catch 把整次保存标成失败。
      const otherAiTasks = tasks.filter((t) =>
        t.taskUuid !== result.uuid
        && t.taskUuid !== editingTaskUuid
        && isPendingTask(t, Date.now()));
      if (otherAiTasks.length > 0) {
        try {
          const refresh = await ActiveMsgClient.refreshCharPendingAiTaskCredentials({
            char, config, apiConfig, tasks: otherAiTasks,
          });
          if (refresh.status === 'partial') {
            addToast(`该角色已有 ${refresh.failed} 条任务的 API 凭据没刷新成功，稍后重新保存可重试。`, 'error');
          }
        } catch (refreshError) {
          console.warn('[ActiveMsg2Modal] 刷新其余任务的 API 凭据失败', refreshError);
        }
      }
    } catch (error: any) {
      const message = error?.message || '主动消息 2.0 保存失败。';
      onSave((prev) => buildConfig(prev, (list) => list, { lastError: message }));
      addToast(message, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // 「最近没响的」要合三处来源：云端那条 last_skip + 客户端自己记的作废台账。
  // 台账以前只有角色读得到（它进角色的排程现状块），用户这一侧是出口都没有 ——
  // 任务被名额顶掉了、角色记了一条"顺口带出"，用户只看到"到点了没响"，只能猜。
  const [expiredNotices, setExpiredNotices] = useState<Amsg2ExpiredNoticeRecord[]>([]);
  const [dismissedAt, setDismissedAt] = useState(() => readDismissedAt(char.id));
  const missedSummary = useMemo(
    () => buildMissedSummary({
      lastSkip,
      notices: expiredNotices,
      // 挂在任务上的已经由下面每条任务那行说过了（step 6），这张卡不再重复。
      coveredOccurrences: [...missedByTask.values()].flat().map((m) => m.occurrenceMs),
    }).filter((e) => isAfterDismissal(e.occurrenceMs, dismissedAt)),
    [lastSkip, expiredNotices, missedByTask, dismissedAt],
  );

  const handleDismissLastSkip = async () => {
    setLastSkip(null);
    // 本地台账**不删**——它里面还有角色没读走的记录，删了等于抹掉这 48 小时的账。
    // 只把水位线推到最后一条的面：用户看过的就不再冒出来，没看过的下次还在。
    const newest = missedSummary[0]?.occurrenceMs ?? 0;
    if (newest) {
      writeDismissedAt(char.id, newest);
      setDismissedAt(readDismissedAt(char.id));
    }
    try {
      await ActiveMsgClient.clearClientStateValue(amsgStateNamespace(char.id), AMSG_LAST_SKIP_KEY);
    } catch (error) {
      console.warn('[ActiveMsg2Modal] 清除最近一次未发送说明失败', error);
      addToast('这些提示已先从面板隐藏，云端清除失败时下次打开可能还会回来。', 'error');
    }
  };

  return (
    <>
    <Modal
      isOpen={isOpen}
      title="主动消息 2.0"
      onClose={onClose}
      footer={(
        <>
          {/* 麦麦 2026-09-28 19:54：暮色反馈"3 个按钮大小要一样，平均对称居中"
              - 旧版"查看日志"用 flex-shrink-0 + 内容尺寸，按文字宽度收缩 → 比另外两个窄
              - 改成 3 个统一 flex-1 + 居中按钮 */}
          <button
            type="button"
            onClick={() => setDiagLogOpen(true)}
            className="flex-1 py-3 text-xs font-bold text-slate-500 bg-slate-100 rounded-2xl active:scale-95 transition-transform"
          >
            查看日志
          </button>
          <button onClick={onClose} className="flex-1 py-3 text-xs font-bold text-slate-500 bg-slate-100 rounded-2xl active:scale-95 transition-transform">
            取消
          </button>
          <button onClick={handleSubmit} disabled={isSubmitting} className="flex-1 py-3 text-xs font-bold text-white bg-violet-300 rounded-2xl active:scale-95 transition-transform disabled:opacity-50">
            {isSubmitting ? '保存中...' : !enabled ? '关闭 2.0' : (editingTaskUuid ? '保存修改' : '新建任务')}
          </button>
        </>
      )}
    >
      <div className="space-y-4 text-sm text-slate-600">
        <p className="text-xs leading-relaxed text-slate-500">
          这是新的云端主动消息入口。它会把当前角色设定、最近聊天快照和推送订阅一起提交到主动消息标准服务里。长周期循环任务建议在剧情变化后重新保存一次，避免使用过旧的上下文。
        </p>

        <div className="flex items-center justify-between bg-violet-50 border border-violet-100 rounded-2xl p-4">
          <div>
            <div className="font-bold text-slate-700">启用主动消息 2.0</div>
            <div className="text-xs text-violet-700 mt-1">{pushSummary || '正在检查 Push 状态...'}</div>
          </div>
          <button
            onClick={handleToggleEnabled}
            className={`w-12 h-7 rounded-full transition-colors relative ${enabled ? 'bg-violet-300' : 'bg-slate-200'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow transition-all duration-200 ${enabled ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
        </div>

        {/* 关着的时候面板下面整块都是空的，不说一句的话，用户看不出这个开关是按角色算的，
            也不知道打开它能换来什么。 */}
        {!enabled ? (
          <p className="text-xs leading-relaxed text-slate-400 pl-1">
            主动消息 2.0 按角色单独开启。打开这个开关，TA 才能在聊天里给你排定时消息，到点由云端发出；你也可以在这里手动建任务。
          </p>
        ) : null}

        {/* 即时对话按角色单独关，和上面的排程开关互相独立（只排程不即时、只即时不排程
            都行），所以不裹在 enabled 里。全局那道门没开时这里只置灰说明，不代替它。 */}
        <div className={`flex items-center justify-between rounded-2xl p-4 border ${globalInstantChatOn ? 'bg-white border-slate-200' : 'bg-slate-50 border-slate-100'}`}>
          <div className="min-w-0 pr-3">
            <div className={`font-bold ${globalInstantChatOn ? 'text-slate-700' : 'text-slate-400'}`}>即时对话</div>
            <div className="text-xs text-slate-400 mt-1 leading-relaxed">
              {globalInstantChatOn
                ? '开着时 TA 的回复在云端生成、走推送送回，发完就能锁屏。关掉的话这个角色回到本地生成。'
                : '需要先在全局设置里开启即时对话，才能按角色单独调。'}
            </div>
          </div>
          <button
            onClick={handleToggleInstantChat}
            disabled={!globalInstantChatOn}
            className={`w-12 h-7 rounded-full transition-colors relative shrink-0 ${globalInstantChatOn && instantChatOn ? 'bg-violet-300' : 'bg-slate-200'} ${!globalInstantChatOn ? 'opacity-50' : ''}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow transition-all duration-200 ${globalInstantChatOn && instantChatOn ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
        </div>

        {/* 「最近没响的」：闸拦下一次触发时不发任何推送，远端那行任务却照样被消费
            掉——不说一声的话「让路了」在用户看来跟「没发出去 / 功能坏了」完全一样。
            麦麦 2026-10-01 step 8：把云端那条 last_skip 和本地作废台账合成一张卡
            （以前只有前者，而台账里那些用户压根看不见），挂在任务上的那些交给下面
            每条任务自己的那行，这里不重复。 */}
        {enabled && missedSummary.length > 0 ? (
          <div className="bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-xs leading-relaxed text-slate-600">
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">
                  最近没响的
                </div>
                <ul className="space-y-1">
                  {missedSummary.map((e) => (
                    <li key={e.key} className="flex items-start gap-1.5">
                      <span className="shrink-0 mt-[1px] text-[10px] px-1.5 py-0.5 rounded-full bg-white border border-slate-200 text-slate-400">
                        {e.source === 'cloud' ? '云端' : '本地'}
                      </span>
                      <span className="min-w-0">{e.text}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <button
                type="button"
                onClick={handleDismissLastSkip}
                className="shrink-0 px-2.5 py-1 rounded-full bg-white border border-slate-200 text-[11px] font-bold text-slate-500 active:scale-95 transition-transform"
              >
                知道了
              </button>
            </div>
          </div>
        ) : null}

        {enabled && tasks.length > 0 ? (
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 block pl-1">
              任务列表（{tasks.length}）
            </label>
            {/* 一次 render 内所有任务用同一个 now，免得同屏卡片踩在不同的时刻上判定。 */}
            <div className="space-y-2">
              {tasks.map((t) => {
                // 麦麦 2026-09-30：兜底挂在主任务这一行下面，不单独占一行、也不算名额。
                // 面板上要看得见也改得动 —— 用户得知道"到点没响还有一次 30 分钟后的替补"，
                // 替补那句不对他能改。只对角色隐藏（到点上下文 / 排程块都滤掉了）。
                const fb = allTasks.find((x) => x.fallbackFor === t.clientTaskId) ?? null;
                // 循环任务显示的是「下一次」，不是创建时那个锚点（见 currentOccurrenceMs）。
                const occurrenceMs = currentOccurrenceMs(t, now);
                const missingRemote = isRemoteMissingTask(t, knownRemoteUuids, now);
                const remoteInfo = remoteTaskInfo?.get(t.taskUuid);
                // 远端记录的「上一次没发出去」——worker 只在失败时写、成功不清，
                // 文案里带时间就不会把老记录读成「现在还坏着」。
                const remoteErrorText = describeRemoteLastError(remoteInfo?.lastError, formatTaskTime);
                // 「到点了却什么都没来」：本地按新规矩判这次该不该响 + 云端记没记原因。
                // 展开态把回看期内每一次都列出来，折叠态只给最近那一次。
                const missedList = missedByTask.get(t.taskUuid) ?? [];
                const missedText = missedList.length
                  ? describeMissedOccurrence(missedList[0], missedSkip.get(t.taskUuid) ?? null)
                  : null;
                const isExpanded = expandedTaskUuid === t.taskUuid;
                const isEditing = editingTaskUuid === t.taskUuid;
                // 编辑中的任务条用主题色描边；展开中用浅灰边，不再叠合编辑/普通两种样式。
                const containerClass = isEditing
                  ? 'border-violet-400 bg-violet-50'
                  : isExpanded
                    ? 'border-slate-300 bg-slate-50'
                    : 'border-slate-200 bg-white';
                return (
                  <div
                    key={t.taskUuid}
                    className={`rounded-2xl border px-4 py-3 text-xs cursor-pointer transition-colors ${containerClass}`}
                    onClick={() => setExpandedTaskUuid(isExpanded ? null : t.taskUuid)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="font-bold text-slate-700 truncate">
                          [{shortTaskId(t.taskUuid)}] {formatTaskTime(occurrenceMs ?? t.firstSendTime)} · {describeRecurrence(t.recurrenceType)}
                        </div>
                        {/* 进度排最前：这一行会被截断，而「发没发」是用户最想先看到的一条，
                            排在末尾的话（模式描述可能很长）它永远看不见。 */}
                        <div className="text-slate-400 mt-0.5 truncate">
                          {describeTaskProgress(t, knownRemoteUuids, now, remoteInfo?.status)} · {describeTaskMode(t)}
                          · {describeExpirePolicy(t.expirePolicy)}
                          · {t.source === 'character' ? '角色自设' : '手动创建'}
                        </div>
                        {/* source='character' 的任务在折叠态也显示一行 reason 摘要，
                            完整内容在展开区看（避免长 reason 把摘要那行撑变形）。 */}
                        {t.source === 'character' && t.promptHint && !isExpanded ? (
                          <div className="text-slate-500 mt-1 text-[11px] truncate">
                            原因：{t.promptHint}
                          </div>
                        ) : null}
                        {missingRemote && !isExpanded ? (
                          <div className="text-slate-400 mt-1 text-[11px]">⚠ 远端不存在（可能已发送或在别处取消）</div>
                        ) : null}
                        {/* 「为什么没响」放折叠态也看得见：用户在外面点进设置就是为了
                            找这句话，藏进展开区等于让他自己猜该点哪里。 */}
                        {missedText && !isExpanded ? (
                          <div className="text-amber-600 mt-1 text-[11px]">⚠ {missedText}</div>
                        ) : null}
                      </div>
                      {/* 按钮区放右侧，stopPropagation 防止点按钮触发外层 row 的展开切换。 */}
                      <div className="flex gap-2 shrink-0 ml-2" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => setEditingTaskUuid(t.taskUuid)} className="px-2.5 py-1.5 rounded-lg bg-slate-100 text-slate-600 font-bold">编辑</button>
                        <button onClick={() => void handleCancelTask(t)} className="px-2.5 py-1.5 rounded-lg bg-red-50 text-red-500 font-bold">取消</button>
                      </div>
                    </div>
                    {/* 暮色 2026-09-18 12:42：点 row 展开完整详情。
                        折叠态显示一行摘要 + 标签；展开态显示所有字段完整内容（不截断），
                        加上远端错误、本地 lastError 等折叠态可能藏掉的信息。 */}
                    {isExpanded ? (
                      <div className="mt-3 pt-3 border-t border-slate-200 space-y-2 text-slate-600">
                        <div>
                          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">模式</div>
                          <div className="text-slate-700 mt-0.5">
                            {describeTaskMode(t)} · {describeRecurrence(t.recurrenceType)} · {describeExpirePolicy(t.expirePolicy)}
                            {' · '}{t.source === 'character' ? '角色自设' : '手动创建'}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">首次发送</div>
                          <div className="text-slate-700 mt-0.5">{formatTaskTime(t.firstSendTime)}</div>
                        </div>
                        {t.userMessage ? (
                          <div>
                            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">固定消息内容</div>
                            <div className="text-slate-700 mt-0.5 whitespace-pre-wrap break-words">{t.userMessage}</div>
                          </div>
                        ) : null}
                        {t.promptHint ? (
                          <div>
                            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                              {t.source === 'character' ? '原因' : '额外提示词'}
                            </div>
                            <div className="text-slate-700 mt-0.5 whitespace-pre-wrap break-words">{t.promptHint}</div>
                          </div>
                        ) : null}
                        {t.recurrenceType !== 'none' && occurrenceMs ? (
                          <div>
                            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">下次触发</div>
                            <div className="text-slate-700 mt-0.5">{formatTaskTime(occurrenceMs)}</div>
                          </div>
                        ) : null}
                        {missingRemote ? (
                          <div className="text-slate-500 text-[11px]">⚠ 远端不存在（可能已发送或在别处取消）</div>
                        ) : null}
                        {remoteErrorText ? (
                          <div className="text-amber-600 text-[11px]">⚠ {remoteErrorText}</div>
                        ) : null}
                        {missedList.length ? (
                          <div>
                            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                              为什么没响
                            </div>
                            {/* 循环任务攒下好几次没响时全列出来——只说最近一次的话，
                                每天的任务连着好几天没响，用户会以为只有一次。 */}
                            <ul className="mt-0.5 space-y-0.5">
                              {missedList.map((m) => (
                                <li key={`${m.task.taskUuid}:${m.occurrenceMs}`} className="text-amber-600 text-[11px]">
                                  ⚠ {describeMissedOccurrence(m, missedSkip.get(t.taskUuid) ?? null)}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                        {t.lastError ? (
                          <div className="text-red-500 text-[11px]">{t.lastError}</div>
                        ) : null}
                      </div>
                    ) : null}
                    {/* 兜底挂在主任务里面（不另起一行）：它是这条任务的后路，
                        单独列一行的话用户会以为系统多排了一条他没排过的任务。
                        时间用主任务的 + 30 分钟算出来，不单独存——那个值就是
                        updateFallbackText 重建时原样带走的那个 firstSendTime。

                        麦麦 2026-10-03 深夜：条件从 `t.expirePolicy === 'force'` 保持不变，
                        但语义变了——以前 fixed 被钉死成 force，所以**每一条固定任务**都
                        挂着一个「兜底」标签（暮色当时问的就是这个：「固定任务到点就发，
                        用不着兜底呀」）。现在固定模式能自己选策略了，只有选了
                        「转入下轮」的固定任务才真配兜底、才显示这个标签。 */}
                    {t.expirePolicy === 'force' ? (
                      <div className="mt-2 pt-2 border-t border-dashed border-slate-200">
                        <div className="flex items-center gap-1.5 mb-1">
                          {/* 麦麦 2026-10-03 深夜（暮色截图说的）：这两个字原来被挤成
                              「兜」「额」竖着排——行宽不够时中文会被逐字折行。标签加
                              nowrap + shrink-0，窄屏宁可让右边那句让位也不折它。 */}
                          <span className="shrink-0 whitespace-nowrap px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600 text-[10px] font-bold">
                            兜底
                          </span>
                          <span className="text-slate-400 text-[11px]">
                            到点转入下轮的任务，30 分钟没触发下轮自动触发一次唤醒
                          </span>
                        </div>
                        {fb ? (
                          editingFallbackFor === t.clientTaskId ? (
                            <div onClick={(e) => e.stopPropagation()}>
                              <textarea
                                value={fallbackDraft}
                                onChange={(e) => setFallbackDraft(e.target.value)}
                                rows={2}
                                className="w-full px-2.5 py-2 rounded-lg border border-slate-200 text-[11px] text-slate-700 focus:border-amber-300 focus:outline-none resize-none"
                                placeholder="30 分钟后推过来的那句话"
                              />
                              <div className="flex gap-2 mt-1.5">
                                <button
                                  onClick={() => void handleSaveFallbackText(t, fb)}
                                  disabled={savingFallbackUuid === fb.taskUuid}
                                  className="px-2.5 py-1 rounded-lg bg-amber-100 text-amber-700 font-bold disabled:opacity-50"
                                >
                                  {savingFallbackUuid === fb.taskUuid ? '保存中…' : '保存'}
                                </button>
                                <button
                                  onClick={() => setEditingFallbackFor(null)}
                                  className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-500 font-bold"
                                >
                                  取消
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div
                              onClick={(e) => {
                                e.stopPropagation();
                                setFallbackDraft(fb.userMessage || '');
                                setEditingFallbackFor(t.clientTaskId);
                              }}
                              className="flex items-start gap-2"
                            >
                              <div className="flex-1 min-w-0 text-slate-600 text-[11px] leading-relaxed break-words">
                                {fb.userMessage || <span className="text-slate-400">（还没内容）</span>}
                              </div>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setFallbackDraft(fb.userMessage || '');
                                  setEditingFallbackFor(t.clientTaskId);
                                }}
                                className="px-2 py-1 rounded-lg bg-slate-100 text-slate-600 font-bold shrink-0"
                              >
                                改
                              </button>
                            </div>
                          )
                        ) : (
                          /* 麦麦 2026-10-03 深夜（暮色指着截图说的）：这行原本紧贴在
                             「兜底」那块下面，看着像兜底说明的一部分，其实是另一件事
                             ——主任务在云端建失败了。中间补一条虚线分开。
                             `mt-2 pt-2` 跟上面「兜底」那块自己的 `mt-2 pt-2` 对齐，
                             两条分割线的间距一样，整块看起来是同一套节奏。 */
                          <div className="mt-2 pt-2 border-t border-dashed border-slate-200 text-slate-400 text-[11px]">
                            这次没建成（建任务那次没成功，可以取消这条重排一次）
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
            {editingTaskUuid ? (
              <button onClick={() => setEditingTaskUuid(null)} className="mt-2 text-xs text-violet-600 font-bold pl-1">
                ＋ 放弃编辑，改为新建任务
              </button>
            ) : null}
          </div>
        ) : null}

        {enabled ? (
          <>
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 block pl-1">
                {editingTaskUuid ? '编辑任务' : '新建任务'}
              </label>
              {/* 麦麦 2026-10-03 傍晚（暮色指着截图说的）：这行字要在这三个模式**上面**。
                  上午那版放在模式按钮下面，暮色在下面翻策略区时压根没看见，回了一句
                  「新建任务下面的说明没有写」——位置太靠下、跟标题隔着一整个
                  「首次发送时间」，等于没说。放到标题正下方，视线从「新建任务」往下
                  扫第一眼就能撞上。

                  这句话是删掉「角色自设」那个占位选项之后的信息补偿（暮色原话「把多余
                  的去掉」），所以不能没有：角色在聊天里用 schedule_next_wakeup 排的
                  任务照样出现在下面列表里、照样标「角色自设」。 */}
              <div className="text-[11px] text-slate-400 mb-2 pl-1">
                角色和用户均可排主动消息任务
              </div>
              <div className="space-y-2">
                {MODE_OPTIONS.map((option) => {
                  // 麦麦 2026-10-03：原来这里还渲染过一个 disabled 的「角色自设」占位项
                  //   （2026-09-18 加的），已经删掉，所以现在没有 isDisabled 分支了。
                  //   角色自排的任务照样会出现在下面的列表里、照样标「角色自设」。
                  const isSelected = mode === option.id;
                  return (
                    <button
                      key={option.id}
                      onClick={() => {
                        // 麦麦 2026-10-03 深夜：原来这里是 `if (option.id === 'fixed')
                        // setExpirePolicy('force')`——选固定模式就偷偷把策略改成转入下轮。
                        // 那是代码替用户改选择（面板上写一套、落库是另一套），现在固定
                        // 模式三个策略都能配（暮色原话「能配」），**不再替他改**。
                        setMode(option.id);
                      }}
                      className={`w-full text-left rounded-2xl border px-4 py-3 transition-all ${
                        isSelected
                          ? 'bg-violet-300 text-white border-violet-300'
                          : 'bg-white border-slate-200 text-slate-600'
                      }`}
                    >
                      <div className="font-bold">{option.label}</div>
                      <div className={`text-xs mt-1 leading-relaxed ${isSelected ? 'text-violet-50' : 'text-slate-400'}`}>{option.desc}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block pl-1">首次发送时间</label>
              {/* 暮色 2026-09-18 12:59：首次发送时间快捷预设 — 4 个 chip 直接把 input 填到
                  「距当前设备时间 +N 分钟/小时」的未来时间，省去滚日期选择器的步骤。
                  受 amsg-server 限制只影响「首次触发」的绝对时刻，不影响 repeat 间隔。 */}
              <div className="grid grid-cols-4 gap-2 mb-2">
                {FIRST_SEND_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => setFirstSendTime(
                      toDatetimeLocalValue(new Date(Date.now() + preset.offsetMs).toISOString())
                    )}
                    className="py-2 rounded-xl text-xs font-bold border bg-white border-slate-200 text-slate-600 hover:bg-violet-50 hover:border-violet-300 transition-all"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <input
                type="datetime-local"
                value={firstSendTime}
                onChange={(event) => setFirstSendTime(event.target.value)}
                className="w-full bg-white border border-slate-200 rounded-2xl px-4 py-3 text-sm"
              />
            </div>

            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 block pl-1">重复方式</label>
              <div className="grid grid-cols-3 gap-2">
                {RECURRENCE_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    onClick={() => setRecurrenceType(option.id)}
                    className={`py-2.5 rounded-xl text-xs font-bold border transition-all ${recurrenceType === option.id ? 'bg-violet-300 text-white border-violet-300' : 'bg-white border-slate-200 text-slate-600'}`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <div className="text-[11px] text-slate-400 mt-2 pl-1">
                2.0 标准版目前只支持：一次 / 每天 / 每周。30 分钟、1 小时、2 小时这类间隔暂时不支持。
              </div>
            </div>

            {/* 麦麦 2026-10-03 深夜（暮色拍了图定样式）：
                1. 标题从「到点前 10 分钟用户说过话」改成「触发规则」。原来那个标题把
                   判据（那 10 分钟）写进了标题，但三个策略里「强制触发」压根不看
                   那 10 分钟，标题就成了假话。
                2. 竖排三行，每行左边一个勾选框（选中的是紫底白勾），右边加粗名字 +
                   冒号 + 自己那段介绍。三个策略的适用场景差得远（没事 / 不着急 /
                   卡时间），挤成一整段谁也分不清哪个配哪个。
                3. 固定模式**不再藏这一块**了——三个策略固定都能配（暮色原话「能配」）。
                   以前藏它是因为 fixed 被代码钉死成 force，选了也没用；钉死那条拆了
                   之后就没有理由藏了。

                字号：名字 text-sm 加粗，介绍 text-[11px] 灰。名字要压得住介绍——图上
                暮色强调的就是"名字大一点、介绍小一点"，一行里那个层次差就是可读性。 */}
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 block pl-1">触发规则</label>
              <div className="space-y-2">
                {EXPIRE_POLICY_OPTIONS.map((option) => {
                  const isSelected = expirePolicy === option.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setExpirePolicy(option.id)}
                      className={`w-full flex items-start gap-2.5 text-left rounded-2xl border px-3 py-3 transition-all ${
                        isSelected
                          ? 'bg-violet-50 border-violet-300'
                          : 'bg-white border-slate-200'
                      }`}
                    >
                      {/* 勾选框自己画，不用原生 checkbox：原生那个在移动端点击区太小，
                          暮色图上那一行是整行可点的。 */}
                      <span
                        aria-hidden
                        className={`shrink-0 mt-0.5 w-4 h-4 rounded-[5px] border-2 flex items-center justify-center ${
                          isSelected ? 'bg-violet-400 border-violet-400' : 'bg-white border-slate-300'
                        }`}
                      >
                        {isSelected ? (
                          <svg viewBox="0 0 12 12" className="w-2.5 h-2.5" fill="none">
                            <path d="M2.5 6.2l2.4 2.4 4.6-5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        ) : null}
                      </span>
                      <span className="min-w-0">
                        <span className={`block text-sm font-bold leading-snug ${isSelected ? 'text-violet-700' : 'text-slate-700'}`}>
                          {option.label}
                          <span className="text-slate-300 mx-1 font-bold">·</span>
                        </span>
                        <span className="block mt-1 text-[11px] leading-relaxed text-slate-400">
                          {option.desc}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {mode === 'fixed' ? (
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block pl-1">固定消息内容</label>
                <textarea
                  value={userMessage}
                  onChange={(event) => setUserMessage(event.target.value)}
                  placeholder="到点后直接推送这段消息"
                  className="w-full h-28 bg-white border border-slate-200 rounded-2xl px-4 py-3 text-sm resize-none"
                />
              </div>
            ) : (
              <>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block pl-1">
                    {mode === 'prompted' ? '额外提示词' : '补充灵感 (可选)'}
                  </label>
                  <textarea
                    value={promptHint}
                    onChange={(event) => setPromptHint(event.target.value)}
                    placeholder={mode === 'prompted' ? '例如：晚安前撒娇一下，但别太油' : '例如：今天下雨、想找我聊一点轻松的'}
                    className="w-full h-24 bg-white border border-slate-200 rounded-2xl px-4 py-3 text-sm resize-none"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block pl-1">maxTokens (可选)</label>
                  <input
                    type="number"
                    min={1}
                    value={maxTokens}
                    onChange={(event) => setMaxTokens(event.target.value)}
                    placeholder="例如 120"
                    className="w-full bg-white border border-slate-200 rounded-2xl px-4 py-3 text-sm"
                  />
                </div>
              </>
            )}

            <div className="pt-1 border-t border-slate-100">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block pl-1">连发上限</label>
              <select
                value={maxUnanswered}
                onChange={(event) => setMaxUnanswered(event.target.value)}
                className="w-full bg-white border border-slate-200 rounded-2xl px-4 py-3 text-sm"
              >
                <option value="">默认（{DEFAULT_MAX_UNANSWERED_SENDS} 条）</option>
                {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={String(n)}>{n} 条</option>
                ))}
                <option value="0">不限</option>
              </select>
              <p className="text-xs text-slate-400 mt-1.5 pl-1 leading-relaxed">
                你没回消息的时候，TA 最多连续主动发几条——这就是 TA 能连续主动发言的次数上限（包括
                TA 给自己排的后续）。到上限后 TA 自己排的会暂停，你回一句就重新计数；你在这个面板里
                亲手排的任务不受它限制。比如你俩有时差、想让 TA 在你睡觉时每隔一阵报备一句，就把这里调大些。
              </p>
            </div>

            <div className="pt-1 border-t border-slate-100">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <div className="font-bold text-slate-700">使用单独 API</div>
                  <div className="text-xs text-slate-400 mt-1">不开启则复用当前聊天主 API。</div>
                </div>
                <button
                  onClick={() => setUseSecondaryApi(!useSecondaryApi)}
                  className={`w-12 h-7 rounded-full transition-colors relative ${useSecondaryApi ? 'bg-violet-300' : 'bg-slate-200'}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow transition-all duration-200 ${useSecondaryApi ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>

              {useSecondaryApi ? (
                <div className="space-y-3 bg-slate-50 rounded-2xl p-3">
                  <input value={secUrl} onChange={(event) => setSecUrl(event.target.value)} placeholder="API URL" className="w-full px-3 py-2 bg-white rounded-xl text-sm border border-slate-200" />
                  <input type="password" value={secKey} onChange={(event) => setSecKey(event.target.value)} placeholder="API Key" className="w-full px-3 py-2 bg-white rounded-xl text-sm border border-slate-200" />
                  <input value={secModel} onChange={(event) => setSecModel(event.target.value)} placeholder="Model" className="w-full px-3 py-2 bg-white rounded-xl text-sm border border-slate-200" />
                </div>
              ) : null}
            </div>

            {/* 麦麦 2026-10-03（暮色拍板，原话「这条比改文案重要」）：折叠版本信息。
                为什么值得单独做一块——2026-10-03 暮色在 fix 分支上测 11 步规则，屏幕上
                跑的却是 master 的代码，因为 capacitor.config 的 server.url 指错了。
                查清这件事花了五条独立证据（APK 内 config / git 历史 / 截图旧文案 /
                远端 bundle 符号 / CDP 读 url）。而这里只要一眼：
                「网页代码」是哪个分支构建的，「加载网址」是手机实际在连哪个域名，
                两者对上就说明跑的就是你以为的代码。

                折叠是因为平时没人要看，报障时一戳就有。 */}
            <details className="pt-1 border-t border-slate-100">
              <summary className="text-[10px] font-bold text-slate-400 uppercase tracking-widest cursor-pointer select-none pl-1 py-1.5">
                版本信息
              </summary>
              <div className="text-[11px] text-slate-400 pl-1 pb-1 space-y-0.5 break-all font-mono">
                <div>网页代码：{BUILD_LABEL}</div>
                {LOADED_HOST ? <div>加载网址：{LOADED_HOST}</div> : null}
                <div>构建时间：{BUILD_TIME_LABEL}</div>
                <div>应用版本：{APP_VERSION}</div>
              </div>
            </details>
          </>
        ) : null}
      </div>
    </Modal>
    {/* 麦麦 2026-09-24 13:48：诊断日志 viewer — 唯一入口（从全局弹窗迁过来的） */}
    <AmsgDiagLogViewer
      isOpen={diagLogOpen}
      onClose={() => setDiagLogOpen(false)}
    />
    </>
  );
};

export default React.memo(ActiveMsg2SettingsModal);
