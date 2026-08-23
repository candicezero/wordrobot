# WordRobot 语音听写 APP 设计计划（v0.4 iPad 单机版，Review 已确认）

> 目标：给孩子做英语单词语音听写的工具。**教师端与孩子端同一台 iPad**，一个纯前端 PWA 应用内分「教师模式 / 孩子模式」两个入口；数据全部存在 iPad 本地，无自建后端服务。
>
> v0.4：备份方案由 EmailJS 邮件简化为 **GitHub 仓库直存 JSON**（复用已有 GitHub 账号、去掉第三方服务与配额限制、天然获得 git 版本历史），见 §5.7。8 项 Review 结论见 §10。

---

## 1. 总体架构与技术选型

### 1.1 架构决策：iPad 单机纯前端 PWA（已确认）

| 方案 | 评估 | 结论 |
|---|---|---|
| **纯前端 PWA（单机）** | 一台 iPad 全搞定；零后端、零运维、零局域网配置；添加到主屏幕即类 App 体验 | **采用** |
| B/S（Windows 服务端 + iPad 浏览器） | 双端+服务端，部署/网络/防火墙复杂；仅当需要多设备共享数据时才有价值 | 放弃 |
| iPad 原生 App | 需要 Mac/Xcode/开发者账号/上架 | 放弃 |

- 教师与孩子**共用同一台 iPad、同一个 App**，入口首页两个大按钮：「教师模式」「开始听写（孩子）」。
- 静态文件托管在 **GitHub Pages（已确认，已有账号）**，HTTPS 满足 iOS 麦克风权限的安全上下文要求。
- Service Worker 缓存 App 壳与词典文件：**首次联网加载后可完全离线使用**（TTS 用系统语音离线可用；ASR 与自动备份需联网，均有兜底）。
- 数据只存本机：无账号、无上传，天然保护孩子隐私；备份依靠**批改后自动提交 GitHub + 手动导出**双保险（见 §5.7）。

### 1.2 技术栈

| 层 | 选型 | 理由 |
|---|---|---|
| 应用 | 原生 HTML/CSS/JS 单页应用（无构建步骤） | 零工具链，静态托管即部署；iPad Safari 完整支持 |
| 数据 | IndexedDB（封装轻量 DAL） | 浏览器本地库，容量充裕（百 MB 级），支持索引查询 |
| 词典 | 预解析静态资源 `dictionary.json`（构建产物随 App 分发） | 运行时零解析，内存字典毫秒级查询 |
| 词典构建 | Python + PyMuPDF，离线构建脚本（任意电脑跑一次） | 复用父目录已验证的 PDF 解析逻辑 |
| TTS（念题） | Web Speech API `speechSynthesis`（iPad Safari 支持，中英文分 voice） | 免费、系统语音离线可用 |
| ASR（听口令） | `webkitSpeechRecognition`（iOS 14.5+ Safari，zh-CN） | 免费；**屏幕按钮始终兜底**，ASR 失效不中断流程 |
| 自动备份 | GitHub Contents API（fine-grained PAT 存于 iPad 本机设置） | 批改后把备份 JSON 直接写入 GitHub 私有仓库；复用 GitHub 账号、免费无配额、天然版本历史；见 §5.7 |
| 部署 | GitHub Pages + Service Worker 离线缓存 | 免费、HTTPS、免运维（已确认） |

### 1.3 架构图

```
┌────────────────────────────────────────────────┐
│              iPad（Safari / 主屏幕 PWA）          │
│  ┌──────────────┐      ┌──────────────────────┐ │
│  │  教师模式      │      │  孩子模式             │ │
│  │ · 词库管理     │      │ · 选词库→开始听写      │ │
│  │ · TXT导入     │      │ · TTS 念题/ASR 听口令  │ │
│  │ · 批改(多学生) │      │ · 完成提示/动画        │ │
│  │ · 勋章墙查看   │      │ · 我的勋章墙           │ │
│  │ · 设置/备份    │      └──────────────────────┘ │
│  └──────┬───────┘                               │
│         │                                      │
│  ┌──────▼───────────────────────────────────┐  │
│  │  应用核心（纯 JS，本地运行）                  │  │
│  │  选词算法(错率权重) · 批改统计 · 勋章/里程碑   │  │
│  │  IndexedDB 本地数据库                       │  │
│  │  dictionary.json 词典(静态资源,内存加载)      │  │
│  └──────────────────────────────────────────┘  │
└────────────────────────────────────────────────┘
        ↑ 首次访问/更新时从 GitHub Pages 拉取(HTTPS)
          Service Worker 缓存后可离线运行
        ↑ 批改完成后经 GitHub API 自动提交备份 JSON 到私有仓库
          (需联网, 失败进重试队列; 每次备份=一次commit, 免费版本历史)

构建期(任意电脑,一次性): 《考纲词汇默写本.pdf》
   → tools/build_dictionary.py → dictionary.json → 随 App 托管
```

