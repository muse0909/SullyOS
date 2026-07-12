import React, { useState, useEffect, useLayoutEffect } from 'react';
import { useOS } from '../context/OSContext';
import { CharacterProfile } from '../types';
import Chat from './Chat';
import UserApp from './UserApp';
import DiscoverPage from './DiscoverPage';

// 三个 Tab 键
type TabKey = 'messages' | 'discover' | 'me';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'messages', label: '消息' },
  { key: 'discover', label: '发现' },
  { key: 'me', label: '我' },
];

// WeChat: 仿微信风格的"消息 / 发现 / 我"三屏入口
// 占位发现 tab + 联系人 tab 走真实 characters
// "我" tab 直接渲染 UserApp（个人档案）
const WeChat: React.FC = () => {
  const { characters, activeCharacterId, setActiveCharacterId, registerBackHandler, closeApp, consumePendingDirectChat, consumeDirectEntry } = useOS();

  // 当前 Tab
  const [tab, setTab] = useState<TabKey>('messages');
  // 已点开的角色 id（null = 还在联系人列表）
  const [openedCharId, setOpenedCharId] = useState<string | null>(null);
  // 入口标记：widget 直跳进来 → 按返回直接回桌面；联系人列表点入 → 按返回回联系人列表
  const [cameFromDirectEntry, setCameFromDirectEntry] = useState(false);

  // Mount 时：检查是否有 pending direct chat（来自 launcher widget 直跳）
  // 有值就直接进 Chat，跳过联系人列表；读完清掉，不影响后续进 AppID.Chat
  // 同时消费 direct entry 标记，决定返回行为
  // 修复跳转错位（#5）：用 useLayoutEffect 同步消费 + 同步 setOpenedCharId，
  //   避免 useEffect 异步消费导致的"中间帧"（FavoritesPage 还没卸载，Chat 已经在 mounted，
  //   两者在 transition 中叠加成错位）
  useLayoutEffect(() => {
    const pending = consumePendingDirectChat();
    if (pending) {
      setOpenedCharId(pending);
      if (consumeDirectEntry()) {
        setCameFromDirectEntry(true);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Android 物理返回键 / 浏览器返回：
  //   - widget 直跳入口 → 一次返回直接回桌面（不走联系人列表，因为用户压根没看过）
  //   - 联系人列表点入 → 聊天页返回回联系人列表，再返回才到桌面（保持微信式结构）
  //   - 联系人列表页 → 返回 closeApp（return false 让 OSContext.handleBack 处理）
  useEffect(() => {
    const unregister = registerBackHandler(() => {
      if (cameFromDirectEntry && openedCharId) {
        // widget 直跳：直接 closeApp（return false 让 OSContext.handleBack 走默认逻辑）
        return false;
      }
      if (openedCharId) {
        setOpenedCharId(null);
        return true;
      }
      return false;
    });
    return unregister;
  }, [cameFromDirectEntry, openedCharId, registerBackHandler]);

  // 同步 activeCharacterId — Chat.tsx 从 OSContext 拿这个值
  // 修复 Bug 2（聊天页 chars 面板切换切不了）：
  //   原 deps 含 [openedCharId, activeCharacterId, setActiveCharacterId]
  //   → 用户在 chat 内 chars 面板 setActiveCharacterId(newId) 后，
  //     此 effect 检测到 openedCharId(oldId) !== activeCharacterId(newId)
  //     → setActiveCharacterId(openedCharId) 覆盖回 oldId，切换失效
  // 修法：deps 只用 [openedCharId, setActiveCharacterId]，
  //   只有联系人列表点入（openedCharId 变化）时才同步；
  //   Chat 内 chars 面板切角色（activeCharacterId 变化）不再触发反向覆盖
  useEffect(() => {
    if (openedCharId && openedCharId !== activeCharacterId) {
      setActiveCharacterId(openedCharId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openedCharId, setActiveCharacterId]);

  // 修复 Bug 1（联系人页被反向同步 effect 破坏）：
  //   撤掉原来的 "activeCharacterId → openedCharId" 反向同步 effect，
  //   改走 pendingDirectChatRef 路径（见 context/OSContext.tsx jumpToMessage）：
  //     - 普通进 WeChat：pendingDirectChatRef 为 null → 不动 → 显示联系人列表 ✓
  //     - jumpToMessage 收藏页跳转：pendingDirectChatRef = charId → consume 后 setOpenedCharId → 进 Chat ✓
  //   这个 effect 处理 WeChat 已 mounted 时收到 jumpToMessage 的场景（收藏页本身在 WeChat 内，
  //   setActiveApp(AppID.Chat) 不会触发 WeChat 重新 mount，所以上面的 mount effect 不会再跑）。
  //   普通字符切换走 chars 面板（setActiveCharacterId 不走 pendingDirectChatRef）→ 这里 consume 拿到 null → 不动 → OK
  // 修复跳转错位（#5）：改用 useLayoutEffect 同步消费，避免 useEffect 异步导致的中间帧错位
  useLayoutEffect(() => {
    const pending = consumePendingDirectChat();
    if (pending && !openedCharId) {
      setOpenedCharId(pending);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCharacterId]);

  // 暮色 2026-07-12：ChatHeaderShell 右上角星星按钮触发 → 回联系人列表 + 切到发现 tab
  // 监听 discoverTabRequestId：ChatHeaderShell 调 requestOpenDiscoverTab() 会自增这个 counter
  // 这里 consume + setOpenedCharId(null) + setTab('discover')
  const { consumePendingDiscoverTab, discoverTabRequestId } = useOS();
  useEffect(() => {
    if (discoverTabRequestId === 0) return; // 初始值 0 跳过
    if (consumePendingDiscoverTab()) {
      setOpenedCharId(null);
      setTab('discover');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discoverTabRequestId]);

  // 已选角色 → 嵌套 Chat
  // 顶栏左侧 onClose 交给 Chat 自己的 ChatHeaderShell 处理：
  //   onClose → closeApp → handleBack → 我们的 registerBackHandler 优先级最高 → 自动回到联系人列表
  // （Android 物理返回键 / 浏览器后退同样走这条链路）
  if (openedCharId) {
    return (
      <div className="absolute inset-0 flex flex-col">
        <div className="flex-1 relative overflow-hidden">
          <Chat />
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 flex flex-col bg-[#ededed]">
      {/* 顶部 header — "联系人" + 左上角返回 (返回 launcher) + 右上齿轮 */}
      <div className="flex items-center justify-between px-2 py-3 bg-white border-b border-slate-200/60 shrink-0">
        <button
          onClick={closeApp}
          className="w-9 h-9 flex items-center justify-center rounded-full text-slate-600 hover:bg-slate-100 active:scale-95 transition-transform"
          aria-label="返回桌面"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
            <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 0 1-.02 1.06L8.832 10l3.938 3.71a.75.75 0 1 1-1.04 1.08l-4.5-4.25a.75.75 0 0 1 0-1.08l4.5-4.25a.75.75 0 0 1 1.06.02Z" clipRule="evenodd" />
          </svg>
        </button>
        <h1 className="text-base font-semibold text-slate-800 tracking-wide">联系人</h1>
        <button
          className="w-9 h-9 flex items-center justify-center rounded-full text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          aria-label="设置"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
            <path fillRule="evenodd" d="M7.84 1.804a1 1 0 0 1 .668-.943 5.5 5.5 0 0 1 3.066 0 1 1 0 0 1 .668.943V3.27a8.98 8.98 0 0 1 1.62.987 1 1 0 0 1 .318 1.243l-.6 1.13a8.963 8.963 0 0 1 1.171 1.785 1 1 0 0 1-.193 1.318l-1.04.97a7.013 7.013 0 0 1 0 1.948l1.04.97a1 1 0 0 1 .193 1.318 8.962 8.962 0 0 1-1.171 1.785l.6 1.13a1 1 0 0 1-.318 1.243 8.98 8.98 0 0 1-1.62.987v1.413a1 1 0 0 1-.668.943 5.5 5.5 0 0 1-3.066 0 1 1 0 0 1-.668-.943v-1.413a8.976 8.976 0 0 1-1.62-.987 1 1 0 0 1-.318-1.243l.6-1.13a8.963 8.963 0 0 1-1.171-1.785 1 1 0 0 1 .193-1.318l1.04-.97a7.013 7.013 0 0 1 0-1.948l-1.04-.97a1 1 0 0 1-.193-1.318 8.962 8.962 0 0 1 1.171-1.785l-.6-1.13a1 1 0 0 1 .318-1.243 8.98 8.98 0 0 1 1.62-.987V1.804Zm.4 7.696a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z" clipRule="evenodd" />
          </svg>
        </button>
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto">
        {tab === 'messages' && (
          <MessagesTab characters={characters} onOpenChar={setOpenedCharId} />
        )}
        {tab === 'discover' && (
          <DiscoverPage onClose={() => setTab('messages')} />
        )}
        {tab === 'me' && <UserApp />}
      </div>

      {/* 底部 Tab bar — 仿微信底部三 Tab（磨砂白底，暮色 v4 反馈） */}
      <div
        className="shrink-0 bg-white/85 backdrop-blur-xl border-t border-slate-200/40 flex"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 relative py-2.5 text-[13px] font-medium transition-colors ${
              tab === t.key ? 'text-emerald-600' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
            {tab === t.key && (
              <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-5 h-0.5 bg-emerald-500 rounded-full" />
            )}
          </button>
        ))}
      </div>
    </div>
  );
};

// === 子组件：消息 Tab（联系人列表） ===
const MessagesTab: React.FC<{
  characters: CharacterProfile[];
  onOpenChar: (id: string) => void;
}> = ({ characters, onOpenChar }) => {
  if (!characters || characters.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-20 text-slate-400">
        <div className="w-16 h-16 rounded-full bg-white flex items-center justify-center mb-4 shadow-sm">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-7 h-7 text-slate-300">
            <path d="M3 4.25A2.25 2.25 0 0 1 5.25 2h9.5A2.25 2.25 0 0 1 17 4.25v8.5A2.25 2.25 0 0 1 14.75 15h-3.708l-2.286 1.713a.75.75 0 0 1-1.144-.486V15H5.25A2.25 2.25 0 0 1 3 12.75v-8.5Z" />
          </svg>
        </div>
        <div className="text-sm">还没有联系人</div>
        <div className="text-xs mt-1">去「神经链接」添加一个角色吧</div>
      </div>
    );
  }
  return (
    <div className="px-5 py-3 space-y-3">
      {characters.map((c) => (
        <ContactCard key={c.id} char={c} onClick={() => onOpenChar(c.id)} />
      ))}
    </div>
  );
};

const ContactCard: React.FC<{
  char: CharacterProfile;
  onClick: () => void;
}> = ({ char, onClick }) => {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 p-3 bg-white rounded-2xl shadow-sm hover:shadow-md active:scale-[0.98] transition-all text-left"
    >
      <img
        src={char.avatar || ''}
        alt={char.name}
        className="w-12 h-12 rounded-full object-cover bg-slate-100 shrink-0"
        onError={(e) => {
          (e.target as HTMLImageElement).src =
            `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'><rect width='40' height='40' fill='%23e2e8f0'/><text x='50%25' y='55%25' font-size='16' fill='%2364748b' text-anchor='middle' font-family='sans-serif'>${(char.name || '?').slice(0, 1)}</text></svg>`;
        }}
      />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-slate-800 truncate">{char.name || '未命名'}</div>
        <div className="text-xs text-slate-400 mt-0.5 truncate">点击开始聊天…</div>
      </div>
      <div className="text-slate-300 text-xl px-1">›</div>
    </button>
  );
};

// === 子组件：占位 Tab（发现） ===
const PlaceholderTab: React.FC<{ title: string; hint: string }> = ({ title, hint }) => (
  <div className="flex flex-col items-center justify-center h-full py-24 text-slate-400">
    <div className="text-base font-medium text-slate-500 mb-2">{title}</div>
    <div className="text-xs">{hint}</div>
  </div>
);

export default WeChat;
