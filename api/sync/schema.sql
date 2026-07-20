-- ============================================================================
-- SullyOS Cloud Sync — 数据库初始化脚本
-- ============================================================================
--
-- 用途：暮色电脑手机互通（多端聊天记录 + 记忆宫殿共享）
-- 部署：Vercel Marketplace 装 Neon 集成后，在 Neon SQL Editor 跑这个脚本
-- 重新运行：脚本用 IF NOT EXISTS 保护，可安全重复跑
--
-- 数据归属：
--   - 配对码 = 云端身份（6 位字符，剔除 0/1/o/i/l）
--   - 同一配对码下所有设备共享数据
--   - 不同配对码完全隔离
--   - 设备 ID = UUID v4（客户端生成，本地持久化）
--
-- 容量估算（Neon 免费档 0.5 GB）：
--   - 聊天消息：~500 字节 / 条 → 100 万条 / 0.5 GB
--   - 记忆节点：~1 KB / 条 → 50 万条 / 0.5 GB
--   - 暮色每天聊 50 条 → 55 年才满
--
-- 鉴权强度：
--   - 仅靠"配对码"做隔离，不抗暴力
--   - 适用范围：个人多端互通，不抗主动攻击
--   - 不适合公开部署或多人共用
-- ============================================================================

-- ─── 1. 设备表 ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS devices (
    device_id    TEXT PRIMARY KEY,            -- UUID v4
    pair_code    TEXT NOT NULL,               -- 6 位配对码
    device_name  TEXT,                        -- 用户起的名字（可选）
    last_seen_at BIGINT NOT NULL,             -- ms timestamp（心跳）
    created_at   BIGINT NOT NULL,             -- ms timestamp
    user_agent   TEXT                         -- 浏览器 UA（调试用）
);

CREATE INDEX IF NOT EXISTS idx_devices_pair_code ON devices(pair_code);
CREATE INDEX IF NOT EXISTS idx_devices_last_seen ON devices(pair_code, last_seen_at DESC);


-- ─── 2. 聊天消息表 ─────────────────────────────────

CREATE TABLE IF NOT EXISTS chat_messages (
    id                BIGSERIAL PRIMARY KEY,
    pair_code         TEXT NOT NULL,
    char_id           TEXT NOT NULL,
    client_id         TEXT NOT NULL,            -- 客户端 UUID，用于去重
    role              TEXT NOT NULL,            -- 'user' | 'assistant' | 'system'
    type              TEXT NOT NULL DEFAULT 'text',
    content           TEXT NOT NULL,
    message_timestamp BIGINT NOT NULL,          -- 消息原始时间（ms）
    metadata          TEXT,                     -- JSON 字符串
    reply_to          TEXT,                     -- JSON 字符串
    uploaded_at       BIGINT NOT NULL,          -- 上传时间（ms）
    uploaded_by       TEXT NOT NULL,            -- 设备 ID

    -- 同一对码下同一 clientId 只存一条
    CONSTRAINT uq_chat_pair_client UNIQUE (pair_code, client_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_pair_char_ts
    ON chat_messages(pair_code, char_id, message_timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_chat_pair_ts
    ON chat_messages(pair_code, message_timestamp DESC);


-- ─── 3. 记忆宫殿表 ─────────────────────────────────
--
-- ⚠️ 这里同步的是"记忆内容 + 元数据"，不包含向量。
--    向量检索走 utils/memoryPalace/supabaseVector.ts（pgvector 单独项目）。

CREATE TABLE IF NOT EXISTS memory_palace_items (
    id                 BIGSERIAL PRIMARY KEY,
    pair_code          TEXT NOT NULL,
    memory_id          TEXT NOT NULL,            -- 客户端 MemoryNode.id
    char_id            TEXT NOT NULL,
    content            TEXT NOT NULL,
    room               TEXT NOT NULL,            -- living_room/bedroom/...
    tags               TEXT[] DEFAULT '{}',
    importance         INT  DEFAULT 5,
    mood               TEXT DEFAULT '',
    valence            REAL,                     -- -1 ~ 1，Russell 情感模型
    arousal            REAL,                     -- -1 ~ 1
    source_id          TEXT,                     -- 消化衍生记忆的源 ID
    origin             TEXT,                     -- extraction / digestion / system
    archived           BOOLEAN DEFAULT FALSE,    -- 被压入 box summary
    is_box_summary     BOOLEAN DEFAULT FALSE,    -- 此行是 box summary
    event_box_id       TEXT,                     -- 所属 EventBox.id
    created_at         BIGINT NOT NULL,
    last_accessed_at   BIGINT DEFAULT 0,
    access_count       INT  DEFAULT 0,
    pinned_until       BIGINT,                   -- 便利贴置顶截止（ms）
    group_id           TEXT,                     -- 群聊记忆来源
    group_name         TEXT,                     -- 群名快照
    deleted            BOOLEAN DEFAULT FALSE,    -- 软删除标记
    cloud_updated_at   BIGINT NOT NULL,          -- 云端上次写入时间（拉取用）
    uploaded_by        TEXT NOT NULL,            -- 设备 ID

    CONSTRAINT uq_mp_pair_memory UNIQUE (pair_code, memory_id)
);

CREATE INDEX IF NOT EXISTS idx_mp_pair_char_room
    ON memory_palace_items(pair_code, char_id, room);

CREATE INDEX IF NOT EXISTS idx_mp_pair_updated
    ON memory_palace_items(pair_code, cloud_updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_mp_pair_char_updated
    ON memory_palace_items(pair_code, char_id, cloud_updated_at DESC);


-- ─── 4. 统计视图（调试用） ──────────────────────────
--
-- 不被 API 使用，但可在 Neon SQL Editor 跑 SELECT * FROM sync_stats;
-- 看每个配对码的设备 / 消息 / 记忆数。

CREATE OR REPLACE VIEW sync_stats AS
SELECT
    d.pair_code,
    COUNT(DISTINCT d.device_id)               AS device_count,
    COALESCE(msg.cnt, 0)                       AS message_count,
    COALESCE(mem.cnt, 0)                       AS memory_count,
    COALESCE(mem_deleted.cnt, 0)               AS memory_deleted_count,
    MAX(d.last_seen_at)                        AS latest_heartbeat
FROM devices d
LEFT JOIN (
    SELECT pair_code, COUNT(*) AS cnt
    FROM chat_messages
    GROUP BY pair_code
) msg ON msg.pair_code = d.pair_code
LEFT JOIN (
    SELECT pair_code, COUNT(*) AS cnt
    FROM memory_palace_items
    WHERE deleted = false
    GROUP BY pair_code
) mem ON mem.pair_code = d.pair_code
LEFT JOIN (
    SELECT pair_code, COUNT(*) AS cnt
    FROM memory_palace_items
    WHERE deleted = true
    GROUP BY pair_code
) mem_deleted ON mem_deleted.pair_code = d.pair_code
GROUP BY d.pair_code, msg.cnt, mem.cnt, mem_deleted.cnt;

COMMENT ON TABLE devices IS '云端同步设备表 — 配对码 + 设备 ID + 心跳';
COMMENT ON TABLE chat_messages IS '云端同步聊天消息 — 跨设备共享';
COMMENT ON TABLE memory_palace_items IS '云端同步记忆宫殿内容（不含向量）— 跨设备共享';
COMMENT ON VIEW sync_stats IS '同步状态统计视图（每配对码的设备/消息/记忆数）';