---

## 2. 数据模型设计（IndexedDB，库名 `wordrobot`）

```
libraries        词库
  id(autoIncrement), name, created_at, updated_at   -- updated_at 决定"最近录入的词库"默认项

words            词条（词库内活跃单词）
  id, library_id, word                             -- 索引: [library_id+word] 唯一
  phonetic, meaning                                -- 从词典JSON回填（词性&中文为PDF原样组合字段）
  meaning_source                                   -- pdf / manual（词典查不到时教师手工补）
  weight            REAL  DEFAULT 1.0              -- 被选中权重
  wrong_count       INT   DEFAULT 0                -- 累计被标"本次答错"次数
  correct_count     INT   DEFAULT 0                -- 累计答对次数
  created_at

mastered_words   已掌握词库（每个词库一份）
  id, library_id, word, phonetic, meaning, mastered_at

students         学生
  id, name, created_at

sessions         听写任务（一份听写词表）
  id, ts_name          -- 如 "20260823-175301"，timestamp 命名，用于检索
  library_id, created_at
  total, c2e_count, e2c_count                       -- 默认 50 / 30 / 20（配置可改）

session_items    听写题目
  id, session_id, seq(1..N)
  word, q_type        -- 'C2E' 中译英 / 'E2C' 英译中
  stem_json           -- 题干快照（中译英:中文+词性+首字母; 英译中:英文+词性）
  answer_json         -- 标准答案快照（音标+词性中文/英文）
  from_wrong_pool     -- 是否来自错词池（追溯用）

gradings         批改结果（一次听写 × 一个学生 = 一条记录）
  id, session_id, student_id
  wrong_item_ids  JSON -- 被勾选"本次答错"的题目 id 列表
  score           INT  -- (总题数-错题数)/总题数×100
  created_at

badges           勋章事件
  id, student_id, grading_id, kind('small'/'big'), created_at

milestone_events 里程碑事件（已掌握词库每+30词触发一次）
  id, library_id, mastered_count(=30/60/90...), created_at

backup_queue     自动备份重试队列（见 §5.7）
  id, payload_json, commit_msg, status('pending'/'sent'/'failed'), attempts, created_at, sent_at

settings         应用配置（覆盖 config.js 默认值）
  key, value                      -- 含 GitHub 备份仓库与 PAT（见 §6）
```

要点：
- 词条统计（weight / wrong_count / correct_count）**按词库全局聚合，不按学生分开**（依据需求 5.3"认可所有学生都完全掌握"）。
- 题目与答案做**快照**存在 session_items：之后教师改词库/单词移入已掌握，都不影响历史批改对照。
- 标准答案页：批改页内直接展示（数据即快照）；另支持**导出打印版 HTML**（iPad 分享/打印，可存 PDF）。

---

## 3. 核心算法：听写词表生成（需求 2.1 / 2.2 / 5）

### 3.1 权重规则（需求 4/5 联动，批改保存时更新）

| 事件 | 对词条的影响 |
|---|---|
| 初次录入 | weight = 1.0 |
| 被勾选"本次答错"一次 | wrong_count +1；`weight = min(weight × 2, 8)` |
| 未被勾选（答对） | correct_count +1；**每累计 3 次答对** `weight = max(weight ÷ 2, 0.25)` |
| correct_count 达到 10 | 从当前词库删除，移入"已掌握"词库，不再参与选词 |

