#!/usr/bin/env node
// scripts/amsg-task-inspect.mjs
/**
 * 把云端任务表读成一张人能核对的表 —— 主动消息 2.0 排障用。
 *
 * 为什么要有这个：任务内容在 D1 里是**加密**的（`iv:authTag:data` 三段 hex，
 * key = sha256(主密钥 + 用户身份) 取前 64 位）。想知道某条任务的「作废策略」和
 * 「有没有被翻成遇忙作废」这两个字段，只能解开看——之前每次都得临时写一遍解密，
 * 换个字段就再写一遍。这个脚本把那件事固化下来。
 *
 * 用法（两种模式）：
 *
 *   1) 不解密，只看调度状态（不需要任何密钥）
 *      CF_API_TOKEN=xxx node scripts/amsg-task-inspect.mjs
 *
 *   2) 连内容一起解开（需要主密钥 + 用户身份）
 *      CF_API_TOKEN=xxx AMSG_MASTER_KEY=<64位hex> AMSG_USER_ID=<uuid> \
 *        node scripts/amsg-task-inspect.mjs
 *
 * 环境变量：
 *   CF_API_TOKEN    必需。Cloudflare API Token（Workers Scripts:Read + D1:Read）
 *   CF_ACCOUNT_ID  可选，默认取 token 能看到的第一个账号
 *   CF_D1_ID       可选，默认按名字 sully-amsg2 找
 *   AMSG_MASTER_KEY 可选。给了才解密内容
 *   AMSG_USER_ID    可选。给了才解密内容（= 面板上「X-User-Id」那个）
 *
 * 密钥只从环境变量读，不写文件、不打印、不进仓库。
 */

import { createHash } from 'node:crypto';

const CF_API = 'https://api.cloudflare.com/client/v4';

const token = (process.env.CF_API_TOKEN || '').trim();
if (!token) {
  console.error('缺少 CF_API_TOKEN。看 README 顶部那段「用法」，或问我要。');
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
};

const api = async (path, init) => {
  const res = await fetch(`${CF_API}${path}`, { ...init, headers });
  const body = await res.json().catch(() => null);
  if (!body?.success) {
    const err = (body?.errors || []).map((e) => e.message).join('; ') || `HTTP ${res.status}`;
    throw new Error(`${path} → ${err}`);
  }
  return body.result;
};

const query = async (dbId, sql) => {
  const out = await api(`/accounts/${accountId}/d1/database/${dbId}/query`, {
    method: 'POST',
    body: JSON.stringify({ sql }),
  });
  return out?.[0]?.results ?? [];
};

// ── 找账号和库 ─────────────────────────────────────────

let accountId = (process.env.CF_ACCOUNT_ID || '').trim();
if (!accountId) {
  const accounts = await api('/accounts');
  if (!accounts?.length) throw new Error('这枚 token 看不到任何账号。');
  accountId = accounts[0].id;
}

let dbId = (process.env.CF_D1_ID || '').trim();
if (!dbId) {
  const dbs = await api(`/accounts/${accountId}/d1/database`);
  const found = (dbs || []).find((d) => d.name === 'sully-amsg2');
  if (!found) {
    console.error('这个账号里没有叫 sully-amsg2 的库。现有的是：');
    (dbs || []).forEach((d) => console.error(`  - ${d.name} (${d.uuid})`));
    process.exit(1);
  }
  dbId = found.uuid;
}

// ── 解密（跟云端 deriveUserEncryptionKey 逐字对齐）──────

const masterKey = (process.env.AMSG_MASTER_KEY || '').trim();
const userId = (process.env.AMSG_USER_ID || '').trim();
const willDecrypt = Boolean(masterKey && userId);

let cachedUserKey = null;
const userKey = () => {
  if (!cachedUserKey) {
    const digest = createHash('sha256').update(masterKey + userId, 'utf8').digest('hex');
    cachedUserKey = digest.slice(0, 64);
  }
  return cachedUserKey;
};

const fromHex = (hex) => Uint8Array.from(hex.match(/../g).map((b) => parseInt(b, 16)));

async function decryptPayload(cipherText, keyHex) {
  const [ivHex, authTagHex, dataHex] = String(cipherText).split(':');
  if (!ivHex || !authTagHex || !dataHex) return { error: '密文格式不是 iv:authTag:data' };
  const key = await crypto.subtle.importKey(
    'raw', fromHex(keyHex), { name: 'AES-GCM' }, false, ['decrypt'],
  );
  // ⚠ 拼接顺序必须是「密文 + 标签」，不是反过来。
  //   云端 aesGcmOpen 传的是 concatBytes(ciphertext, authTag)（见 bundle 1369 行），
  //   WebCrypto 解密时把 trailing 那一段当 auth tag 读。顺序反了会算出完全不同的
  //   认证标签，AES-GCM 直接判失败——症状是"钥匙错了"，但其实钥匙是对的。
  const joined = new Uint8Array(fromHex(dataHex).length + fromHex(authTagHex).length);
  joined.set(fromHex(dataHex), 0);
  joined.set(fromHex(authTagHex), fromHex(dataHex).length);
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromHex(ivHex), tagLength: 128 }, key, joined,
    );
    return { value: new TextDecoder().decode(plain) };
  } catch (e) {
    return { error: `解不开（${String(e).slice(0, 60)}）——钥匙对但解不开，或 AMSG_MASTER_KEY 不是这把后端用的` };
  }
}

