# Normandy · DSH

《质量效应》主题的 DSH 开场：N7 徽记从画面外拼合，诺曼底掠过镜头，身份环收拢，Skills 与 MCP 逐项展开，最后进入指挥界面。完整时间线为 24 秒，包含六段 EDI 风格合成配音、引擎低频、跃迁、扫描和锁定音效。

![Normandy flyby](docs/preview.png)

## 先看样片

```sh
python3 scripts/preview_cinematic.py
```

打开 [本地样片](http://127.0.0.1:8792/cinematic/)，点击「启动诺曼底」。所有字体、音频和图形依赖均为本地资源。

空格暂停／继续，R 重播，M 静音，F 全屏，Esc 跳过。底部进度条可以跳转。样片使用标明「演示清单」的 Skills／MCP 名称。

## 接入 DSH

本版本面向 **macOS + 官方 DeepSeek Harness Web profile**，按 `@deepseek-ai/dsh 0.1.1-rc.2` 的插件接口实现。需要已初始化的 DSH web profile、Node.js 22.19+ 和 `swiftc`（Xcode Command Line Tools）。

```sh
node integration/install.mjs
dsh
```

安装器默认查找 `~/.dsh/profiles/node_modules/@deepseek-ai/dsh/lib/bin.js`。如果 DSH 位于其他位置：

```sh
node integration/install.mjs --dsh-cli /absolute/path/to/@deepseek-ai/dsh/lib/bin.js
```

安装后，`dsh` 启动真实 DSH Web 服务，在原生窗口中自动播放开场，包括声音。播放结束、Esc 或点击「返回 DSH」后，在同一窗口使用 DSH。关闭窗口会停止本次启动的服务。`dsh-normandy` 是相同入口。

实际启动时，画面读取当前默认预设的 Skills 和 MCP 名称，只展示名称与数量；清单较长时显示前八项。MCP 表示已配置的接口目录，不代表连接健康检查。读取失败时显示“清单读取暂不可用”，仍可进入 DSH。

```sh
dsh startup off       # 以后关闭开场
dsh startup on        # 重新开启
dsh startup status    # 查看开关
dsh --no-startup      # 本次跳过
dsh web --port 3081   # 转发官方 DSH 参数
dsh web --no-open     # 只启动服务，手动使用浏览器
```

浏览器首次播放声音可能需要点击「开启声音并启动」。原生窗口已配置自动播放。`--help`、`--version` 和非 Web profile 直接交给原始 DSH CLI。

## 安装与恢复

安装器将运行文件放在 `~/.local/share/fancy-dsh/`，创建 `~/.local/bin/dsh` 和 `dsh-normandy`，并向 DSH 的 `web/cordis.patch.yml` 添加一个独立插件。现有同名命令会使安装停止，不会被覆盖。只有该 bin 目录不在 PATH 时才添加一个标记过的 zsh PATH 配置块。

原始 DSH profile patch 会先备份。安装器保留 DSH 源码、模型设置、会话和用户数据。重复安装用于更新本项目。

如果 Web profile 中的旧版组件与 CLI 依赖树中的新版混用，安装器会生成独立的本地兼容补丁；启动器仅在启动对应 Web profile 时加载它，保持页面服务与当前 CLI 匹配。原有端口和主机参数仍然生效。

```sh
node integration/install.mjs --uninstall
```

卸载会删除本项目创建的命令和插件条目。运行文件与备份保留在安装目录，方便检查。

## 文件与验证

- `dist/cinematic/`：画面、24 秒时间线、字幕和混合音轨。
- `dist/ship.js`：程序生成的诺曼底舰体。
- `integration/plugin.mjs`、`overlay.js`：DSH 页面接入与本地清单。
- `integration/NormandyWindow.swift`：macOS 窗口与自动音频。
- `integration/install.mjs`、`launch.mjs`：安装、启动和恢复。
- `release-files.json`：发布文件清单。

```sh
npm test
```

该命令检查接入层的关键边界。真实 DSH 启动和画面播放需在 macOS 上运行安装入口验证。

动作设计参考 [deepseek-harness-rust-optimize](https://github.com/Ar1haraNaN7mI/deepseek-harness-rust-optimize) 的高清开场：分块拼合、大幅收缩环、分层斜向转场和扫描揭示。第三方资源与音频来源见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