> 同一次批改中：A 学生标错 + B 学生答对 → wrong_count 与 correct_count 各 +1，权重先×2再÷2 相互抵消，符合"各学生混合统计"的语义。

### 3.2 选词流程（生成一次听写词表）

```
输入: 词库 L, 配置 total=50, c2e=30(中译英), e2c=20(英译中)

1. 错词池 P = 该词库"最近一次听写任务"的批改结果中，
   所有学生被标记"本次答错"的题目单词（跨学生合并去重）   ← 已确认：任一学生标错即入池
2. 若 |P| > total: 按权重降序取前 total 个，其余留待下次
3. 剩余额度 R = total - |P|
   从词库活跃词（排除已选、排除已掌握）按权重加权不放回抽样 R 个  ← 需求 2.1
4. 题型分配:
   - 错词优先占用"中译英"名额（错词重练拼写）
   - 错词溢出部分占用"英译中"名额
   - 随机词补足剩余名额；对随机词先随机指定题型再填入
5. 全部题目随机打乱顺序 → 写入 session_items（题干+答案快照）→ 按 timestamp 命名
```

### 3.3 词表不足 50 词时的降级策略（已确认）

- 活跃词 + 错词 < 50：**全部入选**，题型按 30:20 比例折算（如 40 词 → 24 中译英 + 16 英译中）；< 5 词时提示教师先扩充词库。

---

## 4. 词典查询方案（需求 2.3，PDF → 静态词典）

- **离线一次性预解析**：新增 `tools/build_dictionary.py`（在任何装有 Python+PyMuPDF 的电脑上运行），移植父目录 `scripts/fix_wrong_sheet_from_pdf.py` 中已验证的 PyMuPDF 提取 + Part1/Part2 解析逻辑，把《上海市中考英语考纲词汇默写本.pdf》全量解析为 `assets/dictionary.json`，随 App 一起托管：
  ```json
  { "ability": { "phonetic": "/ə'bɪləti/", "meaning": "n. 能力；才能", "starred": false, "pdf_index": 2 } }
  ```
- **iPad 上零解析**：App 启动时 fetch 词典 JSON 加载进内存（约几千词条，体积 < 1MB），录入单词时实时查，毫秒级。
- **查不到的词**（实测存在，如 `laboratory` 在 PDF 中缺失，**已确认允许手动录入**）：
  - 录入界面标记"缺释义"，教师可当场**手动录入中文词性与音标**（meaning_source=manual）；
  - 未补的词：可正常进入听写，但**只分配"英译中"题型**（英文+词性题干可生成），不进"中译英"（缺中文题干无法生成）；
  - 词库管理页常设"缺释义"过滤器，方便教师集中补录。
- 词性不做单独拆分：PDF 中"词性&中文"是组合字段（如 `n. 能力；才能`），题干直接使用该字段，满足 2.4 的展示需求。

---

## 5. 功能模块详细设计

### 5.1 教师模式 · 词库管理（需求 1）

- 新建/选择词库；**单次输入**：文本框粘贴/输入（支持逗号、空格、换行分隔），保存后反复使用。
- **随时扩充**（1.2）：任意词库任意时刻追加单词，已存在的词自动跳过去重。
- **只输英文**（1.3）：保存时自动查词典回填音标+词性中文，界面即时显示"已匹配/缺释义"。
- **TXT 批量导入**（1.4）：iPad「文件」App 中选取 txt（每行一个单词），逐行清洗（去空行/首尾星号空格/大小写归一）后入库，返回导入报告（成功 N、重复 M、缺释义列表）。

### 5.2 孩子模式 · 听写流程（需求 2 / 3）

```
选词库(默认=最近更新的词库) → 点"开始听写"
  → 本地生成词表(session, ts_name 命名)
  → 进入语音互动模式，逐题循环:
       TTS 念题干 → 麦克风持续监听口令
         · 听到"没听清/再说一遍" → 重复念本题     (3.2)
         · 听到"好了/下一个/下一题" → 念下一题    (3.3)
         · 屏幕常驻【再听一遍】【下一题】按钮兜底（ASR 不可用时流程不中断）
  → 全部完成: "今天50题已经完成！" + 表扬 + 当日进度总结   (3.4)
```

