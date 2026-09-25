/**
 * @dsh-external/dsh-usage-heatmap — client 面板（settings.section 分区）。
 *
 * 布局：头部（标题/摘要/刷新）→ 9 宫指标卡（累计/今日/昨日/峰值日/最长会话/连续活跃/
 * 活跃天数/会话/子代理Token）→ GitHub 风格热力图（日/周/累计切换 + 月份轴 + tooltip）
 * → 活动洞察列表。样式：简洁浅色卡片，复用 DSH 设计变量（--dsw-alias-*）。
 *
 * ⚠️ 两个必坑（2026-08 实测）：
 *  ① apply 用 ctx.slots 必须 export const inject = ['slots']（文本校验按此正则）；
 *  ② slots.register 的 slot 名必须是字符串字面量且 `{` 紧跟 register( 同一行
 *    （守卫正则 register\(\{[\s\S]{0,400}?name:\s*['"]<slot>['"]）；
 *     组件作为 register(...) 的第二个参数传入（非对象内 component 字段）。
 *  ③ 组件必须是 React 组件（宿主经 factory 的 require("react") 提供），
 *     返回原生 DOM 会渲染成空白。
 */
declare const require: any

var React = require('react')
var h = React.createElement

var PLUGIN_ID = '@dsh-external/dsh-usage-heatmap'
var API = '/@dsh-external/dsh-usage-heatmap/api'

// 分区标题：settings.section 的 label 与「导航图标补丁」共用同一份文本
var SECTION_LABEL = '模型用量统计'

/**
 * 设置页导航图标（热力图 3×3，供 CSS mask 使用）。
 *
 * **为什么需要补丁**（2026-09-25 查证）：
 *  ① 宿主 `ui-settings-general` 的 `navIcon(id)` 是**按 id 硬编码**的图标映射，
 *     源码注释原文：`unknown ids fall back to the settings gear` ⇒ 第三方分区只能拿到齿轮；
 *  ② `settings.section` 槽位契约（client-runner 的 `registerOptions`）只有
 *     `id` / `order` / `label`，**没有 icon 字段**；
 *  ③ 借用已发布的 id（account / models / agent-presets / plugins / archived-sessions）会按契约
 *     「reusing a shipped id puts you in THAT cell and replaces it」**顶替掉官方分区**，绝不可行。
 * ⇒ 降级方案：JS 只给「我们这一行」加 `data-uh-nav-icon` 标记，CSS 隐藏宿主 svg 并用 mask 画出本图标。
 *   `background:currentColor` ⇒ 自动跟随 hover/active 的主题色。
 *   宿主 DOM 结构若变化，补丁**静默失效**（不影响面板本体功能）。
 *
 * 尺寸：网格墨迹 span 2..13 = **11px**——格子 3px（v3 定稿）+ 间隙 1px（v2 的值，
 * 用户要求"间隙回之前的"）。全整数坐标，1x 下锐利。图标设计惯例就是 viewBox 四周
 * 留呼吸边——官方齿轮与 dshmarket 的 block mark（实测 13×12）都是如此。
 */
var NAV_ICON_MASK = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cg fill='%23000'%3E%3Crect x='2' y='2' width='3' height='3' rx='0.8' opacity='.25'/%3E%3Crect x='6' y='2' width='3' height='3' rx='0.8' opacity='.45'/%3E%3Crect x='10' y='2' width='3' height='3' rx='0.8' opacity='.65'/%3E%3Crect x='2' y='6' width='3' height='3' rx='0.8' opacity='.45'/%3E%3Crect x='6' y='6' width='3' height='3' rx='0.8' opacity='.65'/%3E%3Crect x='10' y='6' width='3' height='3' rx='0.8' opacity='.85'/%3E%3Crect x='2' y='10' width='3' height='3' rx='0.8' opacity='.65'/%3E%3Crect x='6' y='10' width='3' height='3' rx='0.8' opacity='.85'/%3E%3Crect x='10' y='10' width='3' height='3' rx='0.8'/%3E%3C/g%3E%3C/svg%3E\")"

// ---------------------------------------------------------------------------
// 样式
// ---------------------------------------------------------------------------

