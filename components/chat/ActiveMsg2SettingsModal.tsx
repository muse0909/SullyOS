import React, { useEffect, useState } from 'react';
import Modal from '../os/Modal';
import {
  ActiveMsg2CharacterConfig,
  ActiveMsg2ExpirePolicy,
  ActiveMsg2Mode,
  ActiveMsg2Recurrence,
  ActiveMsg2TaskRecord,
  APIConfig,
  CharacterProfile,
  GroupProfile,
  RealtimeConfig,
  UserProfile,
} from '../../types';
import { ActiveMsgClient, getDefaultActiveMsgFirstSendTime } from '../../utils/activeMsgClient';
import { ActiveMsgStore } from '../../utils/activeMsgStore';
import { type AmsgLastSkip, DEFAULT_MAX_UNANSWERED_SENDS, describeLastSkip } from '../../utils/amsgFirePack';
// SullyOS 缺 amsgInstantChat / amsgStateSync / amsg2TaskContext / analytics —— 对应功能块（即时对话开关 / 防穿帮闸 / 任务收件箱 / 调试）按暮色 22:30 指令删掉对应 import 和功能块。
import {
  applyRemoteTaskDelta,
  applyScheduledTask,
  currentOccurrenceMs,
  describeExpirePolicy,
  describeRecurrence,
  describeRemoteLastError,
  describeTaskMode,
  describeTaskProgress,
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
} from '../../utils/amsg2Tasks';

// 麦麦 2026-09-11 21:59：覆盖 upstream modal 后的本地兼容桩，删功能块时把残留调用指到这里。
const trackEvent = (_event: string, _props?: any) => { /* SullyOS 缺 analytics 模块，跟踪桩 */ };
const syncAmsgLlmCredentials = (_apiConfig: any) => { /* SullyOS 缺 amsgStateSync，凭证同步桩 */ };
const buildUserCancelledNotices = (..._args: any[]): any[] => [];
const isInstantChatReady = async (): Promise<boolean> => false;

interface ActiveMsg2SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  char: CharacterProfile;
  apiConfig: APIConfig;
  userProfile: UserProfile;
  groups: GroupProfile[];
  realtimeConfig: RealtimeConfig;
  /**
   * 落盘角色级设置。
   *
   * 暮色 9-11 21:59 指令"onSave 改成 plain object 形态"——SullyOS 的 updateCharacter
   * 签名只接受 Partial<CharacterProfile>（plain object），不支持 functional updater。
   * 所以 onSave 接收整份 config 对象，调用方直接 updateCharacter(char.id, { activeMsg2Config: config })。
   */
  onSave: (config: ActiveMsg2CharacterConfig) => void;
  addToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

const MODE_OPTIONS = [
  { id: 'fixed', label: '固定', desc: '到点直接发你写好的内容' },
  { id: 'auto', label: '自动', desc: '用当前角色设定和聊天快照自己生成' },
  { id: 'prompted', label: '提示词', desc: '围绕你写的方向生成主动消息' },
] as const;

const RECURRENCE_OPTIONS = [
  { id: 'none', label: '一次' },
  { id: 'daily', label: '每天' },
  { id: 'weekly', label: '每周' },
] as const;

