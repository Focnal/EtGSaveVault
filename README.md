# EtG Save Vault

Enter the Gungeon 存档备份管理工具，基于 Electron + Vue 3 + TypeScript。

## 功能

- **工作区树视图**：可添加多个备份目录（工作区），树形展开查看其中的所有备份
- **备份详情视图**：创建时间、文件数、总大小、注册表标记、可编辑备注、存档文件预览
- **新建备份**：复制游戏存档目录并导出注册表键，支持自定义名称与备注
- **恢复备份**：恢复前自动为当前存档创建 `_snapshot_` 前缀的安全快照；检测到游戏运行时提示先结束进程
- **重命名 / 删除 / 在资源管理器中打开**
- **设置**：存档来源目录、注册表键、游戏进程名均可配置

## 开发

```bash
npm install        # 如 Electron 下载缓慢：$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
npm run dev        # Vite 开发服务器 + Electron 热重启
```

## 构建与运行

```bash
npm run build      # 类型检查 + 渲染层打包 + 主进程打包
npm start          # 以生产模式启动
```

## 目录结构

```
electron/    主进程与 preload（备份逻辑、注册表、进程检测、IPC）
shared/      主进程与渲染层共享的 TypeScript 类型
src/         Vue 3 渲染层（组件、全局 store、样式）
scripts/     开发 / 构建脚本（esbuild + vite）
```

## 备份目录结构

每个备份是工作区下的一个文件夹：

```
<工作区>/<备份名>/
  Enter the Gungeon/      存档数据
  Enter the Gungeon.reg   注册表导出（可选）
  vault-meta.json         创建时间与备注
```