/**
 * 解开一段云端状态值。跟云端 unpackStateValue 同口径：先解 AES-GCM，
 * 再认 `gz1:` 前缀（gzip 压缩过的值，角色记忆包那种大的会被压）。
 */
async function readStateValue(cipherText, keyHex) {
  const decrypted = await decryptPayload(cipherText, keyHex);
  if (decrypted.error) return { error: decrypted.error };
  let text = decrypted.value;
  if (text.startsWith('gz1:')) {
    try {
      const bytes = new TextEncoder().encode(text.slice(4));
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
      text = await new Response(stream).text();
    } catch (e) {
      return { error: `解压失败（${String(e).slice(0, 50)}）` };
    }
  }
  try {
    return { value: JSON.parse(text) };
  } catch {
    return { value: text };
  }
}

// ── 主流程 ─────────────────────────────────────────────

const rows = await query(
  dbId,
  `SELECT id, uuid, message_type, status, next_send_at, retry_count, updated_at,
          last_error, encrypted_payload
     FROM scheduled_messages
    ORDER BY next_send_at ASC`,
);

const skipped = await query(
  dbId,
  `SELECT user_id, key, value, updated_at FROM client_state WHERE key = 'last_skip'`,
);

const selfLogs = await query(
  dbId,
  `SELECT user_id, key, value, updated_at FROM client_state WHERE key = 'self_log'`,
);

// 麦麦 2026-10-03 加：真机验收时最该一眼看到的一段——**这一条到底推出去没有**。
//
// scheduled_messages.status 只说"云端处理了没有"，不说"手机收到了没有"。
// 实测过一次推送投递失败（522）时，任务那行干干净净写着 sent，而 message_outbox
// 里那两段的 delivered_at 全是 NULL——不看这张表就会把失败当成功。
const outbox = await query(
  dbId,
  `SELECT id, message_id, task_uuid, session_id, message_index, total_messages,
          created_at, delivered_at, acked_at
     FROM message_outbox
    ORDER BY id DESC
    LIMIT 30`,
);

console.log(`库 ${dbId}（账号 ${accountId}）`);
console.log(`任务 ${rows.length} 条${willDecrypt ? '' : '（没给密钥，只看调度状态）'}\n`);

// 兜底配对表：主任务 clientTaskId → 那条 30 分钟后的兜底。收尾时单独打一段，
// 免得两条任务隔着几十行输出、靠肉眼去对时间。声明放在 if 外面——下面那段汇总要用。
const fallbackByFor = new Map();

if (!rows.length) {
  console.log('一条都没有。');
} else {
  for (const r of rows) {
    const err = r.last_error ? String(JSON.parse(r.last_error).reason || r.last_error).slice(0, 70) : '';
    console.log(`#${r.id}  ${r.message_type}  ${r.status}  下次 ${r.next_send_at}  重试 ${r.retry_count}`);
    if (err) console.log(`      失败原因: ${err}`);

    if (willDecrypt) {
      const decrypted = await decryptPayload(r.encrypted_payload, userKey());
      if (decrypted.error) {
        console.log(`      ⚠ ${decrypted.error}`);
      } else {
        let payload = {};
        try { payload = JSON.parse(decrypted.value); } catch { /* 不是 JSON 就只报模式 */ }
        const md = payload.metadata || {};
        console.log(`      策略=${md.amsgExpirePolicy ?? '(没写)'}  `
          + `推迟标记=${md.amsgForceDeferred === true ? '有' : '无'}  `
          + `固定转提示词=${md.amsgFixedAsPrompted === true ? '有' : '无'}  `
          + `云端模式=${md.amsgMode ?? '(没写)'}  `
          + `循环=${payload.recurrenceType ?? 'none'}  `
          + `来源=${md.amsgSource ?? '(没写)'}`);
        const mode = payload.messageType;
        if (md.amsgForceDeferred === true) console.log('      ↑ 面板上是「转入下轮」，发给云端翻成了「自动取消」（云端只认后一种，延后那步在客户端做）');
        if (md.amsgFixedAsPrompted === true) {
          console.log('      ↑ 原本是「固定」，连模式一起翻成了提示词（云端要调模型，走 10 分钟窗）');
          console.log(`      翻译成的提示词: ${String(md.amsgTaskInstruction || '(没写)').slice(0, 90)}`);
        }
        if (mode === 'fixed') {
          console.log(`      固定内容: ${String(payload.userMessage || '(空)').slice(0, 60)}`);
        }
        if (md.amsgFallbackFor) {
          console.log(`      ★ 这是兜底任务，兜着 ${md.amsgFallbackFor}`);
          fallbackByFor.set(md.amsgFallbackFor, {
            id: r.id, uuid: r.uuid, at: r.next_send_at, text: payload.userMessage,
          });
        }
      }
    }
    console.log('');
  }
}

