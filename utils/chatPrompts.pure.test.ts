// 纯聊天模式（char.chatMode === 'pure'）—— 2026-10-04 麦麦
//
// 这个模式是暮色的**工作台**：他用贵的按量模型找角色聊技术、理思路、写更清楚的指令，
// 输入 token 是真金白银。所以它的验收标准不是"跑起来没报错"，而是
// **"该关的真的一个都没进请求体"**——症状只是"token 没省下来"，不报错、不报警，
// 漏了几个月都看不出来。所以这里逐条钉死。
//
// 另一条同样重要的：**完整模式不能被这次改动碰到**。断言写在最后一组。

import { describe, it, expect } from 'vitest';
import { ChatPrompts } from './chatPrompts';
import type { CharacterProfile, UserProfile } from '../types';

const makeChar = (over: Partial<CharacterProfile> = {}): CharacterProfile => ({
  id: 'char-test',
  name: '江澈',
  systemPrompt: '你叫江澈，说话直接，不绕。',
  chatMode: 'pure',
  ...over,
} as CharacterProfile);

const makeUser = (over: Partial<UserProfile> = {}): UserProfile => ({
  name: '暮色',
  bio: '做产品的，脑子偶尔不转，需要人帮他捋清楚。',
  ...over,
} as UserProfile);

const build = (char: CharacterProfile, user: UserProfile = makeUser()) =>
  ChatPrompts.buildSystemPrompt(char, user, [], [], [], []);

describe('纯聊天模式：一件不该出现的东西都不能出现', () => {
  it('不含标记类功能：表情库 / 思维链 / 引用 / 回戳 / 转账 / 纪念日 / 定时消息', async () => {
    const out = await build(makeChar());
    const all = `${out.bp1Tools}\n${out.bp2Rules}\n${out.bp3Context}`;
    for (const bad of [
      'SEND_EMOJI',    // 表情库（含那份清单）
      'THOUGHT',       // 思维链
      'QUOTE',         // 引用
      'ACTION:POKE',   // 回戳
      'TRANSFER',      // 转账
      'ADD_EVENT',     // 添加纪念日
      'schedule_message',  // 定时发送消息
      'schedule_next_wakeup', // 唤醒时间指南
    ]) {
      expect(all, `纯聊天不该出现 ${bad}`).not.toContain(bad);
    }
  });

  it('不含外部功能段：朋友圈 / 小纸条 / 信箱 / 共读 / 音乐 / 小红书 / 日程 / 搜索 / Notion / 飞书', async () => {
    const out = await build(makeChar());
    const all = `${out.bp1Tools}\n${out.bp2Rules}\n${out.bp3Context}`;
    for (const bad of [
      'MOMENT_POST', '朋友圈',
      'XIAO_ZHI_TIAO', '小纸条',
      '信箱',
      '共读',
      'MCP', 'Notion', '飞书', '小红书',
      'search', '搜索',
    ]) {
      expect(all, `纯聊天不该出现 ${bad}`).not.toContain(bad);
    }
  });

  it('不带情绪底色 buffInjection（角色带 buffInjection 也不能漏进来）', async () => {
    const out = await build(makeChar({ buffInjection: '【情绪底色】今天心情很好' } as never));
    expect(out.bp3Context).not.toContain('今天心情很好');
  });

  it('不带记忆宫殿（角色带 memoryPalaceInjection 也不能漏进来）', async () => {
    const out = await build(makeChar({ memoryPalaceInjection: '【记忆宫殿】他上周说过要做纯聊天模式' } as never));
    expect(out.bp3Context).not.toContain('记忆宫殿');
  });

  it('不带角色备忘录 / 状态面板（哪怕角色真写了 memo）', async () => {
    const out = await build(makeChar({
      characterMemo: [{ id: 'm1', region: 'core', text: '他讨厌粉色' }],
    } as never));
    expect(out.bp3Context).not.toContain('他讨厌粉色');
  });

  it('动态尾巴全空（真实世界感知 / 意识流 / 热搜 / 天气都不给）', async () => {
    const out = await build(makeChar());
    expect(out.dynamicTail.realtimeText).toBe('');
    expect(out.dynamicTail.hotNewsText).toBe('');
    expect(out.dynamicTail.innerState).toBe('');
  });
});

