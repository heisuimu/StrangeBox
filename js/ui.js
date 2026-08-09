/**
 * UI 交互层
 *
 * 负责 DOM 事件绑定、按钮状态管理、日志显示。
 * 不直接调 navigator.bluetooth，全部通过 BluetoothController 暴露的方法。
 *
 * 点动按钮安全设计：
 * 1. 按下发 opening/closing，松开发 stop
 * 2. 处理 mouseleave / touchcancel / blur —— 手指滑出按钮也要发 stop
 * 3. 页面切后台（visibilitychange）自动发 stop
 * 4. 蓝牙断开时禁用所有按钮，记录本地 stop
 * 5. 防抖 150ms
 */

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
      this._els.btnConnect.textContent = '断开';
      this._els.btnConnect.dataset.action = 'disconnect';
      this._setButtonsEnabled(true);
    } else {
      this._els.btnConnect.textContent = '连接设备';
      this._els.btnConnect.dataset.action = 'connect';
      this._setButtonsEnabled(false);
      // 断开时主动发本地 stop 日志（防丢失）
      if (state === 'disconnected') {
        this._log('● 本地记录: stop (断连兜底)', 'sys');
      }
    }
  },

  // ============ 工具方法 ============

  _setButtonsEnabled(enabled) {
    ['btnOpen', 'btnClose', 'btnStop', 'btnOpening', 'btnClosing'].forEach((k) => {
      this._els[k].disabled = !enabled;
    });
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
      btnConnect: document.getElementById('btnConnect'),
      btnOpen: document.getElementById('btnOpen'),
      btnClose: document.getElementById('btnClose'),
      btnStop: document.getElementById('btnStop'),
      btnOpening: document.getElementById('btnOpening'),
      btnClosing: document.getElementById('btnClosing'),
      statusDot: document.getElementById('statusDot'),
      statusText: document.getElementById('statusText'),
      logArea: document.getElementById('logArea'),
    };
  },
};

if (typeof window !== 'undefined') {
  window.UI = UI;
}
