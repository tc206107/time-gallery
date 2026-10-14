# 第三方参考说明

## 来源

[TomPast/artwork-3D-museum](https://github.com/TomPast/artwork-3D-museum)

## 参考范围

本项目参考该仓库的以下设计思路：

- Room：按时期组织展厅空间结构。
- Frame：按画作真实比例和时期风格生成画框。
- SpotlightGroup：为单幅画作提供集中式灯光。
- framePositioning：根据墙面和空间位置安排画作。

实际实现为原生 Three.js 重写。本项目运行时代码不包含该仓库的源代码，也不把该仓库作为运行时依赖。

## 许可证

无法确认该仓库的许可证信息。本项目未直接复制仓库文件，只采用代码思路参考，因此不在此添加许可证声明。

## 本地依赖与离线运行

- Three.js 和 Vite 仅在开发或构建期由 pnpm 在本地安装，运行时不需要 `node_modules`。
- 生产构建后，相关代码随 `pnpm build` 打包到 `dist/`。
- 运行时只使用本地构建产物和 `public/assets/`，不请求外部脚本、字体、API 或图片。
- `puppeteer-core` 仅用于本地自动化验收，不进入浏览器运行包。