var CSS = [
  /* 页面骨架 */
  /* 页面根 = 自滚动容器（复刻 dsh-hy-proxy 实测满帧配方，2026-09-22 CDP 帧时间验证）：
     will-change:scroll-position → 行为走合成器线程，实测 21ms→6.05ms、超标帧 56/60→0/60。
     ★ 勿加 scrollbar-width/scrollbar-color：非 auto 会让全部 ::-webkit-scrollbar* 规则失效。
     ★ 勿加 contain:layout paint：实测 23.95ms/57-of-60 反而更差。 */
  '.uh-page{display:flex;flex-direction:column;color:var(--dsw-alias-label-primary,#1f2329);box-sizing:border-box;touch-action:pan-y;max-height:calc(100vh - 150px);overflow-y:auto;overflow-x:hidden;overscroll-behavior:auto;scrollbar-gutter:stable;-webkit-overflow-scrolling:touch;will-change:scroll-position}',
  '.uh-page::-webkit-scrollbar{width:6px}',
  '.uh-page::-webkit-scrollbar-track{background:transparent;margin:16px 0}',
  '.uh-page::-webkit-scrollbar-thumb{background:transparent;border-radius:99px}',
  '.uh-page.uh-scrolling::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l2,rgba(0,0,0,.18))}',
  '.uh-header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:2px 0 14px;border-bottom:1px solid var(--dsw-alias-border-default,#e5e5e5);flex-wrap:wrap}',
  '.uh-brand{display:flex;flex-direction:column;min-width:0}',
  '.uh-brandName{font-size:17px;font-weight:600;line-height:24px;color:var(--dsw-alias-label-primary,#1a1a1a)}',
  '.uh-brandDesc{margin:2px 0 0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#555)}',
  '.uh-headerRight{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
  '.uh-sum{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#646a73);font-variant-numeric:tabular-nums}',

  /* 卡片：扁平清爽，且不做任何 hover 反馈——大卡片 hover 切换会让整卡子树重绘，滚动时是掉帧源 */
  '.uh-card{position:relative;border:1px solid var(--dsw-alias-border-l2,#f0f1f3);border-radius:10px;padding:12px 14px;background:var(--dsw-alias-bg-layer-3,#fff);box-shadow:0 1px 2px rgb(31 35 41 / 2%)}',

  /* 指标卡片行 */
  '.uh-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(164px,1fr));gap:10px;margin:14px 0}',
  '.uh-metricLabel{display:flex;align-items:center;gap:7px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#646a73)}',
  '.uh-metricIcon{display:inline-grid;place-items:center;width:15px;height:15px;border-radius:4px;font-size:10px;line-height:1;flex:none;color:#1677ff;background:rgb(22 119 255 / 9%)}',
  '.uh-metricValue{margin-top:7px;font-size:20px;font-weight:650;line-height:26px;letter-spacing:-.01em;color:var(--dsw-alias-label-primary,#1f2329);font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.uh-metricSub{margin-top:4px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#8f959e);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.uh-metricSub b{font-weight:600;color:var(--dsw-alias-label-secondary,#646a73)}',

  /* 热力图卡片 */
  '.uh-section{margin-bottom:14px}',
  '.uh-sectionHead{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:12px}',
  '.uh-sectionTitle{margin:0;font-size:14px;line-height:20px;font-weight:640;color:var(--dsw-alias-label-primary,#1f2329)}',
  '.uh-sectionDesc{margin:2px 0 0;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#8f959e)}',
  '.uh-tools{display:flex;align-items:center;gap:12px;flex-wrap:wrap}',

  /* 分段切换（日 / 周 / 累计） */
  '.uh-seg{display:inline-flex;border:1px solid var(--dsw-alias-border-l2,#dfe1e5);border-radius:9px;overflow:hidden;background:var(--dsw-alias-bg-layer-2,#f4f5f7)}',
  '.uh-segBtn{padding:4px 13px;font-size:12px;line-height:18px;border:0;background:transparent;cursor:pointer;color:var(--dsw-alias-label-secondary,#646a73);transition:background .15s ease,color .15s ease}',
  '.uh-segBtn + .uh-segBtn{border-left:1px solid var(--dsw-alias-border-l2,#dfe1e5)}',
  '.uh-segBtn:hover{color:var(--dsw-alias-label-primary,#1f2329);background:rgb(0 0 0 / 4%)}',
  '.uh-segBtn[aria-pressed="true"]{background:#1677ff;color:#fff}',
  '.uh-segBtn:focus-visible{outline:2px solid color-mix(in srgb,#1677ff 55%,transparent);outline-offset:-2px}',

  /* 图例 */
  '.uh-legend{display:flex;align-items:center;gap:4px;font-size:11px;color:var(--dsw-alias-label-tertiary,#8f959e)}',
  '.uh-legendSw{width:11px;height:11px;border-radius:2px;background:var(--uh-l0)}',

  /* 日历热力网格（GitHub 风格）：列宽自适应铺满容器，正常情况下无需滚动（无滚动条）；
     极窄容器才横向溢出，此时浏览器按默认行为显示滚动条（overflow-x:auto 只在溢出时出现） */
  '.uh-calWrap{overflow-x:auto;padding:2px 0 6px}',
  /* ★ 列轨道唯一来源：--uh-tracks 由 .uh-cal 声明一次，.uh-months 与 .uh-cells 共同消费。
     两者宽度同为 .uh-main 的 100%，同一模板 + 同一可用宽度 ⇒ 列位置解析结果必然一致，
     月份轴与格子列天然一一对齐（不存在"两边各写一遍 minmax 再对齐"的余地）。
     ★ 行轨道唯一来源：行标是 .uh-cells 的 grid 成员（第 1 列、第 1..7 行），
     与格子落在同一批行轨道上 ⇒ 行高由定义相等，无需任何高度/偏移镜像常量。
     ⚠ 历史错位根因就是镜像常量：height:calc(100% - 17px)（百分比高度遇 auto 包含块不解析，
    1fr 行退化为 13px 文字行盒）+ margin-top:17px（=月份行 13px + gap 4px）。
     此后**禁止**再引入 calc(100% - Npx) / margin-top:Npx 这类跨元素补偿。 */
  '.uh-cal{width:100%;--uh-tracks:var(--uh-gutter,16px) repeat(var(--uh-cols,37),minmax(var(--uh-cell-min,11px),1fr))}',
  '.uh-main{display:flex;flex-direction:column;gap:4px;min-width:0}',
  '.uh-months{display:grid;grid-template-columns:var(--uh-tracks);gap:3px;height:13px;width:100%;font-size:10px;line-height:13px;color:var(--dsw-alias-label-tertiary,#8f959e);font-variant-numeric:tabular-nums}',
  '.uh-months > span{white-space:nowrap}',
  /* 末位月份标签锚到容器右缘。理由：标签墨迹宽（"12月"≈21px）必然超过最窄轨道（11~14px），
     左对齐时位于末尾轨道的标签会把墨迹顶出 .uh-calWrap 右缘 → scrollWidth 虚增 →
     无端冒出横向滚动条（实测 week@768 = 7.47px、day/cum@320 = 3.67px，且 gridOverflowX=0，
     说明不是布局溢出而是纯文字墨迹）。改为右对齐后墨迹向左伸展，必然落在容器内。
     只作用于"最后一个非空标签"这一个元素，其余标签仍严格左对齐到所在列 ⇒ 月份轴对齐不受影响。
     安全性：相邻列相隔 7 天，不可能连续两列都换月，故末位标签前面那个非空标签至少隔 2 轨，
     右对齐后向左最多伸展 (墨迹宽 − 轨宽) ≤ 7.5px，不会与它重叠（已实测 labelOverlapMax = 0）。 */
  '.uh-months > span.uh-monthEnd{justify-self:end}',
  /* 行标：格子 grid 的第 1 列成员（行轨道与格子同源，见 .uh-cal 注释）。
     ★ align-self:center + height:0 是"行高解耦"的关键，缺一不可：
       标签自身是 grid item，其行盒会参与所在行的 auto 尺寸计算 → 字号/行高变大时
       行标那 7 行会被文字撑高，而格子行高仍由 aspect-ratio:1 的宽度决定 → 又开始漂移。
       height:0 让标签的盒高恒为 0，align-self:center 则把它视觉居中于行轨道，
       于是"行标行盒"对行高的贡献被彻底移除，行高只剩格子这一个来源。
     ★ 判别性实验（改字号/行高看 |maxΔCY| 是否漂移）：仅 line-height:1 时
       fs12px→0.41px、fs20px→4.41px、显式 line-height:20px→4.41px（仍在漂移）；
       加上 height:0 后 fs7/9/12/20px 与 line-height 9/20px 全部恒为 0.01px（不漂移）。
       ⇒ 这才是"结构同源"而非"常量凑对"的硬证据。
     overflow:visible 保证 height:0 不会裁掉文字墨迹。

     ★ 光学修正 translateY(-0.0667em)：上面的 height:0 + align-items:center 让**行盒**中心
       与格子行中心精确重合（盒量测 0.008px），但用户看到的是**字形墨迹**，两者并不重合——
       本字体（Segoe UI / 系统 CJK 回退）度量 ascent=10 / descent=2 不对称，且 CJK 字形墨迹
       在 em 盒内偏上，导致墨迹中心落在行盒中心**下方**（canvas TextMetrics 推导：
       一+0.5 / 三+1.0 / 五+1.0 / 日+1.5 px）。**盒量测测不到这个残差，是它的盲区。**
       真实面板像素扫描（强度加权质心法，w=480，translateY 剂量-反应）：
         无修正            → 墨迹中心 − 格子行中心 = **+0.590px**（偏下，即用户观感）
         有效 −0.5px @DPR4 → **+0.138px**（平台期）
         有效 −0.75px@DPR4 → −0.088px
       取值依据（不是拍脑袋，是"两个 DPR 都要落对设备像素"）：
         DPR=1：−0.5px **被舍入吞掉**（与无修正位图相同），需 ≤−0.6px 才翻到 −1 设备像素；
         DPR=4：−0.6px = −2.4 设备像素 → 舍入到 −2（= −0.5 CSS px，落平台期）。
       ⇒ −0.6px 在两个 DPR 下都取到正确档位；换算成 em（−0.6/9px = −0.0667em），
       使修正随 font-size 等比缩放（墨迹偏移由字体度量决定、与字号成正比，
       用 px 会在字号变化后失准）。逐字残余 ±0.5px 是「一/三/五/日」字形墨迹分布差异
       （一为单横无下伸部、日有下伸部），属字体固有，无法用单一常量消除。
       ⚠ 这是**光学修正**，不是行轨道补偿：它只平移墨迹，不参与任何行高计算，
       故不违反上面"禁止跨元素镜像常量"的约束（那条针对的是用高度/边距去凑另一元素的几何）。 */
  '.uh-wdLabel{display:flex;align-self:center;height:0;overflow:visible;align-items:center;justify-content:flex-end;font-size:9px;line-height:1;color:var(--dsw-alias-label-tertiary,#8f959e);text-align:right;transform:translateY(-0.0667em)}',
  /* 格子区独立合成层：滚动时整块贴图平移，不逐帧重栅格化几百个圆角色块（勿加 contain，见 .uh-page 注释） */
  '.uh-cells{display:grid;grid-auto-flow:column;grid-template-columns:var(--uh-tracks);grid-template-rows:repeat(7,auto);gap:3px;width:100%;transform:translateZ(0)}',
  '.uh-weekCells{display:grid;grid-template-columns:var(--uh-tracks);gap:3px;width:100%;transform:translateZ(0)}',
  '.uh-cell{aspect-ratio:1;border-radius:2px;background:var(--uh-l0);cursor:pointer}',
  '.uh-cell:hover{outline:2px solid rgb(31 35 41 / 45%);outline-offset:0}',
  '.uh-cell[data-future="1"]{visibility:hidden;pointer-events:none}',
  '.uh-cell[data-l="0"]{background:var(--uh-l0)}',
  '.uh-cell[data-l="1"]{background:var(--uh-l1)}',
  '.uh-cell[data-l="2"]{background:var(--uh-l2)}',
  '.uh-cell[data-l="3"]{background:var(--uh-l3)}',
  '.uh-cell[data-l="4"]{background:var(--uh-l4)}',

  /* 调色板：蓝色系（少→多），无绿色 */
  ':root{--uh-l0:#eef1f5;--uh-l1:#bfd8ff;--uh-l2:#7fadff;--uh-l3:#3d8bfd;--uh-l4:#0f56c9}',

  /* tooltip */
  '.uh-tip{position:fixed;z-index:10000;transform:translate(-50%,calc(-100% - 12px));background:#1f2329;color:#fff;padding:7px 10px;border-radius:9px;font-size:12px;line-height:18px;pointer-events:none;white-space:nowrap;box-shadow:0 4px 12px rgb(0 0 0 / 18%);font-variant-numeric:tabular-nums}',
  '.uh-tip b{font-weight:650}',
  '.uh-tip em{font-style:normal;color:rgb(255 255 255 / 65%);font-size:11px}',

  /* 洞察列表 */
  '.uh-insights{display:grid;gap:9px}',
  '.uh-insight{display:flex;gap:9px;align-items:flex-start;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary,#1f2329)}',
  '.uh-insDot{flex:none;width:7px;height:7px;border-radius:50%;background:#1677ff;margin-top:6px}',
  '.uh-insight[data-k="peak"] .uh-insDot{background:#f59e0b}',
  '.uh-insight[data-k="streak"] .uh-insDot{background:#f97316}',
  '.uh-insight[data-k="cache"] .uh-insDot{background:#7b5cff}',
  '.uh-insight[data-k="week"] .uh-insDot{background:#1677ff}',
  '.uh-insight[data-k="scope"] .uh-insDot{background:#94a3b8}',
  '.uh-insight[data-k="rhythm"] .uh-insDot{background:#ec4899}',
  '.uh-insight[data-k="subagent"] .uh-insDot{background:#0ea5e9}',
  '.uh-insight[data-k="deleted"] .uh-insDot{background:#f43f5e}',
  '.uh-insight em{font-style:normal;color:var(--dsw-alias-label-secondary,#646a73);font-size:12px}',

  /* 按钮 / 提示 / 空态 */
  '.uh-btn{font-size:12px;line-height:18px;padding:4px 12px;border:1px solid var(--dsw-alias-border-l2,#dfe1e5);border-radius:8px;background:var(--dsw-alias-bg-layer-3,#fff);cursor:pointer;color:var(--dsw-alias-label-primary,#1f2329);white-space:nowrap;transition:border-color .15s ease,background .15s ease,color .15s ease}',
  '.uh-btn:hover:not(:disabled){border-color:color-mix(in srgb,#1677ff 40%,var(--dsw-alias-border-l2,#dfe1e5));color:#1677ff;background:color-mix(in srgb,#1677ff 6%,var(--dsw-alias-bg-layer-3,#fff))}',
  '.uh-btn[data-kind="primary"]{background:#1677ff;color:#fff;border-color:#1677ff}',
  '.uh-btn[data-kind="primary"]:hover:not(:disabled){background:#0f5fce;border-color:#0f5fce;color:#fff}',
  '.uh-btn:disabled{opacity:.5;cursor:default}',
  '.uh-note{margin-top:2px;padding:9px 11px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2,#eef0f3);background:var(--dsw-alias-bg-layer-2,#f7f8fa);font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#646a73)}',
  '.uh-note[data-tone="warn"]{border-color:color-mix(in srgb,#e37400 35%,var(--dsw-alias-border-l2,#eef0f3));background:rgb(227 116 0 / 8%);color:#b45309}',
  '.uh-empty{padding:26px 8px;text-align:center;font-size:13px;color:var(--dsw-alias-label-tertiary,#8f959e)}',
].join('\n')

