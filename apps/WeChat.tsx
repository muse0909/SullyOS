import React, { useState, useEffect } from 'react';
import { useOS } from '../context/OSContext';
import { CharacterProfile } from '../types';
import Chat from './Chat';

// 三个 Tab 键
type TabKey = 'messages' | 'discover' | 'me';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'messages', label: '消息' },
  { key: 'discover', label: '发现' },
  { key: 'me', label: '我' },
];

// WeChat: 仿微信风格的"消息页"入口
// Step 1 范围：联系人列表 + 三 Tab 占位 + 嵌套 Chat（嵌套逻辑预览用，完整返回闭环等 Step 3 优化）
const WeChat: React.FC = () => {
  const { characters, activeCharacterId, setActiveCharacterId, registerBackHandler, closeApp } = useOS();

  // 当前 Tab
  const [tab, setTab] = useState<TabKey>('messages');
  // 已点开的角色 id（null = 还在联系人列表）
  const [openedCharId, setOpenedCharId] = useState<string | null>(null);

  // Android 物理返回键 / 浏览器返回：优先回联系人列表，其次 closeApp
  useEffect(() => {
    const unregister = registerBackHandler(() => {
      if (openedCharId) {
        setOpenedCharId(null);
        return true;
      }
      return false;
    });
    return unregister;
  }, [openedCharId, registerBackHandler]);

  // 同步 activeCharacterId — Chat.tsx 从 OSContext 拿这个值
  useEffect(() => {
    if (openedCharId && openedCharId !== activeCharacterId) {
      setActiveCharacterId(openedCharId);
    }
  }, [openedCharId, activeCharacterId, setActiveCharacterId]);

  // 已选角色 → 嵌套 Chat + 左上角返回按钮（叠在 Chat 之上，绕开 Chat 顶栏避免改 Chat.tsx）
  if (openedCharId) {
    return (
      <div className="absolute inset-0 flex flex-col">
        <div className="flex-1 relative overflow-hidden">
          <Chat />
          {/* 左上角"返回联系人列表"按钮 — absolute 浮在 Chat 顶栏左侧 */}
          <button
            onClick={() => setOpenedCharId(null)}
            className="absolute left-3 top-3 z-30 w-9 h-9 flex items-center justify-center rounded-full bg-white/85 backdrop-blur-sm shadow-md text-slate-600 hover:bg-white active:scale-95 transition-transform"
            aria-label="返回联系人"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 0 1-.02 1.06L8.832 10l3.938 3.71a.75.75 0 1 1-1.04 1.08l-4.5-4.25a.75.75 0 0 1 0-1.08l4.5-4.25a.75.75 0 0 1 1.06.02Z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
      </div>
    );
  }

  // 没选角色 → 联系人列表 + 三 Tab
  return (
    <div className="absolute inset-0 flex flex-col bg-[#ededed]">
      {/* 顶部 header */}
      <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-slate-200/60 shrink-0">
        <div className="w-9 h-9" />
        <h1 className="text-base font-semibold text-slate-800 tracking-wide">消息</h1>
        <button
          className="w-9 h-9 flex items-center justify-center rounded-full text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          aria-label="设置"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
            <path fillRule="evenodd" d="M7.84 1.804a1 1 0 0 1 .668-.943 5.5 5.5 0 0 1 3.066 0 1 1 0 0 1 .668.943V3.27a8.98 8.98 0 0 1 1.62.987 1 1 0 0 1 .318 1.243l-.6 1.13a8.963 8.963 0 0 1 1.171 1.785 1 1 0 0 1-.193 1.318l-1.04.97a7.013 7.013 0 0 1 0 1.948l1.04.97a1 1 0 0 1 .193 1.318 8.962 8.962 0 0 1-1.171 1.785l.6 1.13a1 1 0 0 1-.318 1.243 8.98 8.98 0 0 1-1.62.987v1.413a1 1 0 0 1-.668.943 5.5 5.5 0 0 1-3.066 0 1 1 0 0 1-.668-.943v-1.413a8.976 8.976 0 0 1-1.62-.987 1 1 0 0 1-.318-1.243l.6-1.13a8.963 8.963 0 0 1-1.171-1.785 1 1 0 0 1 .193-1.318l1.04-.97a7.013 7.013 0 0 1 0-1.948l-1.04-.97a1 1 0 0 1-.193-1.318 8.962 8.962 0 0 1 1.171-1.785l-.6-1.13a1 1 0 0 1 .318-1.243 8.98 8.98 0 0 1 1.62-.987V1.804Zm.4 7.696a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z" clipRule="evenodd" />
          </svg>
        </button>
      </div>

      {/* 三 Tab 切换 */}
      <div className="flex bg-white border-b border-slate-200/60 shrink-0">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 relative py-3 text-sm font-medium transition-colors ${
              tab === t.key ? 'text-emerald-600' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
            {tab === t.key && (
              <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-6 h-0.5 bg-emerald-500 rounded-full" />
            )}
          </button>
        ))}
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto">
        {tab === 'messages' && (
          <MessagesTab characters={characters} onOpenChar={setOpenedCharId} />
        )}
        {tab === 'discover' && (
          <PlaceholderTab title="发现" hint="朋友圈 · 收藏 · 日记 — 即将到来" />
        )}
        {tab === 'me' && (
          <PlaceholderTab title="我" hint="档案页面 — 即将接入" />
        )}
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
    <div className="px-3 py-3 space-y-2">
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

// === 子组件：占位 Tab（发现 / 我） ===
const PlaceholderTab: React.FC<{ title: string; hint: string }> = ({ title, hint }) => (
  <div className="flex flex-col items-center justify-center h-full py-24 text-slate-400">
    <div className="text-base font-medium text-slate-500 mb-2">{title}</div>
    <div className="text-xs">{hint}</div>
  </div>
);

export default WeChat;
