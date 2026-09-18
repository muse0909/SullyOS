// utils/coReadChapterParser.ts
// 麦麦 2026-09-18：共读 txt 解析工具
//   - encoding 识别（UTF-8 / UTF-16 LE/BE / GBK），中文 txt 不怕乱码
//   - 7-8 种本地正则拆章（命中数最多的胜出）
//   - 兜底按 5000 字切片（章节数 = 1 时 fallback）
//   - 步骤 4 帮工 API 兜底：在本地所有正则都不命中 / 命中的章节数 < 预期时
//     把"疑似标题的短行 + 行号"发给帮工，帮工返回真标题行号列表

// ─── 编码识别 ────────────────────────────────────

export type FileEncoding = 'utf-8' | 'utf-16' | 'gbk';

/**
 * 看头几个字节做编码判断：
 *   - UTF-8 BOM：EF BB BF
 *   - UTF-16 LE BOM：FF FE
 *   - UTF-16 BE BOM：FE FF（少见,按 BE 处理）
 *   - GBK：无 BOM + 大量双字节 → 抽样解码看是否合理中文
 */
export function detectFileEncoding(buffer: ArrayBuffer, fallbackTextSample?: string): FileEncoding {
  const u8 = new Uint8Array(buffer);
  if (u8.length >= 3 && u8[0] === 0xEF && u8[1] === 0xBB && u8[2] === 0xBF) {
    return 'utf-8';
  }
  if (u8.length >= 2 && u8[0] === 0xFF && u8[1] === 0xFE) {
    return 'utf-16';
  }
  if (u8.length >= 2 && u8[0] === 0xFE && u8[1] === 0xFF) {
    return 'utf-16'; // BE 也按 utf-16 走，decodeByEncoding 处理
  }
  // 没有 BOM：尝试 UTF-8 解码，看是否大多合法
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const decoded = decoder.decode(buffer);
    // 中文段落里 UTF-8 中文每字符 3 字节；高比例的 ASCII + 零中文 → 可能是 GBK 当 UTF-8 看
    // 简单启发：如果解码后的字符串里有 "" 替换字符数量 > 阈值，认为不是 UTF-8
    const replaced = (decoded.match(/\uFFFD/g) || []).length;
    const totalChars = decoded.length || 1;
    if (replaced / totalChars > 0.01) {
      return 'gbk';
    }
    return 'utf-8';
  } catch {
    // fatal=true 时 UTF-8 解码失败 → 多半是 GBK
    return 'gbk';
  }
}

/**
 * 按指定编码解码整个 buffer 为字符串
 */
export function decodeByEncoding(buffer: ArrayBuffer, encoding: FileEncoding): string {
  try {
    if (encoding === 'utf-16') {
      // 先按 utf-16le 试一次，失败再 utf-16be
      try {
        return new TextDecoder('utf-16le').decode(buffer);
      } catch {
        return new TextDecoder('utf-16be').decode(buffer);
      }
    }
    return new TextDecoder(encoding === 'gbk' ? 'gbk' : 'utf-8').decode(buffer);
  } catch (e) {
    // GBK 在某些浏览器没有支持，fallback 用 utf-8 看运气
    console.warn('[coRead] decode failed, fallback utf-8:', e);
    return new TextDecoder('utf-8').decode(buffer);
  }
}

// ─── 章节拆分 ─────────────────────────────────────

export interface ParsedChapter {
  index: number;        // 0-based
  title: string;
  content: string;
  charCount: number;    // content.length
}

export type ChapterSplitMethod = 'regex-auto' | 'helper-llm' | 'fallback-chunks';

export interface SplitResult {
  method: ChapterSplitMethod;
  chapters: ParsedChapter[];
  matchedRule?: string; // 命中的正则名称,仅 regex-auto 时有
}

// 每条规则试一遍：返回 { ruleName, chapters, count }
// 命中数最多的胜出（要求 count >= 2,避免"假阳性"）
interface Rule {
  name: string;
  test: (line: string) => string | null; // 返回章节标题字符串(或 null 表示这一行不是章节标题)
}

const CHAPTER_RULES: Rule[] = [
  // 1. 中文 "第一章 标题" 或 "第1章 标题"
  {
    name: 'cn-第X章',
    test: (line) => {
      const m = line.match(/^第[一二三四五六七八九十百千零〇0-9]+章[ \t　]*(.*?)$/);
      return m ? (m[1].trim() || line.trim()) : null;
    },
  },
  // 2. English "Chapter 1: 标题" / "Chapter 1 标题"
  {
    name: 'en-Chapter',
    test: (line) => {
      const m = line.match(/^Chapter\s+\d+[ \t　:.：\-—]*(.*?)$/i);
      return m ? (m[1].trim() || line.trim()) : null;
    },
  },
  // 3. "CHAPTER I 标题"
  {
    name: 'en-CHAPTER-ROMAN',
    test: (line) => {
      const m = line.match(/^CHAPTER\s+[IVXLCDM]+[ \t　:.：\-—]*(.*?)$/);
      return m ? (m[1].trim() || line.trim()) : null;
    },
  },
  // 4. 中文 "卷一 标题" / "卷1：标题"
  {
    name: 'cn-卷X',
    test: (line) => {
      const m = line.match(/^卷[一二三四五六七八九十百千零〇0-9]+[ \t　:.：\-—]*(.*?)$/);
      return m ? (m[1].trim() || line.trim()) : null;
    },
  },
  // 5. 序章 / 序言 / 楔子 / 前言 / Prologue
  {
    name: 'prologue',
    test: (line) => {
      if (/^(序章|序言|楔子|前言|引子|Prologue|PROLOGUE)[ \t　:.：]*.*$/.test(line)) {
        return line.trim();
      }
      return null;
    },
  },
  // 6. 终章 / 尾声 / 番外 / 后记 / Epilogue
  {
    name: 'epilogue',
    test: (line) => {
      if (/^(终章|尾声|番外|后记|结语|Epilogue|EPILOGUE)[ \t　:.：]*.*$/.test(line)) {
        return line.trim();
      }
      return null;
    },
  },
  // 7. 编号格式 "1 标题" / "0001 标题" / "001. 标题"
  //   必须纯数字开头且后面是空格或 .——避免与正文中的"今天天气..."冲突
  {
    name: 'numbered',
    test: (line) => {
      const m = line.match(/^[ \t　]*(\d{1,5})[ \t　.．、:：]+(.+?)$/);
      if (!m) return null;
      const num = parseInt(m[1], 10);
      if (isNaN(num) || num < 1 || num > 9999) return null;
      const title = m[2].trim();
      // 标题不能太长（避免误把段落当标题）
      if (title.length > 60) return null;
      return title;
    },
  },
  // 8. 连载编号 "0001 01 标题" 这种格式
  //   必须两段都是数字 + 第三段是中文 (>= 2 个汉字)
  {
    name: 'serial-num',
    test: (line) => {
      const m = line.match(/^[ \t　]*(\d{2,5})\s+(\d{1,4})\s+(.+)$/);
      if (!m) return null;
      const title = m[3].trim();
      if (title.length < 2) return null;
      return title;
    },
  },
];

