-- OAuth2 第三方账号绑定表
-- 一个用户 (users.uid) 可以绑定多个 provider 的账号
CREATE TABLE IF NOT EXISTS oauth_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  uid TEXT NOT NULL,
  email TEXT,
  username TEXT,
  avatar_url TEXT,
  FOREIGN KEY (uid) REFERENCES users(uid) ON DELETE CASCADE
);

-- 同一个 provider 下的同一个第三方用户只能绑定一次
CREATE UNIQUE INDEX IF NOT EXISTS idx_oauth_accounts_provider_user
  ON oauth_accounts(provider, provider_user_id);

CREATE INDEX IF NOT EXISTS idx_oauth_accounts_uid ON oauth_accounts(uid);
