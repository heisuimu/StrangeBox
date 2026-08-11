/**
 * Web Bluetooth API 封装
 *
 * 负责设备选择、GATT 连接、特征值读写、断开监听。
 * 通过回调通知 UI 层，不直接操作 DOM。
 *
 * 浏览器要求：Chrome 56+ / Edge 79+，HTTPS 或 localhost
 */

// HM-10 兼容服务 UUID —— 亿佰特/HC-08/JDY-31 等 BLE 串口模块常用
//   易加蓝牙模块默认使用此服务，TX/RX 是同一特征值（既可写又可 notify）
const HM10_SERVICE_UUID = '0000ffe0-0000-1000-8000-00805f9b34fb';
const HM10_CHARACTERISTIC_UUID = '0000ffe1-0000-1000-8000-00805f9b34fb';

const CONNECT_TIMEOUT_MS = 10000;
const RECENT_DEVICES_MAX = 5;
const RECENT_DEVICES_KEY = 'andrawapp_recent_devices';
const SERVICE_PROFILE_STORAGE_KEY = 'andrawapp_service_profile';

// 服务预设表：UI 通过 getPresetProfiles() 读取，避免在 ui.js 出现 UUID 字面量
//   id      —— 与 <option value="..."> 对应
//   label   —— UI 显示名
//   service —— GATT Primary Service UUID（128-bit 小写规范）
//   tx      —— app 写入外设的特征 UUID
//   rx      —— 外设 notify 的特征 UUID（HM-10 的 tx/rx 是同一特征）
const SERVICE_PROFILES = Object.freeze([
  Object.freeze({
    id: 'hm10',
    label: 'HM-10 兼容 (0xFFE0/0xFFE1)',
    service: HM10_SERVICE_UUID,
    tx: HM10_CHARACTERISTIC_UUID,
    rx: HM10_CHARACTERISTIC_UUID,
  }),
  Object.freeze({
    id: 'custom',
    label: '自定义 UUID',
    service: '',
    tx: '',
    rx: '',
  }),
]);

// 扫描模式枚举
const ScanMode = Object.freeze({
  BY_SERVICE: 'by_service', // 按当前 profile 的 service UUID 过滤（严格）
  ALL: 'all',               // 显示所有 BLE 设备（acceptAllDevices 兜底）
});

