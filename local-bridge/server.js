/**
 * CCTV Manager - Local CCTV Bridge & RTSP Relay
 * พอร์ต: 3880
 * ใช้โมดูลมาตรฐาน Node.js ทั้งหมด (Zero-dependency)
 */

const http = require('http');
const url = require('url');
const net = require('net');
const dgram = require('dgram');
const os = require('os');
const { exec, spawn } = require('child_process');

const PORT = 3880;

// OUI Prefixes สำหรับตรวจสอบยี่ห้อกล้องวงจรปิดจาก MAC Address
const MAC_VENDORS = {
  // Hikvision
  '44:19:B6': 'Hikvision', 'C0:56:E3': 'Hikvision', '10:DA:43': 'Hikvision',
  '40:22:D8': 'Hikvision', 'BC:AD:28': 'Hikvision', 'A4:14:37': 'Hikvision',
  // Dahua / IMOU
  '3C:EF:8C': 'Dahua', 'A0:BD:1D': 'Dahua', 'E0:50:8B': 'Dahua',
  '90:02:A9': 'Dahua', '4C:11:BF': 'Dahua', 'B4:A3:82': 'Dahua',
  // TP-Link (Tapo / Kasa)
  '50:C7:BF': 'TP-Link Tapo', 'AC:84:C6': 'TP-Link Tapo', 'B0:4E:26': 'TP-Link Tapo',
  '00:31:92': 'TP-Link Tapo', '30:DE:4B': 'TP-Link Tapo', '70:4F:57': 'TP-Link Tapo',
  // Uniview
  '6C:F1:7E': 'Uniview', '48:EA:63': 'Uniview',
  // Axis
  '00:40:8C': 'Axis', 'AC:CC:8E': 'Axis', 'B8:A4:4F': 'Axis',
  // Reolink
  'EC:71:DB': 'Reolink', '1C:49:7B': 'Reolink',
  // Espressif (ESP32-CAM)
  '24:0A:C4': 'ESP32-CAM', '30:AE:A4': 'ESP32-CAM', '24:6F:28': 'ESP32-CAM'
};

// ตรวจสอบว่าในเครื่องมี ffmpeg หรือไม่
let hasFfmpeg = false;
exec('ffmpeg -version', (err) => {
  hasFfmpeg = !err;
  console.log(`[Bridge] FFmpeg status: ${hasFfmpeg ? 'FOUND (RTSP relay ready)' : 'NOT FOUND (HTTP streams only, install FFmpeg for RTSP -> MJPEG)'}`);
});

function setCorsHeaders(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  // รองรับ Chrome Private Network Access (PNA)
  if (req.headers['access-control-request-private-network']) {
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
  }
}

function getLocalNetworkInfo() {
  const interfaces = os.networkInterfaces();
  const results = [];

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        const parts = iface.address.split('.');
        const subnetPrefix = `${parts[0]}.${parts[1]}.${parts[2]}`;
        results.push({
          interface: name,
          ip: iface.address,
          netmask: iface.netmask,
          subnetPrefix: subnetPrefix,
          suggestedRange: {
            start: `${subnetPrefix}.1`,
            end: `${subnetPrefix}.254`
          }
        });
      }
    }
  }
  return results;
}

function getArpTable() {
  return new Promise((resolve) => {
    const isWin = os.platform() === 'win32';
    exec(isWin ? 'arp -a' : 'arp -an', { timeout: 3000 }, (err, stdout) => {
      const map = {};
      if (err || !stdout) return resolve(map);

      const lines = stdout.split('\n');
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 2) {
          const ip = parts[0].replace(/[()]/g, '');
          let mac = parts[1].toUpperCase().replace(/-/g, ':');
          if (/^([0-9A-F]{2}[:-]){5}([0-9A-F]{2})$/.test(mac)) {
            map[ip] = mac;
          }
        }
      }
      resolve(map);
    });
  });
}

