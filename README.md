# Nav-Item Cloudflare

一个现代化的导航网站，基于 [eooce/nav-item](https://github.com/eooce/nav-item) 改编，迁移至 Cloudflare Pages + Functions 实现完全无服务器部署。

## 项目简介

Nav-Item 是一个简洁美观的个人导航站，支持多级菜单分类、网站卡片管理、搜索聚合、广告位和友情链接等功能，适合作为浏览器首页或个人书签管理工具。

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | Vue 3 + Vite + Vue Router |
| 后端 | Cloudflare Pages Functions + Hono |
| 数据库 | Cloudflare D1 (SQLite) |
| 文件存储 | Cloudflare R2 |
| 认证 | JWT + PBKDF2 密码哈希 |

## 主要功能

- **多级导航菜单**：支持一级菜单与子菜单分类管理
- **网站卡片管理**：添加/编辑/删除网站，支持自定义图标上传
- **搜索聚合**：集成多搜索引擎快捷入口
- **广告位管理**：左右侧广告位配置
- **友情链接**：底部友链展示
- **后台管理**：JWT 鉴权的管理后台，支持所有内容 CRUD
- **响应式设计**：适配桌面与移动端

## 项目结构

```
nav-item/
├── web/                              # 前端 Vue 3 项目
│   ├── src/
│   │   ├── views/
│   │   │   ├── Home.vue              # 首页（导航展示、搜索框）
│   │   │   ├── Admin.vue             # 后台登录页
│   │   │   └── admin/                # 后台管理页面
│   │   │       ├── MenuManage.vue    # 菜单/子菜单管理
│   │   │       ├── CardManage.vue    # 网站卡片管理
│   │   │       ├── AdManage.vue      # 广告位管理
│   │   │       ├── FriendLinkManage.vue  # 友情链接管理
│   │   │       └── UserManage.vue    # 用户账号管理
│   │   ├── components/
│   │   │   ├── CardGrid.vue          # 卡片网格展示组件
│   │   │   └── MenuBar.vue           # 顶部菜单栏组件
│   │   ├── api.js                    # Axios API 请求封装
│   │   ├── router.js                 # Vue Router 路由配置
│   │   ├── App.vue                   # 根组件
│   │   └── main.js                   # Vue 应用入口
│   ├── public/
│   │   ├── background.webp           # 默认背景图
│   │   ├── default-favicon.png       # 默认网站图标
│   │   └── robots.txt                # 搜索引擎爬虫规则
│   ├── index.html                    # HTML 入口模板
│   ├── vite.config.mjs               # Vite 构建配置
│   └── package.json                  # 前端依赖配置
├── functions/                        # Cloudflare Pages Functions
│   ├── api/
│   │   └── [[path]].js               # Hono 路由（登录/菜单/卡片/广告/友链/上传）
│   └── _utils/
│       ├── jwt.js                    # JWT 签发与验证
│       └── password.js               # PBKDF2 密码哈希与校验
├── d1-schema.sql                     # D1 数据库建表语句
├── d1-seed.sql                       # 初始示例数据（菜单、卡片等）
├── wrangler.toml                     # Cloudflare D1/R2 绑定配置
└── package.json                      # 根项目脚本与依赖
```

## 部署指南

### 1. 创建 D1 数据库

1. 登录 [Cloudflare](https://dash.cloudflare.com/)，进入 **Workers & Pages** → **D1 SQL Database**
2. 点击 **Create** 创建数据库（如 `nav-item`）
3. 记录数据库名称和 ID
4. 编辑 `wrangler.toml`，填入你的数据库信息：
   ```toml
   [[d1_databases]]
   binding = "DB"
   database_name = "你的数据库名"
   database_id = "你的数据库ID"
   ```

### 2. 创建 R2 存储桶

1. 进入 **R2 Object Storage** → **Create bucket**
2. 创建存储桶（如 `nav-item-uploads`）
3. 进入桶 → **Settings** → **Public access** → 开启公共访问
4. 记录公共域名（如 `https://pub-xxx.r2.dev`）
5. 编辑 `wrangler.toml`，填入存储桶名称：
   ```toml
   [[r2_buckets]]
   binding = "R2"
   bucket_name = "你的存储桶名"
   ```

### 3. 创建 Cloudflare Pages 项目

1. 进入 **Workers & Pages**
2. 选择 **创建应用程式** → **Pages** → **连结到 Git**
3. 选择你 Fork 的仓库
4. 在「设定组建和部署」页面，配置构建设定：
   - **框架预设**：`Vue`
   - **构建命令**：`npm run build`
   - **构建输出目录**：`web/dist`
5. 点击 **保存并部署**（首次部署会失败，需先完成后续绑定配置）

### 4. 绑定资源

Pages 项目 → **Settings** → **Functions**：

| 类型 | Binding 名称 | 绑定到 |
|------|-------------|--------|
| D1 Database | `DB` | 你创建的 D1 数据库 |
| R2 Bucket | `R2` | 你创建的 R2 存储桶 |

### 5. 配置环境变量

Pages 项目 → **Settings** → **Environment variables**：

| 变量 | 说明 | 示例 |
|------|------|------|
| `JWT_SECRET` | JWT 签名密钥（必填，随机字符串） | `your-random-secret-key` |
| `ADMIN_USERNAME` | 管理员用户名 | `admin` |
| `ADMIN_PASSWORD` | 管理员密码 | `your-password` |
| `R2_PUBLIC_BASE` | R2 公共访问 URL | `https://pub-xxx.r2.dev` |
| `VITE_UPLOAD_BASE` | 同上，用于前端 | `https://pub-xxx.r2.dev` |

### 6. 初始化数据库

使用 Wrangler CLI 初始化表结构：

```bash
npx wrangler d1 execute <数据库名> --remote --file=d1-schema.sql
npx wrangler d1 execute <数据库名> --remote --file=d1-seed.sql
```

### 7. 重新部署

返回 Pages 项目 → **Deployments** → 点击 **Retry deployment**


## 访问地址

- 前端页面：`https://your-project.pages.dev/`
- 管理后台：`https://your-project.pages.dev/admin`
- API 接口：`https://your-project.pages.dev/api/*`

## 致谢

- 原项目：[eooce/nav-item](https://github.com/eooce/nav-item)

## License

MIT