describe('纯聊天模式：该留的一件都不能少（砍过头也是 bug）', () => {
  it('留「他是谁」：角色核心设定 + 互动对象(用户画像)', async () => {
    const out = await build(makeChar());
    expect(out.bp3Context).toContain('江澈');
    expect(out.bp3Context).toContain('暮色');
    // 用户画像就是 user.bio —— 暮色在「个人档案 → 关于我 / 设定」里填的那段
    expect(out.bp3Context).toContain('做产品的');
  });

  it('留「怎么说话」：沉浸感 / 行为模式 / 对话质量 / 格式要求 / 环境感知', async () => {
    const out = await build(makeChar());
    const rules = out.bp1Tools;
    expect(rules).toContain('沉浸感');
    expect(rules).toContain('行为模式');
    expect(rules).toContain('对话质量');
    expect(rules).toContain('格式要求');
    expect(rules).toContain('环境感知');
    // 换行符分气泡这条是渲染层的硬要求，砍了所有多气泡消息会挤成一段
    expect(rules).toContain('换行符');
  });

  it('留调取记忆 [[RECALL:]]（暮色 10-4 拍板：理思路常常横跨好几次对话）', async () => {
    const out = await build(makeChar());
    expect(out.bp1Tools).toContain('RECALL');
  });

  it('留一句语音禁令（不传 <语音> 教学，但历史里可能出现过，模型会照着学）', async () => {
    const out = await build(makeChar());
    expect(out.bp2Rules).toContain('语音');
    expect(out.bp2Rules).toContain('严禁');
  });
});

describe('纯聊天模式：走的是独立短路径，不是"完整模式减法"', () => {
  it('聊天模式参数为 undefined 时按角色自己的设置判（老角色不算 pure）', async () => {
    const out = await build(makeChar({ chatMode: undefined }));
    // 完整模式：表情库那条得回来
    expect(`${out.bp1Tools}`).toContain('SEND_EMOJI');
  });

  it('显式传 full 覆盖角色设置，走完整模式', async () => {
    // ⚠️ chatMode 是第 12 个参数（char/user/groups/emojis/categories/currentMsgs/
    //    realtimeConfig/evolvedNarrative/userListeningContext/isListeningTogether/musicCfg/
    //    chatMode/...）。少传两个就落到 realtimeConfig 头上——这个坑项目里踩过
    //    （chatPrompts.ts 的 chatMode 参数就是为 22 个错位调用点放宽的）。
    const out = await ChatPrompts.buildSystemPrompt(
      makeChar({ chatMode: 'pure' }), makeUser(), [], [], [], [],
    );
    const full = await ChatPrompts.buildSystemPrompt(
      makeChar({ chatMode: 'pure' }), makeUser(), [], [], [], [],
      undefined, undefined, undefined, undefined, undefined, 'full', false,
    );
    expect(full.bp1Tools).toContain('SEND_EMOJI');
    expect(out.bp1Tools).not.toContain('SEND_EMOJI');
  });
});

/**
 * 10-4 交付前自查时发现的坑：纯聊天判定是 `chatMode ?? char.chatMode ?? 'full'`。
 *
 * 那个 `?? char.chatMode` 是 2026-07-18 就有的（老角色不传 chatMode 时按自己的设置判），
 * 一直没问题。但 10-4 把纯聊天改成"早返回的独立短路径"之后，它变成了一个陷阱：
 * **任何不传 chatMode 的调用点，都会跟着角色的开关走。**
 *
 * 当时有三个这样的调用点，都是"主动消息/即时对话"这类**要完整上下文**的路：
 *   - context/OSContext.tsx      主动消息到点生成
 *   - utils/chatRequestPayload.ts 即时对话回复
 *   - utils/activeMsgClient.ts   fire_pack 模板（碰巧安全：options 对象落在同一位置，判不等）
 *
 * 后果：角色一开纯聊天，他的主动消息也跟着变成贫瘠版。已三个都显式传 'full' 修掉。
 *
 * **加新调用点时记得传。** 漏传的表现是"某个非聊天功能突然变傻"，不会报错。
 */
describe('纯聊天模式：不该跟着走的路径不能跟着走', () => {
  it('不传 chatMode 时确实 fallback 到角色设置（所以调用点必须显式传）', async () => {
    const out = await build(makeChar({ chatMode: 'pure' }));
    expect(out.bp1Tools).not.toContain('SEND_EMOJI');
    // 反证：完整模式角色的默认行为没变
    const normal = await build(makeChar({ chatMode: 'full' }));
    expect(normal.bp1Tools).toContain('SEND_EMOJI');
  });
});
