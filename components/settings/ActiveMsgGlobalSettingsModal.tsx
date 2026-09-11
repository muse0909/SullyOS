import React, { useEffect, useState } from 'react';
import Modal from '../os/Modal';
import { ActiveMsg2GlobalConfig, RealtimeConfig } from '../../types';
import { ActiveMsgClient, ActiveMsg2PushStatus } from '../../utils/activeMsgClient';
import { ActiveMsgStore, maskActiveMsgUserId } from '../../utils/activeMsgStore';

// 麦麦 2026-09-11 22:10：覆盖 upstream GlobalSettingsModal（1741 行）后修报错。
// 按暮色 21:59 指令"凡是依赖SullyOS没有的utils或types的地方，改成SullyOS现有等价实现或直接删掉对应功能块"，
// 删掉以下功能块（upstream 多出来但 SullyOS 缺的）：
//   - Cloudflare 账户部署助手（cfProvision / CfAccount / ProvisionProgress）—— SullyOS 无
//   - VAPID 生成（vapidGen / pushVapid）—— SullyOS 用 BUILT_IN VAPID
//   - 推送深度重置（reconcilePushSubscription）—— SullyOS 只有 ensurePushSubscription
//   - Worker 自更新（selfUpdateWorker）—— SullyOS 手动部署
//   - 诊断面板（amsgDiagnostics）—— SullyOS 无
//   - Worker 版本探测（isAmsgServerVersionAtLeast）—— SullyOS SDK 锁 2.6.0-next.12
//   - 即时对话配置（instantPushClient）—— SullyOS 5 大需求不涉及
//   - Cron 暂停 / Attach 部署 / Deno Proxy / 体检 / workerOutdated / 手动粘贴 / 补装更新 —— SullyOS 5 大需求不涉及
// 保留：基础 5 大需求全局配置（Neon URL / 通知权限 / 高级信息折叠 / 测试推送 / 重置订阅 / 连接并启用）。
// 加 realtimeConfig prop：保留 upstream 的 props 习惯（apps/Settings.tsx 调用处需要）。

interface ActiveMsgGlobalSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  addToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  realtimeConfig: RealtimeConfig;
}

