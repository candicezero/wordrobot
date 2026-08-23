# WordRobot 听写机器人

孩子英语单词语音听写的纯前端 PWA：教师与孩子共用一台 iPad，数据全存本机，
批改后自动备份到 GitHub 私有仓库。设计文档见 `docs/design-plan.md`（v0.4，唯一事实来源）。

## 快速开始（本地）

```
cd WordRobot
python -m http.server 8765        # 任意静态服务器均可；直接双击 index.html 亦可（SW/麦克风不可用）
# 浏览器打开 http://127.0.0.1:8765
```

## 目录

| 路径 | 说明 |
|---|---|
| `index.html` | 单页应用入口（hash 路由，零构建，`<script>` 直引） |
| `js/` | 模块：db / dictionary / selector / grading / reward / tts / asr / githubBackup / backup / router + views |
| `assets/dictionary.json` | 《上海市中考英语考纲词汇默写本》预解析词典（1776 词条） |
| `tools/build_dictionary.py` | PDF → 词典 构建脚本（任意装有 Python+PyMuPDF 的电脑运行一次） |
| `sw.js` / `manifest.webmanifest` | PWA 离线缓存与清单（发版时 CACHE 版本号 +1） |
| `tests/` | core-tests（纯逻辑 52 项）· smoke（IndexedDB 集成 34 项）· e2e/backup/sw 脚本 |
| `docs/` | 设计文档与 GitHub 备份/部署指引 |

## 测试

- 逻辑测试：浏览器打开 `tests/core-tests.html`
- 集成测试：需经 HTTP 访问 `tests/smoke.html`（IndexedDB + 词典）
- 自动化（本仓库开发用）：`python tools/cdp_run.py <url> <wait_s> @tests/e2e-flow.js`

## 词典重建

```
python tools/build_dictionary.py            # 默认读取 ../WordTest/上海市中考英语考纲词汇默写本.pdf
```

## 部署与备份配置

见 `docs/github-backup-setup.md`（公开托管仓库开 Pages + 私有备份仓库 + fine-grained PAT）。