function ensureCss(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById('uh-usage-heatmap-style')) return
  var tag = document.createElement('style')
  tag.id = 'uh-usage-heatmap-style'
  tag.textContent = CSS
  document.head.appendChild(tag)
}

// ---------------------------------------------------------------------------
// 数据获取（SWR：10s 内命中缓存；进页后自动 fresh=1 刷新 + 手动刷新按钮绕过 host 缓存）
// ---------------------------------------------------------------------------

var _cache: any = { at: 0, raw: null, data: null, promise: null }
var SWR_TTL_MS = 10000 // 客户端 SWR：10s 内命中本地缓存
/* 后台轮询间隔。★ 必须 ≤ 宿主 STATE_TTL_MS(20000, 见 src/index.ts:37)：
   轮询间隔大于宿主 TTL 时，每次轮询都必然落进宿主的"旧缓存 + 后台增量刷新"分支
   → 每次轮询都白白触发一轮后台扫描（全命中约 26ms）。取 15s 既在 TTL 内，
   又比原来 60s 更及时，且不会比 TTL 更频繁地打宿主。 */
var POLL_MS = 15000

function fetchState(force?: boolean): Promise<any> {
  var now = Date.now()
  if (!force && _cache.data && now - _cache.at < SWR_TTL_MS) return Promise.resolve(_cache.data)
  if (_cache.promise) return _cache.promise
  var url = API + '/state' + (force ? '?fresh=1' : '')
  _cache.promise = fetch(url, { cache: 'no-store' })
    .then(function (r) {
      // 必须校验 r.ok：宿主 500 也返回 JSON，直接 r.json() 会把 {error} 当状态渲染成静默空面板
      return r.json().then(
        function (s: any) {
          if (!r.ok) throw new Error((s && s.error) || 'HTTP ' + r.status)
          return s
        },
        function () {
          throw new Error('HTTP ' + r.status)
        },
      )
    })
    .then(function (s: any) {
      _cache.promise = null
      // 内容没变 → 复用旧对象引用，setData 时 React bail out，避免每分钟整棵重渲染造成滑动顿挫
      var raw = JSON.stringify(s)
      if (raw === _cache.raw) return _cache.data || s
      _cache.raw = raw
      _cache.data = s
      _cache.at = Date.now()
      return s
    })
    .catch(function (e: any) {
      _cache.promise = null
      throw e
    })
  return _cache.promise
}

function usePanelData(): any {
  var useState = React.useState
  var useEffect = React.useEffect

  var _d = useState(_cache.data)
  var data = _d[0]
  var setData = _d[1]
  var _l = useState(!_cache.data)
  var loading = _l[0]
  var setLoading = _l[1]
  var _e = useState('')
  var err = _e[0]
  var setErr = _e[1]

  function load(force?: boolean): Promise<void> {
    if (!data) setLoading(true)
    setErr('')
    return fetchState(force)
      .then(function (s: any) {
        setData(function (prev: any) { return s === prev ? prev : s })
        setLoading(false)
      })
      .catch(function (e: any) {
        setErr(String((e && e.message) || e))
        setLoading(false)
      })
  }

  useEffect(function () {
    ensureCss()
    // 进设置页即自动刷新：先用快照/缓存把旧数据秒开渲染出来，随后立刻补一次
    // fresh=1 增量扫描（宿主等扫完才回包），回包后静默覆盖旧数据——无需手动点刷新。
    // load() 内部已 catch（永远 resolve）→ 链上无 rejection，无需外层 catch
    load(false).then(function () { return load(true) })
    var timer = setInterval(function () { load(false) }, POLL_MS)
    return function () { clearInterval(timer) }
  }, [])

  return { data: data, loading: loading, err: err, load: load }
}

// ---------------------------------------------------------------------------
// 格式化与日期工具
// ---------------------------------------------------------------------------

function fmtTokens(n: number): string {
  if (!isFinite(n) || n <= 0) return '0'
  if (n >= 1e8) return (n / 1e8).toFixed(2).replace(/\.?0+$/, '') + '亿'
  if (n >= 1e4) return (n / 1e4).toFixed(1).replace(/\.0$/, '') + '万'
  return String(Math.round(n))
}

function fmtExact(n: number): string {
  return Math.round(n).toLocaleString('en-US')
}

