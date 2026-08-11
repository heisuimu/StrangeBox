# 蓝牙协议说明

## BLE 服务与特征值（多 Profile 支持）

本项目支持多种 BLE 串口服务 UUID，用户可在连接 Modal 的"设备类型"下拉框中选择，或自定义 UUID。

### 内置预设

| Profile ID | 名称 | Service UUID | TX（app 写外设）| RX（外设 notify）| 适用设备 |
|------------|------|--------------|------------------|-------------------|----------|
| `nus`      | Nordic UART (NUS) | `6e400001-b5a3-f393-e0a9-e50e24dcca9e` | `6e400002-...` | `6e400003-...` | nRF52 / Arduino BLE Serial 固件 |
| `hm10`     | HM-10 兼容 (0xFFE0/0xFFE1) | `0000ffe0-0000-1000-8000-00805f9b34fb` | `0000ffe1-...` | `0000ffe1-...` | 易加 / HC-08 / JDY-31 / 亿佰特 E104-BT 系列 |
| `custom`   | 自定义 UUID | 用户输入 | 用户输入 | 用户输入 | 任何 BLE 串口模块 |

> **HM-10 兼容模块说明**：TX/RX 是同一特征值 `0xFFE1`（同一特征既可写又可 notify），代码无需特殊处理。

### UUID 规范化

用户在自定义输入框中可填写以下任一格式，`BluetoothController.normalizeUuid()` 会自动扩展为 128-bit 小写规范：

- `FFE0` / `ffe0` → `0000ffe0-0000-1000-8000-00805f9b34fb`
- `0xFFE0` → `0000ffe0-0000-1000-8000-00805f9b34fb`
- `0000ffe0-0000-1000-8000-00805f9b34fb` → 原样保留

### Profile 持久化

用户选择的 profile 会保存到 `localStorage` 的 `andrawapp_service_profile` 键，下次打开自动加载。预设 profile 始终回查代码表（避免本地副本过期）；自定义 profile 直接用 storage 内容。

## 扫描模式

| 模式 | 行为 | 适用场景 |
|------|------|----------|
| `nus_only` | `filters: [{ services: [当前 profile.service] }]` | 严格过滤，只显示注册了对应服务的设备 |
| `by_name`  | `filters: [{ namePrefix }]` | 按设备名前缀过滤 |
| `all`      | `acceptAllDevices: true` + `optionalServices: [profile.service]` | 兜底，显示所有 BLE 设备 |

> **注意**：`optionalServices` 必须包含 `profile.service`，否则 ALL/BY_NAME 模式下 `getPrimaryService` 会抛 SecurityError。

## 指令格式

ASCII 文本 + LF(`\n`) 结尾。便于用串口助手调试，也便于外设端按行解析。

## 指令表

| 指令 | 报文（字节） | 含义 | 触发方式 |
|------|-------------|------|----------|
| open    | `open\n`    | 开     | 主控按钮点击 |
| close   | `close\n`   | 关     | 主控按钮点击 |
| stop    | `stop\n`    | 停     | 主控按钮点击 / 点动松开自动发 |
| opening | `opening\n` | 点动开 | 点动按钮按下 |
| closing | `closing\n` | 点动关 | 点动按钮按下 |

## 外设端实现要点

### ESP32（NUS 固件）

1. 注册 NUS 服务（含 TX/RX 特征值）
2. RX 特征值（`6e400003`）启用 notify
3. TX 特征值（`6e400002`）接收写入，按 `\n` 切行解析指令
4. 收到 `open` 执行开启动作，`close` 执行关闭，`stop` 执行停止
5. 收到 `opening`/`closing` 持续动作直到收到 `stop`

### 易加/HC-08/JDY-31（HM-10 兼容模块 + STC 单片机）

1. 蓝牙模块默认透传模式，无需固件开发
2. 蓝牙模块的 TX/RX 引脚连接 STC 单片机的串口
3. STC 单片机串口按 `\n` 切行解析指令，执行对应动作
4. 应用端选择"HM-10 兼容 (0xFFE0/0xFFE1)"设备类型即可

## 安全机制

- 点动按钮松开/滑出/失焦/页面切后台 → 自动发 `stop`
- 蓝牙断连时本地记录 `stop`（防止连接中断前最后一条 stop 丢失）
- 防抖 150ms
