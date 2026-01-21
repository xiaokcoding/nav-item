# Nav-Item (Cloudflare Pages)

现代化导航站点，前端为 Vue 3 SPA，后端为 Cloudflare Pages Functions（Hono），数据使用 D1，上传使用 R2。

## 项目结构

```
nav-item/
├── functions/            # Pages Functions (ESM JS)
│   ├── api/[[path]].js   # API 路由
│   └── uploads/[[key]].js# R2 文件读取
├── migrations/           # D1 迁移
│   ├── 0001_init.sql
│   └── seed.sql          # 可选数据
├── scripts/              # 本地脚本
│   └── smoke-test.mjs
├── web/                  # Vue 3 前端
│   ├── public/_redirects # SPA 重写
│   └── src/
├── wrangler.toml
└── package.json
```

## 本地开发

1) 安装依赖并构建前端
```bash
npm install
npm run build
```

2) 运行本地 Pages + Functions（带 D1/R2 绑定）
```bash
wrangler pages dev web/dist \
  --d1 DB=nav-item \
  --r2 UPLOADS=nav-item-uploads \
  --binding JWT_SECRET=dev-secret \
  --binding ADMIN_USERNAME=admin \
  --binding ADMIN_PASSWORD=pass123 \
  --local-protocol http \
  --persist-to .wrangler/state/v3
```

## 部署到 Cloudflare Pages

### Dashboard 方式（推荐）
1) 打开 Cloudflare 控制台 → Pages → 创建项目，选择 GitHub 仓库 `xiaokcoding/nav-item`。
2) 构建设置：
   - Framework preset：选“无”
   - Build command：`npm run build`
   - Output directory：`web/dist`
3) Functions 设置：保持默认，Pages 会自动识别仓库根目录下的 `functions/`。
4) 绑定 D1：
   - 先在 D1 创建数据库（例如 `nav-item`）
   - Pages 项目 → 设置 → Functions → D1 绑定
   - 绑定名称：`DB`
   - 数据库：选择刚创建的 D1
5) 绑定 R2：
   - 先在 R2 创建存储桶（例如 `nav-item-uploads`）
   - Pages 项目 → 设置 → Functions → R2 绑定
   - 绑定名称：`UPLOADS`
   - 存储桶：选择刚创建的桶
6) Secrets（同页设置）：
   - `JWT_SECRET`（任意强随机字符串）
   - `ADMIN_USERNAME`（初始管理员账号）
   - `ADMIN_PASSWORD`（初始管理员密码）
7) D1 迁移（远程）：
```bash
wrangler d1 create nav-item
wrangler d1 migrations apply nav-item --remote
```
8) 提交并部署：推送到 GitHub 后，Pages 会自动构建并发布。
9) 初始数据：部署后首次访问任意 `/api/*` 会自动写入默认菜单与友链数据。

### Wrangler 方式（可选）
创建 D1 与迁移：
```bash
wrangler d1 create nav-item
wrangler d1 migrations apply nav-item --remote
```

## 数据库与迁移

本地：
```bash
wrangler d1 migrations apply nav-item --local
```

默认种子数据：
项目在首次访问任意 `/api/*` 时，会检测 `menus` 表是否为空，若为空则自动插入内置的初始数据（等同于 `migrations/seed.sql`）。

如需手动导入（可选）：
```bash
wrangler d1 execute nav-item --file=migrations/seed.sql --local
```

## 接口说明

- `/api/health`：健康检查
- `/api/login`：登录获取 token
- `/api/menus`、`/api/cards`、`/api/friends`、`/api/users/*`：CRUD
- `/api/upload`：上传文件（字段名 `logo`）
- `/uploads/<key>`：访问上传文件

## 手工测试步骤（curl）

1) 健康检查
```bash
curl http://127.0.0.1:8788/api/health
```

2) 登录获取 token
```bash
curl -H "content-type: application/json" \
  -d '{"username":"admin","password":"pass123"}' \
  http://127.0.0.1:8788/api/login
```

3) 读取用户信息
```bash
curl -H "Authorization: Bearer <TOKEN>" \
  http://127.0.0.1:8788/api/users/me
```

4) 新增菜单
```bash
curl -H "Authorization: Bearer <TOKEN>" \
  -H "content-type: application/json" \
  -d '{"name":"Test Menu","order":1}' \
  http://127.0.0.1:8788/api/menus
```

5) 新增卡片
```bash
curl -H "Authorization: Bearer <TOKEN>" \
  -H "content-type: application/json" \
  -d '{"menu_id":1,"sub_menu_id":null,"title":"Test","url":"https://example.com","logo_url":"","desc":"","order":1}' \
  http://127.0.0.1:8788/api/cards
```

6) 友链列表
```bash
curl http://127.0.0.1:8788/api/friends
```

7) 上传并访问
```bash
curl -F "logo=@web/public/default-favicon.png" http://127.0.0.1:8788/api/upload
curl http://127.0.0.1:8788/uploads/<key>
```

## 冒烟测试脚本（可选）

```bash
ADMIN_USERNAME=admin ADMIN_PASSWORD=pass123 \
node scripts/smoke-test.mjs --baseURL=http://127.0.0.1:8788
```

## Git 清理说明

若曾提交过构建产物/缓存，可执行：
```bash
git rm -r --cached node_modules web/dist .wrangler
```

## 许可证

MIT