const BluetoothController = {
  // 内部状态
  _device: null,
  _server: null,
  _txCharacteristic: null, // 写
  _rxCharacteristic: null, // 通知
  _disconnectListener: null,
  _currentProfile: null,   // 当前选中的 ServiceProfile

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

  // ============ Service Profile 管理 ============

  /**
   * 获取所有预设 profile（UI 用于渲染 <option>）
   * 返回深拷贝避免外部修改常量表
   */
  getPresetProfiles() {
    return SERVICE_PROFILES.map((p) => ({ ...p }));
  },

  /**
   * 按 id 查找预设 profile
   * @returns {Object|null} 找不到返回 null
   */
  findProfileById(id) {
    const found = SERVICE_PROFILES.find((p) => p.id === id);
    return found ? { ...found } : null;
  },

  /**
   * 获取当前 profile；若内存为空则从 localStorage 加载
   */
  getCurrentProfile() {
    if (!this._currentProfile) this.loadProfile();
    return this._currentProfile;
  },

  /**
   * 设置当前 profile（仅内存，不写 storage）
   */
  setCurrentProfile(profile) {
    if (!profile) return;
    this._currentProfile = { ...profile };
  },

  /**
   * 从 localStorage 加载 profile；失败回退到首个预设（NUS）
   */
  loadProfile() {
    try {
      const raw = localStorage.getItem(SERVICE_PROFILE_STORAGE_KEY);
      if (!raw) {
        this._currentProfile = { ...SERVICE_PROFILES[0] };
        return this._currentProfile;
      }
      const parsed = JSON.parse(raw);
      if (parsed && parsed.id === 'custom') {
        // 自定义 profile：直接用 storage 内容
        this._currentProfile = { ...parsed };
      } else if (parsed && parsed.id) {
        // 预设 profile：始终回查代码表，避免本地副本过期
        const preset = this.findProfileById(parsed.id) || SERVICE_PROFILES[0];
        this._currentProfile = { ...preset };
      } else {
        this._currentProfile = { ...SERVICE_PROFILES[0] };
      }
    } catch (e) {
      this._currentProfile = { ...SERVICE_PROFILES[0] };
    }
    return this._currentProfile;
  },

  /**
   * 保存 profile 到 localStorage
   */
  saveProfile(profile) {
    if (!profile) return;
    try {
      localStorage.setItem(SERVICE_PROFILE_STORAGE_KEY, JSON.stringify(profile));
    } catch (e) { /* localStorage 不可用时静默忽略 */ }
  },

  /**
   * UUID 规范化：支持 'FFE0' / '0xFFE0' / 'ffe0' / '0000ffe0-...'
   * 统一输出为 128-bit 小写形式 '0000ffe0-0000-1000-8000-00805f9b34fb'
   * @param {string} input
   * @returns {string}
   */
  normalizeUuid(input) {
    if (!input) return '';
    let s = String(input).trim().toLowerCase();
    // 去掉 0x 前缀
    if (s.startsWith('0x')) s = s.slice(2);
    // 去掉所有连字符
    s = s.replace(/-/g, '');
    // 16-bit 短 UUID → 扩展为 128-bit（Bluetooth Base UUID）
    if (s.length === 4) {
      return `0000${s}-0000-1000-8000-00805f9b34fb`;
    }
    // 32-bit 短 UUID → 扩展
    if (s.length === 8) {
      return `${s}-0000-1000-8000-00805f9b34fb`;
    }
    // 128-bit：按 8-4-4-4-12 格式重组
    if (s.length === 32) {
      return `${s.slice(0,8)}-${s.slice(8,12)}-${s.slice(12,16)}-${s.slice(16,20)}-${s.slice(20,32)}`;
    }
    // 其他情况原样返回（让浏览器 API 报错）
    return input.trim().toLowerCase();
  },

  /**
   * 选择并连接设备
   * 必须由用户手势触发（通过 UI 层的 Modal "开始扫描"按钮调用）
   *
   * @param {Object} options
   * @param {string} options.mode - ScanMode 枚举值
   * @param {Object} [options.serviceProfile] - ServiceProfile；为空时用当前 _currentProfile
   * @returns {Promise<void>}
   */
  async pickAndConnect(options = {}) {
    if (!this.isSupported()) {
      this._notifyError('浏览器不支持 Web Bluetooth API。请用 Chrome 56+ 或 Edge 79+，且在 HTTPS 或 localhost 环境。');
      return;
    }

    const mode = options.mode || ScanMode.BY_SERVICE;

    // 解析 profile：优先用参数传入的，否则用当前内存中的
    const profile = options.serviceProfile || this.getCurrentProfile();
    if (!profile || !profile.service || !profile.tx || !profile.rx) {
      this._notifyError('未选择有效的设备类型，请先在连接面板选择或填写 Service/TX/RX UUID。');
      return;
    }
    const serviceUuid = profile.service;
    const txUuid = profile.tx;
    const rxUuid = profile.rx;

    // 构造 requestDevice 参数
    //   注意：optionalServices 必须含 serviceUuid，否则 ALL 模式下
    //   getPrimaryService 会抛 SecurityError
    const requestOptions = { optionalServices: [serviceUuid] };

    if (mode === ScanMode.BY_SERVICE) {
      // 严格过滤：只显示注册了当前 profile.service 的设备
      requestOptions.filters = [{ services: [serviceUuid] }];
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

      // 4. 获取 service（用当前 profile 的 UUID）
      const service = await this._server.getPrimaryService(serviceUuid);

      // 5. 获取 TX/RX 特征值
      this._txCharacteristic = await service.getCharacteristic(txUuid);
      this._rxCharacteristic = await service.getCharacteristic(rxUuid);

      // 6. 启用 RX 通知
      await this._rxCharacteristic.startNotifications();
      this._rxCharacteristic.addEventListener(
        'characteristicvaluechanged',
        (event) => this._handleNotification(event)
      );

      // 7. 保存到最近设备列表 + 持久化当前 profile
      this._saveRecent(this._device);
      this.saveProfile(profile);
      this._currentProfile = { ...profile };

      this._notifyState('connected');
    } catch (err) {
      this._cleanup();
      this._notifyState('disconnected');

      // 用户取消选择器不算错误
      if (err.name === 'NotFoundError') return;

      // 设备缺少当前 profile 所需的 service/characteristic —— 给专门提示
      const msg = err.message || String(err);
      const isServiceError = /service|characteristic/i.test(msg);
      if (isServiceError) {
        this._notifyError(`该设备不支持 ${profile.label}（Service=${serviceUuid.slice(0, 8)}…），无法进行串口通信。请改用其他设备类型或扫描模式。`);
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
