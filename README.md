# 时光画廊

《时光画廊》是一款纯浏览器单机运行的艺术史科普游戏。它参考 William Fleming 与 Mary Warner Marien 的《Arts and Ideas》宏观脉络，将艺术形式背后的意识形态、社会背景与时代精神组织成 12 个艺术时期，以第一人称 3D 展厅完成浏览。

当前 v2 内容规模：

- 12 个艺术时期
- 96 幅画作，每时期 8 幅
- manifest 收录 73 位画家条目

## 本地运行

```bash
git clone https://github.com/tc206107/time-gallery.git
cd time-gallery
pnpm install
pnpm dev
```

浏览器打开终端输出的本地地址即可。生产构建：

```powershell
pnpm build
pnpm preview
```

构建产物在 `dist/`，可直接用任意静态服务器离线托管。运行时不会请求任何外部脚本、字体、API 或图片。

## 三种分发形态

同一个代码库产出三种形态，按用途取用：

| 形态 | 产物 | 用途 |
| --- | --- | --- |
| 静态站 | `pnpm build` → `dist/` | 托管到任意静态服务器或 GitHub Pages，手机浏览器可直接访问 |
| 离线目录 | `npx vite build --config vite.config.offline.js` 后运行 `tools/inline_offline.py` | 拷贝整个目录后用本地静态服务器打开 |
| 离线单文件 | `tools/build_single_file.py` → `release/时光画廊-离线单文件版.html` | 单个 HTML 文件，双击即玩，无需任何服务器 |

关于单文件版为什么必须把图片内联为 data URI：ES module 脚本在 `file://` 下会被 CORS 拒绝，
所以单文件版改用 IIFE 经典脚本；但即使如此，Three.js 的 `TextureLoader` 会在 `<img>` 上设置
`crossOrigin='anonymous'`，`file://` 下图片被视作跨源，`texImage2D` 会抛 `SecurityError`，
3D 展厅只会出现空白画框。把图片内联为 `data:` URI 后贴图才可用。这一结论在本机实测确认。

## 操作

### 桌面端

- 欢迎页点击“进入时间轴”。
- 时间轴悬停节点查看代表画作，点击节点进入对应时期展厅。
- 展厅内点击画面锁定指针；WASD 或方向键移动，鼠标旋转视角。
- 点击画框或按 E 打开详情，E 再次切换关闭，Esc 关闭面板。
- 点击“返回时间轴”回到树状时间轴。

### 移动端

- 单指在画面上拖动旋转视角，不会误触发画作详情。
- 轻点画作直接打开详情，无需进入指针锁定。
- 左下角虚拟摇杆控制前后左右移动，松手即停。
- 移动端自动降级渲染：不启用环境光遮蔽（SSAO）、像素比上限 1.5、阴影贴图 512；
  帧时间持续超过约 33 毫秒时再逐级降低渲染分辨率，只降不升。

## 资产与构建工具

- `tools/generate_manifest.py`：从 `fetch_assets.py` 的曲目表重建 `manifest.json`，输出相对路径与缩略图字段。
- `tools/optimize_assets.py`：压缩 `public/assets/art/` 原图并生成 `public/assets/thumb/` 缩略图。
- `tools/verify_assets.py`：校验清单与图片一一对应、路径为相对路径、宽高比未漂移。
- `tools/smoke.mjs`：桌面端端到端验收（12 展厅、指针锁定、E/Esc、返回时间轴）。
- `tools/smoke-mobile.mjs`：移动端端到端验收（真实触摸事件、轻点开详情、拖动不误触、零外部请求）。
- `tools/touch-check.mjs`：桌面与触摸两种能力下的对照回归（含低功耗渲染分支断言）。
- `tools/shots.mjs`：产出交付用截图。

## 内容与画幅

- 全部图像来自 Wikimedia Commons 或博物馆开放数据，均为公有领域或 CC0。
- 每幅画的来源 URL、作者、年代、物理尺寸与授权记录见根目录 `manifest.json`。
- 文本为项目按《Arts and Ideas》学术框架撰写的原创科普简释，非原书转载。
- 画作先按原图宽高比保持比例，再按 `physicalWidthCm` / `physicalHeightCm` 计算相对真实尺寸。
- 超大画幅会限制到墙面可用范围，避免裁切画面或拉伸变形。

## 十二时期展厅

每个时期使用独立的空间结构、材料、照明与画作挂放方式：

