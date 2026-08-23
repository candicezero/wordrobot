# GitHub 备份配置指引（v0.4 方案）

> 设计依据：`design-plan.md` §5.7。批改完成后自动把全库备份 JSON 写入 **GitHub 私有仓库** 的
> `backup-latest.json`，每次备份即一次 commit，天然获得完整版本历史。

## 0. 总体布局（两个仓库，严格分离）

| 仓库 | 可见性 | 用途 | 放什么 |
|---|---|---|---|
| 托管仓库 | **公开** | GitHub Pages 发布 App | index.html / js / css / assets / sw.js 等 |
| 备份仓库 | **私有** | 只存一个 `backup-latest.json` | 备份数据（含学生姓名与成绩） |

分离的好处：PAT 权限只及备份仓库（即使泄露也碰不到 App 代码）；备份内容不公开；
Service Worker 不会缓存到它。

## 1. 创建私有备份仓库（一次性）

1. GitHub 右上角 **+** → **New repository**。
2. Repository name 如 `wordrobot-backup`；选择 **Private**；不要初始化 README（空仓库即可）。
3. 创建完成。记下你的用户名（owner）和仓库名，后面要用。

## 2. 创建 Fine-grained PAT（一次性）

1. GitHub → 头像 → **Settings** → 最底部 **Developer settings** →
   **Personal access tokens** → **Fine-grained tokens** → **Generate new token**。
2. 填写：
   - **Token name**：`wordrobot-backup`（随意）
   - **Expiration**：建议选最长有效期（如 1 年）或自定义更长；到期前 GitHub 会发邮件提醒续期
   - **Repository access**：选 **Only select repositories** → 选中刚建的 `wordrobot-backup`
     （**千万不要选 All repositories**）
   - **Permissions → Repository permissions → Contents**：选 **Read and write**
     （其余权限一律保持 No access）
3. **Generate token**，立刻复制 `github_pat_...` 开头的完整 Token。
4. **把 Token 备份到密码管理器 / 备忘录**——iPad 数据丢失后恢复时必须靠它（App 本机数据里
   的 Token 会随数据一起丢失）。

## 3. 在 App 中配置（每台 iPad 一次）

1. iPad 打开 App → 教师模式 → **设置**。
2. 在「GitHub 自动备份」中填：备份仓库 owner（你的用户名）、仓库名、Token。
3. 点 **保存并测试**，提示「连接成功 ✓」即完成。
   - 401：Token 无效/过期；404：仓库名写错或 Token 未授权该仓库。
4. 可点 **立即备份一次** 验证完整链路。

之后每次点「批改完成」会自动备份：
- 成功：toast「已自动备份到 GitHub ✓」
- 失败（无网/服务异常/Token 失效）：自动进入重试队列，教师模式首页与设置页显示积压条数，
  下次打开 App 或联网时自动补交；Token 失效时请重新生成并更新设置。

未配置时批改不受影响，仅弹窗提醒手动导出。

## 4. 恢复

设置页 → 「恢复」：

- **从 GitHub 恢复最新版**：拉取 `backup-latest.json` 全量重建本机数据。
- **查看历史版本**：列出最近 30 次 commit（形如 `backup 20260823-175301 小明 92分`），
  可恢复到任意时点。
- **从本地备份文件导入**：导入此前手动导出的 JSON。

注意：恢复是**全量覆盖**，操作前请确认。多设备共用同一备份仓库属于超出当前范围
（单台 iPad 单写入者，无并发冲突）。

## 5. 附：托管仓库部署（GitHub Pages）

1. 新建一个**公开**仓库（如 `wordrobot`）。
2. 把 WordRobot 目录全部内容（index.html、js/、css/、assets/、sw.js、manifest.webmanifest、
   config.js）推送到 `main` 分支。docs/、tools/、tests/ 可一并放入，不影响运行。
3. 仓库 **Settings → Pages → Build and deployment → Source** 选 `Deploy from a branch`，
   分支 `main`、目录 `/ (root)`，保存。
4. 约 1–2 分钟后访问 `https://<用户名>.github.io/<仓库名>/` 验证。
5. iPad Safari 打开该地址 → 分享 → **添加到主屏幕**，即获得类 App 体验。
6. HTTPS 自动满足 iOS 麦克风（ASR）与 Service Worker 的安全上下文要求。

### 发版更新

改动文件后：把 `sw.js` 顶部的 `CACHE` 版本号 +1（如 `wordrobot-v1` → `wordrobot-v2`）再推送，
否则已安装的 iPad 可能继续使用旧缓存。首次访问新版本会自动拉新并接管。

### 真机验证清单（M6）

- [ ] Safari 标签页与主屏幕 PWA 两种形态下，TTS 念题正常（首次点击页面后发声）
- [ ] 两种形态下 ASR 口令（"再说一遍"/"下一个"）可用；不可用时按钮兜底正常
- [ ] 断网后打开 App 仍可进入听写与批改（离线缓存生效）
- [ ] 批改完成 → GitHub 私有仓库出现新 commit
- [ ] 添加到主屏幕后图标与名称正确

## 6. 安全要点

- PAT **绝不能**出现在托管仓库的任何文件中（它是本机设置数据，只存 iPad IndexedDB）。
- 备份仓库必须私有（包含学生姓名与成绩）。
- Token 泄露的处置：GitHub 上直接 Revoke 该 Token → 重建新 Token → iPad 设置中更新。
- 建议同时开启「申请存储持久化」（设置页按钮），降低 iOS 清理存储时回收 IndexedDB 的风险。