function guessBrand(mac, openPorts) {
  if (mac) {
    const prefix = mac.slice(0, 8).toUpperCase();
    if (MAC_VENDORS[prefix]) return MAC_VENDORS[prefix];
  }
  if (openPorts.includes(37777)) return 'Dahua / IMOU';
  if (openPorts.includes(8000) && openPorts.includes(554)) return 'Hikvision / Hilook';
  if (openPorts.includes(8899)) return 'ONVIF IP Camera';
  if (openPorts.includes(554)) return 'Generic RTSP CCTV';
  if (openPorts.includes(80) || openPorts.includes(8080)) return 'HTTP Web Camera';
  return 'Network Device';
}

function checkPort(host, port, timeout = 350) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let status = false;

    socket.setTimeout(timeout);
    socket.once('connect', () => {
      status = true;
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });

    try {
      socket.connect(port, host);
    } catch (e) {
      resolve(false);
    }
  });
}

async function scanHost(ip, ports, timeout = 350) {
  const openPorts = [];
  for (const port of ports) {
    const isOpen = await checkPort(ip, port, timeout);
    if (isOpen) {
      openPorts.push(port);
    }
  }
  return openPorts;
}

// ค้นหากล้องผ่าน ONVIF WS-Discovery (UDP Multicast)
function probeOnvif(timeoutMs = 2500) {
  return new Promise((resolve) => {
    const discovered = [];
    const client = dgram.createSocket('udp4');
    const probeMessage = Buffer.from(
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<Envelope xmlns:tds="http://www.onvif.org/ver10/device/wsdl" xmlns="http://www.w3.org/2003/05/soap-envelope">' +
      '<Header><wsa:MessageID xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing">uuid:' + Math.random().toString(36).slice(2) + '</wsa:MessageID>' +
      '<wsa:To xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing">urn:schemas-xmlsoap-org:ws:2005:04:discovery</wsa:To>' +
      '<wsa:Action xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing">http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</wsa:Action>' +
      '</Header><Body><Probe xmlns="http://schemas.xmlsoap.org/ws/2005/04/discovery">' +
      '<Types>tds:Device</Types></Probe></Body></Envelope>'
    );

    client.on('message', (msg, rinfo) => {
      const text = msg.toString();
      let xAddrs = '';
      const match = text.match(/<d:XAddrs>(.*?)<\/d:XAddrs>/i) || text.match(/XAddrs>(.*?)<\/.*XAddrs>/i);
      if (match) xAddrs = match[1];

      discovered.push({
        ip: rinfo.address,
        port: rinfo.port,
        xAddrs: xAddrs,
        type: 'ONVIF Device'
      });
    });

    client.bind(() => {
      client.setBroadcast(true);
      client.send(probeMessage, 0, probeMessage.length, 3702, '239.255.255.250', (err) => {
        if (err) console.error('[ONVIF] Probe error:', err.message);
      });
    });

    setTimeout(() => {
      try { client.close(); } catch (e) {}
      resolve(discovered);
    }, timeoutMs);
  });
}

