# AndRawApp 项目规范

## 项目定位

Web 端蓝牙设备控制应用：通过 Web Bluetooth API 直接在浏览器中
连接 BLE 设备（ESP32/nRF52 等），发送 5 条文本指令控制外设开关。

## 技术栈

- 纯静态网页（HTML + CSS + 原生 JS，无构建步骤）
- Web Bluetooth API（仅 Chrome / Edge / Opera 支持，需 HTTPS 或 localhost）
- 目标 BLE 服务：Nordic UART Service (NUS)
- 协议：ASCII 文本 + LF(`\n`) 结尾

## 目录结构

```
andrawapp/
├── .trae/rules/project_rules.md   ← 本文件（AI 行为规范）
├── index.html                     ← 入口页面
├── css/style.css                  ← 样式
├── js/
│   ├── protocol.js                ← 指令枚举 + 编解码（纯逻辑，无 DOM 依赖）
│   ├── bluetooth.js               ← Web Bluetooth API 封装
│   ├── ui.js                      ← UI 交互 + 点动按钮安全逻辑
│   └── app.js                     ← 入口，组装各模块
├── docs/                          ← 设计文档
│   ├── bluetooth-protocol.md
│   └── browser-support.md
├── scripts/
│   └── serve.ps1                  ← 本地 HTTP 服务脚本
└── README.md
```

## 目录职责隔离

| 目录 | 职责 | 禁止 |
|------|------|------|
| `js/protocol.js` | 指令枚举、字节编解码 | 禁止引用 DOM、Bluetooth API |
| `js/bluetooth.js` | 设备选择、连接、读写、断开 | 禁止直接操作 DOM（通过回调通知 UI）|
| `js/ui.js` | DOM 事件、按钮状态、日志显示 | 禁止直接调 navigator.bluetooth（通过 bluetooth.js 暴露的方法）|
| `js/app.js` | 组装、初始化 | 禁止写业务逻辑 |
| `docs/` | 设计文档 | — |
| `scripts/` | 辅助脚本 | 禁止放生产代码 |

## 编码规范

- 文件编码：UTF-8 无 BOM
- 行尾：LF
- 缩进：2 空格
- JS：ES2020+，`const`/`let`，禁用 `var`
- 命名：
  - 变量/函数：camelCase
  - 常量：UPPER_SNAKE_CASE
  - 类：PascalCase
- 严禁硬编码：UUID、超时时间等放 `bluetooth.js` 顶部常量区

## 指令协议

| 指令 | 报文 | 触发方式 |
|------|------|----------|
| open    | `open\n`    | 主控按钮点击 |
| close   | `close\n`   | 主控按钮点击 |
| stop    | `stop\n`    | 主控按钮点击 / 点动松开自动发 |
| opening | `opening\n` | 点动按钮按下 |
| closing | `closing\n` | 点动按钮按下 |

## 点动按钮安全要求（强制）

1. 按下发 `opening`/`closing`，松开发 `stop`
2. 必须处理 `mouseleave` / `touchcancel` / `blur` —— 手指滑出按钮也要发 `stop`
3. 页面切后台（`visibilitychange`）自动发 `stop`
4. 蓝牙断开时禁用所有按钮，并记录本地 `stop`（防丢失）
5. 防抖 150ms

## 浏览器兼容性要求

- 必须支持 Chrome 56+ / Edge 79+（基于 Chromium）
- 不支持 Firefox / Safari（Web Bluetooth API 限制）
- 运行环境必须是 HTTPS 或 localhost

## 文档要求

- 任何协议、UUID、安全逻辑变更必须同步更新 `docs/`
- `README.md` 必须包含：项目简介、运行方式、浏览器要求、指令列表
