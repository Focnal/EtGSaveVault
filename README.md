# EtG Save Vault

Enter the Gungeon 存档备份管理工具，基于 Electron + Vue 3 + TypeScript。

## 功能

- **工作区树视图**：可添加多个备份目录（工作区），树形展开查看其中的所有备份
- **备份详情视图**：创建时间、文件数、总大小、注册表标记、可编辑备注、存档文件预览
- **新建备份**：复制游戏存档目录并导出注册表键，支持自定义名称与备注
- **恢复备份**：恢复前自动把当前存档捕获为「回档点」；检测到游戏运行时提示先结束进程
- **回档点**：恢复前的安全网，存放在应用数据目录而非工作区，同卷时零拷贝捕获，按策略只保留最近 N 份；恢复完成的提示里可直接「撤销本次恢复」
- **重命名 / 删除 / 在资源管理器中打开**
- **设置**：存档来源目录、注册表键、游戏进程名、回档点保留份数均可配置

## 开发

```bash
npm install        # 安装依赖（不下载 Electron 二进制）
npm run dev        # Vite 开发服务器 + Electron 热重启（首次运行会按需下载 Electron 二进制）
```

> Electron 42 起 npm 包不再自带 `postinstall`，二进制改为首次调用 `electron` 时按需下载（约 151MB，缓存到 `%LOCALAPPDATA%\electron\Cache`，装好一次后不再重复下载）。因此 `npm install` 不会访问 GitHub，项目也不需要自己补 `postinstall` 钩子；`npm run dev` / `npm start` 在缺少 `node_modules/electron/dist` 时会自动补齐。
> 下载默认走淘宝 npmmirror 镜像（配置见下方「国内镜像构建」），无需额外参数。

## 构建与运行

```bash
npm run build      # 类型检查 + 渲染层打包 + 主进程打包（不联网）
npm start          # 以生产模式启动
npm run make       # build + electron-builder 打包便携版 → dist-executable/（镜像见下）
```

## 国内镜像构建

`npm run dev`（首次运行，下载 Electron 二进制约 151MB）与 `npm run make`（下载 Electron 压缩包，以及 winCodeSign、NSIS、7zip 等打包工具）都会从 GitHub Releases 下载大文件，国内网络下经常长时间卡住，因此镜像直接写在 `package.json` 的 `config` 字段里，普通命令自动生效，不需要 `make:cn` 之类的变体：

| `config` 键 | 值 | 作用 |
| --- | --- | --- |
| `electron_mirror` | `https://npmmirror.com/mirrors/electron/` | Electron 二进制（`npm run dev` 首次下载、`npm run make` 下载的 Electron 压缩包） |
| `electron_builder_binaries_mirror` | `https://npmmirror.com/mirrors/electron-builder-binaries/` | electron-builder 的打包工具（winCodeSign、NSIS、7zip） |

npm 会把 `config` 里的键导出成 `npm_package_config_*` 环境变量，`@electron/get` 与 electron-builder 都识别这种形式；**它的优先级高于 `ELECTRON_MIRROR` / `ELECTRON_BUILDER_BINARIES_MIRROR` 环境变量**。

若你可以正常访问electron官方源，则可删除`package.json`中的`config`字段来直接使用官方源

下载内容会缓存到 `%LOCALAPPDATA%\electron\Cache` 与 `%LOCALAPPDATA%\electron-builder\Cache`，之后的构建不会重复下载。

`config` 只在经过 npm 脚本运行时才会被导出。以下两种情况需要显式指定镜像（`--timeout=<秒>` 可防止下载卡死一直挂着，超时以退出码 124 结束）：

也可以直接设环境变量 `ELECTRON_MIRROR` / `ELECTRON_BUILDER_BINARIES_MIRROR`（不经 npm 脚本时它们就会生效）。

若还想让 npm 依赖包本身也走镜像，在 `.npmrc` 里写 `registry=https://registry.npmmirror.com/`（npm 官方支持的键，不会产生弃用警告）。本项目未内置该文件，以免影响其他网络环境的贡献者。

## 目录结构

```
electron/    主进程与 preload（备份逻辑、回档点、注册表、进程检测、IPC）
shared/      主进程与渲染层共享的 TypeScript 类型
src/         Vue 3 渲染层（组件、全局 store、样式）
scripts/     开发 / 构建脚本（esbuild + vite + 镜像包装）
```

## 回档点

「回档点」是恢复备份**之前**自动保留的那份当前存档，用途是"撤销本次恢复"。它与用户主动创建的备份是两种东西，因此单独存放：

```
%LOCALAPPDATA%\EtG Save Vault\rollback\<来源目录指纹>\
  <yyyyMMdd_HHmmss_SSS>/
    Enter the Gungeon/        当时的存档数据
    Enter the Gungeon.reg     当时的注册表导出
    rollback-meta.json        时间、来源备份、捕获方式
```

- **归属按存档来源目录**，而不是工作区 —— 恢复改写的始终是来源目录，多个工作区可能指向同一个游戏存档
- **零拷贝**：回档点与存档来源同在 `C:` 卷时，捕获 = 目录 `rename`，瞬时完成且不占额外空间；跨卷时自动退化为复制
- **滚动保留**：默认只保留最近 1 份，可在设置中改为关闭 / 1 / 3 / 10 份，超出部分自动删除
- **不影响工作区**：回档点不出现在备份树里，也不计入备份统计

> 旧版本在工作区内生成的 `_snapshot_*` 目录仍然会被识别并标记为「自动快照」，可手动删除，不会自动迁移。

## 备份目录结构

每个备份是工作区下的一个文件夹：

```
<工作区>/<备份名>/
  Enter the Gungeon/      存档数据
  Enter the Gungeon.reg   注册表导出（可选）
  vault-meta.json         创建时间与备注
```

工作区里只会出现你主动创建的备份；恢复操作产生的回档点存放在上面说的应用数据目录中。
