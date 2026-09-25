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

- monitor 目前没有公开标签和公开备注字段，相应展示项在无数据时自动隐藏；节点分组已支持。
- monitor 不向匿名主题下发 IP 地址；本主题不依赖额外的 IP 信息插件。
- monitor 历史接口目前不提供 Swap、连接数、进程数和 Load 历史，这些指标仍可显示实时值。
- 首页 Ping 与节点详情页都读取 monitor 后台分配给服务器的探测任务和历史；后台调整分配后，
  首页会自动同步。主题设置只调整显示顺序和按服务器筛选。
- 开启「后台未分配任务时显示模拟延迟」后，前端生成的数值会带「模拟」标记；它不代表真实网络质量。

## 主题设置保存在哪里

新版 monitor 提供 `GET/PUT /api/themes/LuminaPlus/config`。站长登录后在主题设置页保存，
配置写入 hub 数据库；所有设备和访客读取同一份配置，更新或重装主题不会清除它。
`PUT` 需要已安装 LuminaPlus 且保持登录。保存失败会在设置页显示接口错误，不会假报成功。

旧版浏览器 `localStorage` 和手工放置的 `theme-settings.json` 不再作为配置来源，也不会覆盖
monitor 数据库中的设置。主题设置页不再提供旧版配置迁移入口。

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
- **首页自动显示后台当前分配的任务**，无需在主题里重复绑定。开启多线路模式后，大卡片和
  小卡片显示每台服务器的全部已分配任务，数量不限；全局优先顺序只调整排列，未列出的任务
  仍会显示。按服务器自定义时，可以选择显示任意数量的已分配任务并调整顺序，未选的任务会
  隐藏。迷你卡片和列表默认显示后台首条任务，也可以为节点指定一条优先显示的任务。
  后台撤销的任务不会继续出现在首页；没有分配任务的服务器不显示多线路 Ping 区域。
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