function fmtDur(ms: number): string {
  if (ms <= 0) return '—'
  var min = Math.floor(ms / 60000)
  if (min >= 1440) return Math.floor(min / 1440) + '天' + Math.floor((min % 1440) / 60) + '小时'
  if (min >= 60) return Math.floor(min / 60) + '小时' + (min % 60) + '分'
  return min + '分'
}

function fmtAgo(ts: number): string {
  if (!ts || ts <= 0) return '—'
  var diff = Date.now() - ts
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return Math.round(diff / 60000) + ' 分钟前'
  if (diff < 86400000) return Math.round(diff / 3600000) + ' 小时前'
  return fmtMD(new Date(ts).getFullYear() + '-' + pad2(new Date(ts).getMonth() + 1) + '-' + pad2(new Date(ts).getDate()))
}

function pad2(n: number): string {
  return n < 10 ? '0' + n : String(n)
}

var WD = ['一', '二', '三', '四', '五', '六', '日']

function parseKey(key: string): Date {
  var p = key.split('-')
  return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]))
}

function keyOf(d: Date): string {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
}

/** 'M月D日' */
function fmtMD(key: string): string {
  var d = parseKey(key)
  return d.getMonth() + 1 + '月' + d.getDate() + '日'
}

/** 'M月D日（周X）' */
function fmtMDWd(key: string): string {
  var d = parseKey(key)
  return fmtMD(key) + '（周' + WD[(d.getDay() + 6) % 7] + '）'
}

function addDays(key: string, delta: number): string {
  var d = parseKey(key)
  d.setDate(d.getDate() + delta)
  return keyOf(d)
}

/** 该日所在周的周一 */
function mondayOf(key: string): string {
  var d = parseKey(key)
  var shift = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - shift)
  return keyOf(d)
}

function todayKey(): string {
  return keyOf(new Date())
}

function daysBetween(a: string, b: string): number {
  return Math.round((parseKey(b).getTime() - parseKey(a).getTime()) / 86400000)
}

function pct(part: number, whole: number): string {
  if (whole <= 0) return '0%'
  return Math.round((part / whole) * 100) + '%'
}

// ---------------------------------------------------------------------------
// 指标卡片
// ---------------------------------------------------------------------------

function MetricCard(props: any): any {
  return h(
    'div',
    { className: 'uh-card', key: props.label },
    h(
      'div',
      { className: 'uh-metricLabel' },
      h('span', { className: 'uh-metricIcon' }, props.icon || '●'),
      props.label,
    ),
    h('div', { className: 'uh-metricValue', title: props.title || '' }, props.value),
    props.sub ? h('div', { className: 'uh-metricSub', title: props.subTitle || '' }, props.sub) : null,
  )
}

// ---------------------------------------------------------------------------
// 热力图（日 / 周 / 累计）
// ---------------------------------------------------------------------------

interface RangeInfo {
  columns: string[] // 每列的周一键
}

/** 容器实测宽度 → 列数的常量与换算（列宽 = cellMin 格 + 3px gap；行标槽另占 GUTTER 宽） */
var COLS_MAX = 54
var GUTTER = 16 // 行标槽宽，与 .uh-cal 的 --uh-gutter 同源
var COL_SAFETY = 4 // 亚像素取整余量：防止 minmax 下限把末列挤出容器造成 1px 横向滚动

/* 列数换算：**由可用宽度解出**，且**永不猜测**。
   网格总占用 = gutter + n × stride（1 条行标槽 + n 条格轨道，n 个 3px 间隙；stride = 格宽 + gap）。
   解 n ≤ (availW − gutter − COL_SAFETY) / stride 即"刚好塞满且不溢出"。
   gutter 由调用方传入（极窄退化态会传 0，见 HeatmapCard 的 showLabels）—— 不在函数里重复扣减，
   否则会把行标槽扣两次、列数偏小。
   ★ 禁止再引入 COLS_DEFAULT=37 这类"常规值回退"：面板极窄时（视口 320px → .uh-page 被压到
     cardW=30px、wrapW=0）回退到 37 列会让 37 个 minmax 下限硬撑出 520px 横向溢出（周视图 520px）。
   ★ 下界必须是 1，不能是"最小 10 列"：10 列 × (11+3) + 16 = 156px，在 wrapW < 156 时
     仍会硬撑出溢出（实测 wrapW=0/30 时 156px）。改为"能塞几列就几列"，退化到 1 列即 14px，
     是所有宽度下都不溢出。实测 wrapW=0 时溢出 520px → 16px（余下 16px 是 .uh-card 内边距+边框）。
   ★ 正常宽度不受影响：wrapW ≥ 160 时解出的列数本就 ≥ 10，宽度足够时列数照常铺满。
   ★ 单调性：availW 越小 → 列数越少，不存在"窄容器反而列更多"的跳变。 */
function calcCols(availW: number, cellMin: number, gutter: number): number {
  var stride = cellMin + 3
  var n = Math.floor((availW - gutter - COL_SAFETY) / stride)
  if (!(n >= 1)) n = 1 // 未测量 / 被压成 0 / 极窄 → 1 列，绝不猜测常规值
  return Math.min(COLS_MAX, n)
}

/** 展示区间：从本周起向右回溯，取最近 maxCols 周（列数由容器宽度决定 → 格子保持 ≥11px 正方形铺满） */
function buildRange(maxCols: number): RangeInfo {
  var cur = mondayOf(todayKey())
  var columns: string[] = []
  var n = 0
  while (n++ < maxCols && n <= 400) {
    columns.push(cur)
    cur = addDays(cur, -7)
  }
  return { columns: columns }
}

/** 分位分档（GitHub 算法）：values 升序 → v 的档位 1..4 */
function makeLevelFn(values: number[]): (v: number) => number {
  var sorted = values.filter(function (v) { return v > 0 }).sort(function (a, b) { return a - b })
  if (!sorted.length) return function () { return 0 }
  return function (v: number): number {
    if (v <= 0) return 0
    /* 二分求 upper_bound：le = 「sorted 中 ≤ v 的个数」。
       原先用 for 线性扫描，且本函数**每格调用一次**（COLS_MAX 54 × 7 行 = 378 格）
       → 单次渲染约 8000 次比较，是渲染期主线程的纯算法冗余。
       二分后 O(log n)，且与线性版**语义完全等价**（都是 upper_bound 计数，
       含重复值时的计数也一致，仅边界取法不同）。 */
    var lo = 0
    var hi = sorted.length
    while (lo < hi) {
      var mid = (lo + hi) >> 1
      if (sorted[mid] <= v) lo = mid + 1
      else hi = mid
    }
    var le = lo
    return Math.min(4, Math.ceil((le / sorted.length) * 4))
  }
}

/** 累计前缀：sortedKeys + prefix，cumAt(key) = 截至该日（含）的总量 */
function makeCumulative(days: Record<string, number>): (key: string) => number {
  var keys = Object.keys(days).sort()
  var prefix: number[] = []
  var run = 0
  for (var i = 0; i < keys.length; i++) {
    run += days[keys[i]]
    prefix.push(run)
  }
  return function (key: string): number {
    // 二分：最后一个 ≤ key 的下标
    var lo = 0
    var hi = keys.length - 1
    var ans = -1
    while (lo <= hi) {
      var mid = (lo + hi) >> 1
      if (keys[mid] <= key) { ans = mid; lo = mid + 1 } else hi = mid - 1
    }
    return ans < 0 ? 0 : prefix[ans]
  }
}

function weekValue(days: Record<string, number>, monday: string): number {
  var sum = 0
  for (var i = 0; i < 7; i++) sum += days[addDays(monday, i)] || 0
  return sum
}

function weekActiveDays(days: Record<string, number>, monday: string): number {
  var n = 0
  for (var i = 0; i < 7; i++) if ((days[addDays(monday, i)] || 0) > 0) n++
  return n
}

function monthLabels(columns: string[]): string[] {
  var out: string[] = []
  var prev = -1
  for (var i = 0; i < columns.length; i++) {
    var m = parseKey(columns[i]).getMonth()
    out.push(i === 0 || m !== prev ? m + 1 + '月' : '')
    prev = m
  }
  return out
}

