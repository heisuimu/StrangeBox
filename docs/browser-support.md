# 浏览器兼容性

## 支持的浏览器

| 浏览器 | 支持情况 | 最低版本 |
|--------|----------|----------|
| Chrome | ✅ 完全支持 | 56+ |
| Edge   | ✅ 完全支持 | 79+（Chromium 内核）|
| Opera  | ✅ 完全支持 | 43+ |
| Firefox | ❌ 不支持 | — |
| Safari | ❌ 不支持 | — |
| 移动端 Chrome（Android）| ⚠️ 部分支持 | 需 Flags 开启 |

## 运行环境要求

Web Bluetooth API 出于安全考虑，要求运行环境必须是：

- **HTTPS** 网页（任何域名）
- **localhost**（本地开发）
- **file://** 协议**不支持**（必须起 HTTP 服务）

## 本地启动方法

### 方法 1：用项目自带脚本

```powershell
# 在项目根目录执行
.\scripts\serve.ps1
```
默认在 `http://localhost:8000` 启动服务，浏览器打开即可。

### 方法 2：Python 内置 HTTP 服务

```powershell
cd D:\个人工作资料\trae_working\andrawapp
python -m http.server 8000
```
浏览器访问 `http://localhost:8000`。

### 方法 3：Node.js http-server

```powershell
npx http-server -p 8000
```

## 常见问题

### Q：点击"连接设备"没反应？
A：确认浏览器是 Chrome / Edge，且地址是 `http://localhost:...` 而非 `file://`。

### Q：设备列表里找不到我的设备？
A：
1. 确认设备是 BLE（不是经典蓝牙 HC-05/06）
2. 确认设备固件注册了 NUS 服务（UUID `6e400001-...`）
3. 确认设备已通电且在广播

### Q：手机上能用吗？
A：Android Chrome 需在 `chrome://flags` 启用 `Web Bluetooth API`，iOS 不支持。

### Q：HTTPS 部署后还需要什么？
A：不需要额外配置，Web Bluetooth API 在 HTTPS 下直接可用。
