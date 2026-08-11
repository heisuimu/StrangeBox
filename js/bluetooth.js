/**
 * Web Bluetooth API 封装
 *
 * 负责设备选择、GATT 连接、特征值读写、断开监听。
 * 通过回调通知 UI 层，不直接操作 DOM。
 *
 * 浏览器要求：Chrome 56+ / Edge 79+，HTTPS 或 localhost
 */

// Nordic UART Service —— BLE 串口事实标准
const NUS_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const NUS_TX_CHARACTERISTIC_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'; // app 写入外设
const NUS_RX_CHARACTERISTIC_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'; // 外设通知 app

const CONNECT_TIMEOUT_MS = 10000;
const RECENT_DEVICES_MAX = 5;
const RECENT_DEVICES_KEY = 'andrawapp_recent_devices';

// 扫描模式枚举
const ScanMode = Object.freeze({
  NUS_ONLY: 'nus_only',   // 仅显示注册了 NUS 服务的设备（严格过滤）
  BY_NAME: 'by_name',     // 按设备名前缀过滤
  ALL: 'all',             // 显示所有 BLE 设备（acceptAllDevices）
});

const BluetoothController = {
  // 内部状态
  _device: null,
  _server: null,
  _txCharacteristic: null, // 写
  _rxCharacteristic: null, // 通知
  _disconnectListener: null,

  // 回调（由 UI 层设置）
  onStateChanged: null, // (state: 'disconnected'|'connecting'|'connected') => void
  onDataReceived: null,  // (text: string) => void
  onError: null,         // (message: string) => void

  /**
   * 检查浏览器是否支持 Web Bluetooth
   */
  isSupported() {
    return typeof navigator !== 'undefined' && !!navigator.bluetooth;
  },

  /**
   * 选择并连接设备
   * 必须由用户手势触发（通过 UI 层的 Modal "开始扫描"按钮调用）
   *
   * @param {Object} options
   * @param {string} options.mode - ScanMode 枚举值
   * @param {string} [options.namePrefix] - BY_NAME 模式下的名称前缀
   * @returns {Promise<void>}
   */
  async pickAndConnect(options = {}) {
    if (!this.isSupported()) {
      this._notifyError('浏览器不支持 Web Bluetooth API。请用 Chrome 56+ 或 Edge 79+，且在 HTTPS 或 localhost 环境。');
      return;
    }

    const mode = options.mode || ScanMode.NUS_ONLY;
    const namePrefix = (options.namePrefix || '').trim();

    // 构造 requestDevice 参数
    const requestOptions = { optionalServices: [NUS_SERVICE_UUID] };

    if (mode === ScanMode.NUS_ONLY) {
      // 严格过滤：只显示注册了 NUS 服务的设备
      requestOptions.filters = [{ services: [NUS_SERVICE_UUID] }];
    } else if (mode === ScanMode.BY_NAME && namePrefix) {
      // 按名称前缀过滤
      requestOptions.filters = [{ namePrefix }];
    } else {
      // 显示所有 BLE 设备（兜底模式，能看到正在广播的全部设备）
      requestOptions.acceptAllDevices = true;
    }

    this._notifyState('connecting');

    try {
      // 1. 用户选择设备（浏览器弹窗，无法绕过）
      this._device = await navigator.bluetooth.requestDevice(requestOptions);

      // 2. 监听断开
      this._disconnectListener = () => {
        this._cleanup();
        this._notifyState('disconnected');
        this._notifyError('设备已断开');
      };
      this._device.addEventListener('gattserverdisconnected', this._disconnectListener);

      // 3. 连接 GATT（带超时）
      const connectPromise = this._device.gatt.connect();
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('连接超时')), CONNECT_TIMEOUT_MS)
      );
      this._server = await Promise.race([connectPromise, timeoutPromise]);

      // 4. 获取 NUS 服务
      const service = await this._server.getPrimaryService(NUS_SERVICE_UUID);

      // 5. 获取 TX/RX 特征值
      this._txCharacteristic = await service.getCharacteristic(NUS_TX_CHARACTERISTIC_UUID);
      this._rxCharacteristic = await service.getCharacteristic(NUS_RX_CHARACTERISTIC_UUID);

      // 6. 启用 RX 通知
      await this._rxCharacteristic.startNotifications();
      this._rxCharacteristic.addEventListener(
        'characteristicvaluechanged',
        (event) => this._handleNotification(event)
      );

      // 7. 保存到最近设备列表
      this._saveRecent(this._device);

      this._notifyState('connected');
    } catch (err) {
      this._cleanup();
      this._notifyState('disconnected');

      // 用户取消选择器不算错误
      if (err.name === 'NotFoundError') return;

      // 设备不在 ALL 模式下无 NUS 服务 —— 给专门提示
      const msg = err.message || String(err);
      if (mode === ScanMode.ALL && (msg.includes('service') || msg.includes('Service') || msg.includes('NUS') || msg.includes('characteristic'))) {
        this._notifyError(`该设备不支持 Nordic UART Service (NUS)，无法进行串口通信。请使用"仅 NUS 设备"模式，或选择其他 BLE 设备。`);
      } else {
        this._notifyError(`连接失败: ${msg}`);
      }
    }
  },

  /**
   * 发送指令
   * @param {string} command Protocol.Command 枚举值
   * @returns {Promise<boolean>} 是否成功
   */
  async send(command) {
    if (!this._txCharacteristic) {
      this._notifyError('未连接设备，无法发送');
      return false;
    }
    try {
      const data = Protocol.encode(command);
      await this._txCharacteristic.writeValue(data);
      return true;
    } catch (err) {
      this._notifyError(`发送失败: ${err.message}`);
      return false;
    }
  },

  /**
   * 主动断开
   */
  disconnect() {
    if (this._device && this._device.gatt.connected) {
      this._device.gatt.disconnect();
    }
    this._cleanup();
    this._notifyState('disconnected');
  },

  /**
   * 当前是否已连接
   */
  isConnected() {
    return !!(this._device && this._device.gatt.connected);
  },

  /**
   * 获取当前设备信息（供 UI 显示）
   * @returns {{id:string,name:string}|null}
   */
  getCurrentDevice() {
    if (!this._device) return null;
    return {
      id: this._device.id || '',
      name: this._device.name || '(未命名设备)',
    };
  },

  /**
   * 获取最近连接的设备列表（从 localStorage）
   * @returns {Array<{id:string,name:string,at:number}>}
   */
  getRecentDevices() {
    try {
      const raw = localStorage.getItem(RECENT_DEVICES_KEY);
      if (!raw) return [];
      const list = JSON.parse(raw);
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  },

  /**
   * 清空最近设备列表
   */
  clearRecentDevices() {
    try {
      localStorage.removeItem(RECENT_DEVICES_KEY);
    } catch (e) { /* 忽略 */ }
  },

  // ============ 内部方法 ============

  _handleNotification(event) {
    const value = event.target.value;
    const text = new TextDecoder().decode(value);
    if (this.onDataReceived && text) {
      this.onDataReceived(text);
    }
  },

  _cleanup() {
    if (this._rxCharacteristic && this._disconnectListener) {
      try {
        this._rxCharacteristic.removeEventListener(
          'characteristicvaluechanged',
          this._handleNotification
        );
      } catch (e) { /* 忽略 */ }
    }
    if (this._device && this._disconnectListener) {
      this._device.removeEventListener('gattserverdisconnected', this._disconnectListener);
    }
    this._server = null;
    this._txCharacteristic = null;
    this._rxCharacteristic = null;
    this._disconnectListener = null;
    // _device 保留以便重连，下次 pickAndConnect 会覆盖
  },

  /**
   * 保存设备到最近列表（去重 + 限长）
   */
  _saveRecent(device) {
    if (!device || !device.id) return;
    try {
      const list = this.getRecentDevices();
      const filtered = list.filter((d) => d.id !== device.id);
      filtered.unshift({
        id: device.id,
        name: device.name || '(未命名设备)',
        at: Date.now(),
      });
      const top = filtered.slice(0, RECENT_DEVICES_MAX);
      localStorage.setItem(RECENT_DEVICES_KEY, JSON.stringify(top));
    } catch (e) { /* localStorage 不可用时静默忽略 */ }
  },

  _notifyState(state) {
    if (this.onStateChanged) this.onStateChanged(state);
  },

  _notifyError(message) {
    if (this.onError) this.onError(message);
  },
};

if (typeof window !== 'undefined') {
  window.BluetoothController = BluetoothController;
  window.ScanMode = ScanMode;
}
