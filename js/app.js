/**
 * 应用入口
 *
 * 组装 UI 与蓝牙模块，绑定连接按钮。
 * 业务逻辑在 ui.js / bluetooth.js，本文件只做"接线"。
 */

document.addEventListener('DOMContentLoaded', () => {
  UI.init();

  const btnConnect = document.getElementById('btnConnect');

  // 浏览器兼容性预检
  if (!BluetoothController.isSupported()) {
    document.getElementById('statusText').textContent =
      '浏览器不支持 Web Bluetooth，请用 Chrome / Edge';
    document.getElementById('statusDot').style.background = '#c33';
    btnConnect.disabled = true;
    return;
  }

  btnConnect.addEventListener('click', async () => {
    const action = btnConnect.dataset.action || 'connect';
    if (action === 'disconnect') {
      BluetoothController.disconnect();
    } else {
      await BluetoothController.pickAndConnect();
    }
  });
});
