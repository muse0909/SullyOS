-- Proactive Push Accelerator — D1 schema
--
-- 一张表够用。endpoint + char_id 作为联合主键：一个浏览器订阅对多
-- 个角色独立调度，互不影响。

CREATE TABLE IF NOT EXISTS schedules (
  endpoint        TEXT    NOT NULL,
  char_id         TEXT    NOT NULL,
  p256dh          TEXT    NOT NULL,
  auth            TEXT    NOT NULL,
  interval_ms     INTEGER NOT NULL,
  next_fire_at    INTEGER NOT NULL,    -- epoch ms，下次应当发 wake push 的时间
  last_heartbeat  INTEGER NOT NULL,    -- epoch ms，客户端最近一次 heartbeat
  created_at      INTEGER NOT NULL,
  -- 麦麦 2026-09-05 commit 6：user_id 字段（commit 2-8 修复）
  --   client 的 WS userId，commit 2 cron 写 D1 时用它替代 endpoint 占位
  user_id         TEXT,
  PRIMARY KEY (endpoint, char_id)
);

-- cron 每次都按 next_fire_at 扫，单列索引足够。
CREATE INDEX IF NOT EXISTS idx_schedules_next_fire ON schedules(next_fire_at);

-- 麦麦 2026-09-05：离线消息持久化（commit 2 + 4）
--   客户端不在线时，cron 不走 Web Push（只有 Web 端走 VAPID，Android 端没订阅），
--   改为写 D1。客户端启动时 GET /api/offline-messages 拉取。
--   messageId 是 commit 3 客户端去重的幂等键。
CREATE TABLE IF NOT EXISTS proactive_offline_messages (
  id              TEXT    PRIMARY KEY,        -- uuid，由 commit 2 端生成
  user_id         TEXT    NOT NULL,
  char_id         TEXT    NOT NULL,
  character_name  TEXT    NOT NULL,
  content         TEXT    NOT NULL,
  message_id      TEXT    NOT NULL,            -- 业务去重键，commit 3 客户端用
  created_at      INTEGER NOT NULL,            -- epoch ms
  expires_at      INTEGER NOT NULL            -- created_at + 72*3600*1000（暮色 9-5 决定）
);
CREATE INDEX IF NOT EXISTS idx_offline_user_created
  ON proactive_offline_messages(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_offline_expires
  ON proactive_offline_messages(expires_at);
