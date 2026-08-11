/**
 * UI 交互层
 *
 * 负责 DOM 事件绑定、按钮状态管理、日志显示、连接 Modal。
 * 不直接调 navigator.bluetooth，全部通过 BluetoothController 暴露的方法。
 *
 * 点动按钮安全设计：
 * 1. 按下发 opening/closing，松开发 stop
 * 2. 处理 mouseleave / touchcancel / blur —— 手指滑出按钮也要发 stop
 * 3. 页面切后台（visibilitychange）自动发 stop
 * 4. 蓝牙断开时禁用所有按钮，记录本地 stop
 * 5. 防抖 150ms
 */

// 扫描模式提示文案模板（{label} 占位符在 _onModeChange 中用当前 profile.label 替换）
const MODE_HINTS = {
  by_service: '仅显示注册了 {label} 服务的设备。如果列表为空，说明附近没有符合的设备，请改用"显示所有"模式。',
  all: '显示所有正在广播的 BLE 设备（列表最全）。选中后仍会尝试连接 {label}，若设备无此服务会报错。',
};

const UI = {
  // DOM 元素引用
  _els: {},

  // 防抖状态
  _lastPressMs: 0,

  /**
   * 初始化 UI：缓存 DOM、绑定事件、绑定蓝牙回调
   */
  init() {
    this._cacheElements();
    this._bindMainButtons();
    this._bindMomentaryButtons();
    this._bindVisibilitySafety();
    this._bindBluetoothCallbacks();
    this._bindModal();
    this._bindProfileSelector();
    this._loadProfileIntoUI();
    this._setButtonsEnabled(false); // 未连接前禁用
  },

  // ============ 主控按钮 ============

  _bindMainButtons() {
    this._els.btnOpen.addEventListener('click', async () => {
      await BluetoothController.send(Protocol.Command.OPEN);
      this._log(`→ 发送: open`, 'out');
    });
    this._els.btnClose.addEventListener('click', async () => {
      await BluetoothController.send(Protocol.Command.CLOSE);
      this._log(`→ 发送: close`, 'out');
    });
    this._els.btnStop.addEventListener('click', async () => {
      await BluetoothController.send(Protocol.Command.STOP);
      this._log(`→ 发送: stop`, 'out');
    });
  },

  // ============ 点动按钮（核心安全）============

  _bindMomentaryButtons() {
    this._bindMomentary(this._els.btnOpening, Protocol.Command.OPENING);
    this._bindMomentary(this._els.btnClosing, Protocol.Command.CLOSING);
  },

  /**
   * 绑定点动按钮：按下发 pressCmd，松开/离开/失焦发 stop
   */
  _bindMomentary(btn, pressCmd) {
    const press = (e) => {
      e.preventDefault();
      const now = Date.now();
      if (now - this._lastPressMs < Protocol.DEBOUNCE_MS) return;
      this._lastPressMs = now;
      btn.classList.add('active');
      BluetoothController.send(pressCmd);
      this._log(`→ 发送: ${pressCmd} (按下)`, 'out');
    };

    const release = () => {
      if (!btn.classList.contains('active')) return;
      btn.classList.remove('active');
      BluetoothController.send(Protocol.Command.STOP);
      this._log(`→ 发送: stop (松开)`, 'out');
    };

    // 鼠标
    btn.addEventListener('mousedown', press);
    btn.addEventListener('mouseup', release);
    btn.addEventListener('mouseleave', release); // 滑出按钮必须停
    btn.addEventListener('blur', release);        // 失焦也必须停

    // 触摸
    btn.addEventListener('touchstart', press, { passive: false });
    btn.addEventListener('touchend', release);
    btn.addEventListener('touchcancel', release); // 触摸中断必须停
  },

  // ============ 页面切后台安全 ============

  _bindVisibilitySafety() {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && BluetoothController.isConnected()) {
        // 页面切后台，强制停机
        BluetoothController.send(Protocol.Command.STOP);
        this._log(`→ 发送: stop (页面切后台)`, 'out');
      }
    });
    // 失去焦点（切到其他应用）也要停
    window.addEventListener('blur', () => {
      if (BluetoothController.isConnected()) {
        BluetoothController.send(Protocol.Command.STOP);
        this._log(`→ 发送: stop (窗口失焦)`, 'out');
      }
    });
  },

  // ============ 蓝牙回调 ============

  _bindBluetoothCallbacks() {
    BluetoothController.onStateChanged = (state) => this._onStateChanged(state);
    BluetoothController.onDataReceived = (text) => this._log(`← 收到: ${text}`, 'in');
    BluetoothController.onError = (msg) => this._log(`⚠ ${msg}`, 'err');
  },

  _onStateChanged(state) {
    const map = {
      disconnected: { text: '未连接', color: '#999' },
      connecting: { text: '连接中…', color: '#e80' },
      connected: { text: '已连接', color: '#2a7' },
    };
    const info = map[state] || map.disconnected;
    this._els.statusDot.style.background = info.color;
    this._els.statusText.textContent = info.text;

    if (state === 'connected') {
      this._setConnectingButton(false);
      this._setButtonsEnabled(true);
      this._renderDeviceInfo();
    } else if (state === 'connecting') {
      this._setConnectingButton(true);
    } else {
      // disconnected
      this._setConnectingButton(false);
      this._setButtonsEnabled(false);
      // 断开时隐藏设备信息卡片
      this._els.deviceInfo.style.display = 'none';
      // 断开时主动发本地 stop 日志（防丢失）
      this._log('● 本地记录: stop (断连兜底)', 'sys');
    }
  },

  // ============ 连接 Modal ============

  _bindModal() {
    // 取消按钮
    this._els.modalCancel.addEventListener('click', () => this._hideModal());
    // 点击遮罩关闭
    this._els.connectModal.addEventListener('click', (e) => {
      if (e.target === this._els.connectModal) this._hideModal();
    });
    // ESC 关闭
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this._els.connectModal.classList.contains('show')) {
        this._hideModal();
      }
    });

    // 扫描模式切换：更新提示文案
    this._els.connectModal.querySelectorAll('input[name="scanMode"]').forEach((radio) => {
      radio.addEventListener('change', () => this._onModeChange());
    });

    // 清空最近设备
    this._els.clearRecentBtn.addEventListener('click', () => {
      BluetoothController.clearRecentDevices();
      this._renderRecentDevices();
    });

    // 开始扫描
    this._els.modalConfirm.addEventListener('click', async () => {
      // 1. 收集并校验 profile
      const profile = this._collectProfileFromUI();
      if (!profile) return; // 校验失败已在内部 _log

      // 2. 持久化 profile
      BluetoothController.setCurrentProfile(profile);
      BluetoothController.saveProfile(profile);

      // 3. 发起连接
      const mode = this._getSelectedMode();
      this._setModalLoading(true);
      this._hideModal();
      this._log(`● 开始扫描（设备类型: ${profile.label}, 模式: ${mode}）`, 'sys');
      await BluetoothController.pickAndConnect({ mode, serviceProfile: profile });
      this._setModalLoading(false);
    });
  },

  showModal() {
    this._renderRecentDevices();
    this._onModeChange(); // 初始化提示文案和输入框状态
    this._els.connectModal.classList.add('show');
    this._els.connectModal.setAttribute('aria-hidden', 'false');
  },

  _hideModal() {
    this._els.connectModal.classList.remove('show');
    this._els.connectModal.setAttribute('aria-hidden', 'true');
  },

  _getSelectedMode() {
    const checked = this._els.connectModal.querySelector('input[name="scanMode"]:checked');
    return checked ? checked.value : ScanMode.BY_SERVICE;
  },

  _onModeChange() {
    const mode = this._getSelectedMode();
    // 更新提示文案（用当前 profile.label 替换 {label} 占位符）
    const profile = BluetoothController.getCurrentProfile();
    const label = (profile && profile.label) || '所选服务';
    const template = MODE_HINTS[mode] || '';
    this._els.modeHint.textContent = template.replace(/\{label\}/g, label);
  },

  _renderRecentDevices() {
    const list = BluetoothController.getRecentDevices();
    const container = this._els.recentDevices;
    container.innerHTML = '';

    if (list.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'recent-empty';
      empty.textContent = '暂无最近连接的设备';
      container.appendChild(empty);
      return;
    }

    list.forEach((dev) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'recent-device-item';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'dev-name';
      nameSpan.textContent = dev.name || '(未命名设备)';

      const timeSpan = document.createElement('span');
      timeSpan.className = 'dev-time';
      timeSpan.textContent = this._formatTime(dev.at);

      item.appendChild(nameSpan);
      item.appendChild(timeSpan);

      // 点击最近设备：关闭 Modal 并用当前 profile 发起连接
      // （浏览器限制：仍会弹原生选择器，但已记忆设备便于用户重选）
      item.addEventListener('click', async () => {
        const profile = BluetoothController.getCurrentProfile();
        this._hideModal();
        this._log(`● 从最近列表连接: ${dev.name}（类型: ${profile.label}）`, 'sys');
        await BluetoothController.pickAndConnect({ mode: ScanMode.BY_SERVICE, serviceProfile: profile });
      });

      container.appendChild(item);
    });
  },

  _formatTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    if (isToday) {
      return `今天 ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
    }
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  },

  // ============ 设备类型（ServiceProfile）管理 ============

  _bindProfileSelector() {
    // select 切换：显示/隐藏自定义 UUID 输入框，更新 hint
    this._els.profileSelect.addEventListener('change', () => this._onProfileChange());

    // 自定义 UUID 输入框失焦时规范化
    [this._els.customServiceInput, this._els.customTxInput, this._els.customRxInput].forEach((inp) => {
      inp.addEventListener('blur', () => {
        if (inp.value.trim()) {
          inp.value = BluetoothController.normalizeUuid(inp.value);
        }
      });
    });
  },

  /**
   * 从 localStorage 加载 profile 回填到 UI
   */
  _loadProfileIntoUI() {
    const profile = BluetoothController.loadProfile();
    if (!profile) return;

    this._els.profileSelect.value = profile.id;

    if (profile.id === 'custom') {
      this._els.customProfileFields.style.display = 'block';
      this._els.customServiceInput.value = profile.service || '';
      this._els.customTxInput.value = profile.tx || '';
      this._els.customRxInput.value = profile.rx || '';
    } else {
      this._els.customProfileFields.style.display = 'none';
    }

    this._onProfileChange();
  },

  /**
   * select 切换时的 UI 更新
   */
  _onProfileChange() {
    const id = this._els.profileSelect.value;
    if (id === 'custom') {
      this._els.customProfileFields.style.display = 'block';
      this._els.profileHint.textContent = '手动输入 Service / TX / RX UUID（支持 16-bit 短串如 FFE0，自动扩展为 128-bit）';
      // 同步内存中的 profile，让扫描模式 hint 能显示
      const current = this._collectProfileFromUI(true);
      if (current) BluetoothController.setCurrentProfile(current);
    } else {
      this._els.customProfileFields.style.display = 'none';
      const preset = BluetoothController.findProfileById(id);
      if (preset) {
        this._els.profileHint.textContent = `${preset.label}：Service=${preset.service.slice(0, 13)}…`;
        BluetoothController.setCurrentProfile(preset);
      }
    }
    // 同步刷新扫描模式 hint（因为 {label} 占位符依赖当前 profile）
    this._onModeChange();
  },

  /**
   * 从 UI 收集 profile（用于点击"开始扫描"时）
   * @param {boolean} silent - true 时不输出错误日志（用于 UI 切换时的临时同步）
   * @returns {Object|null} 校验失败返回 null
   */
  _collectProfileFromUI(silent = false) {
    const id = this._els.profileSelect.value;

    if (id === 'custom') {
      const service = this._els.customServiceInput.value.trim();
      const tx = this._els.customTxInput.value.trim();
      const rx = this._els.customRxInput.value.trim();
      if (!service || !tx || !rx) {
        if (!silent) this._log('⚠ 自定义 UUID 需填写完整（Service / TX / RX 三项）', 'err');
        return null;
      }
      return {
        id: 'custom',
        label: '自定义 UUID',
        service: BluetoothController.normalizeUuid(service),
        tx: BluetoothController.normalizeUuid(tx),
        rx: BluetoothController.normalizeUuid(rx),
      };
    }

    const preset = BluetoothController.findProfileById(id);
    if (!preset) {
      if (!silent) this._log('⚠ 未知的设备类型，请重新选择', 'err');
      return null;
    }
    return preset;
  },

  // ============ 设备信息卡片 ============

  _renderDeviceInfo() {
    const dev = BluetoothController.getCurrentDevice();
    if (!dev) {
      this._els.deviceInfo.style.display = 'none';
      return;
    }
    this._els.devName.textContent = dev.name;
    // ID 较长，截断显示
    const idShort = dev.id.length > 20 ? dev.id.slice(0, 20) + '…' : dev.id;
    this._els.devId.textContent = idShort;
    this._els.devId.title = dev.id;
    this._els.deviceInfo.style.display = 'block';
  },

  // ============ 工具方法 ============

  _setButtonsEnabled(enabled) {
    ['btnOpen', 'btnClose', 'btnStop', 'btnOpening', 'btnClosing'].forEach((k) => {
      this._els[k].disabled = !enabled;
    });
  },

  _setModalLoading(loading) {
    const btn = this._els.modalConfirm;
    if (loading) {
      btn.disabled = true;
      btn.textContent = '连接中…';
      btn.style.opacity = '0.7';
    } else {
      btn.disabled = false;
      btn.textContent = '开始扫描';
      btn.style.opacity = '';
    }
  },

  _setConnectingButton(connecting) {
    const btn = this._els.btnConnect;
    if (connecting) {
      btn.disabled = true;
      btn.textContent = '连接中…';
    } else {
      // 根据当前连接状态恢复
      if (BluetoothController.isConnected()) {
        btn.textContent = '断开';
        btn.dataset.action = 'disconnect';
      } else {
        btn.textContent = '连接设备';
        btn.dataset.action = 'connect';
        btn.disabled = false;
      }
    }
  },

  _log(text, type = 'sys') {
    const div = document.createElement('div');
    div.className = `log-line log-${type}`;
    const time = new Date().toLocaleTimeString();
    div.textContent = `[${time}] ${text}`;
    this._els.logArea.appendChild(div);
    this._els.logArea.scrollTop = this._els.logArea.scrollHeight;
    // 限制最多 100 条
    while (this._els.logArea.children.length > 100) {
      this._els.logArea.removeChild(this._els.logArea.firstChild);
    }
  },

  _cacheElements() {
    this._els = {
      // Header
      btnConnect: document.getElementById('btnConnect'),
      statusDot: document.getElementById('statusDot'),
      statusText: document.getElementById('statusText'),
      // 主控 / 点动
      btnOpen: document.getElementById('btnOpen'),
      btnClose: document.getElementById('btnClose'),
      btnStop: document.getElementById('btnStop'),
      btnOpening: document.getElementById('btnOpening'),
      btnClosing: document.getElementById('btnClosing'),
      // 日志
      logArea: document.getElementById('logArea'),
      // 设备信息卡片
      deviceInfo: document.getElementById('deviceInfo'),
      devName: document.getElementById('devName'),
      devId: document.getElementById('devId'),
      // Modal
      connectModal: document.getElementById('connectModal'),
      modalCancel: document.getElementById('modalCancel'),
      modalConfirm: document.getElementById('modalConfirm'),
      modeHint: document.getElementById('modeHint'),
      recentDevices: document.getElementById('recentDevices'),
      clearRecentBtn: document.getElementById('clearRecentBtn'),
      // Profile 选择
      profileSelect: document.getElementById('profileSelect'),
      customProfileFields: document.getElementById('customProfileFields'),
      customServiceInput: document.getElementById('customServiceInput'),
      customTxInput: document.getElementById('customTxInput'),
      customRxInput: document.getElementById('customRxInput'),
      profileHint: document.getElementById('profileHint'),
    };
  },
};

if (typeof window !== 'undefined') {
  window.UI = UI;
}
