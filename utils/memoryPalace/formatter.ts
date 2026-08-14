/**
 * Memory Palace — 召回结果格式化（EventBox 感知）
 *
 * 输入：hybridSearch + spreadActivation 后排序好的 ScoredMemory[]
 * 输出：注入 system prompt 的 markdown 文本
 *
 * 关键规则：
 *  - 命中盒内任一活节点 → 整盒（summary + 所有活节点）作为 1 个名额
 *  - 命中独立记忆（无 eventBoxId）→ 1 个名额
 *  - 同一 box 多次命中只算 1 次（按 box id 去重）
 *  - 总名额上限 MAX_OUTPUT_ITEMS（默认 15）
 *  - 状态面板由 buildStatusPanelSectionForInjection 拼在最前面，不占名额
 */

import type { Anticipation, EventBox, MemoryNode, ScoredMemory } from './types';
import { ROOM_CONFIGS, getRoomLabel } from './types';
import { MemoryNodeDB, EventBoxDB } from './db';
import { recordRecallReceipt } from './recallReceipts';
import { buildStatusPanelSectionForInjection } from './statusPanel';

const DEFAULT_MAX_OUTPUT_ITEMS = 15;
const MAX_LIVE_NODES_PER_BOX = 8; // 单盒最多展开多少条活节点（防止超大盒污染）

/**
 * 把记忆的 createdAt 格式化成「日期 时分 · 距今多久时段」
 * 暮色 2026-07-25：原版只输出日期，AI 看到 (2026/7/24, ...) 跟「今天 7/25」对比
 *   不会主动换算，会无意识复读 memory 内容里的「今晚/今天/昨天」等模糊时间词。
 *   现在加「具体几点」+「距今多久」+「智能时段」（早/中/晚/深夜），
 *   AI 一眼看到「1天前晚间」就不会再把昨天的「今晚」字面搬到现在。
 *
 * 输出示例：
 *   - 5 分钟前:     "2026/7/25 13:38 · 刚刚下午"
 *   - 30 分钟前:    "2026/7/25 13:13 · 30分钟前下午"
 *   - 5 小时前:     "2026/7/25 08:30 · 5小时前上午"
 *   - 1 天前:       "2026/7/24 22:30 · 1天前晚间"
 *   - 5 天前:       "2026/7/20 22:30 · 5天前晚间"
 *   - 1 个月前:     "2026/6/25 22:30 · 1个月前晚间"
 */
function formatMemoryTimestamp(ts: number): string {
  const d = new Date(ts);
  const now = Date.now();
  const dateStr = d.toLocaleDateString('zh-CN');
  const timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const hour = d.getHours();

  let timeOfDay = '凌晨';
  if (hour >= 5 && hour < 8) timeOfDay = '早晨';
  else if (hour >= 8 && hour < 12) timeOfDay = '上午';
  else if (hour >= 12 && hour < 14) timeOfDay = '中午';
  else if (hour >= 14 && hour < 18) timeOfDay = '下午';
  else if (hour >= 18 && hour < 20) timeOfDay = '傍晚';
  else if (hour >= 20 && hour < 23) timeOfDay = '晚上';
  else if (hour >= 23) timeOfDay = '深夜';

  const diffMs = now - ts;
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  let ageStr: string;
  if (diffMins < 1) ageStr = '刚刚';
  else if (diffMins < 60) ageStr = `${diffMins}分钟`;
  else if (diffHours < 24) ageStr = `${diffHours}小时`;
  else if (diffDays < 30) ageStr = `${diffDays}天`;
  else ageStr = `${Math.floor(diffDays / 30)}个月`;

  return `${dateStr} ${timeStr} · ${ageStr}前${timeOfDay}`;
}

interface RenderItem {
    /** 用于排序：取该 item 内最高的 finalScore */
    score: number;
    /** 用于按房间分组的代表房间 */
    room: string;
    /** 渲染好的内容文本块（不含 room 头） */
    body: string;
    /** 创建时间（用于次级排序） */
    createdAt: number;
    /** 重要性（用于次级排序） */
    importance: number;
    /** 调试日志用 */
    debugLabel: string;
    /** 实际落到 prompt 里的 memoryId 列表（事件盒会展开成 summary + 活节点） */
    sourceIds: string[];
}

/**
 * 话题盒展开 + 格式化为 Markdown
 *
 * 1. 加载便利贴置顶（不占 15 条名额）
 * 2. 把 ScoredMemory 按 eventBoxId 去重分组：
 *    - 命中带 eventBoxId 的记忆 → 整盒展开（summary + 活节点）
 *    - 独立记忆 → 单条展开
 * 3. 占用 MAX_OUTPUT_ITEMS 个名额，按 score 排序后按房间渲染
 */
