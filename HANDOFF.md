# 工作记忆 / HANDOFF（2026-10-07）

> 本文件是会话间交接用，未提交进 git（files 白名单不含它，发布不受影响）。
> 权威代码状态 = `src/index.ts`、`src/aggregate.ts`、`src/client/index.ts` + 本文件。

## 1. 当前身份（v0.1.0 起已改名，别再写旧名）

- npm 包名 / package.json name：**`dsh-usage-heatmap`**（原 `@dsh-external/dsh-usage-heatmap`，因该 scope 不归我们 npm 账号 jiaszeng，unscoped 化才能发 npm、才被市场统计下载量）
- host 路由：**`/dsh-usage-heatmap/api`**（`/state`、`?fresh=1` 正则 `/[?&]fresh=1(?:&|$)/`）
- status 工具：**`_dsh_usage_heatmap_status`**
- cordis.patch：`id: dsh-usage-heatmap` + `name: 'dsh-usage-heatmap'`；tsdown banner id 同名
- 本机装配：dev_inject_plugin 注入（dir=本仓库），entry `51f461b3 [active]`；旧 @dsh-external 条目已 uninject，profile patch 的 disabled 阻断行已删

## 2. 核心机制（都有注释在源码里，别回退）

- **增量续解**（aggregate.ts）：日志仅追加多帧 zstd ⇒ 缓存条目持久化 `r`(帧边界)/`h`(前缀 sha256)/`u`(st.last)/`t`(turnSet) ⇒ 变更文件只折尾部新帧；守卫不符→全量回退；撕裂 carry→r=-1 下次全量。旧条目缺字段→变更时全折一次自动升级。实测 fresh 6.8~12s→**~50ms**。
- **载荷契约**：顶层 5 键 `title,days,metrics,source,updatedAt`；`days`=纯数字对象；不变量 `sum(days)==metrics.totalTokens`；metrics 27 键。
- **SWR**：host STATE_TTL_MS=20s；client POLL_MS=15s；快照 `last-state.json` 秒开；dirty 门控（snapshotContentKey 剔遥测字段）。
- **滚动满帧配方**（client/index.ts）：`.uh-page` 自滚动 + `will-change:scroll-position` + 6px webkit 细滚动条 `.uh-scrolling` 滚动中着色（**禁写 scrollbar-width/scrollbar-color**，会废掉全部 ::-webkit-scrollbar*）+ 格子区 `translateZ(0)`；**contain:layout/paint 已证伪（更差）勿加**；`.uh-card` 无 hover。
- **高度填充模型**（10-05 vfill 修复，`tools/vertical-fill-probe.mjs` 量测）：`.uh-page` `height:100%`——百分比包含块 = 宿主 `.VOzbGW_options` 内容盒（经 display:contents 透传），精确贴窗口底沿 + 单层滚动条；`max-height:calc(100vh - 85px)` **仅作宿主 auto 高布局的回退**保留（150px 旧值是按 222px 导航布局定的，用户 0.4.6 无导航模式 chrome 只有 ~85px，150 会把面板压短 ~65px 再造底部空白——10-05 用户亲自定位）（旧模型单用 max-height：819 视口下 669 > 可用 532 → 双滚动条，内容短时底部空白——用户报的「没贴满」）。`.uh-fill`（洞察卡）**必须 `flex:1 0 auto`（只 grow 不 shrink）**：首版写成 `1 1 auto` + `min-height:0`，内容溢出视口时 flex 把这张卡**压瘪**（实测 910×428 压到 26px，洞察列表溢出卡片框、视觉上盖过 note 显示 → 用户截图里的错乱）；有富余则吸收剩余高度、数据源 note 沉底。四档实测（428/819/1000/1250）全过 + 回归 `tools/panel-vfill-fix2.json`：3 宽 ×3 模式对齐 ≤0.6px、sq=0、无溢出、配方 flag 干净。
- **行标对齐**：单网格 `--uh-tracks` 声明在 `.uh-cal`（必须带内联变量的同一元素）+ 行标 `align-self:center;height:0;overflow:visible` + 墨迹光学修正 `translateY(-0.0667em)`（字体 ascent/descent 不对称，em 随字号缩放）。
- **导航图标**：settings.section 无 icon 契约 ⇒ DOM 补丁 `installSettingsNavIcon()`（按 SECTION_LABEL 文本认领行、MutationObserver、CSS mask 3px 格+1px 隙墨迹 11px）——生态惯例（dshmarket 同款）。
- **按模型统计**（10-07 `f28cdef` 起 → 10-08 堆叠图）：数据流 = 日志 assistant/message 行的 `data.message.source.{provider,model}`（`modelOfEvent`；attempt 行无模型明细不计入）→ 会话级 `models` + **日×模型 `dayModels`** 双维度分桶 `[uncachedInput,output,cacheRead,cacheWrite]` → payload 顶层 `models` + `dayModels`。**CACHE_VERSION 保持 1，口径版本 `MODELS_V`（现=3，dayModels 上线时 2→3）**：缓存条目 `mv!==MODELS_V` 视为未命中 → 全量重折自愈（一次性 ~2min；升口径只改 MODELS_V 常量即全量重折），**增量续扫同样要求 `prev.mv===MODELS_V`**（缺此门历史行永远无模型归属且写回后不再修复——10-07 踩过）。已删会话归档/孤儿投影无模型明细 → 不计入，面板显示差额行「另有 X tokens 未按模型计入」。面板：模型卡在热力图与洞察之间，**双版式可切换**（`.uh-seg` 复用热力图粒度控件样式，state 在组件顶层 `modelModeS` useState，**默认 'day' 按日期、按钮顺序按日期在前**——10-08 用户指定）：①「按模型」垂直柱状（**数值标签绝对定位贴柱顶**：track position:relative + val bottom=calc(柱高% + 4px)，图表 padding-top:20px 给最高柱标签留位；柱 track 150px/宽 44px + 短名 mLabel）②「按日期」堆叠多色柱（横轴=本地日升序 32 根；柱高=当日总量/最大日；柱内段=模型按当日占比 flex-grow 分配，**段必须 `flex-basis:0`** 否则所有柱撑满——踩过；柱 track 150px/宽 80% max 34px；**日期标签每 4 根抽稀+末根**，否则 32 根挤成重叠行；逐日数值只进 tooltip）；调色板 `mPalette` 8 色 top8 各一色+其他灰，两版式与图例共用 `mColor`；**图例整块居中**（justify-content:center，条目内部点+文字仍左对齐，左右留白对称——10-08 用户指定）；**差额行 mMissEl 是图表容器兄弟节点**（push 进 flex 行容器会被挤到值标签行，踩过）。**悬停交互（10-08）**：tooltip 机制从 HeatmapCard 提为模块级单例（`_tipEl/showTip/moveTip/hideTip/mkTipHandlers`，lines 调用处求值避 var 闭包陷阱）；段/日柱/按模型柱/图例全挂 tooltip（段三行：全名 / 日期·tokens·占当日% / 全期·占比）；同柱其他段 `:hover` 变淡 .45 + 悬停段 brightness(.9)；**图例悬停联动**：hlS useState(-1|0..7|8)，`.uh-modelStack[data-hl]` + 段 `data-on`，非目标模型 opacity .22；图例 enter/leave 必须同时 showTip+setHl / hideTip+setHl(-1)（Object.assign 会覆盖 handler，踩过）。**短名碰撞**：mLabel——不同 provider 同名模型（deepseek-official 与 hy3 的 deepseek-v4.1-flash）短名计数>1 时回退全名。排版教训（10-07/10-08）：**禁用 500/550 等非标字重**（Windows Segoe UI 无 550 → 拉丁映射 Semibold、中文雅黑映射 Bold，同串字体观感割裂，用户报「字体各不相同」；现全卡 600=真实字面）；固定盒宽+tnum 双保险保成列（探针 `--rects` 量 pctRight/valRight 逐行唯一值+文字间隙；「恒定间隙」与「右缘对齐」几何互斥，选保对齐——该教训属已废弃的行式版式）。指标卡图标 `.uh-metricIcon` 15→18px / font 12 / radius 5（用户反馈太小）。