function HeatmapCard(props: any): any {
  var days: Record<string, number> = props.days || {}
  var m = props.metrics || {}

  var _mode = React.useState('day')
  var mode = _mode[0]
  var setMode = _mode[1]

  // tooltip：脱离 React 渲染，直接操作 DOM——悬停/移动零重渲染（300+ 格子不再跟着鼠标move重画）
  var tipElRef = React.useRef(null)
  React.useEffect(function () {
    return function () {
      var el: any = tipElRef.current
      if (el && el.parentNode) el.parentNode.removeChild(el)
      tipElRef.current = null
    }
  }, [])
  function ensureTip(): any {
    var el: any = tipElRef.current
    if (!el || !el.parentNode) {
      el = document.createElement('div')
      el.className = 'uh-tip'
      el.style.display = 'none'
      document.body.appendChild(el)
      tipElRef.current = el
    }
    return el
  }
  function escapeHtml(s: string): string {
    var map: any = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }
    return String(s).replace(/[&<>"]/g, function (c: string) { return map[c] || c })
  }
  var tipRaf = 0
  var tipEv: any = null
  function placeTip(): void {
    tipRaf = 0
    var el: any = tipElRef.current
    if (el && tipEv) {
      el.style.left = tipEv.clientX + 'px'
      el.style.top = tipEv.clientY + 'px'
    }
  }
  function showTip(ev: any, lines: string[]): void {
    var el = ensureTip()
    el.innerHTML =
      '<div><b>' + escapeHtml(String(lines[0] ?? '')) + '</b></div>' +
      (lines[1] != null ? '<div>' + escapeHtml(String(lines[1])) + '</div>' : '') +
      (lines[2] != null ? '<em>' + escapeHtml(String(lines[2])) + '</em>' : '')
    el.style.display = 'block'
    tipEv = ev
    if (!tipRaf) tipRaf = requestAnimationFrame(placeTip)
  }
  function moveTip(ev: any): void {
    if (!tipElRef.current) return
    tipEv = ev
    if (!tipRaf) tipRaf = requestAnimationFrame(placeTip)
  }
  function hideTip(): void {
    var el: any = tipElRef.current
    if (el) el.style.display = 'none'
  }

  var hasData = !!(m.firstDay && Object.keys(days).length)

  // 容器实测宽度 → 列数（calcCols：每格 ≥11px 的小正方形，铺满且不滚动）
  var wrapRef = React.useRef(null)
  var _wrapW = React.useState(0)
  var wrapW = _wrapW[0]
  var setWrapW = _wrapW[1]
  React.useLayoutEffect(function () {
    var el: any = wrapRef.current
    if (!el) return
    var measure = function (): void { setWrapW(el.clientWidth) }
    measure()
    var ro: any = null
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(measure)
      ro.observe(el)
    }
    return function () { if (ro) ro.disconnect() }
  }, [hasData, mode])
  var isWeek = mode === 'week'
  var isCum = mode === 'cum'
  var cellMin = isWeek ? 13 : 11
  /* 行标槽宽：与 .uh-cal 的 --uh-gutter 同源。三模式恒为 GUTTER（week 用 .uh-weekPad 占位），
     这样切换 日/周/累计 时格子左缘不动 —— 若 week 取 0，整块日历会横跳 19px（实测 3.00 vs 19.00）。
     ★ 唯一的例外是"连行标槽都放不下"的极窄退化态（面板被压到 30px 级、wrapW < 30px）：
       此时保留 16px 行标槽 + 11px 最小格 = 30px 最小占地，必然溢出。
       放不下就把行标槽连同行标一起去掉（showLabels=false），只留格子。
       这与 calcCols 的"能塞几列就几列"同一套退化哲学：宁可少显示，也不撑破容器。 */
  var showLabels = wrapW >= GUTTER + cellMin + 3
  var gutter = showLabels ? GUTTER : 0
  /* 格宽下限同样退化：minmax 的下限是硬下限，容器比它还窄时 minmax 会撑破容器（CSS 规范行为，
     min 优先于 1fr 的收缩）。因此把下限压到"当前容器能容纳的最大格宽"，
     保证 1 列永远塞得进 → 极窄态溢出进一步收敛（实测 520 → 16px，余下 16px 是
     .uh-card 的 14px×2 内边距 + 2px 边框，属卡片自身占地，与网格无关）。
     正常宽度下 avail 充足，cellMin 保持 11/13px 原值，正方形与视觉尺寸完全不变。 */
  var avail = Math.max(0, wrapW - gutter - COL_SAFETY)
  var effCellMin = Math.max(1, Math.min(cellMin, avail - 3))
  var cols = calcCols(wrapW, effCellMin, gutter)
  /* 月份轴同样退化：需要"1 格 + 3px + 一个标签的最小墨迹宽"才值得显示。
     标签宽取最宽的"12月"量级（约 22px），不够就整行不渲染（见 monthsRow 注释）。 */
  var showMonths = wrapW >= gutter + effCellMin + 3 + 22
  var range = React.useMemo(function () { return buildRange(cols) }, [cols])
  var cumAt = React.useMemo(function () { return makeCumulative(days) }, [JSON.stringify(days)])
  var months = monthLabels(range.columns)
  // 末位非空月份标签：锚到容器右缘，避免文字墨迹顶出 .uh-calWrap 造成假横向滚动（见 CSS 注释）
  var lastMon = months.length - 1
  while (lastMon > 0 && months[lastMon] === '') lastMon--
  /* 月份轴：三模式共用同一段结构，保证行高/列轨道/左缘完全一致。
     极窄退化态（showMonths=false，面板窄到放不下一列 + 一个"12月"标签）整行不渲染：
     月份标签是 nowrap 文字，其 min-content 宽度会作为 grid item 撑开所在轨道 →
     在 30px 级面板里硬撑出 19px 溢出。此时显示月份轴也没有信息量，直接省掉。 */
  var monthsRow = showMonths
    ? h(
        'div',
        { className: 'uh-months' },
        // 首列占位：月份轴与格子共用 --uh-tracks，缺了这个槽位标签就会整体左移一轨
        h('span', { className: 'uh-monthPad', key: '__pad' }),
        months.map(function (mm: string, i: number) {
          return h('span', { key: i, className: i === lastMon ? 'uh-monthEnd' : undefined }, mm)
        }),
      )
    : null
  var total = m.totalTokens || 0
  // 列/行轨道的唯一来源：内联在 .uh-cal 上，--uh-tracks 同元素声明后由两个子 grid 继承
  var calStyle = { '--uh-cols': range.columns.length, '--uh-gutter': gutter + 'px', '--uh-cell-min': effCellMin + 'px' } as any

  // 当前模式的取值集合 → 分位档
  var levelFn = React.useMemo(
    function () {
      if (isWeek) {
        return makeLevelFn(range.columns.map(function (mon: string) { return weekValue(days, mon) }))
      }
      if (isCum) {
        var top = cumAt(todayKey())
        return function (v: number): number {
          if (v <= 0 || top <= 0) return 0
          return Math.min(4, Math.ceil((v / top) * 4))
        }
      }
      return makeLevelFn(Object.keys(days).map(function (k) { return days[k] }))
    },
    [mode, JSON.stringify(days), JSON.stringify(range.columns)],
  )

  var modes = [
    { id: 'day', label: '每日' },
    { id: 'week', label: '每周' },
    { id: 'cum', label: '累计' },
  ]

  var seg = h(
    'div',
    { className: 'uh-seg', role: 'group', 'aria-label': '热力图粒度' },
    modes.map(function (it: any) {
      return h(
        'button',
        {
          key: it.id,
          type: 'button',
          className: 'uh-segBtn',
          'aria-pressed': String(mode === it.id),
          onClick: function () { setMode(it.id) },
        },
        it.label,
      )
    }),
  )

  var legend = h(
    'div',
    { className: 'uh-legend' },
    h('span', null, '少'),
    [0, 1, 2, 3, 4].map(function (l: number) {
      return h('span', { key: l, className: 'uh-legendSw', 'data-l': String(l), style: { background: 'var(--uh-l' + l + ')' } })
    }),
    h('span', null, '多'),
  )

  var body: any
  if (!hasData) {
    body = h('div', { className: 'uh-empty' }, '暂无用量数据——使用 DSH 后热力图会按天聚合本地会话日志')
  } else if (isWeek) {
    // 周视图：一格一周（单行；最左=本周，向右越来越早）
    var weekCells = range.columns.map(function (mon: string, i: number) {
      var v = weekValue(days, mon)
      var end = addDays(mon, 6)
      var act = weekActiveDays(days, mon)
      var future = mon > todayKey()
      return h('div', {
        key: mon,
        className: 'uh-cell',
        'data-l': String(future ? 0 : levelFn(v)),
        'data-future': future ? '1' : '0',
        onMouseEnter: function (ev: any) {
          showTip(ev, [
            fmtMD(mon) + ' – ' + fmtMD(end),
            fmtTokens(v) + ' tokens',
            '活跃 ' + act + ' 天 · 占累计 ' + pct(v, total),
          ])
        },
        onMouseMove: moveTip,
        onMouseLeave: function () { hideTip() },
      })
    })
    body = h(
      'div',
      { className: 'uh-calWrap', ref: wrapRef },
      h(
        'div',
        { className: 'uh-cal', style: calStyle },
        h(
          'div',
          { className: 'uh-main' },
          monthsRow,
          h(
            'div',
            { className: 'uh-weekCells' },
            // 周视图无行标，但保留同一首列轨道 → 三种模式左缘一致，切换时不横跳
            h('span', { className: 'uh-weekPad', key: '__pad' }),
            weekCells,
          ),
        ),
      ),
    )
  } else {
  // 日视图 / 累计视图：GitHub 日历（7 行 = 周一..周日，列为周；列序倒序：最左=本周）
    var today = todayKey()
    var dayCells: any[] = []
    for (var c = 0; c < range.columns.length; c++) {
      for (var r = 0; r < 7; r++) {
        var key = addDays(range.columns[c], r)
        var future = key > today
        var dayV = days[key] || 0
        var v = future ? 0 : isCum ? cumAt(key) : dayV
        ;(function (key: string, dayV: number, v: number, future: boolean) {
          dayCells.push(
            h('div', {
              key: key,
              className: 'uh-cell',
              'data-l': String(future ? 0 : levelFn(v)),
              'data-future': future ? '1' : '0',
              onMouseEnter: function (ev: any) {
                if (future) return
                var lines = isCum
                  ? [fmtMDWd(key), '累计 ' + fmtTokens(v) + ' tokens', '当日 +' + fmtTokens(dayV)]
                  : [
                      fmtMDWd(key),
                      fmtTokens(dayV) + ' tokens',
                      '占累计 ' + pct(dayV, total) + ' · ' + relDay(key),
                    ]
                showTip(ev, lines)
              },
              onMouseMove: moveTip,
              onMouseLeave: function () { hideTip() },
            }),
          )
        })(key, dayV, v, future)
      }
    }
    body = h(
      'div',
      { className: 'uh-calWrap', ref: wrapRef },
      h(
        'div',
        { className: 'uh-cal', style: calStyle },
        h(
          'div',
          { className: 'uh-main' },
          monthsRow,
          h(
            'div',
            { className: 'uh-cells' },
            // 行标与格子同 grid 同轨道：显式钉在第 1 列第 i+1 行 → 垂直中心由定义相等
            // 极窄退化态（连行标槽都放不下）整组不渲染，避免无谓地撑高行
            showLabels
              ? WD.map(function (w: string, i: number) {
                  return h('span', {
                    key: 'wd' + i,
                    className: 'uh-wdLabel',
                    style: { gridColumn: '1', gridRow: String(i + 1) },
                  }, i % 2 === 0 ? w : '')
                })
              : null,
            dayCells,
          ),
        ),
      ),
    )
  }

  return h(
    'div',
    { className: 'uh-card uh-section' },
    h(
      'div',
      { className: 'uh-sectionHead' },
      h(
        'div',
        null,
        h('h4', { className: 'uh-sectionTitle' }, 'Token 活跃热力图'),
        h('p', { className: 'uh-sectionDesc' }, isWeek ? '每格 = 一个自然周的累计用量' : isCum ? '每格 = 截至该日的历史累计用量' : '每格 = 当日用量（周一为一周之始）'),
      ),
      h('div', { className: 'uh-tools' }, legend, seg),
    ),
    body,
  )
}

