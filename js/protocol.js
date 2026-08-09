/**
 * 指令协议层
 *
 * 纯逻辑模块：不依赖 DOM、不依赖 Web Bluetooth API。
 * 负责指令枚举定义、文本↔字节编解码、串口粘包/半包切分。
 *
 * 协议格式：ASCII 文本 + LF(\n) 结尾
 *   例：open\n / close\n / stop\n / opening\n / closing\n
 */

// 5 条指令枚举
const Command = Object.freeze({
  OPEN: 'open',
  CLOSE: 'close',
  STOP: 'stop',
  OPENING: 'opening',
  CLOSING: 'closing',
});

const LINE_ENDING = '\n';
const CHARSET = 'utf-8';

// 指令防抖间隔（毫秒）
const DEBOUNCE_MS = 150;

const Protocol = {
  Command,
  LINE_ENDING,
  CHARSET,
  DEBOUNCE_MS,

  /**
   * 编码指令为字节数组（含换行符）
   * @param {string} command Command 枚举值
   * @returns {Uint8Array}
   */
  encode(command) {
    const text = command + LINE_ENDING;
    return new TextEncoder().encode(text);
  },

  /**
   * 解析单行文本为指令（外设回传解析）
   * @param {string} line
   * @returns {string|null} Command 枚举值，未知指令返回 null
   */
  parse(line) {
    const trimmed = (line || '').trim().toLowerCase();
    if (!trimmed) return null;
    const valid = Object.values(Command);
    return valid.includes(trimmed) ? trimmed : null;
  },

  /**
   * 切分粘包/半包：从字节块中按 \n 拆出完整行
   * @param {Uint8Array} chunk
   * @param {string} prevBuffer 上次未完成的半行（外部维护状态）
   * @returns {{lines: string[], remain: string}}
   */
  splitLines(chunk, prevBuffer = '') {
    const text = prevBuffer + new TextDecoder().decode(chunk);
    const parts = text.split(LINE_ENDING);
    // 最后一段可能不完整（无 \n 结尾）
    const remain = parts.pop() || '';
    const lines = parts.filter((l) => l.trim().length > 0);
    return { lines, remain };
  },

  /**
   * 判断是否为点动指令
   */
  isMomentary(command) {
    return command === Command.OPENING || command === Command.CLOSING;
  },
};

// 浏览器环境暴露到全局（纯静态项目无模块系统）
if (typeof window !== 'undefined') {
  window.Protocol = Protocol;
}