- 孩子屏幕同步显示当前题干（中译英：中文+词性+首字母提示，如 `能力 n. a ______`；英译中：`ability n. ______`）、题号进度 `12/50`。
- **作答介质（已确认）：孩子在纸质本上手写作答，教师人工批改**——不做机器识别；屏幕只显示题干与进度，与纸质学习习惯一致。

### 5.3 语音交互设计（TTS/ASR）

**TTS（念题）**，中英文分段合成（iPad 各选一个 zh-CN / en-US voice）：
- 中译英：`第 3 题。中文意思：能力。词性：名词。首字母提示：A。请写出这个英文单词。`
- 英译中：`第 4 题。英文单词：ability（放慢、读两遍）。词性：名词。请写出中文意思。`
- **英文单词默认读两遍（已确认）**；语速/间隔 v1 固定内置值（rate≈0.9），不做可配置，留待 2.0 版本按需增加。
- 完成：`今天 50 题已经完成！你真棒！`

**ASR（听口令）**：
- `webkitSpeechRecognition`，`lang='zh-CN'`，识别结果做关键词匹配：
  - 命中 `没听清|再说一遍|重复|听不懂` → 重播本题
  - 命中 `好了|下一个|下一题|继续` → 下一题
- 每题开始时启动监听，识别结束自动重启（连续监听）；首次使用需授权麦克风（HTTPS 静态托管满足安全上下文）。
- **兜底原则**：ASR 是增强体验，屏幕按钮始终可用；ASR 不可用（无网/未授权）时自动隐藏语音提示、放大按钮。
- **真机验证点**：ASR 在 Safari 标签页与「主屏幕 PWA」两种形态下都需实测（iOS 主屏幕模式对 SpeechRecognition 历史上存在兼容差异），M6 里程碑中验证。

### 5.4 教师模式 · 批改（需求 4）

- 批改入口按 **timestamp 列表**检索听写任务（显示 `20260823-175301` + 词库名 + 题数），也可先导出打印版答案页对照纸质卷。
- 选定任务后进入批改页：
  - 每题一行：`[checkbox] 序号 题干 —— 标准答案`（中译英答案=英文+音标；英译中答案=中文）。
  - **多学生模式**（4.2）：页面顶部学生选择/快速新建，每个学生的勾选状态独立缓存（草稿存 IndexedDB），切换学生互不干扰，分别保存。
  - 底部**【批改完成】**按钮（4.4）：保存该学生勾选结果 → 计算得分（`(总题数−错题数)/总题数×100`）→ 触发 3.1 权重更新 → 错词进入下次错词池 → 发放小勋章（5.1 鼓励）→ **触发自动 GitHub 备份（§5.7）** → 页面显示得分与错词清单。
- iPad 触屏勾选 checkbox，批改体验天然适合平板。

### 5.5 后台 · 错题巩固闭环（需求 5，见 §3）

批改保存 → 权重/计数更新 → 已达 10 次答对的词移入"已掌握"→ 下次生成词表时错词优先占位 → 权重影响随机抽样概率。
（"后台"即应用内同步执行的纯 JS 逻辑，无独立进程。）

### 5.6 孩子模式 · 鼓励体系（需求 5 鼓励项）

| 事件 | 奖励 |
|---|---|
| 每次批改完成（该学生有成绩录入） | +1 枚小勋章（5.1） |
| 已掌握词库每 +30 词（**已确认：按词库独立统计**） | 触发一次 Milestone 恭喜动画（5.2），孩子端下次打开/听写完成时播放，每个里程碑只播一次 |
| 每累计 10 枚小勋章 | 兑换 1 枚大勋章（5.3） |

- 孩子端首页常驻"我的勋章墙"（小勋章计数、大勋章计数、已掌握单词数、距下一个 Milestone 还差几个词）。
- Milestone 阈值（30）、大勋章比例（10）进配置。

### 5.7 数据备份：批改后自动提交 GitHub + 手动导出双保险（v0.4 确认）

**机制**：GitHub Contents API 允许带 Token 的网页直接写入仓库文件（`PUT /repos/{owner}/{repo}/contents/{path}`，HTTPS + CORS，iPad Safari 可直连）。备份就是一次 API 调用，无需任何后端与第三方服务。