## 3. 发布状态

- GitHub：**master `f28cdef` 已推送**；Releases v0.1.0→v0.1.1→**v0.1.2（Latest，10-05）**，资产一律 `dsh-usage-heatmap.tgz`（**版本无关命名，不得带版本号**——发版需把 npm pack 产物复制成无版本名再 gh 挂）。0.1.2 内容：面板高度自适应修复链 `ce59d32`（height:100% 贴满）→`edfe64f`（uh-fill 只 grow 不 shrink）→`8b0848f`（纵向密度压缩）→`ae94bd3`（**max-height 上限 150→85px，用户亲自定位：其 0.4.6 无导航弹窗 chrome 仅 ~85px**）→`20a0fd3`（洞察列表保持单列——双列密度方案用户否决，观感优先，超高时面板内部滚动）
- **0.1.3 攒着未发**（10-07 用户指示「先不发，攒着先」）：已积累 `09033de`（最活跃星期洞察附大头日期证据）+ `f28cdef`（按模型统计 token 消耗 + 指标卡图标 18px）。发版时走常规链：bump → `npm run build:client` + host `npx tsc -p tsconfig.json` → pack 复制成无版本名 → gh release + npm publish
- npm：**`dsh-usage-heatmap@0.1.2` 已发布**（10-05，账号 jiaszeng，latest 标签）；本机 `.npmrc` 已配 token，`npm whoami` 绿。历史下载：0.1.0 = 335（09-04~10-03）
- **内核适配（0.1.1 变更点）**：peerDeps `@deepseek-ai/dsh-tools` / `@deepseek-ai/dsh-client-ui-slots` 追加 `|| >=0.2.0-rc.1 <2`（本机宿主 Desktop 0.4.4 捆绑 0.2.0-rc.2；node-semver 预发布规则下旧段 `<2` 匹不上 0.2.0-rc.2 预发布，必须加段；0.1.x 段保留向后兼容）。typecheck 0 错 + 热重载 [active] + 不变量 sum==totalTokens（21,236,180,567）均实测通过
- 市场：PR #5838 **已合并**（2026-09-26）；probe 已于 10-05 写入 npm 字段（待办②完结）；0.1.1 上 npm 后 version/downloads 下一轮日更自动跟随
- 构建链：`dev_build_plugin(D:\workroom\dsh-usage-heatmap)` → `dev_reload_package(usage-heatmap)`；typecheck `npm run typecheck`