if (skipped.length) {
  console.log('── 最近一次跳过（面板上「为什么没响」读的就是这条）──');
  if (!willDecrypt) {
    console.log('  （内容是加密的，给上 AMSG_MASTER_KEY + AMSG_USER_ID 才看得到文字）');
    console.log(`  共 ${skipped.length} 条记录，更新于 ${new Date(skipped[0].updated_at).toLocaleString('zh-CN')}`);
  }
  for (const s of skipped) {
    const r = await readStateValue(s.value, userKey());
    if (r.error) { console.log(`  角色 ${s.user_id}  ⚠ ${r.error}`); continue; }
    const v = r.value || {};
    console.log(`  角色 ${s.user_id}  原因 ${v.reason}  本该在 ${new Date(v.occurrenceMs).toLocaleString('zh-CN')}  实际跳于 ${new Date(v.skippedAt).toLocaleString('zh-CN')}`);
  }
  console.log('  ⚠ 云端只保留**最近一条**，后跳过的会把先跳的顶掉。');
  console.log('');
}

// ── 推送投递（麦麦 2026-10-03 加）────────────────────────
console.log('── 到底推出去没有（最近 30 条）──');
if (!outbox.length) {
  console.log('  一条推送都没有。到点后这里还是空的 = 云端压根没生成推送，别急着查手机。');
} else {
  let undelivered = 0;
  for (const o of outbox) {
    const when = o.created_at ? new Date(o.created_at).toLocaleString('zh-CN') : '(没写)';
    const idx = o.total_messages > 1 ? ` ${o.message_index + 1}/${o.total_messages}` : '';
    let mark;
    if (o.delivered_at) {
      mark = `已送达 +${Math.round((o.delivered_at - o.created_at) / 1000)} 秒`;
    } else if (o.acked_at) {
      // 麦麦 2026-10-03 修正：起先这里一律写「★ 没送达」，拿真数据一跑就发现不对——
      // 历史上有 4 条 delivered_at 是空的，可 acked_at 明明有值，也就是**手机收到了**、
      // 只是云端没记下送达时刻。这两种得分开，不然会把"没记时间"报成"没送到"。
      mark = '· 送达时间没记上（客户端已确认收到）';
      undelivered += 1;
    } else {
      mark = '★ 真没收到';
      undelivered += 1;
    }
    console.log(`  ${when}  任务 ${(o.task_uuid || '(没挂任务)').slice(0, 8)}`
      + `${idx}  ${mark}${o.acked_at ? '  已确认' : ''}`);
  }
  if (undelivered) {
    console.log(`  · ${undelivered} 条 delivered_at 是空的——其中带「已确认」的是"收到了但云端没记时间"，`);
    console.log('    只有标「★ 真没收到」的才要查投递链路。任务那行写着 sent 不等于手机收到了。');
  }
}
console.log('');

// ── 兜底配对（麦麦 2026-09-30）──────────────────────────
// 规则：每条面板上选「转入下轮」的任务，建的时候都该顺带出一条 30 分钟后的固定兜底。
// 核对方式：主任务那一行的「推迟标记」应该是有，兜底那行带 ★，两者时间差正好 30 分钟。
if (willDecrypt) {
  console.log('── 兜底配对 ──');
  if (!fallbackByFor.size) {
    console.log('  一条兜底都没有。');
    console.log('  · 库里没有「转入下轮」的任务时这是对的；');
    console.log('  · 有推迟标记=有 却没兜底 → 建兜底那步失败了，查诊断里的 fallback-schedule-failed。');
  } else {
    for (const [forId, fb] of fallbackByFor) {
      const at = fb.at ? new Date(fb.at).toLocaleString('zh-CN') : '(没写)';
      console.log(`  兜着 ${forId.slice(0, 8)}  →  #${fb.id} ${at}`);
      console.log(`      内容: ${String(fb.text || '(空)').slice(0, 60)}`);
    }
  }
  console.log('');
}

if (selfLogs.length) {
  console.log('── 角色自述日志（循环任务「响了几次没回」看这里）──');
  for (const s of selfLogs) {
    const r = await readStateValue(s.value, userKey());
    if (r.error) { console.log(`  角色 ${s.user_id}  ⚠ ${r.error}`); continue; }
    const log = r.value || {};
    const recurring = log.recurringSends || {};
    const entries = log.unansweredSends ?? 0;
    const detail = Object.entries(recurring)
      .map(([k, v]) => `${k.slice(0, 8)}=${v}次没回`)
      .join('，') || '（还没有循环任务的未回计数）';
    console.log(`  角色 ${s.user_id}  连发未回 ${entries} 次  循环未回: ${detail}`);
  }
}