**仓库布局**（备份仓库与 Pages 托管仓库分离）：
- **托管仓库**（公开）：放 App 静态文件，Pages 发布。
- **备份仓库**（**私有**）：只存一个 `backup-latest.json`。
- 分离的好处：PAT 权限只及备份仓库（即使泄露也碰不到 App 代码）；备份内容（含学生姓名与成绩）不公开；Service Worker 不会缓存到它。

**自动流程**：
1. 「设置」中配置 repo_owner / repo_name / github_token——**fine-grained PAT，仅授予该备份仓库的 Contents: Read & Write 权限**（一次性配置，M5.5 附操作指引）。
2. 每次点击「批改完成」→ 生成**全库备份 JSON**（词库+词条+批改+勋章，KB 级）→ GET 现有文件的 sha → PUT 更新 `backup-latest.json`，commit message 形如 `backup 20260823-175301 小明 92分`。
3. 失败（无网/服务异常/Token 失效）→ 写入 `backup_queue`，下次打开 App 或联网时自动重试；教师模式首页角标提示积压条数；Token 失效时引导重新粘贴。
4. 未配置时：批改后弹窗提示「未配置自动备份，请手动导出」，不阻塞批改流程。

**版本历史（附带免费能力）**：每次备份是一次 git commit，GitHub 保留全部历史——恢复页默认取最新版，也可列出历史 commit 回滚到任意时点（比邮件方案更可靠，且无 200 封/月类配额）。

**恢复**：「设置 → 从 GitHub 恢复」经带 Token 的 API 拉取 `backup-latest.json`（或指定历史版本）→ 全量重建 IndexedDB；也支持导入本地备份文件。注意：恢复的前提是拿到 PAT——PAT 平时只存于 iPad 本机，教师需在密码管理器/备忘录**留存一份**（iPad 数据丢失后恢复时要用）。

**并发与边界**：单台 iPad 单写入者，无并发冲突；未来若多设备使用同一备份仓库，采用 last-write-wins（超出当前范围）。fine-grained PAT 建议选择长时间有效期/不过期，避免遗忘续期导致备份静默失败（Token 失效有角标提醒）。

**保留手动导出/导入**（次要通道）：教师模式「备份」页一键导出 JSON 文件到「文件」App/iCloud；`navigator.storage.persist()` 持久化申请降低 iOS 存储回收风险。

---

## 6. 配置设计（需求 2.2）

默认值在 `config.js`（随代码托管的配置文件）；App 内「教师模式 → 设置」可改并存入 settings 表（覆盖默认值）：

```js
dictation: { total: 50, c2e: 30, e2c: 20 }   // 每次听写总词数/中译英/英译中
selection: {
  initial_weight: 1.0,
  wrong_multiplier: 2.0,      // 答错一次权重×2
  weight_cap: 8.0,
  correct_per_decrease: 3,    // 每答对3次
  decrease_divisor: 2.0,      // 权重÷2
  weight_floor: 0.25,
  mastered_threshold: 10,     // 答对10次→已掌握
}
reward: { milestone_step: 30, big_badge_per: 10 }
tts: { rate: 0.9 }            // v1 固定值，不暴露设置项；2.0 再评估
backup: {
  repo_owner: '', repo_name: '',  // 备份仓库（私有，与 Pages 托管仓库分离）
  github_token: '',               // fine-grained PAT，仅授予该仓库 Contents 读写
}
```

---

## 7. 页面与本地模块结构

```
index.html（单页应用，hash 路由）
├── #/home            入口：教师模式 / 孩子模式
├── #/teacher
│   ├── #/teacher/libraries        词库列表/新建
│   ├── #/teacher/library/:id      词条管理(追加/导入txt/词典回填/缺释义补录/已掌握)
│   ├── #/teacher/sessions         听写任务列表(timestamp检索)
│   ├── #/teacher/grading/:ts      批改页(多学生/checkbox/批改完成)
│   ├── #/teacher/students         学生管理/勋章统计
│   └── #/teacher/settings         设置(GitHub备份配置/参数) & 备份(导出导入/重试队列/从GitHub恢复)
└── #/child
    ├── #/child/home               选词库(默认最近)+勋章墙
    ├── #/child/dictation/:ts      听写互动(TTS/ASR/进度)
    └── #/child/done               完成页(表扬/总结/Milestone动画)
```

