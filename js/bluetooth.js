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
   * 弹出设备选择器（必须由用户手势触发）
   * @returns {Promise<void>}
   */
  async pickAndConnect() {
    if (!this.isSupported()) {
      this._notifyError('浏览器不支持 Web Bluetooth API。请用 Chrome 56+ 或 Edge 79+，且在 HTTPS 或 localhost 环境。');
      return;
    }

    this._notifyState('connecting');

    try {
      // 1. 用户选择设备（浏览器弹窗，无法绕过）
      this._device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [NUS_SERVICE_UUID] }],
        optionalServices: [NUS_SERVICE_UUID],
      });

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

      this._notifyState('connected');
    } catch (err) {
      this._cleanup();
      this._notifyState('disconnected');
      // 用户取消选择器不算错误
      if (err.name !== 'NotFoundError') {
        this._notifyError(`连接失败: ${err.message}`);
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
      // 移除监听器（特征值已失效，忽略异常）
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

  _notifyState(state) {
    if (this.onStateChanged) this.onStateChanged(state);
  },

  _notifyError(message) {
    if (this.onError) this.onError(message);
  },
};

if (typeof window !== 'undefined') {
  window.BluetoothController = BluetoothController;
}