export async function expandAndFormat(
    results: ScoredMemory[],
    charId: string,
    anticipations: Anticipation[] = [],
    userName?: string,
    /** 注入上限。rerank 启用时传 15 + topN，让 rerank 额外召回的不被切。 */
    maxOutputItems: number = DEFAULT_MAX_OUTPUT_ITEMS,
    /** 分数门槛过滤前的条数。0 = 没走门槛过滤。日志里显示"X 条中过滤 Y 条"。 */
    preFilterCount: number = 0,
): Promise<string> {
    const MAX_OUTPUT_ITEMS = maxOutputItems;
    // 0. 状态面板：拼在最前面，不占 15 条名额
    const statusPanelSection = buildStatusPanelSectionForInjection(
        (await import('./statusPanel')).getStatusPanel()
    );
    const allCharNodes = await MemoryNodeDB.getByCharId(charId);

    if (results.length === 0 && anticipations.length === 0 && statusPanelSection === '') return '';

    // 1. 按 eventBoxId 去重分组（同一 box 多次命中合并；保留命中里最高分作 box 分）
    //    boxItem: { boxId, topScore, hitNodeIds[] }
    const boxHits = new Map<string, { topScore: number; hitNodeIds: Set<string>; sample: ScoredMemory }>();
    const standaloneItems: ScoredMemory[] = [];

    for (const r of results) {
        if (r.node.archived) continue;          // 防御：理论上 archived 不会到这里

        const ebId = r.node.eventBoxId;
        if (ebId) {
            const cur = boxHits.get(ebId);
            if (!cur) {
                boxHits.set(ebId, {
                    topScore: r.finalScore,
                    hitNodeIds: new Set([r.node.id]),
                    sample: r,
                });
            } else {
                if (r.finalScore > cur.topScore) cur.topScore = r.finalScore;
                cur.hitNodeIds.add(r.node.id);
            }
        } else {
            standaloneItems.push(r);
        }
    }

    // 2. 加载所有 box 的完整内容
    const renderItems: RenderItem[] = [];
    const localNodeMap = new Map(allCharNodes.map(n => [n.id, n]));

    for (const [boxId, hit] of boxHits) {
        const box = await EventBoxDB.getById(boxId);
        if (!box) {
            // box 丢失 → 退化为单条命中
            renderItems.push(buildStandaloneItem(hit.sample));
            continue;
        }
        const item = await buildBoxItem(box, hit.topScore, localNodeMap);
        if (item) renderItems.push(item);
    }

    for (const r of standaloneItems) {
        renderItems.push(buildStandaloneItem(r));
    }

    // 3. 排序（finalScore 降序，同分时较新者优先）+ 截断到 MAX_OUTPUT_ITEMS
    renderItems.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return b.createdAt - a.createdAt;
    });
    const finalItems = renderItems.slice(0, MAX_OUTPUT_ITEMS);
    const cutItems = renderItems.slice(MAX_OUTPUT_ITEMS);

    // ── 召回回执：把这次实际注入 prompt 的 memoryId 落到 localStorage ──
    // 用途见 ./recallReceipts.ts。截断/过期记忆不计入。
    // 状态面板是 per-user 全局面板，不在 memory_nodes 表里，不计入回执。
    try {
        const injectedIds: string[] = [];
        for (const it of finalItems) injectedIds.push(...it.sourceIds);
        recordRecallReceipt(charId, injectedIds);
    } catch (e) {
        // 回执只是 extraction 阶段的辅助，写失败不影响本次召回输出
        console.warn('🏰 [MemoryPalace] recordRecallReceipt failed:', e);
    }

    // ─── 调试：打印最终注入 prompt 的完整列表 ─────────────
    //
    // 打开控制台展开这个 group，能看到：
    //  - 每条的 rank / score / 所属房间 / 完整文字 / 字数
    //  - 是独立记忆还是事件盒（盒子会打印 summary + 所有活节点完整内容，
    //    验证盒内成员有没有真的一起出来）
    //  - 被截断的 item 也会列出来（标 ✂️），方便判断是不是应该注入的事件盒被挤掉了
    const finalTotalChars = finalItems.reduce((s, it) => s + it.body.length, 0);
    const filteredByThreshold = preFilterCount > 0 ? preFilterCount - finalItems.length - cutItems.length : 0;
    const summaryParts: string[] = [`盒子 ${boxHits.size}`, `独立 ${standaloneItems.length}`];
    if (filteredByThreshold > 0) {
        summaryParts.push(`门槛过滤 ${filteredByThreshold}`);
    }
    if (cutItems.length > 0) {
        summaryParts.push(`✂️ cut ${cutItems.length}`);
    }
    const summaryLabel = preFilterCount > 0
        ? `🏰 [MemoryPalace] 最终注入 prompt：${preFilterCount} 条中过滤 ${filteredByThreshold} 条，实际注入 ${finalItems.length} 条 · ${finalTotalChars} 字（${summaryParts.join(' | ')}）`
        : `🏰 [MemoryPalace] 最终注入 prompt：${finalItems.length} 条 · ${finalTotalChars} 字（${summaryParts.join(' | ')}）`;
    console.groupCollapsed(summaryLabel);
    finalItems.forEach((it, i) => {
        const isBox = it.debugLabel.startsWith('box ');
        const scoreStr = it.score.toFixed(3);
        const chars = it.body.length;
        if (isBox) {
            // 从 boxHits 里找到具体是哪个盒子 + 命中了几条
            const boxId = it.debugLabel.slice(4).split(' ')[0];
            const hit = boxHits.get(boxId);
            const hitCount = hit?.hitNodeIds.size ?? 0;
            const meta = it.debugLabel.slice(4 + boxId.length + 1); // "(N live + summary)"
            console.log(
                `#${i + 1} [${it.room}] score=${scoreStr}`
                + ` 📦 ${boxId} ${meta} · 命中 ${hitCount} 条 · ${chars} 字\n${it.body}`
            );
        } else {
            const nodeId = it.debugLabel.slice(4); // "mem xxx" → "xxx"
            console.log(
                `#${i + 1} [${it.room}] score=${scoreStr}`
                + ` 🔹 独立 ${nodeId} · ${chars} 字\n${it.body}`
            );
        }
    });
    if (cutItems.length > 0) {
        console.groupCollapsed(`✂️ 被截断的 ${cutItems.length} 条（排在 15 名之外，不注入）`);
        cutItems.forEach((it, i) => {
            console.log(
                `#${MAX_OUTPUT_ITEMS + i + 1} [${it.room}] score=${it.score.toFixed(3)}`
                + ` ${it.debugLabel.startsWith('box ') ? '📦' : '🔹'} ${it.debugLabel} · ${it.body.length} 字`
            );
        });
        console.groupEnd();
    }
    console.groupEnd();

    // 4. 按房间分组渲染
    let output = `### 记忆宫殿 (Memory Palace)\n`;
    output += `以下是你脑海中浮现的相关记忆片段，它们可能影响你此刻的感受和反应：\n\n`;

    // 4a. 状态面板（per-user 全局，拼在最前面，不占 15 条名额；全空时不注入）
    if (statusPanelSection) {
        output += statusPanelSection;
    }

    // 按房间分组（保持房间显示顺序：卧室 > 客厅 > 书房 > 用户房间 > 自我房间 > 阁楼 > 窗台）
    const byRoom = new Map<string, RenderItem[]>();
    for (const it of finalItems) {
        const arr = byRoom.get(it.room) || [];
        arr.push(it);
        byRoom.set(it.room, arr);
    }
    const roomOrder = ['bedroom', 'living_room', 'study', 'user_room', 'self_room', 'attic', 'windowsill'];
    for (const room of roomOrder) {
        const items = byRoom.get(room);
        if (!items || items.length === 0) continue;
        const roomLabel = getRoomLabel(room as any, userName);
        const roomDesc = ROOM_CONFIGS[room as keyof typeof ROOM_CONFIGS]?.description || '';
        for (const it of items) {
            output += `**[${roomLabel} · ${roomDesc}]** ${it.body}\n\n`;
        }
    }

    // 5. 窗台期盼
    const activeAnticipations = anticipations.filter(a => a.status === 'active' || a.status === 'anchor');
    if (activeAnticipations.length > 0) {
        output += `> **窗台期盼**:\n`;
        for (const ant of activeAnticipations) {
            const label = ant.status === 'anchor' ? '🔒 锚点' : '✨ 期盼';
            output += `> - ${label}: ${ant.content}\n`;
        }
        output += `\n`;
    }

    const trimmed = output.trim();
    // 暮色 2026-07-18：限制 memoryPalace 总字符数 ≤ 8000（约 3000 tokens）
    //   改前：recursion 结果可能 5000-10000 chars，让 system 字段变大 → cache_creation 写入量变贵
    //   改后：截到 8000 chars 后追加"（内容已截断，避免 prompt 过长）"提示
    //   副作用：超长召回会丢一些尾部条目，但优先级低的本来就不重要
    const MAX_MEMORY_PALACE_CHARS = 8000;
    const finalOutput = trimmed.length > MAX_MEMORY_PALACE_CHARS
        ? trimmed.slice(0, MAX_MEMORY_PALACE_CHARS) + '\n\n（内容已截断，避免 prompt 过长）'
        : trimmed;
    console.log(`🏰 [MemoryPalace] 本次召回 ${finalItems.length} 条 (${boxHits.size} 个 box + ${standaloneItems.length} 条独立)，${finalOutput.length}/${trimmed.length} 字`);
    return finalOutput;
}