/** 相对日期：今天/昨天/N天前 */
function relDay(key: string): string {
  var diff = daysBetween(key, todayKey())
  if (diff === 0) return '今天'
  if (diff === 1) return '昨天'
  if (diff > 1 && diff < 3650) return diff + '天前'
  return ''
}

// ---------------------------------------------------------------------------
// 洞察列表
// ---------------------------------------------------------------------------

function buildInsights(days: Record<string, number>, m: any): any[] {
  var out: any[] = []
  if (!m) return out

  // 本周 vs 上周
  if (m.weekTokens > 0 || m.prevWeekTokens > 0) {
    var text: string
    if (m.prevWeekTokens > 0) {
      var delta = Math.round(((m.weekTokens - m.prevWeekTokens) / m.prevWeekTokens) * 100)
      text = '本周已用 ' + fmtTokens(m.weekTokens) + '，上周 ' + fmtTokens(m.prevWeekTokens)
        + '（' + (delta >= 0 ? '+' : '') + delta + '%）'
    } else {
      text = '本周已用 ' + fmtTokens(m.weekTokens) + '（上周无记录）'
    }
    out.push({ k: 'week', text: text })
  }

  // 峰值日
  if (m.peakDay) {
    out.push({
      k: 'peak',
      text: '峰值日 ' + fmtMD(m.peakDay.day) + ' · ' + fmtTokens(m.peakDay.tokens)
        + ' tokens，占累计 ' + pct(m.peakDay.tokens, m.totalTokens),
    })
  }

  // 连续活跃
  out.push({
    k: 'streak',
    text: '连续活跃 ' + m.currentStreak + ' 天，历史最长 ' + m.longestStreak + ' 天',
  })

  // 覆盖面
  var totalSessions = m.sessions + (m.deletedSessions || 0)
  var scope = '累计 ' + totalSessions + ' 个会话（主 ' + (m.mainSessions || 0) + ' · 子代理 ' + (m.subagentSessions || 0)
    + (m.deletedSessions ? ' · 已删 ' + m.deletedSessions : '') + '）· ' + m.turns + ' 轮对话 · ' + m.steps + ' 个步骤'
  if (m.longestSession && m.longestSession.ms > 0) {
    var who = m.longestSession.title || shortCwd(m.longestSession.cwd) || ''
    scope += who ? '；最长会话 ' + fmtDur(m.longestSession.ms) + '（' + who + '）' : '；最长会话 ' + fmtDur(m.longestSession.ms)
  }
  out.push({ k: 'scope', text: scope })

  // 子代理用量
  if (m.subagentSessions > 0) {
    out.push({
      k: 'subagent',
      text: '子代理会话 ' + m.subagentSessions + ' 个，消耗 ' + fmtTokens(m.subagentTokens)
        + ' tokens（占累计 ' + pct(m.subagentTokens, m.totalTokens) + '）',
    })
  }

  // 已删除会话归档
  if (m.deletedSessions > 0) {
    out.push({
      k: 'deleted',
      text: '已删除会话 ' + m.deletedSessions + ' 个已归档，保留 ' + fmtTokens(m.deletedTokens) + ' tokens 不丢失',
    })
  }

  // 缓存命中结构
  if (m.cacheReadTokens > 0) {
    out.push({
      k: 'cache',
      text: '缓存读取 ' + fmtTokens(m.cacheReadTokens) + ' tokens，占累计 ' + pct(m.cacheReadTokens, m.totalTokens)
        + '；未缓存输入 ' + fmtTokens(m.uncachedInputTokens) + ' · 输出 ' + fmtTokens(m.outputTokens),
    })
  }

  // 节律：最活跃星期
  var wk = [0, 0, 0, 0, 0, 0, 0]
  var dayKeys = Object.keys(days)
  for (var i = 0; i < dayKeys.length; i++) {
    var d = parseKey(dayKeys[i])
    wk[(d.getDay() + 6) % 7] += days[dayKeys[i]]
  }
  var best = 0
  var sum = 0
  for (var j = 0; j < 7; j++) {
    sum += wk[j]
    if (wk[j] > wk[best]) best = j
  }
  if (sum > 0 && wk[best] > 0) {
    out.push({
      k: 'rhythm',
      text: '最活跃的是周' + WD[best] + '：贡献 ' + fmtTokens(wk[best]) + ' tokens（' + pct(wk[best], sum) + '）',
    })
  }

  return out
}

