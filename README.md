# EtG Save Vault

Enter the Gungeon 存档备份管理工具，基于 Electron + Vue 3 + TypeScript。

## 功能

- **工作区**：可添加多个备份目录，树形展开查看其中的备份
- **备份**：新建（复制存档目录 + 导出注册表键）、恢复、重命名、删除、在资源管理器中打开
- **备份详情**：创建时间、文件数、总大小、注册表标记、可编辑备注、存档文件预览
- **回档点**：恢复前自动把当前存档保留为回档点，恢复完成的提示里可直接「撤销本次恢复」
- **设置**：存档来源目录、注册表键、游戏进程名、回档点保留份数均可配置

## 开发与构建

node.js >= 22

```bash
npm install     # 安装依赖（Electron 二进制按需下载，约 151MB）
npm run dev     # Vite 开发服务器 + Electron 热重启
npm run build   # 类型检查 + 渲染层与主进程打包
npm start       # 以生产模式启动
npm run make    # build + 打包便携版 → dist-executable/
```

## CN镜像

Electron 二进制与 electron-builder 打包工具的镜像已写入 `package.json` 的 `config` 字段，经 npm 脚本运行时自动生效，无需额外参数；若可正常访问官方源，删除该字段即可。下载内容缓存在 `%LOCALAPPDATA%\electron\Cache` 与 `%LOCALAPPDATA%\electron-builder\Cache`，之后不会重复下载。

## 目录结构

```
electron/    主进程与 preload（备份逻辑、回档点、注册表、进程检测、IPC）
shared/      主进程与渲染层共享的 TypeScript 类型
src/         Vue 3 渲染层（组件、全局 store、样式）
scripts/     开发 / 构建脚本
```

## 数据布局

备份是工作区下的一个文件夹：

```
<工作区>/<备份名>/
  Enter the Gungeon/      存档数据
  Enter the Gungeon.reg   注册表导出（可选）
  vault-meta.json         创建时间与备注
```

「回档点」单独存放在 `%LOCALAPPDATA%\EtG Save Vault\rollback\`，不进入备份树；与存档来源同卷时零拷贝捕获（目录 rename），跨卷时退化为复制，默认只保留最近 1 份。
