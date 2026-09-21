# monitor-theme-luminaplus

LuminaPlus 是为 [monitor](https://github.com/monitor-probe/monitor) 移植的独立公开状态主题，保留原版 LuminaPlus 的高信息密度卡片、响应式布局、资源图表、流量统计、资产统计和背景外观能力。

本项目基于 [Komari-Theme-LuminaPlus](https://github.com/shanyang242/Komari-Theme-LuminaPlus) 移植，并继续遵循 MIT 许可证。

维护仓库与发布地址：[kure29/Monitor-Theme-LuminaPlus](https://github.com/kure29/Monitor-Theme-LuminaPlus)

![Monitor Theme LuminaPlus 预览](docs/images/monitor-theme-preview.png)

## 当前能力

- 大卡片、小卡片、迷你卡片和列表四种节点视图
- monitor `/api/ws` 实时节点快照，断线时自动回退 HTTP
- CPU、内存、Swap、磁盘、负载、网络和连接数实时指标
- CPU、内存、磁盘和网络历史图表
- 多探测点 Ping 延迟与丢包历史图表
- 今日流量、速率历史和峰值统计
- 费用、账单周期、到期时间和资产统计
- 国家地区筛选、亮色/暗色外观、背景图片、桌面视频和环境动效
- 桌面、平板和移动端布局

## 当前限制

- monitor 的主题契约里没有主题设置存储接口，所以主题设置默认保存在当前浏览器的
  `localStorage`，不会自动同步到其他设备或访客；多端一致的办法见
  [主题设置保存在哪里](#主题设置保存在哪里)。
- monitor 目前没有公开分组、标签和公开备注字段，相应筛选项在无数据时自动隐藏。
- monitor 不向匿名主题下发 IP 地址；本主题不依赖额外的 IP 信息插件。
- monitor 历史接口目前不提供 Swap、连接数、进程数和 Load 历史，这些指标仍可显示实时值。
- 首页 Ping 需要在主题设置中绑定 monitor 的探测任务；节点详情页可直接读取已分配探测任务的历史。
- 开启「未绑定探测点显示模拟延迟」后，前端生成的数值会带「模拟」标记；它不代表真实网络质量。

## 主题设置保存在哪里

monitor 只给主题开放同源只读接口（`/api/me`、`/api/nodes`、`/api/nodes/{id}/metrics`、`/api/ws`），
没有主题设置存储接口，所以本主题的设置分成两层：

1. **站点默认值（可选）**：`<themes-dir>/LuminaPlus/theme-settings.json`。它与 `theme.json`
   同一层，由 hub 当普通静态文件下发，是所有访客的默认值。
2. **本浏览器设置**：主题设置页（首页右上角「管理」→ 主题设置）保存到 `localStorage`，
   优先级高于站点默认值，用于在单台设备上临时调整。

设置页第 10 节「配置迁移」就是这份 JSON 的导入/导出入口：在手机上「导出当前配置」→「复制」，
换到电脑打开同一个页面「导入到表单」→「保存设置」，整套配置即搬到新设备。把同一份 JSON
保存成主题目录里的 `theme-settings.json`，则所有访客（含未登录）都会看到这套默认值。

设置内容变化后需要重新放到主题目录：monitor 后台的「上传主题包 / 从 GitHub 更新」是整体替换
主题目录，站点默认文件不会保留；本浏览器设置不受影响。

## 开发

准备一个运行在 `127.0.0.1:9911` 的 monitor hub：

```bash
npm ci
npm run dev
```

Vite 会把 `/api` 和 WebSocket 请求代理到 hub。

提交前运行：

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

## 打包与安装

生成 monitor 可安装的主题包：

```bash
npm run package
```

产物为仓库根目录下的 `theme.tar.gz`，内部结构为：

```text
dist/
theme.json
preview.png
```

在 monitor 后台的「主题」页面上传 `theme.tar.gz`，然后选择 LuminaPlus。

后台卡片上的作者、版本和「源码」链接都来自 `theme.json`；卡片右侧的刷新按钮会读取
`url` 指向仓库的最新 release，从中取 `theme.tar.gz` 更新（版本号与 release tag 相同则跳过）。
发布新版本：改 `theme.json` 与 `package.json` 的 `version`，提交后推送 `vX.Y.Z` tag，
`.github/workflows/release.yml` 会自动打包并创建 release。

也可以手动解压到 hub 的主题目录：

```text
<themes-dir>/LuminaPlus/
├── theme.json
├── theme-settings.json   # 可选：站点默认配置
├── preview.png
└── dist/
    └── index.html
```

## 自定义背景资源

把图片或视频放入 `public/assets/`，重新执行 `npm run package`，然后在主题设置中填写 `/assets/<文件名>`。

桌面视频建议使用短循环、无音轨的 H.264 MP4 或兼容 WebM。触屏设备、窄屏、减少动态效果和省流量模式会自动使用背景图片。

桌面端与移动端背景图互为回退：只填一侧时另一侧使用同一张图，同一个背景在手机和电脑上都会生效；
两端都填则各用各的。

### 背景遮罩（压暗/提亮背景，保护眼睛）

主题设置第 3 节有「浅色模式遮罩」和「深色模式遮罩」两个 0–100 的输入框：它在背景图或桌面视频
之上叠一层主题底色（`--bg-0`），深色模式压暗、浅色模式提亮，默认 0（不加遮罩，与升级前一致）。

- 深色模式背景图偏亮时，40%–70% 比较合适；100% 等于完全盖住背景图。
- 卡片透明度低于 95 时会自动叠加一层可读性遮罩，此时最终浓度取两者中较大的一个，不会叠加成双倍。
- 遮罩写在 `<html>` 的 `--bg-scrim` 上：图片层（`body::after`）和视频层（`.background-video-scrim`）
  共用它，所以视频背景同样会被压暗。首帧遮罩由 `index.html` 的内联脚本从背景缓存里直接恢复，
  不会出现"先亮一下再变暗"。

## 费用与账单周期

续费价格按 monitor 后台的付款周期展示与摊销，识别 `monthly` / `quarterly` / `semiannual` /
`yearly` / `biennial` / `triennial` / `once`，以及对应的中文写法与天数（30 / 90 / 180 / 365 /
730 / 1095）。三年付会显示成 `¥1,095/3年` 并按 36 个月摊销，而不是当成一年。

## 延迟与丢包从哪里来

- 数据来自 monitor 的 Ping 记录：由**节点上的 agent 主动连接探测目标**测出的往返时间，
  不是从"三网"一侧去测节点，所以和其他从探测端测量的监控（比如 Cloudflare Workers 探针）
  数值天然不同。
- 卡片上的延迟是最近一分钟桶的中位数，按探测任务的间隔刷新（`interval` 秒，最低 10 秒）；
  任务目标不通时 monitor 存 `-1`，主题显示"无样本"并把这段时间计入丢包。
- **卡片只显示你在主题设置里绑定的任务**。后台把任务分配给节点只决定"谁去测量"，不会自动
  出现在首页；没有绑定的节点显示"未配置"。设置页第 9 节可以按任务勾选节点，或开启三网模式
  用三项全局任务覆盖全部节点。
- 丢包率取 monitor 给出的**窗口丢包率**（响应里的 `loss`）。逐桶的 `loss` 是桶内百分比、
  分母已经丢了，平均它们会低估丢包，所以主题不再自己平均。
- hub 同时只允许 4 个历史查询（`HISTORY_GATE`），超出的请求会返回 503。主题会把同一节点同
  一窗口的并发请求合并成一次，并在 503 时短暂退避重试，避免多任务/多节点时整块图表显示
  "加载失败"。

## 致谢

- [shanyang242/Komari-Theme-LuminaPlus](https://github.com/shanyang242/Komari-Theme-LuminaPlus)
- [stqfdyr/komari-theme-Lumina](https://github.com/stqfdyr/komari-theme-Lumina)
- [monitor-probe/monitor](https://github.com/monitor-probe/monitor)
- [monitor-probe/monitor-theme-default](https://github.com/monitor-probe/monitor-theme-default)

## 许可证

MIT。分发修改版本时请保留原项目及本项目的版权和许可声明。