function shortCwd(cwd: string): string {
  if (!cwd) return ''
  var parts = cwd.split(/[\\/]/)
  return parts[parts.length - 1] || cwd
}

// ---------------------------------------------------------------------------
// 根面板
// ---------------------------------------------------------------------------

function Btn(props: any): any {
  return h(
    'button',
    {
      className: 'uh-btn',
      'data-kind': props.kind,
      disabled: props.disabled,
      onClick: props.onClick,
      title: props.title || '',
    },
    props.children,
  )
}

function UsageHeatmapPanel(): any {
  var s = usePanelData()
  var data = s.data
  var m = data ? data.metrics : null
  var days = (data && data.days) || {}
  var src = (data && data.source) || null

  // 滚动条按需显隐（hy-proxy 同款）：滚动中才给 thumb 上色；rAF 节流 + 捕获阶段
  var pageRef = React.useRef(null)
  React.useEffect(function () {
    var el: any = pageRef.current
    if (!el || typeof document === 'undefined') return
    var raf = 0
    var timer: any = 0
    function onScroll(ev: any): void {
      var t = ev.target
      if (t !== el && !(el.contains && el.contains(t))) return
      if (raf) return
      raf = requestAnimationFrame(function () {
        raf = 0
        el.classList.add('uh-scrolling')
        clearTimeout(timer)
        timer = setTimeout(function () {
          try { el.classList.remove('uh-scrolling') } catch (e) { /* ignore */ }
        }, 900)
      })
    }
    document.addEventListener('scroll', onScroll, true)
    return function () {
      document.removeEventListener('scroll', onScroll, true)
      if (raf) cancelAnimationFrame(raf)
      clearTimeout(timer)
    }
  }, [])
  function pageRoot(kids: any[]): any {
    return h('div', { className: 'uh-page', ref: pageRef }, kids)
  }

  var headerSum = '—'
  if (m) {
    headerSum = '今日 ' + fmtTokens(m.todayTokens) + ' · 本周 ' + fmtTokens(m.weekTokens)
      + ' · 本月 ' + fmtTokens(m.monthTokens) + ' · 更新于 ' + fmtAgo(data.updatedAt)
  } else if (s.loading) {
    headerSum = '加载中…'
  }

  var kids: any[] = [
    h(
      'div',
      { className: 'uh-header', key: 'header' },
      h(
        'div',
        { className: 'uh-brand' },
        h('strong', { className: 'uh-brandName' }, SECTION_LABEL),
        h('p', { className: 'uh-brandDesc' }, '本地 DSH 会话日志聚合 · 累计 Token、活跃热力图与活动洞察'),
      ),
      h(
        'div',
        { className: 'uh-headerRight' },
        h('span', { className: 'uh-sum' }, headerSum),
        h(Btn, { kind: 'primary', disabled: s.loading, onClick: function () { s.load(true) } }, s.loading ? '刷新中…' : '刷新'),
      ),
    ),
  ]

  if (s.err) {
    kids.push(h('div', { className: 'uh-note', 'data-tone': 'warn', key: 'err' }, '加载失败：' + s.err))
  }

  if (s.loading && !data) {
    kids.push(h('div', { className: 'uh-empty', key: 'loading' }, '加载中…（首次需全量扫描会话日志）'))
    return pageRoot(kids)
  }

  if (m) {
    var peakSub = m.peakDay ? fmtMD(m.peakDay.day) + ' · 占累计 ' + pct(m.peakDay.tokens, m.totalTokens) : '暂无'
    var longestSub = m.longestSession && m.longestSession.ms > 0
      ? (m.longestSession.title || shortCwd(m.longestSession.cwd) || '会话') + ' · 共 ' + m.sessions + ' 个会话'
      : '共 ' + m.sessions + ' 个会话'
    kids.push(
      h(
        'div',
        { className: 'uh-cards', key: 'cards' },
        h(MetricCard, {
          label: '累计 Token', icon: 'Σ',
          value: fmtTokens(m.totalTokens),
          title: fmtExact(m.totalTokens) + ' tokens',
          sub: h('span', null, '输入 ', h('b', null, fmtTokens(m.uncachedInputTokens)), ' · 输出 ', h('b', null, fmtTokens(m.outputTokens)), ' · 缓存读 ', h('b', null, fmtTokens(m.cacheReadTokens))),
          subTitle: '未缓存输入 / 输出 / 缓存读取',
        }),
        h(MetricCard, {
          label: '今日用量', icon: '☀',
          value: fmtTokens(m.todayTokens),
          title: fmtExact(m.todayTokens) + ' tokens',
          sub: '本周 ' + fmtTokens(m.weekTokens) + ' · 本月 ' + fmtTokens(m.monthTokens),
          subTitle: '今日自 0 点起 · ' + fmtExact(m.todayTokens) + ' tokens；本周 / 本月为滚动窗口与自然月口径',
        }),
        h(MetricCard, {
          label: '昨日用量', icon: '☾',
          value: fmtTokens(m.yesterdayTokens),
          title: fmtExact(m.yesterdayTokens) + ' tokens',
          sub: '占累计 ' + pct(m.yesterdayTokens, m.totalTokens) + ' · 日均 ' + fmtTokens(m.avgPerActiveDay),
          subTitle: '昨日全天 · ' + fmtExact(m.yesterdayTokens) + ' tokens；日均 = 累计 ÷ 活跃天数',
        }),
        h(MetricCard, {
          label: '峰值日', icon: '▲',
          value: m.peakDay ? fmtTokens(m.peakDay.tokens) : '—',
          title: m.peakDay ? fmtExact(m.peakDay.tokens) + ' tokens' : '',
          sub: peakSub,
        }),
        h(MetricCard, {
          label: '最长会话', icon: '⧗',
          value: m.longestSession && m.longestSession.ms > 0 ? fmtDur(m.longestSession.ms) : '—',
          sub: longestSub,
        }),
        h(MetricCard, {
          label: '连续活跃', icon: '◆',
          value: m.currentStreak + ' 天',
          sub: '历史最长 ' + m.longestStreak + ' 天',
        }),
        h(MetricCard, {
          label: '活跃天数', icon: '▦',
          value: m.activeDays + ' 天',
          sub: m.firstDay
            ? '日均 ' + fmtTokens(m.avgPerActiveDay) + ' · 自 ' + fmtMD(m.firstDay)
            : '暂无数据',
        }),
        h(MetricCard, {
          label: '会话', icon: '▤',
          value: String(m.sessions + (m.deletedSessions || 0)),
          sub: '主 ' + (m.mainSessions || 0) + ' · 子代理 ' + (m.subagentSessions || 0)
            + (m.deletedSessions ? ' · 已删归档 ' + m.deletedSessions : '')
            + (src && src.orphans ? ' · 孤儿投影 ' + src.orphans : ''),
          subTitle: '统计口径：主会话与子代理 = 活跃日志 + 已删归档 + 孤儿投影的分类合计；'
            + '已删归档 = 日志已删除但历史 token 仍保留；孤儿投影 = 日志没了只剩投影缓存。全部计入累计与热力图。',
        }),
        h(MetricCard, {
          label: '子代理 Token', icon: '⬡',
          value: fmtTokens(m.subagentTokens || 0),
          title: fmtExact(m.subagentTokens || 0) + ' tokens',
          sub: (m.subagentSessions || 0) + ' 个子代理会话 · 占累计 ' + pct(m.subagentTokens || 0, m.totalTokens),
        }),
      ),
    )

    kids.push(h(HeatmapCard, { key: 'heat', days: days, metrics: m }))

    var insights = buildInsights(days, m)
    if (insights.length) {
      kids.push(
        h(
          'div',
          { className: 'uh-card uh-section', key: 'insights' },
          h(
            'div',
            { className: 'uh-sectionHead' },
            h(
              'div',
              null,
              h('h4', { className: 'uh-sectionTitle' }, '活动洞察'),
              h('p', { className: 'uh-sectionDesc' }, '基于本地聚合数据自动生成'),
            ),
          ),
          h(
            'div',
            { className: 'uh-insights' },
            insights.map(function (it: any) {
              return h(
                'div',
                { className: 'uh-insight', 'data-k': it.k, key: it.k },
                h('span', { className: 'uh-insDot' }),
                it.text,
              )
            }),
          ),
        ),
      )
    }

    if (src) {
      kids.push(
        h(
          'div',
          { className: 'uh-note', key: 'src' },
          '数据源：' + src.logs + ' 个会话日志（重扫 ' + src.decoded + ' · 命中缓存 ' + src.cacheHits
            + '） + ' + src.orphans + ' 个投影缓存'
            + (src.archived ? ' + ' + src.archived + ' 个已删归档' : '')
            + ' · 本地聚合 ' + src.scanMs + 'ms'
            + (src.droppedFrames > 0 ? ' · ⚠ 跳过损坏帧 ' + src.droppedFrames : ''),
        ),
      )
    }
  }

  return pageRoot(kids)
}