## 4. 待办 / 风险

1. **⚠️ npm token**：10-05 用户经聊天提供新 token，已配置进本机 `.npmrc`（`//registry.npmjs.org/:_authToken`），0.1.1 发布可用——但**此 token 也随之进入聊天记录（第二次同途径）**。若在意：去 [Access Tokens](https://www.npmjs.com/settings/jiaszeng/tokens) revoke 旧的、生成新的**直接**写 `.npmrc`（勿贴聊天）。以后发布我可直接用 `.npmrc` 里的凭据跑 `npm publish`，无需我看 token 内容
2. ~~复验市场~~ **已完结（10-05 复验通过）**：probe 已写入 `npm=dsh-usage-heatmap / version=0.1.0 / downloads=335`（downloadsCheckedAt=2026-10-05，与 npm API 09-04~10-03 计数 335 一致）。npm 发布→市场写入实测延迟 ~6 天（09-28 发布→10-05 写入），比原估「1~2 天」长；0.1.1 上 npm 后 version/downloads 下一轮日更自动跟随。`.market-watch.json` 门槛文件保留（HEAD 比对 Last-Modified 未推进即跳拉取），若需观察 0.1.1 跟随可用。过程证据（probe 三链节奏、写入前提 4/4 全绿）见 goal-5329c259 与 git 历史，此处从简。
3. 若将来 dev_uninject_plugin 本插件：它会写 `id: dsh-usage-heatmap` 的 disabled 行**恰好阻断新版自装配**——重装/恢复后务必删掉该行
4. 长期安全约束：**不得触碰含密钥的 llm-headers**；**禁止用 cua/桌面自动化操作用户的 DSH Desktop 窗口**（10-05 用户明确要求「别用 3081 这个窗口」）。**10-07 用户再次明确：「不要使用 3081 看，3080 才是电脑端口」——一切探针/验证只走 127.0.0.1:3080，3081 一律不碰、不推断其归属**。看用户真实渲染只能**等用户截图**。探针纪律：全部 `--headless=new`、只访问 `127.0.0.1:3080`（探针打印 `location.port` 自证，勿凭截图猜端口）、用完即退不留进程。**宿主 web 壳有响应式断点：窄窗（~≤1000，实测 922）设置页=弹层+三列导航网格；宽窗（实测 ≥1123）=侧边栏布局页——给用户看效果前先对齐其窗口宽度，否则「页面长得不一样」会被误判成端口/入口不同（10-07 用户即中此坑）**
5. 本机真实数据基线（10-07）：累计 ~233.6 亿、活跃日 33、连续 25、logs 247、归档 305（主 426 · 子代理 126）、模型键 44 个（计入 79.4 亿，差额 154 亿=已删会话）；漂移属正常
6. **DSH 源码检出**（10-05 曾消失，10-07 已回来：junction 健康、typecheck 绿）——但 `DSH_CHECKOUT` env 未设且 `dev_build_plugin` 常见路径探测不到它，仍报「未找到 DSH checkout」；bash 不在 pwsh PATH ⇒ `scripts/build.sh` 不可用。**host 构建等价替代：`npx tsc -p tsconfig.json`**（tsconfig outDir=lib，项目自带 typescript 5.9 直接 emit host）。教训：改 host 代码（aggregate/index.ts）后 reload 前确认 `lib/aggregate.js`/`lib/index.js` 真的重新编译过（10-07 第一轮只 build:client 导致 models 键 0）

## 5. 验证资产

- 仓库内 `tools/`（已 gitignore，30+ 探针/夹具脚本与证据 JSON）：`byte-equiv.mjs`、`align-probe.mjs`、`cdp-panel-probe.mjs`、`scroll-perf.mjs`、`snapshot-gate.mjs`、`baseline/`（旧构建冻结副本）；8 个 probe-*.mjs 是早期已提交的。`vertical-fill-probe.mjs` 支持 `--scroll <selector>`（截图前滚动到该元素并打印其完整 innerText，用于目检视口外的卡片）；`ground-truth.mjs`（独立 zstd 解码真值）+ `weekday-audit.mjs`（星期口径审计，**须以仓库根为 workdir**）
- TEMP 可复现测试（**09-29 确认已被系统清理**，改 aggregate.ts 前需从 tools/ 重建）：`uh-golden-inc.mjs`（增量≡全量黄金等价）、`uh-real-inc.mjs`（真实规模 814→107ms）、`uh-bench-fold.mjs`
- 诊断日志：`~/.dsh/super-injector/{reload-debug.log,self-heal.log}`
- 报告：`D:\workroom\dsh-usage-heatmap-优化报告.md`；对照图两张（光学修正/导航图标）
- 坑账：Windows 下 import 需 `file:///`；npm.cmd 需 shell:true；比对字段必须双边存在；`?fresh` 边界不能用状态码判定；headless Edge profile 会吃 1GB TEMP；**github.com:443 直连被阻（10-05 实测），git push 需一次性代理 `-c http.proxy=http://127.0.0.1:7890 -c https.proxy=http://127.0.0.1:7890`（勿改全局），而 gh CLI 的 api/uploads.githubusercontent 直连可达**；发版资产 npm pack 产物自带版本号，必须复制成 `dsh-usage-heatmap.tgz` 再 `gh release create` 挂
