# @dsh-external/dsh-usage-heatmap

模型用量统计面板 — 装在 DSH 设置页里的 Token 用量看板：九宫指标卡 + GitHub 风格热力图 + 活动洞察，数据全部在本地聚合。

An all-local token usage dashboard for the DeepSeek Harness settings page.

## 功能 / Features

- **九宫指标卡**：累计 Token、今日、昨日、峰值日、最长会话、连续活跃（当前 / 历史最长）、活跃天数、会话数（主 / 子代理）、子代理 Token。
- **热力图**：GitHub 风格日历，每格 = 当日用量（周一为一周之始），可切「每日 / 每周 / 累计」三档；行标一/三/五/日与格子按同一 7 行网格对齐；列数随容器宽度自适应。
- **活动洞察**：峰值日占比、连续活跃区间、会话构成、最长会话、子代理占比、缓存读取占比、今日四桶（未缓存输入 / 输出 / 缓存读 / 缓存写）。
- **不丢数**：会话日志被删后，历史 token 仍从投影缓存（`session_projcache`）与已扫入的归档分桶中保留；面板把「已删归档」与「孤儿投影」分开标注。
- **性能**：投影文件按 mtime 记忆化、逐文件让出事件循环、内容未变不重渲染、持久化快照使重启首帧约 350ms；面板根为自滚动容器（`will-change: scroll-position`），滚动走合成器线程。

## 安装 / Install

从 GitHub 安装（仓库已提交 `lib/`，无需构建）：

```bash
dsh plugin add github:zeng6125-rgb/dsh-usage-heatmap
```

或使用 Release 里的预构建 tarball：

```bash
dsh plugin add https://github.com/zeng6125-rgb/dsh-usage-heatmap/releases/latest/download/dsh-usage-heatmap.tgz
```

装好后在 **设置 → 模型用量统计** 查看。首次扫描需要几秒（约 8s，取决于会话日志总量），之后走缓存与快照，秒开。

## 数据来源 / Where the numbers come from

全部为本地文件，插件不发起任何网络请求：

| 来源 | 路径 | 用途 |
| --- | --- | --- |
| 会话投影缓存 | `~/.dsh/storages/session_projcache/sessions/*.json` | 会话级累计 token、会话元信息 |
| 会话日志 | `~/.dsh/storages/session*/**.jsonl.zstd` | 逐日分桶（多帧 zstd） |
| 聚合缓存 | `~/.dsh/storages/usage-heatmap/cache.json` | 增量扫描结果与归档 |
| 快照 | `~/.dsh/storages/usage-heatmap/last-state.json` | 重启后首帧秒开 |

> 逐日分桶依赖会话日志中的事件时间戳；缺失时回退到 `createdAt` / 文件 mtime 摊分。

## 开发 / Development

```bash
DSH_CHECKOUT=<dsh source checkout> bash scripts/build.sh   # src/ → lib/
npm run typecheck                                          # tsc --noEmit
```

`scripts/build.sh` 需要一份 DSH 源码检出（`DSH_CHECKOUT`，或 `~/dsh-harness` / `~/dsh` / `~/.dsh/dsh-harness` 之一）来链接 `@deepseek-ai/*` 与 `cordis`；终端用户安装时用的是仓库里已提交的 `lib/`，不需要这一步。

`tools/*.mjs` 是开发期探针（逐日对账、事件字段、帧结构、投影缓存、子代理口径），自带实现、不依赖 `lib/`。

## License

BSD-3-Clause
