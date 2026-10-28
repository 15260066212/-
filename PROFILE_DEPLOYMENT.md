# Profile 模式部署指南

## 概述

本次改动实现了路线 3：持久化浏览器 Profile 登录，替代传统 Cookie 注入方式。

## 改动文件

### 新增文件
- `apps/harvester/src/lib/account-profiles.ts` — 账号级 Profile 管理 + 续期
- `apps/harvester/src/lib/publish-context.ts` — Profile-first 发布上下文
- `apps/harvester/src/routes/profiles.ts` — Profile 管理 API

### 修改文件
- `apps/harvester/src/routes/publish.ts` — 头条号专属发布 + Profile-first 适配
- `apps/harvester/src/remote-actions/nav-actions.ts` — 采集后自动保存 Profile
- `apps/harvester/src/remote-browser.ts` — RemoteSession 新增 userDataDir
- `apps/harvester/src/routes/session.ts` — session 存储 userDataDir
- `apps/harvester/src/routes/remote.ts` — 前端 UI 显示 Profile 状态
- `packages/shared/src/platform-registry.ts` — 头条号 authCookieNames 修正

## 新增 API

| 方法 | 端点 | 功能 |
|------|------|------|
| GET | `/api/profiles` | 列出所有账号 Profile |
| GET | `/api/profiles/:platform` | 列出某平台 Profile |
| GET | `/api/profiles/:platform/:account/health` | 登录态健康检查 |
| DELETE | `/api/profiles/:platform/:account` | 删除 Profile |
| POST | `/api/profiles/:platform/:account/renew` | 续期单个 Profile |
| POST | `/api/profiles/renew-all` | 续期全部 Profile |

## 部署步骤

### 1. 代码部署

```bash
# 在项目根目录
cd geo-assistant-clean

# 构建 shared 包
cd packages/shared
npm run build

# 构建 harvester
cd ../../apps/harvester
npm run build

# 重启服务
pm2 restart harvester  # 或你的启动方式
```

### 2. Profile 数据迁移

**方式 A：重新采集（推荐）**
- 部署完成后，通过远程控制页面重新登录采集
- 采集后自动保存为账号 Profile

**方式 B：直接拷贝 Profile 目录**
- 将本地 `apps/harvester/data/account-profiles/` 打包
- 上传到服务器相同路径
- ⚠️ Windows → Linux 跨平台可用，但建议重新采集更稳妥

### 3. 验证部署

```bash
# 检查 Profile 列表
curl http://localhost:3003/api/profiles

# 健康检查（替换为实际账号名的 URL 编码）
curl http://localhost:3003/api/profiles/toutiaohao/%E6%96%B0%E9%80%94%E7%A7%91%E6%8A%80/health

# 续期测试
curl -X POST http://localhost:3003/api/profiles/renew-all
```

### 4. 定时续期（可选）

使用 cron 每周续期一次，保持登录态有效：

```bash
# 每周一凌晨 3 点续期所有 Profile
0 3 * * 1 curl -X POST http://localhost:3003/api/profiles/renew-all >> /var/log/profile-renewal.log 2>&1
```

## 发布流程变化

### LLMwiki 发布接口（`POST /api/llmwiki/publish`）

改动前：纯 Cookie 注入模式
改动后：Profile-first 策略
1. 优先尝试加载账号的持久化 Profile
2. 验证登录态（URL + 选择器 + 认证 Cookie 三重检查）
3. 失败则回退到 Cookie 注入

响应新增字段：`publishMode`（`profile` 或 `cookie`）

### 头条号专属发布逻辑

新增 `publishToToutiao` 函数，替代通用选择器：
- ✅ 处理 AI 助手侧边栏遮罩
- ✅ ProseMirror 富文本编辑器适配
- ✅ 标题 + 正文填写
- ✅ 发布按钮状态检查

## 回滚方案

如遇问题，Profile 模式完全兼容原有 Cookie 模式：
- 无 Profile 时自动回退到 Cookie
- 原有 Cookie 存储和 API 不受影响
