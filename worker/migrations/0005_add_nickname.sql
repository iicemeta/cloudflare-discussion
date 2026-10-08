-- 昵称（对外显示名，可自行修改）与用户名隐私开关
-- 校园邮箱注册时用户名会等于学号，因此默认不公开用户名：username_visible = 0
ALTER TABLE users ADD COLUMN nickname TEXT;
ALTER TABLE users ADD COLUMN username_visible INTEGER NOT NULL DEFAULT 0;

-- 注意：有意不回填 nickname = username。
-- 老账号的用户名很可能就是学号，回填等于把学号当成昵称公开，所以留空。
-- 未设置昵称的账号在页面上显示为「用户xxxx」（uid 后 4 位），本人可在个人设置里改。