| 时期 | 空间 |
| --- | --- |
| 古代与中世纪 | 罗马式纵厅 |
| 文艺复兴早期 | 转角回廊 |
| 文艺复兴盛期 | 八角穹顶 |
| 巴洛克 | 巴洛克画廊 |
| 洛可可与新古典 | 椭圆沙龙与古典长廊 |
| 浪漫主义 | 铸铁温室 |
| 写实主义 | 工业博览会棚厅 |
| 印象派 | 双翼自然光沙龙 |
| 后印象派与象征主义 | 八角折面穹顶 |
| 现代主义先锋 | 白色模块化双展厅 |
| 表现主义与未来主义 | 棱坡屋顶多面厅 |
| 美国现代主义 | 工业 Loft |

## 画框

画框按时期使用石质、古典石膏、金箔、木框、轻薄金属框与极简现代框。画框跟随画作真实宽高比，横画保持横向画框，竖画保持竖向画框，不统一压缩为竖框。

## 材质与照明

- 墙体统一采用单色、低饱和、弱反光的 `MeshPhysicalMaterial`。
- 柱体、梁体和地面使用更光滑的材质，减少高对比贴图。
- 全局环境光、半球光和方向光均降低，避免墙面和画作眩光。
- 每幅画使用 3 个 `SpotLight`：上方主光、左侧补光、右侧补光。
- 保留真实阴影、环境反射与后处理，不依赖贴图伪装光源。

## 第三方参考

房间、画框、锥状灯光和画作排布思路参考 [TomPast/artwork-3D-museum](https://github.com/TomPast/artwork-3D-museum)。实际展厅由原生 Three.js 重新实现，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 学术符合性声明

内容组织以《Arts and Ideas》的“艺术形式与时代观念互相塑造”为框架：每个时期的展厅空间、画框、材质与照明都服务于该时期的意识形态、社会背景与艺术理念。

## 目录

```text
index.html
manifest.json
README.md
THIRD_PARTY_NOTICES.md
vite.config.js              # 常规构建（静态站）
vite.config.offline.js      # 离线构建（IIFE 经典脚本）
public/favicon.svg
public/assets/art/          # 本地画作图片
public/assets/thumb/        # 时间轴缩略图
src/data/artworks.js        # manifest 数据入口
src/three/                  # Three.js 展厅、控制、材质、后处理、设备能力判定
src/ui/                     # 欢迎页、时间轴、详情面板
src/main.js                 # 应用流程装配
src/styles.css              # 全局样式与动画
tools/fetch_assets.py       # 构建期资产下载与清单生成工具
tools/optimize_assets.py    # 原图压缩与缩略图生成
tools/inline_offline.py     # 离线目录内联为自包含 HTML
tools/build_single_file.py  # 离线单文件版打包
tools/smoke.mjs             # 桌面端端到端验收
tools/smoke-mobile.mjs      # 移动端端到端验收
tools/touch-check.mjs       # 桌面/触摸能力对照回归
```

## 验收

- 流程闭环：欢迎页 → 时间轴 → 3D 展厅 → 画作详情 → 返回时间轴。
- 12 个展厅空间结构彼此不同，且不全部使用简单圆厅。
- 画作按所在墙面法线摆放，画框保持真实比例，无拉伸或裁切。
- 每幅画配置独立锥状灯光，主光与补光分别创建并加入灯光目标。
- A / ← 向左移动，D / → 向右移动，无方向反转。
- 运行时零外部请求，所有代码和资源均本地打包。
- 移动端轻点画作可打开详情，全程不申请指针锁定。
- 在子路径（如 GitHub Pages 的 `/time-gallery/`）下所有资源均可解析。

## 验收记录

- `pnpm build`：退出码 0，产物 `dist/` 约 40 MB。
- 12 个时期均为 8 幅画作，共 96 幅，manifest 收录 73 位画家条目。
- 96/96 幅画作均有本地图片与 `physicalWidthCm` / `physicalHeightCm` 字段。
- 欢迎页、时间轴、12 个展厅、详情面板、E / Esc 操作、返回时间轴均已验证。
- 控制台错误：0。
- 外部网络请求：0。
- 全部画作执行射线遮挡检测，12 个展厅均无画作被墙柱遮挡。

移动端验收（`tools/smoke-mobile.mjs`，390×844 视口、`hasTouch`，托管在 `/time-gallery/` 子路径）：

- 15 项断言全部通过，退出码 0。
- 触摸拖动 120 像素后详情面板保持关闭；轻点画作打开详情，标题与瞄准画作一致。
- 子路径下缩略图与画作贴图均无 404。
- 图像载荷：原图 86.2 MB → 37.2 MB，时间轴缩略图 37.5 MB → 0.62 MB。

离线单文件验收（`file://` 直接打开 `release/时光画廊-离线单文件版.html`）：

- 桌面与移动视口下流程闭环均通过，控制台错误 0，失败请求 0。
- 单文件体积约 33 MB，含 96 幅内联画作与 96 幅内联缩略图。