模块划分：`db.js`(IndexedDB DAL) / `dictionary.js` / `selector.js` / `grading.js` / `reward.js` / `tts.js` / `asr.js` / `githubBackup.js`(Contents API 提交+重试队列) / `backup.js`。

---

## 8. 项目目录结构

```
WordRobot/
├── index.html                 单页应用入口
├── manifest.webmanifest       PWA 清单(名称/图标/standalone)
├── sw.js                      Service Worker(App壳+词典缓存,离线可用)
├── config.js                  默认配置
├── css/                       样式(教师端/孩子端两套主题)
├── js/                        模块(见 §7)
├── assets/
│   ├── dictionary.json        PDF预解析词典(构建产物,随App托管)
│   └── icons/                 PWA 图标
├── tools/
│   └── build_dictionary.py    PDF→dictionary.json(任意电脑离线运行)
├── docs/
│   ├── design-plan.md         本设计文档
│   └── github-backup-setup.md 建私有备份仓库/创建fine-grained PAT/App配置指引
└── (部署: GitHub Pages——push 到 main 即发布)
```

---

## 9. 实施计划（里程碑）

| 阶段 | 内容 | 预估 |
|---|---|---|
| M0 | 词典预处理：移植 PDF 解析，生成并校验 dictionary.json（抽查词义/音标/覆盖率） | 0.5 天 |
| M1 | IndexedDB 数据层 + 选词算法/权重/批改统计/勋章核心逻辑（纯 JS） | 1 天 |
| M2 | 教师模式 UI：词库管理、TXT 导入、词典回填、缺释义手动补录 | 1 天 |
| M3 | 孩子模式 UI：听写流程 + TTS/ASR + 完成提示 | 1–2 天 |
| M4 | 批改 UI（多学生、checkbox、批改完成）+ 错词/已掌握闭环 | 1 天 |
| M5 | 勋章/里程碑/Milestone 动画、勋章墙、手动备份导出导入 | 0.5–1 天 |
| M5.5 | GitHub 自动备份：Contents API 集成、重试队列、恢复流程（含历史版本）、配置指引文档 | 0.5 天 |
| M6 | PWA（manifest/SW 离线）、GitHub Pages 部署、iPad 真机联调（含主屏幕模式下 ASR 验证） | 0.5 天 |

总计约 5–6.5 天。

---

## 10. Review 确认结论（2026-08-23）

| # | 问题 | 结论 |
|---|---|---|
| 1 | 错词池口径 | **任一学生标错即进入下次词表**（跨学生合并去重） |
| 2 | 词表不足 50 词 | **全部入选**，题型按 30:20 比例折算 |
| 3 | "已掌握"统计口径 | **按词库独立统计**，Milestone 按单库 30 词计 |
| 4 | PDF 查不到释义 | **允许手动录入**中文词性与音标；未补录只做英译中题型 |
| 5 | 作答与批改方式 | **纸质手写作答 + 教师人工批改**，不做机器识别 |
| 6 | 英译中朗读 | **默认读两遍**；语速/间隔 v1 固定内置，不做配置，2.0 再评估 |
| 7 | 备份机制 | **批改后自动把备份 JSON 提交到 GitHub 私有仓库**（v0.4 由 EmailJS 邮件方案简化而来：少一个第三方服务、无配额、git 历史免费提供版本回滚）；配置私有备份仓库 + fine-grained PAT；手动导出兜底 |
| 8 | 托管 | **GitHub Pages**（已有账号） |

实施前置条件（一次性）：
- GitHub 新建**公开托管仓库**（开 Pages）+ **私有备份仓库** + 创建 fine-grained PAT（仅备份仓库 Contents 读写，M5.5 提供操作指引）；PAT 在密码管理器/备忘录留存一份（iPad 数据丢失后恢复时要用）。
- PDF 词典构建在任意 Python 电脑上跑一次。
