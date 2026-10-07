/**
 * 主聊天里的「剧场记录」块（暮色 10-07 21:10 定的）
 *
 * ## 为什么有这个块
 *
 * 剧场的话跟主聊天**存在同一张消息表**里，每条带一个「来自剧场」的标记
 * （`useTheaterLive` 入库时写的 `metadata.source = 'theater'`）。当初这么设计是为了
 * 「打标记就天然接上主聊天，不用做同步这个动作」。
 *
 * 代价是两头都失控了：
 *
 *   - **上下文**：`utils/chatPrompts.ts` 组装历史时**不过滤**剧场消息，一条条全塞进去，
 *     只在前面加个 `[剧场 第X集]`。剧场那边一旦复读（10-07 实测同一条说三遍），
 *     几百条垃圾就把上下文占满了，模型跟着变傻。
 *   - **界面**：`apps/Chat.tsx` 的 `displayMessages` 又**明确过滤掉**了
 *     `source === 'theater'`（同一张表，显示端不给看）。
 *
 * 两边一拼就成了「塞得满、看不见」——用户看得见聊天记录里没有剧场的话，
 * 却删不掉它们，因为界面上根本没有可以点的。
 *
 * ## 这块干什么
 *
 * 把剧场消息从消息表里单独捞出来，在聊天流最上面收成一块：
 *   - **折叠**：默认收起，只露一个胶囊标题（剧场里可能有几百条）
 *   - **单条**：展开后每条照常渲染，长按走主聊天现成的编辑/删除弹窗
 *   - **整块**：一颗「全删」把整块从消息表清掉 ——
 *     **上下文也就跟着干净了**（两边读的是同一张表），这才是解封剧场对话的前提
 *
 * ## 为什么不把消息渲染搬进来
 *
 * `MessageItem` 要吃十几个 props（语音、翻译、多选、头像尺寸…），搬一遍必然跟主聊天走样。
 * 所以这里只管「折叠壳」，每条消息长什么样由 Chat.tsx 传一个 `renderMessage` 进来 ——
 * 主聊天那套原样复用，不抄第二份。
 */

import React, { useMemo, useState } from 'react';
import { CaretDown, CaretUp, Trash, FilmSlate } from '@phosphor-icons/react';
import type { Message } from '../../types';
import Modal from '../os/Modal';

type Props = {
  /** 剧场消息（已按时间排好序） */
  msgs: Message[];
  /** 复用主聊天那套渲染，props 由 Chat.tsx 填 */
  renderMessage: (m: Message, isFirstInGroup: boolean, isLastInGroup: boolean) => React.ReactNode;
  /** 整块删除（真从消息表删，上下文同步干净） */
  onDeleteAll: () => void;
};

/**
 * ⚠️ 样式照抄主聊天那个「加载历史消息」胶囊（半透明白 + 白边 + 深色字）。
 * 主聊天**没有** `night` 这个字段（`types.ts` 的 ChatTheme 里只有 id/name/type/user/ai/customCss），
 * 那个按钮在夜间模式下也是这么一套，所以这里别自己另发明一套夜间判断。
 */
const TheaterRecordBlock: React.FC<Props> = ({ msgs, renderMessage, onDeleteAll }) => {
  // 默认收起：里面可能几百条，展开会把整个聊天流顶到下面看不见
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);

  /**
   * 分轮只看「角色有没有换」这一条。
   *
   * 主聊天那个 `calcBreaks` 还有互动卡、主动消息轮标识两套规则，剧场里都不会出现，
   * 搬过来只会多两行判断然后更难懂。
   */
  const items = useMemo(
    () => msgs.map((m, i) => ({
      m,
      isFirst: i === 0 || msgs[i - 1].role !== m.role,
      isLast: i === msgs.length - 1 || msgs[i + 1].role !== m.role,
    })),
    [msgs]
  );

  if (!msgs.length) return null;

  return (
    <>
      <div className="px-3 mb-3 rounded-2xl border border-white bg-white/50 backdrop-blur-sm shadow-sm">
        {/* 折叠头：一颗胶囊，点开/收起；右边一颗「全删」 */}
        <div className="flex items-center gap-2 px-2.5 py-2">
          <button
            onClick={() => setOpen((v) => !v)}
            className="flex-1 min-w-0 flex items-center justify-center gap-1.5 py-1.5 rounded-full bg-white/70 active:scale-[0.98] transition-transform"
          >
            <FilmSlate size={13} className="text-sky-500" />
            <span className="text-xs font-bold text-slate-600">剧场记录 {msgs.length} 条</span>
            {open
              ? <CaretUp size={12} className="text-slate-400" />
              : <CaretDown size={12} className="text-slate-400" />}
          </button>

          <button
            onClick={() => setConfirming(true)}
            className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-full bg-rose-100 text-rose-500 text-xs font-bold active:scale-95"
            title="删掉全部剧场记录"
          >
            <Trash size={12} weight="bold" />
            全删
          </button>
        </div>

        {/* 展开后：照常渲染，长按走主聊天现成的编辑/删除 */}
        {open && (
          <div className="px-1 pb-2 pt-1">
            {items.map(({ m, isFirst, isLast }) => (
              <div key={m.id}>{renderMessage(m, isFirst, isLast)}</div>
            ))}
          </div>
        )}
      </div>

      {/* 全删要二次确认 —— 删掉的是几千行上下文，误点一下就没了 */}
      <Modal
        isOpen={confirming}
        title="删掉全部剧场记录？"
        onClose={() => setConfirming(false)}
        footer={
          <>
            <button
              onClick={() => setConfirming(false)}
              className="flex-1 py-2.5 rounded-full bg-slate-100 text-slate-600 text-sm font-bold active:scale-95"
            >
              再想想
            </button>
            <button
              onClick={() => { setConfirming(false); onDeleteAll(); }}
              className="flex-1 py-2.5 rounded-full bg-rose-100 text-rose-600 text-sm font-bold active:scale-95"
            >
              全删 {msgs.length} 条
            </button>
          </>
        }
      >
        <p className="px-6 pb-2 text-center text-sm text-slate-500 leading-relaxed">
          这 {msgs.length} 条会从消息表里真删掉，
          <br />
          <span className="text-slate-400">角色也会忘记你们一起看过什么。</span>
        </p>
      </Modal>
    </>
  );
};

export default TheaterRecordBlock;