// สร้าง HTTP Server
const server = http.createServer(async (req, res) => {
  setCorsHeaders(req, res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost:3880'}`);
  const pathname = parsedUrl.pathname;

  // Endpoint: Health & System Info
  if (pathname === '/health' || pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      service: 'CCTV Manager Local Bridge',
      version: '1.0.0',
      platform: os.platform(),
      hasFfmpeg: hasFfmpeg,
      time: new Date().toISOString()
    }));
    return;
  }

  // Endpoint: ข้อมูล Network ของเครื่อง
  if (pathname === '/network-info') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      networks: getLocalNetworkInfo()
    }));
    return;
  }

  // Endpoint: ONVIF Multicast Probe
  if (pathname === '/onvif-probe') {
    const devices = await probeOnvif(2000);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ devices }));
    return;
  }

  // Endpoint: สแกนพอร์ตกล้องในวงแลน
  if (pathname === '/scan' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const payload = body ? JSON.parse(body) : {};
        const prefix = payload.subnetPrefix || '192.168.1';
        const start = parseInt(payload.start, 10) || 1;
        const end = parseInt(payload.end, 10) || 254;
        const ports = payload.ports || [554, 80, 8000, 8080, 8899, 37777, 8554];

        const arpTable = await getArpTable();
        const results = [];

        // Concurrency limit 30 โฮสต์ต่อรอบ
        const concurrency = 30;
        const allIps = [];
        for (let i = start; i <= end; i++) {
          allIps.push(`${prefix}.${i}`);
        }

        for (let i = 0; i < allIps.length; i += concurrency) {
          const chunk = allIps.slice(i, i + concurrency);
          const chunkPromises = chunk.map(async (ip) => {
            const openPorts = await scanHost(ip, ports, 350);
            if (openPorts.length > 0) {
              const mac = arpTable[ip] || '';
              const brand = guessBrand(mac, openPorts);
              return {
                ip: ip,
                openPorts: openPorts,
                mac: mac,
                brandGuess: brand,
                isCctv: openPorts.includes(554) || openPorts.includes(8000) || openPorts.includes(8899) || openPorts.includes(37777)
              };
            }
            return null;
          });

          const chunkResults = await Promise.all(chunkPromises);
          for (const item of chunkResults) {
            if (item) results.push(item);
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'success',
          subnet: prefix,
          count: results.length,
          cameras: results
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'error', message: err.message }));
      }
    });
    return;
  }

  // Endpoint: แปลงสัญญาณ RTSP เป็น MJPEG Stream
  if (pathname === '/stream.mjpeg') {
    const rtspUrl = parsedUrl.searchParams.get('rtsp');
    if (!rtspUrl) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Missing ?rtsp= URL');
      return;
    }

    if (!hasFfmpeg) {
      res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('เครื่องนี้ยังไม่ได้ติดตั้ง FFmpeg เพื่อแปลง RTSP เป็น MJPEG กรุณาติดตั้ง FFmpeg ในระบบ หรือเปิดสตรีมผ่านโปรแกรมภายนอก');
      return;
    }

    const boundary = 'myboundary';
    res.writeHead(200, {
      'Content-Type': `multipart/x-mixed-replace; boundary=--${boundary}`,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Connection': 'close',
      'Pragma': 'no-cache'
    });

    const ffmpegArgs = [
      '-rtsp_transport', 'tcp',
      '-i', rtspUrl,
      '-an',
      '-q:v', '4',
      '-r', '15',
      '-f', 'mjpeg',
      '-'
    ];

    const child = spawn('ffmpeg', ffmpegArgs);

    child.stdout.on('data', (chunk) => {
      res.write(`--${boundary}\r\nContent-Type: image/jpeg\r\nContent-Length: ${chunk.length}\r\n\r\n`);
      res.write(chunk);
      res.write('\r\n');
    });

    child.stderr.on('data', () => {});

    child.on('close', () => {
      res.end();
    });

    req.on('close', () => {
      try {
        child.kill('SIGKILL');
      } catch (e) {}
    });
    return;
  }

  // Endpoint: ดึงภาพ Snapshot 1 เฟรมจาก RTSP หรือ HTTP
  if (pathname === '/snapshot') {
    const rtspUrl = parsedUrl.searchParams.get('rtsp');
    if (rtspUrl && hasFfmpeg) {
      res.writeHead(200, { 'Content-Type': 'image/jpeg' });
      const ffmpegArgs = [
        '-rtsp_transport', 'tcp',
        '-i', rtspUrl,
        '-frames:v', '1',
        '-q:v', '2',
        '-f', 'image2',
        '-'
      ];
      const child = spawn('ffmpeg', ffmpegArgs);
      child.stdout.pipe(res);
      child.on('error', () => {
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
      return;
    }

    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Snapshot unavailable');
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('====================================================');
  console.log(` CCTV Manager Local Bridge กำลังทำงานที่:`);
  console.log(` http://localhost:${PORT}`);
  console.log(` พร้อมรับคำสั่งสแกนเครือข่ายและแปลงสตรีม RTSP จาก GitHub Pages`);
  console.log('====================================================');
});
