# 极简论坛

当前分支已经改成 `Nuxt 静态前端 + Cloudflare Workers API + Cloudflare D1`。

- 前端页面结构、路由和交互尽量保持 `discussion` 原项目一致。
- 后端不再依赖 Prisma / Postgres / Nuxt server。
- 静态资源由 Worker 同域托管，`/api/*` 由 Worker 处理。

## 架构

- 前端：Nuxt 3，`ssr: false`，通过 `nuxt generate` 生成静态站点
- 后端：Cloudflare Workers
- 数据库：Cloudflare D1
- 入口配置：[wrangler.jsonc](./wrangler.jsonc)
- 数据库迁移：[worker/migrations](./worker/migrations)

## 快速开始

### 1. 创建 D1 数据库

```bash
npx wrangler d1 create bbs
```

把命令返回的 `database_id` 填入 [wrangler.jsonc](./wrangler.jsonc) 的 `d1_databases[0].database_id`。

### 2. 创建 R2 Bucket

```bash
npx wrangler r2 bucket create discussion-images
```

把实际 bucket 名称填入 [wrangler.jsonc](./wrangler.jsonc) 的 `r2_buckets[0].bucket_name` 和 `preview_bucket_name`。

### 3. 配置环境变量

- 前端构建变量：复制 [.env.example](./.env.example) 为 `.env`
- Worker 运行时变量：复制 [.dev.vars.example](./.dev.vars.example) 为 `.dev.vars`

注意：

- `NUXT_PUBLIC_TOKEN_KEY` 必须和 `TOKEN_KEY` 保持一致
- `NUXT_PUBLIC_AVATAR_CDN` 建议和 `AVATAR_CDN` 保持一致
- 生产环境建议把 `COOKIE_SECURE` 设为 `"true"`

### 4. 安装依赖

```bash
npm install
```

### 5. 本地初始化 D1

```bash
npm run d1:migrate:local
```

这里的脚本会直接对 `wrangler.jsonc` 里声明的 `DB` 绑定执行 migration，不需要再手动改数据库名。

### 6. 本地预览完整站点

```bash
npm run cf:preview
```

这条命令会先执行 `nuxt generate`，然后用 Wrangler 在本地启动 Worker，并把 `.output/public` 作为同域静态资源。

`npm run dev` 仅适合单独调前端 UI，不包含 Worker API。

## 部署到 Cloudflare

```bash
npm run d1:migrate:remote
npm run cf:deploy
```

如果使用 GitHub Actions，仓库需要配置：

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

默认工作流会先跑远端 D1 migration，再执行 `wrangler deploy`。

## 当前已覆盖的核心能力

- 注册、登录、个人设置
- 昵称与用户名隐私（默认不公开用户名）
- OAuth2 第三方登录（GitHub / Google / Gitee 及自定义服务商）
- 发帖、回帖、收藏、帖子支持
- 点赞 / 点踩评论
- 站内消息、私信、Telegram webhook 绑定通知
- 节点、头衔、用户、帖子、评论的后台管理
- 站点配置持久化到 D1
- 邀请码、积分、签到、隐藏内容付费查看
- R2 图片上传
邮件发送已经切到 Resend。部署后请在后台“系统设置 > 邮件设置”中填写 `Resend API Key`、发件邮箱和发件人名称；如果启用了邮箱验证码注册，注册验证码和找回密码邮件也会走 Resend。

## 昵称与用户名隐私

校园邮箱等场景下用户名往往就是学号，所以站点**默认不公开用户名**：

- 页面上显示的一律是**昵称**（`users.nickname`）；没设昵称时显示为「用户 + uid 后 4 位」，不会回退到用户名。
- 个人主页及其子页面链接统一用 `uid`（`/member/<uid>`），URL 里不再出现用户名。旧的 `/member/<用户名>` 链接仍可访问，服务端会按用户名兜底查找。
- `users.username_visible` 默认 `0`。用户在「个人设置 > 公开我的用户名」里可以打开，打开后其他用户能看到用户名（个人主页会多显示一个 `@用户名` 小标签）。
- 本人与管理员始终能看到真实用户名：本人走 `/api/member/profile`（带私有字段），管理员在后台的用户 / 帖子 / 评论列表里看到。
- 邮箱属于隐私字段，只在本人和管理员的响应里下发。
- 新账号：OAuth 自动建号时把服务商返回的真实姓名写进昵称；邮箱注册的账号昵称为空，需要自己去设置里填。