/**
 * 主入口：拆章
 *   1) 试每条规则 — 取章节数最多且 >= 2 的胜出
 *   2) 都不行（< 2 章）→ 兜底按 5000 字切片，标题"第X部分"
 *
 * 注意：本函数是"纯本地"的——不需要 AI。
 *   步骤 4 在"帮工 API 设置"开启后,主流程会先调本函数；
 *   本函数返回章节数 < 期望阈值（如 5）时才会调用帮工。
 */
export function splitIntoChapters(text: string): SplitResult {
  const lines = text.split(/\r?\n/);
  let bestResult: { ruleName: string; chapterLineIndices: number[]; titles: string[] } | null = null;

  for (const rule of CHAPTER_RULES) {
    const chapterLineIndices: number[] = [];
    const titles: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const t = rule.test(line);
      if (t) {
        chapterLineIndices.push(i);
        titles.push(t);
      }
    }
    if (chapterLineIndices.length < 2) continue;
    // 章节数越多越好；同样多时，按规则优先级（前面规则先到先得）
    if (!bestResult || chapterLineIndices.length > bestResult.chapterLineIndices.length) {
      bestResult = { ruleName: rule.name, chapterLineIndices, titles };
    }
  }

  if (bestResult) {
    const { ruleName, chapterLineIndices, titles } = bestResult;
    const chapters: ParsedChapter[] = [];
    for (let i = 0; i < chapterLineIndices.length; i++) {
      const startLine = chapterLineIndices[i];
      const endLine = i + 1 < chapterLineIndices.length ? chapterLineIndices[i + 1] : lines.length;
      const chapterLines = lines.slice(startLine + 1, endLine); // 标题行不计
      const content = chapterLines.join('\n').trim();
      chapters.push({
        index: i,
        title: titles[i],
        content,
        charCount: content.length,
      });
    }
    return { method: 'regex-auto', chapters, matchedRule: ruleName };
  }

  // 都没命中 → 按 5000 字兜底切片
  return fallbackSplitByChunks(text, 5000);
}

/**
 * 兜底拆章：按 charsPerChunk 切片,标题"第 N 部分"
 *   切点尽量在段落(连续 \n\n)处,以保留语义
 */
export function fallbackSplitByChunks(text: string, charsPerChunk: number = 5000): SplitResult {
  if (!text || text.length <= charsPerChunk) {
    return {
      method: 'fallback-chunks',
      chapters: [{
        index: 0,
        title: '全文',
        content: text.trim(),
        charCount: text.length,
      }],
    };
  }
  const chapters: ParsedChapter[] = [];
  let i = 0;
  let partIndex = 0;
  while (i < text.length) {
    let end = Math.min(i + charsPerChunk, text.length);
    if (end < text.length) {
      // 试图在 \n\n 附近切(±20 字符范围内)
      const searchWindow = text.substring(end, Math.min(end + 50, text.length));
      const paraBreak = searchWindow.indexOf('\n\n');
      if (paraBreak >= 0 && paraBreak < 50) {
        end = end + paraBreak + 2;
      }
    }
    const content = text.substring(i, end).trim();
    if (content) {
      chapters.push({
        index: partIndex,
        title: `第 ${partIndex + 1} 部分`,
        content,
        charCount: content.length,
      });
      partIndex += 1;
    }
    i = end;
  }
  return { method: 'fallback-chunks', chapters };
}

/**
 * 帮工 API 兜底用的工具：
 *   提取疑似标题的"短行"(长度 < 60 且 非空) + 它们的行号
 *   把这些发给帮工,帮工返回真标题的行号列表
 *   不发全文 — 只发行的开头几字符 + 行号 — 隐私 + 便宜
 */
export function extractTitleCandidates(text: string, maxLength: number = 60): Array<{ lineNo: number; preview: string }> {
  const lines = text.split(/\r?\n/);
  const out: Array<{ lineNo: number; preview: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) continue;
    if (t.length > maxLength) continue;
    // 排除全空白、全数字、含太多标点的行(降低噪音)
    if (/^[\d\s.,，。!?！？、:：\-—]+$/.test(t)) continue;
    out.push({ lineNo: i, preview: t.length > 40 ? t.substring(0, 40) + '...' : t });
    if (out.length > 200) break; // 上限,避免帮工被淹没
  }
  return out;
}
