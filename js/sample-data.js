/*!
 * sample-data.js —— 内置示例题库
 * txt 用于页面上的「载入示例题库」；json 保留作格式参考，不再对外提供模板下载。
 */
(function (root) {
  'use strict';

  /* ---------- TXT 格式示例 ---------- */
  const SAMPLE_TXT = [
    '# 计算机网络基础 · 示例题库（TXT 格式）',
    '# 每道题之间用空行分隔；[单选]/[多选]/[判断]/[填空] 用来声明题型',
    '',
    '[单选]',
    '1. 在 OSI 七层参考模型中，负责为数据包选择路由的是哪一层？',
    'A. 物理层',
    'B. 数据链路层',
    'C. 网络层',
    'D. 传输层',
    '答案：C',
    '分值：5',
    '解析：网络层负责逻辑寻址与路由选择，典型设备是路由器；物理层传输比特流，数据链路层负责相邻节点之间的帧传输。',
    '',
    '2. HTTP 协议默认使用的端口号是？',
    'A. 21',
    'B. 25',
    'C. 80',
    'D. 443',
    '答案：C',
    '分值：5',
    '解析：HTTP 默认端口为 80，HTTPS 为 443，FTP 为 21，SMTP 为 25。',
    '',
    '3. 下列关于 IP 地址长度的说法，正确的是？',
    'A. IPv4 地址长度为 64 位',
    'B. IPv4 地址长度为 32 位',
    'C. IPv6 地址长度为 32 位',
    'D. IPv6 地址长度为 64 位',
    '答案：B',
    '分值：5',
    '解析：IPv4 使用 32 位地址，IPv6 扩展到 128 位。',
    '',
    '[多选]',
    '4. 下列属于 TCP 协议特点的是？',
    'A. 面向连接',
    'B. 提供可靠传输',
    'C. 无连接',
    'D. 提供流量控制',
    '答案：ABD',
    '分值：10',
    '解析：TCP 面向连接、可靠、有序，并提供流量控制与拥塞控制；无连接是 UDP 的特点。',
    '',
    '5. 以下属于应用层协议的有？',
    'A. DNS',
    'B. FTP',
    'C. IP',
    'D. SMTP',
    '答案：A、B、D',
    '分值：10',
    '解析：IP 属于网络层；DNS、FTP、SMTP 都工作在应用层。',
    '',
    '[判断]',
    '6. IP 地址 192.168.1.1 属于公网地址。',
    '答案：错误',
    '分值：5',
    '解析：192.168.0.0/16 属于私有地址段，不能在公网上直接路由。',
    '',
    '7. UDP 协议在发送数据前需要先建立连接。',
    '答案：错',
    '分值：5',
    '解析：UDP 是无连接协议，发送前不需要握手，因此开销小、延迟低，但不保证可靠到达。',
    '',
    '[填空]',
    '8. 在 TCP/IP 模型中，IPv4 地址长度为____位，IPv6 地址长度为____位。',
    '答案：32||128',
    '分值：10',
    '解析：IPv4 使用 32 位地址，IPv6 扩展到 128 位；两空需全部答对才得分。',
    '',
    '9. DNS 的主要作用是把域名解析为____。',
    '答案：IP地址|IP 地址',
    '分值：5',
    '解析：DNS（域名系统）负责域名与 IP 地址之间的映射，同一空可配置多个可接受答案。',
    '',
    '10. TCP 建立连接需要经过____次握手，断开连接需要经过____次挥手。',
    '答案：三||四',
    '分值：10',
    '解析：TCP 建立连接使用三次握手确认双方收发能力，断开连接使用四次挥手。'
  ].join('\n');

  /* ---------- JSON 格式示例 ---------- */
  const SAMPLE_JSON = {
    title: '计算机网络基础 · 示例题库（JSON 格式）',
    description: '演示 type / stem / options / answer / explanation / score 六个字段的写法',
    questions: [
      {
        type: 'single',
        stem: '在 OSI 七层参考模型中，负责端到端可靠传输的是哪一层？',
        options: ['A. 网络层', 'B. 传输层', 'C. 会话层', 'D. 数据链路层'],
        answer: 'B',
        explanation: '传输层（TCP）提供端到端的可靠传输；网络层负责路由，数据链路层负责相邻节点间的帧传输。',
        score: 5
      },
      {
        type: 'single',
        stem: 'HTTPS 协议默认使用的端口号是？',
        options: [
          { key: 'A', text: '21' },
          { key: 'B', text: '80' },
          { key: 'C', text: '443' },
          { key: 'D', text: '8080' }
        ],
        answer: 'C',
        explanation: 'HTTPS 默认端口为 443，HTTP 为 80，FTP 为 21。',
        score: 5
      },
      {
        type: 'multiple',
        stem: '下列属于 TCP 协议特点的是？',
        options: { A: '面向连接', B: '提供可靠传输', C: '无连接', D: '提供流量控制' },
        answer: ['A', 'B', 'D'],
        explanation: 'TCP 面向连接、可靠、有序，并提供流量控制与拥塞控制；无连接是 UDP 的特点。',
        score: 10
      },
      {
        type: 'multiple',
        stem: '以下属于应用层协议的有？',
        options: ['A. DNS', 'B. FTP', 'C. IP', 'D. SMTP'],
        answer: 'ABD',
        explanation: 'IP 属于网络层；DNS、FTP、SMTP 都工作在应用层。',
        score: 10
      },
      {
        type: 'judge',
        stem: '192.168.1.1 是一个可以在公网上直接路由的地址。',
        answer: false,
        explanation: '192.168.0.0/16 属于私有地址段，只能在局域网内使用。',
        score: 5
      },
      {
        type: 'judge',
        stem: 'UDP 协议在发送数据前需要先建立连接。',
        answer: '错误',
        explanation: 'UDP 是无连接协议，发送前不需要握手，开销小、延迟低，但不保证可靠到达。',
        score: 5
      },
      {
        type: 'blank',
        stem: '在 TCP/IP 模型中，IPv4 地址长度为____位，IPv6 地址长度为____位。',
        answer: [['32', '三十二'], ['128', '一百二十八']],
        explanation: 'IPv4 使用 32 位地址，IPv6 扩展到 128 位；括号内数值写法均可接受。',
        score: 10
      },
      {
        type: 'blank',
        stem: 'DNS 的主要作用是把域名解析为____。',
        answer: 'IP地址|IP 地址',
        explanation: 'DNS（域名系统）负责域名与 IP 地址之间的映射。',
        score: 5
      },
      {
        type: 'blank',
        stem: 'TCP 建立连接需要经过____次握手，断开连接需要经过____次挥手。',
        answer: ['三', '四'],
        explanation: 'TCP 建立连接使用三次握手确认双方收发能力，断开连接使用四次挥手。',
        score: 10
      },
      {
        type: 'single',
        stem: '下列哪种设备工作在网络层，用于连接不同的网络？',
        options: ['A. 集线器', 'B. 交换机', 'C. 路由器', 'D. 中继器'],
        answer: 'C',
        score: 5
      }
    ]
  };

  const api = { txt: SAMPLE_TXT, json: SAMPLE_JSON };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.QB_SAMPLES = api;
})(typeof window !== 'undefined' ? window : globalThis);
