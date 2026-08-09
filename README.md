# AndRawApp - 蓝牙设备控制网页

通过 Web Bluetooth API 在浏览器中直接连接 BLE 设备，发送 5 条文本指令控制外设开关。

## 功能

- 一键连接 BLE 设备（Nordic UART Service）
- 3 个主控按钮：开 / 关 / 停
- 2 个点动按钮：点动开 / 点动关（长按持续动作，松开自动停止）
- 实时日志（发送/接收/错误）
- 完整的安全停机机制（页面切后台、断连、滑出按钮自动发 stop）

## 浏览器要求

- Chrome 56+ / Edge 79+ / Opera 43+
- 必须 HTTPS 或 localhost 环境
- 不支持 Firefox / Safari

详见 [docs/browser-support.md](docs/browser-support.md)。

## 运行

### 本地启动（推荐）

```powershell
cd D:\个人工作资料\trae_working\andrawapp
.\scripts\serve.ps1
```

或用 Python 内置服务：

```powershell
python -m http.server 8000
```

浏览器访问 `http://localhost:8000`。

### 使用流程

1. 浏览器打开 `http://localhost:8000`
2. 点击"连接设备" → 浏览器弹出设备选择器
3. 选择你的 BLE 设备 → 状态变为"已连接"
4. 点"开/关/停"控制，或长按"点动开/点动关"

## 指令协议

| 指令 | 报文 | 含义 |
|------|------|------|
| open    | `open\n`    | 开 |
| close   | `close\n`   | 关 |
| stop    | `stop\n`    | 停 |
| opening | `opening\n` | 点动开 |
| closing | `closing\n` | 点动关 |

详见 [docs/bluetooth-protocol.md](docs/bluetooth-protocol.md)。

## 目录结构

```
andrawapp/
├── .trae/rules/project_rules.md   ← 项目规范
├── index.html                     ← 入口页面
├── css/style.css                  ← 样式
├── js/
│   ├── protocol.js                ← 指令协议（纯逻辑）
│   ├── bluetooth.js               ← Web Bluetooth 封装
│   ├── ui.js                      ← UI 交互 + 点动安全
│   └── app.js                     ← 入口
├── docs/                          ← 文档
└── scripts/serve.ps1              ← 本地服务脚本
```

## 被控设备要求

- BLE 设备（ESP32 / nRF52 等），非经典蓝牙（HC-05/06 不行）
- 固件需注册 Nordic UART Service（UUID `6e400001-b5a3-f393-e0a9-e50e24dcca9e`）
- 接收 `open`/`close`/`stop`/`opening`/`closing` 文本指令（按 `\n` 切行）

## 技术栈

- 纯静态网页（HTML + CSS + 原生 JS，无构建步骤）
- Web Bluetooth API
- 无后端依赖