// ─── 子渲染：单条独立记忆 ──────────────────────────────

function buildStandaloneItem(r: ScoredMemory): RenderItem {
    const node = r.node;
    // 暮色 2026-07-25：日期升级到「日期 时分 · 距今多久时段」 — 防止 AI 复读记忆里
    //   的「今晚/今天」字面，不主动换算成「昨天/前天」
    const ts = formatMemoryTimestamp(node.createdAt);
    const body = `(${ts}, 重要性: ${node.importance})\n${node.content}`;
    return {
        score: r.finalScore,
        room: node.room,
        body,
        createdAt: node.createdAt,
        importance: node.importance,
        debugLabel: `mem ${node.id}`,
        sourceIds: [node.id],
    };
}

// ─── 子渲染：整个 EventBox（summary + 活节点） ──────────

async function buildBoxItem(
    box: EventBox,
    topScore: number,
    localNodeMap: Map<string, MemoryNode>,
): Promise<RenderItem | null> {
    // 加载 summary（如有）
    let summary: MemoryNode | null = null;
    if (box.summaryNodeId) {
        const s = localNodeMap.get(box.summaryNodeId) || (await MemoryNodeDB.getById(box.summaryNodeId)) || null;
        if (s) summary = s;
    }
    // 加载活节点（按时间升序）
    const liveNodes: MemoryNode[] = [];
    for (const id of box.liveMemoryIds) {
        const n = localNodeMap.get(id) || (await MemoryNodeDB.getById(id));
        if (n && !n.archived) liveNodes.push(n);
    }
    liveNodes.sort((a, b) => a.createdAt - b.createdAt);

    if (!summary && liveNodes.length === 0) return null; // 空盒，跳过

    // 决定房间：summary 优先；否则用最重要的活节点的房间
    const repNode = summary || liveNodes.reduce((acc, n) => (n.importance > acc.importance ? n : acc), liveNodes[0]);
    const room = repNode.room;
    const importance = repNode.importance;
    const createdAt = summary?.createdAt || liveNodes[liveNodes.length - 1]?.createdAt || box.updatedAt;

    // 渲染：盒子标题 + summary（如有）+ 活节点条目
    const liveToShow = liveNodes.slice(0, MAX_LIVE_NODES_PER_BOX);
    const omitted = liveNodes.length - liveToShow.length;

    let body = `📦 **事件盒：${box.name}**`;
    if (box.tags.length > 0) body += `  〈${box.tags.slice(0, 6).join(' · ')}〉`;
    body += '\n';

    if (summary) {
        // 暮色 2026-07-25：summary 时间戳升级到「日期 时分 · 距今多久时段」
        const sTs = formatMemoryTimestamp(summary.createdAt);
        body += `_整合回忆_ (${sTs}, 重要性 ${summary.importance}, 已压缩 ${box.compressionCount} 次)\n`;
        body += `${summary.content}\n`;
    }

    if (liveToShow.length > 0) {
        body += summary ? `_新增片段_：\n` : '';
        for (const n of liveToShow) {
            // 暮色 2026-07-25：活节点时间戳同样升级
            const nTs = formatMemoryTimestamp(n.createdAt);
            body += `- [${nTs}] ${n.content}\n`;
        }
        if (omitted > 0) body += `（另有 ${omitted} 条同盒活节点未展示）\n`;
    }

    const sourceIds: string[] = [];
    if (summary) sourceIds.push(summary.id);
    for (const n of liveToShow) sourceIds.push(n.id);

    return {
        score: topScore,
        room,
        body: body.trimEnd(),
        createdAt,
        importance,
        debugLabel: `box ${box.id} (${liveNodes.length} live${summary ? ' + summary' : ''})`,
        sourceIds,
    };
}