迁移 `worker/migrations/0005_add_nickname.sql` 新增 `nickname` 与 `username_visible` 两列，并**故意不回填** `nickname = username` —— 老账号的用户名很可能就是学号，回填等于把学号当昵称公开。

### 昵称唯一

昵称是对外显示名，**全局唯一**（迁移 `0006_unique_nickname.sql` 建了部分唯一索引）：

- 唯一性按 ASCII **大小写不敏感**比较（`KSM` 与 `ksm` 视为同一个），中文昵称不受影响。
- 登录用的 `username` 本身在 `0001_init.sql` 里就是 `UNIQUE`，这次约束的只是显示名。
- **留空（NULL）不参与唯一约束**，所以多个未设昵称的账号可以共存，各自显示为「用户xxxx」。
- 冲突时报错明确：注册与保存设置都会返回「昵称「X」已被占用，请换一个」。
- OAuth 自动建号时，若服务商给的姓名已被人占用，会自动追加数字后缀去重；实在排不开就留空，**不会因此拒绝登录**。
- 迁移会先把历史数据里首尾空白规范化，重复昵称**保留最早注册的那个**、其余置空（而不是自动加后缀，避免伪造用户没选过的名字）。

> 提及（@）改用 `[@昵称](/member/<uid>)` 的形式，服务端从链接里的 uid 定位被提及者，因此不依赖用户名是否公开。


## OAuth2 第三方登录

后台“系统设置 > OAuth2 登录”里可以配置一个或多个第三方登录方式，配置保存在 D1（`sys_config`），不需要额外环境变量。开启后登录页会自动出现对应的登录按钮。

以 GitHub 为例：

1. 在 GitHub 打开 `Settings > Developer settings > OAuth Apps > New OAuth App`。
2. `Authorization callback URL` 填 `https://你的域名/api/oauth/callback?provider=github`（在后台点“复制回调地址”可直接得到）。
3. 回到后台填入 `Client ID` 与 `Client Secret`，打开“启用”，保存。

匹配规则：

- 同一个第三方账号第二次登录会直接命中 `oauth_accounts` 绑定关系。
- 第三方返回的邮箱若已存在本地账号，会自动绑定到该账号，不会重复建号。
- 其余情况在“首次登录自动注册”开启时会自动创建账号（用户名由昵称生成并自动去重，头像沿用邮箱 Gravatar），关闭则提示先注册。

安全要点：

- `clientSecret` 只在管理员接口 `/api/manage/config/get` 返回，公开的 `/api/config` 只暴露按钮所需的 `key / name / type`。
- 授权回调使用 HMAC 签名的 `state`（10 分钟有效）防 CSRF，`client_secret` 只保存在服务端换取令牌时使用。
- 自动创建的账号使用随机口令，无法通过密码登录；忘记密码流程对其无效，请用第三方方式登录。

已内置的字段预设（自定义服务商可手改）：

| 服务商 | 用户信息地址 | 用户 ID 字段 | 邮箱字段 | 昵称字段 | 头像字段 |
| --- | --- | --- | --- | --- | --- |
| GitHub | `https://api.github.com/user` | `id` | `email` | `name` | `avatar_url` |
| Google | `https://openidconnect.googleapis.com/v1/userinfo` | `sub` | `email` | `name` | `picture` |
| Gitee | `https://gitee.com/api/v5/user` | `id` | `email` | `name` | `avatar_url` |

> GitHub 默认不返回邮箱，代码会自动再请求 `/user/emails` 取主邮箱（需要 `user:email` scope）。

