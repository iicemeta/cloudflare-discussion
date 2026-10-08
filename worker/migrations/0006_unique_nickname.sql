-- 昵称唯一：站点显示名不允许重复。
-- （登录用的 username 在 0001_init.sql 里已经是 UNIQUE，这里约束的是对外显示名。）
-- 注意：按 ASCII 大小写不敏感比较（COLLATE NOCASE / lower()），中文昵称不受影响。

-- 1) 把历史数据规范化成与 normalizeNickname 一致的行为（去首尾空格、空串归 NULL）
UPDATE users SET nickname = NULL WHERE nickname IS NOT NULL AND trim(nickname) = '';
UPDATE users SET nickname = trim(nickname) WHERE nickname IS NOT NULL AND nickname <> trim(nickname);

-- 2) 历史重复昵称去重：保留最早注册（id 最小）的账号，其余置空由本人重新设置。
--    置空而不是加后缀，是为了不伪造一个用户没选过的名字。
UPDATE users
SET nickname = NULL
WHERE nickname IS NOT NULL
  AND id NOT IN (
    SELECT MIN(id) FROM users
    WHERE nickname IS NOT NULL AND nickname <> ''
    GROUP BY lower(nickname)
  );

-- 3) 唯一索引。部分索引让「未设置昵称」的账号不参与约束，因此可以同时存在多个 NULL。
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_nickname_unique
  ON users (nickname COLLATE NOCASE)
  WHERE nickname IS NOT NULL AND nickname <> '';
