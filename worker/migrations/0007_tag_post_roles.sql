-- 标签发帖头衔限制
-- tags.post_roles: JSON 数组,存放允许发帖的头衔 ID 列表(如 '[1,3]')
-- NULL 或空数组 = 不限制,任何用户都可发帖
ALTER TABLE tags ADD COLUMN post_roles TEXT;