const ActiveMsg2SettingsModal: React.FC<ActiveMsg2SettingsModalProps> = ({
  isOpen,
  onClose,
  char,
  apiConfig,
  userProfile,
  groups,
  realtimeConfig,
  onSave,
  addToast,
}) => {
  const saved = char.activeMsg2Config;

  // 开关初值走和工具注入门同一个判定：面板显示「关」而角色其实还能排程，界面就在骗人。
  const [enabled, setEnabled] = useState(() => isAmsg2EnabledForChar(char));
  const [mode, setMode] = useState<ActiveMsg2Mode>(saved?.mode ?? 'auto');
  const [firstSendTime, setFirstSendTime] = useState(saved?.firstSendTime ?? getDefaultActiveMsgFirstSendTime());
  const [recurrenceType, setRecurrenceType] = useState(saved?.recurrenceType ?? 'none');
  const [expirePolicy, setExpirePolicy] = useState<ActiveMsg2ExpirePolicy>(saved?.expirePolicy ?? 'expire');
  const [userMessage, setUserMessage] = useState(saved?.userMessage ?? '');
  const [promptHint, setPromptHint] = useState(saved?.promptHint ?? '');
  const [maxTokens, setMaxTokens] = useState(String(saved?.maxTokens ?? ''));
  // '' = 没设（用默认值）；'0' = 不限；其余 1-10
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
  // 麦麦 2026-09-11 21:59：删掉以下功能块对应的 state —— 任务列表 / 任务编辑 / 即时对话开关 / 防穿帮闸 / 远端对账 / 收件箱。

  // 表单值重置：面板打开时用 saved 字段填表单
  useEffect(() => {
    if (!isOpen) return;

    const config = char.activeMsg2Config;
    setEnabled(isAmsg2EnabledForChar(char));
    setMode(config?.mode ?? 'auto');
    setFirstSendTime(config?.firstSendTime ?? getDefaultActiveMsgFirstSendTime());
    setRecurrenceType(config?.recurrenceType ?? 'none');
    setExpirePolicy(config?.expirePolicy ?? 'expire');
    setUserMessage(config?.userMessage ?? '');
    setPromptHint(config?.promptHint ?? '');
    setMaxTokens(config?.maxTokens ? String(config.maxTokens) : '');
    setMaxUnanswered(config?.maxUnansweredSends === undefined ? '' : String(config.maxUnansweredSends));
    setUseSecondaryApi(config?.useSecondaryApi ?? false);
    setSecUrl(config?.secondaryApi?.baseUrl ?? '');
    setSecKey(config?.secondaryApi?.apiKey ?? '');
    setSecModel(config?.secondaryApi?.model ?? '');
  }, [isOpen, char.id, char.activeMsg2Config]);

  // 麦麦 2026-09-11 21:59：删掉即时对话开关 / 防穿帮闸 / 远端对账 / 任务编辑对应的 useEffect 块。

  // 打开面板时的 push 状态检查（只随 isOpen / 角色变化跑）。
  useEffect(() => {
    if (!isOpen) return;

    void (async () => {
      const globalConfig = await ActiveMsgClient.getGlobalConfig();
      const pushStatus = await ActiveMsgClient.getPushStatus();
      setGlobalReady(Boolean(globalConfig.tenantToken));
      setPushSummary(pushStatus.supported
        ? `权限：${pushStatus.permission} / 订阅：${pushStatus.hasSubscription ? '已就绪' : '未创建'}`
        : '当前环境不支持 Web Push');
    })();
  }, [isOpen, char.id]);

  /**
   * 麦麦 2026-09-11 21:59：覆盖 upstream modal 后，删掉以下功能块：
   * - buildConfig 函数的 tasksOf 参数（任务清单已不属本轮最小闭环）
   * - handleToggleEnabled（拨开关本身保存的 updater 形态）
   * - handleToggleInstantChat（即时对话开关）
   * - writeCancelledNotices（取消回执）
   * - handleCancelTask（取消任务）
   * - handleSubmit 里的 tasks.map / editingTaskUuid / replaceTaskUuid / clientTaskId / firstSendAt / replacedCancelFailed / refreshCharPendingAiTaskCredentials 等
   *
   * 保留：基础 5 大需求表单 + 提交时调 ActiveMsgClient.scheduleCharacterTask（plain object 形态）。
   */

  /**
   * 拼一份要落盘的 config（plain object 形态，暮色 21:59 拍板）
   */
  const buildNextConfig = (): NonNullable<CharacterProfile['activeMsg2Config']> => ({
    enabled,
    mode,
    firstSendTime,
    recurrenceType,
    expirePolicy,
    userMessage: userMessage.trim() || undefined,
    promptHint: promptHint.trim() || undefined,
    maxTokens: maxTokens.trim() ? Number(maxTokens) : undefined,
    maxUnansweredSends: maxUnanswered === '' ? undefined : Number(maxUnanswered),
    useSecondaryApi: useSecondaryApi && !!secUrl,
    secondaryApi: useSecondaryApi && secUrl ? {
      baseUrl: secUrl.trim(),
      apiKey: secKey.trim(),
      model: secModel.trim(),
    } : undefined,
    taskUuid: saved?.taskUuid,
    remoteStatus: saved?.remoteStatus || 'idle',
    lastSyncedAt: saved?.lastSyncedAt,
    lastError: saved?.lastError,
  });

  /**
   * 拨开关本身就算一次保存（plain object 形态）
   */
  const handleToggleEnabled = () => {
    const turningOn = !enabled;
    setEnabled(!enabled);
    if (turningOn) {
      onSave({
        ...buildNextConfig(),
        enabled: true,
        lastSyncedAt: Date.now(),
      });
    }
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      if (!enabled) {
        // 关闭 2.0 = 取消远端任务（如果存在）+ 落盘 enabled:false
        if (saved?.taskUuid) {
          try {
            await ActiveMsgClient.cancelTask(saved.taskUuid);
          } catch (e) {
            console.warn('[ActiveMsg2Modal] cancel old task failed', e);
          }
        }
        onSave({
          ...buildNextConfig(),
          enabled: false,
          taskUuid: undefined,
          remoteStatus: 'idle',
          lastSyncedAt: Date.now(),
          lastError: undefined,
        });
        addToast('主动消息 2.0 已关闭。', 'info');
        onClose();
        return;
      }

      if (!globalReady) {
        throw new Error('请先去系统设置里完成"主动消息 2.0"的全局配置。');
      }

      const result = await ActiveMsgClient.scheduleCharacterTask({
        char,
        config: buildNextConfig(),
        userProfile,
        groups,
        realtimeConfig,
        apiConfig,
      });

      onSave({
        ...buildNextConfig(),
        taskUuid: result.uuid,
        remoteStatus: result.status === 'sent' ? 'sent' : 'scheduled',
        lastSyncedAt: Date.now(),
        lastError: undefined,
      });
      addToast('主动消息 2.0 任务已创建。', 'success');
      onClose();
    } catch (error: any) {
      const message = error?.message || '主动消息 2.0 保存失败。';
      onSave({
        ...buildNextConfig(),
        remoteStatus: 'error',
        lastError: message,
      });
      addToast(message, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      title="主动消息 2.0"
      onClose={onClose}
      footer={(
        <>
          <button onClick={onClose} className="flex-1 py-3 bg-slate-100 text-slate-500 font-bold rounded-2xl active:scale-95 transition-transform">
            取消
          </button>
          <button onClick={handleSubmit} disabled={isSubmitting} className="flex-1 py-3 bg-fuchsia-500 text-white font-bold rounded-2xl active:scale-95 transition-transform disabled:opacity-50">
            {isSubmitting ? '保存中...' : !enabled ? '关闭 2.0' : '保存'}
          </button>
        </>
      )}
    >
      <div className="space-y-4 text-sm text-slate-600">
        <p className="text-xs leading-relaxed text-slate-500">
          这是新的云端主动消息入口。它会把当前角色设定、最近聊天快照和推送订阅一起提交到主动消息标准服务里。长周期循环任务建议在剧情变化后重新保存一次，避免使用过旧的上下文。
        </p>

        <div className="flex items-center justify-between bg-fuchsia-50 border border-fuchsia-100 rounded-2xl p-4">
          <div>
            <div className="font-bold text-slate-700">启用主动消息 2.0</div>
            <div className="text-xs text-fuchsia-600 mt-1">{pushSummary || '正在检查 Push 状态...'}</div>
          </div>
          <button
            onClick={handleToggleEnabled}
            className={`w-12 h-7 rounded-full transition-colors relative ${enabled ? 'bg-fuchsia-500' : 'bg-slate-200'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow transition-all duration-200 ${enabled ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
        </div>

        {/* 关着的时候面板下面整块都是空的，不说一句的话，用户看不出这个开关是按角色算的，
            也不知道打开它能换来什么。 */}
        {!enabled ? (
          <p className="text-xs leading-relaxed text-slate-400 pl-1">
            主动消息 2.0 按角色单独开启。打开这个开关，TA 才能在聊天里给你排定时消息，到点由云端发出。
          </p>
        ) : null}

        {/* 麦麦 2026-09-11 21:59：删掉即时对话开关 / 防穿帮闸说明 / 任务列表 / 任务编辑 JSX 块。 */}

        {enabled ? (
          <>
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 block pl-1">
                主动消息设置
              </label>
              <div className="space-y-2">
                {MODE_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    onClick={() => {
                      setMode(option.id);
                      // fixed 进不了 worker 闸（taskNeedsLlm=false），策略统一钉成 force。
                      if (option.id === 'fixed') setExpirePolicy('force');
                    }}
                    className={`w-full text-left rounded-2xl border px-4 py-3 transition-all ${mode === option.id ? 'bg-fuchsia-500 text-white border-fuchsia-500' : 'bg-white border-slate-200 text-slate-600'}`}
                  >
                    <div className="font-bold">{option.label}</div>
                    <div className={`text-xs mt-1 ${mode === option.id ? 'text-fuchsia-50' : 'text-slate-400'}`}>{option.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block pl-1">首次发送时间</label>
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
                    className={`py-2.5 rounded-xl text-xs font-bold border transition-all ${recurrenceType === option.id ? 'bg-fuchsia-500 text-white border-fuchsia-500' : 'bg-white border-slate-200 text-slate-600'}`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <div className="text-[11px] text-slate-400 mt-2 pl-1">
                2.0 标准版目前只支持：一次 / 每天 / 每周。30 分钟、1 小时、2 小时这类间隔暂时不支持。
              </div>
            </div>

            {mode !== 'fixed' ? (
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 block pl-1">到点时用户正在聊天</label>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    { id: 'expire', label: '自动作废', desc: '转为对话里自然带出' },
                    { id: 'force', label: '强制发送', desc: '闹钟型，照发' },
                  ] as const).map((option) => (
                    <button
                      key={option.id}
                      onClick={() => setExpirePolicy(option.id)}
                      className={`py-2.5 rounded-xl text-xs font-bold border transition-all ${expirePolicy === option.id ? 'bg-fuchsia-500 text-white border-fuchsia-500' : 'bg-white border-slate-200 text-slate-600'}`}
                    >
                      {option.label}
                      <div className={`font-normal mt-0.5 ${expirePolicy === option.id ? 'text-fuchsia-100' : 'text-slate-400'}`}>{option.desc}</div>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

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
                  className={`w-12 h-7 rounded-full transition-colors relative ${useSecondaryApi ? 'bg-fuchsia-500' : 'bg-slate-200'}`}
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
          </>
        ) : null}
      </div>
    </Modal>
  );
};

export default React.memo(ActiveMsg2SettingsModal);