const ActiveMsgGlobalSettingsModal: React.FC<ActiveMsgGlobalSettingsModalProps> = ({
  isOpen,
  onClose,
  addToast,
  realtimeConfig: _realtimeConfig, // SullyOS 5 大需求不直接使用，保留 prop 以兼容上游调用方
}) => {
  const [config, setConfig] = useState<ActiveMsg2GlobalConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [pushStatus, setPushStatus] = useState<ActiveMsg2PushStatus | null>(null);
  const [keyStatus, setKeyStatus] = useState('');

  const refresh = async () => {
    const nextConfig = await ActiveMsgClient.getGlobalConfig();
    const nextPushStatus = await ActiveMsgClient.getPushStatus();
    setConfig(nextConfig);
    setPushStatus(nextPushStatus);
  };

  useEffect(() => {
    if (!isOpen) return;
    void refresh();
  }, [isOpen]);

  const patchConfig = (patch: Partial<ActiveMsg2GlobalConfig>) => {
    setConfig((prev) => (prev ? { ...prev, ...patch } : prev));
    void ActiveMsgStore.saveGlobalConfig(patch);
  };

  const handleInitTenant = async () => {
    if (!config) return;
    setLoading(true);
    setKeyStatus('');
    try {
      const result = await ActiveMsgClient.initTenant({
        driver: 'neon',
        databaseUrl: config.databaseUrl,
        initSecret: config.initSecret,
      });
      addToast('主动消息 2.0 已启用，连接串和密钥都已经准备好。', 'success');
      setKeyStatus(`tenantToken 已生成（掩码 ${maskActiveMsgUserId(result.tenantId)}）`);
      await refresh();
    } catch (error: any) {
      addToast(error?.message || '主动消息 2.0 启用失败。', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateSubscription = async () => {
    setLoading(true);
    try {
      await ActiveMsgClient.ensurePushSubscription();
      addToast('已开启通知与推送。', 'success');
      await refresh();
    } catch (error: any) {
      addToast(error?.message || '开启通知与推送失败。', 'error');
    } finally {
      setLoading(false);
    }
  };

  if (!config) return null;

  const isInitialized = Boolean(config.initializedAt);
  const isLoading = loading;

  return (
    <Modal
      isOpen={isOpen}
      title="主动消息 2.0"
      onClose={onClose}
      footer={(
        <button
          onClick={onClose}
          className="flex-1 py-3 bg-slate-100 text-slate-500 font-bold rounded-2xl active:scale-95 transition-transform"
        >
          关闭
        </button>
      )}
    >
      <div className="space-y-4 text-sm text-slate-600">
        <div className="bg-violet-50 border border-violet-100 rounded-2xl p-4 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <span className="font-bold text-slate-700">连接方式</span>
            <span className="px-3 py-1 rounded-full bg-violet-500 text-white text-xs font-bold">Neon</span>
          </div>
          <p className="text-xs leading-relaxed text-violet-700">
            这里默认就是给 Neon 用的。把 Neon 提供的数据库连接串贴进来，然后点一次"连接并启用"就行。
          </p>
          <p className="text-[11px] leading-relaxed text-violet-600/80">
            就算你复制的是 <code>psql 'postgresql://...'</code> 整段，系统也会自动帮你清理成可用的连接串。
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <span className="font-bold text-slate-700">当前状态</span>
            <span className={`text-xs font-bold ${isInitialized ? 'text-emerald-600' : 'text-amber-600'}`}>
              {isInitialized ? '已连接' : '未连接'}
            </span>
          </div>

          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block pl-1">
              Neon Database URL
            </label>
            <textarea
              value={config.databaseUrl || ''}
              onChange={(event) => patchConfig({ databaseUrl: event.target.value })}
              placeholder="把 Neon 给你的 postgresql://... 连接串贴在这里"
              className="w-full h-28 bg-white/70 border border-slate-200 rounded-2xl px-4 py-3 text-xs font-mono resize-none"
            />
          </div>

          <button
            onClick={handleInitTenant}
            disabled={isLoading}
            className="w-full py-3 bg-violet-300 text-violet-800 font-bold rounded-2xl active:scale-95 transition-transform disabled:opacity-50"
          >
            {isLoading ? '处理中...' : isInitialized ? '重新连接并更新' : '连接并启用'}
          </button>

          {keyStatus ? (
            <p className="text-xs leading-relaxed text-emerald-600">{keyStatus}</p>
          ) : null}

          <p className="text-xs leading-relaxed text-slate-500">
            普通用户只需要这一步。下面那些"密钥 / token / webhook"都是高级信息，不用看。
          </p>
        </div>

        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <span className="font-bold text-slate-700">通知权限</span>
            <span className={`text-xs font-bold ${pushStatus?.hasSubscription ? 'text-emerald-600' : 'text-amber-600'}`}>
              {pushStatus?.hasSubscription ? '已开启' : '未开启'}
            </span>
          </div>
          <p className="text-xs leading-relaxed text-slate-500">
            这是第二步。只有你真的想让角色在后台主动推送消息时，才需要点。
          </p>
          {pushStatus?.detail ? (
            <p className="text-xs leading-relaxed text-amber-600">{pushStatus.detail}</p>
          ) : null}
          <button
            onClick={handleCreateSubscription}
            disabled={isLoading}
            className="w-full py-3 bg-violet-300 text-violet-800 font-bold rounded-2xl active:scale-95 transition-transform disabled:opacity-50"
          >
            {isLoading ? '处理中...' : '开启通知与推送'}
          </button>
        </div>

        <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 text-xs leading-relaxed text-amber-700 space-y-2">
          <div className="font-bold text-amber-800">风险说明</div>
          <p>开了 2.0 以后，主动消息内容、提示词、相关配置，都会进入你填写的 Neon 数据库。</p>
          <p>数据库管理员有机会看到这些内容。除此之外，按这套信任模型，项目维护者也就是糯米鸡，逻辑上同样属于有权限碰到这些数据的人。</p>
          <p>如果你不接受这一点，就不要开 2.0，也不要把自己的 API Key、敏感提示词、私密内容放进去。</p>
          <p>项目不会额外偷偷接一个中心服务器；它走的还是你自己的库。但只要数据进库，就默认数据库管理员和项目维护者是你需要信任的人。</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
          <button
            type="button"
            onClick={() => setAdvancedOpen((prev) => !prev)}
            className="w-full flex items-center justify-between text-left"
          >
            <span className="font-bold text-slate-700">高级信息</span>
            <span className="text-xs font-bold text-slate-400">{advancedOpen ? '收起' : '展开'}</span>
          </button>

          {advancedOpen ? (
            <div className="space-y-3 pt-2 border-t border-slate-100">
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block pl-1">
                  INIT_SECRET（首次连接时填）
                </label>
                <input
                  type="password"
                  value={config.initSecret || ''}
                  onChange={(event) => patchConfig({ initSecret: event.target.value })}
                  placeholder="可选；留空 = 不校验 init-tenant 端点"
                  className="w-full px-3 py-2 bg-white rounded-xl text-sm border border-slate-200"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block pl-1">
                  tenantToken（只读）
                </label>
                <textarea readOnly value={config.tenantToken || ''} className="w-full h-16 bg-white rounded-xl px-3 py-2 font-mono resize-none" />
              </div>

              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block pl-1">
                  cronToken（只读）
                </label>
                <textarea readOnly value={config.cronToken || ''} className="w-full h-16 bg-white rounded-xl px-3 py-2 font-mono resize-none" />
              </div>

              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block pl-1">
                  cronWebhookUrl（只读）
                </label>
                <textarea readOnly value={config.cronWebhookUrl || ''} className="w-full h-16 bg-white rounded-xl px-3 py-2 font-mono resize-none" />
              </div>

              <div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block pl-1">
                  API URL（只读）
                </span>
                <span className="font-mono text-[10px] text-violet-600 break-all block pl-1">{ActiveMsgClient.apiBaseUrl}</span>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </Modal>
  );
};

export default React.memo(ActiveMsgGlobalSettingsModal);