// ---------------------------------------------------------------------------
// 注册（仅设置面板分区）
// ---------------------------------------------------------------------------

/**
 * 设置页导航图标补丁 —— 「认领自己那一行」。
 *
 * **为什么需要**（2026-09-25 查证）：
 *  ① 宿主 `ui-settings-general` 的 `navIcon(id)` 是按 id **硬编码**的图标映射，
 *     源码注释原文：`unknown ids fall back to the settings gear`；
 *  ② `settings.section` 槽位契约（client-runner 的 `registerOptions`）只有
 *     `id` / `order` / `label`，**没有 icon 字段** ⇒ 第三方分区一律戴齿轮；
 *  ③ 借用已发布的 id（account / models / agent-presets / plugins / archived-sessions）
 *     会按契约「reusing a shipped id puts you in THAT cell and replaces it」**顶替官方分区**，不可行。
 *
 * ⇒ 做法与生态既有插件一致（dshmarket 的 settings-nav-icon、dsh-better-sidebar、
 *   dsh-skill-mcp-panel 都这么解决；dshmarket 源码注释亦点名了后两者）：
 *   按**本插件自己的 label 文本**认领那一行 → 打标记 → 用独立样式表把外壳的齿轮换成自己的图标。
 *   React 不会移除它不认识的属性 ⇒ 标记一旦打上即保持；locale 变化时外壳重渲染 label 文本，
 *   observer 会重新认领，标记与文字不会脱节。
 *
 * 边界（刻意收窄）：
 *  - 只标记「可见文本 === 本插件 label」的那一行；不碰任何外壳结构；
 *  - 标记与样式表同属一个 effect ⇒ 随 fiber 一并清除；
 *  - 宿主 DOM 结构若变化，补丁**静默失效**，不影响面板本体。
 * 删除条件：`settings.section` 将来长出 `icon` 字段时，整个模块即可移除。
 *
 * 图标以 CSS `mask-image` 呈现（纯黑，mask 只读 alpha），可见色由
 * `background-color: currentColor` 提供 ⇒ 自动跟随 hover / active / 禁用的主题色。
 * 用 mask 而非替换 DOM，是为了不跟 React 的 children 协调打架（重渲染会还原 svg 子节点）。
 */
var NAV_ICON_MARKER = 'data-uh-nav-icon'

/** 设置页导航行：外壳把每个 settings.section 条目渲染成面板 <nav> 内的一个 <button>。 */
var NAV_ROW_SELECTOR = '[role="dialog"] nav button'

/** 被标记那一行的样式：藏掉外壳回落的齿轮，画出本插件的热力图图标。 */
function navIconCss(): string {
  return [
    '[' + NAV_ICON_MARKER + '] > svg { display: none; }',
    '[' + NAV_ICON_MARKER + ']::before {',
    "  content: '';",
    '  flex: none;',
    '  width: 16px;',
    '  height: 16px;',
    '  background-color: currentColor;',
    '  -webkit-mask-image: ' + NAV_ICON_MASK + ';',
    '  mask-image: ' + NAV_ICON_MASK + ';',
    '  -webkit-mask-repeat: no-repeat;',
    '  mask-repeat: no-repeat;',
    '  -webkit-mask-position: center;',
    '  mask-position: center;',
    '  -webkit-mask-size: 16px 16px;',
    '  mask-size: 16px 16px;',
    '}',
  ].join('\n')
}

/**
 * 安装导航图标补丁，返回清理函数。
 *
 * 样式表**独立注入**（不复用面板的 ensureCss）——面板样式只在面板渲染时才注入，
 * 而设置页导航在打开面板**之前**就要显示图标，时序对不上。
 */
function installSettingsNavIcon(): () => void {
  if (typeof document === 'undefined' || !document.body) return function () {}

  var tag = document.createElement('style')
  tag.id = 'uh-usage-heatmap-nav-icon-style'
  tag.textContent = navIconCss()
  document.head.appendChild(tag)

  var disposed = false
  var scheduled = false

  function sync(): void {
    scheduled = false
    if (disposed) return
    var wanted = String(SECTION_LABEL || '').trim()
    if (!wanted) return // 文本未就绪：什么都不标记，绝不因空串而认领整列
    var rows = document.querySelectorAll(NAV_ROW_SELECTOR)
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i]
      if (String(row.textContent || '').trim() === wanted) row.setAttribute(NAV_ICON_MARKER, '')
      else row.removeAttribute(NAV_ICON_MARKER) // 认领是幂等的：别行的陈旧标记一并清掉
    }
  }

  function schedule(): void {
    if (scheduled || disposed) return
    scheduled = true
    var qm = typeof queueMicrotask === 'function' ? queueMicrotask : function (f: any) { setTimeout(f, 0) }
    qm(sync)
  }

  sync()
  var observer: any = null
  try {
    observer = new MutationObserver(schedule)
    // subtree+characterData：设置页是挂到 body 的门户，且 locale 切换会改写 label 文本
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })
  } catch {
    /* 观察失败：至少已同步过一次 */
  }

  return function () {
    disposed = true
    try { if (observer) observer.disconnect() } catch { /* ignore */ }
    var marked = document.querySelectorAll('[' + NAV_ICON_MARKER + ']')
    for (var i = 0; i < marked.length; i++) {
      try { marked[i].removeAttribute(NAV_ICON_MARKER) } catch { /* ignore */ }
    }
    try { tag.remove() } catch { /* ignore */ }
  }
}

function registerAll(ctx: any): () => void {
  var slots = ctx.slots
  var disposers: any[] = []

  // 设置页分区。守卫细节（写错 ⇒ restore() 跳过恢复 ⇒ 设置项消失）：
  //   1) slot 名必须是字符串字面量（不能用变量）；
  //   2) `{` 必须紧跟 register( 同一行。
  disposers.push(
    slots.inject('settings.section', function () {
      return slots.register({
        name: 'settings.section',
        id: 'usage-heatmap-settings',
        order: 22,
        label: function () {
          return SECTION_LABEL
        },
      }, UsageHeatmapPanel)
    }),
  )

  // 导航图标补丁（齿轮 → 热力图）。放在分区注册之后：必须先有分区才有导航行。
  disposers.push(installSettingsNavIcon())

  return function () {
    for (var i = 0; i < disposers.length; i++) {
      try {
        disposers[i]()
      } catch {
        /* ignore */
      }
    }
  }
}

// ⚠️ 必须是 export const（不能用 var）：注入器骨架校验按文本匹配
// `/export const inject\s*=\s*\[[^\]]*['"]slots['"]/`
export const name = PLUGIN_ID
export const inject = ['slots']

export function apply(ctx: any): void {
  if (ctx.effect) {
    ctx.effect(function () {
      return registerAll(ctx)
    }, PLUGIN_ID + ': usage heatmap settings section')
  } else {
    registerAll(ctx)
  }
}
