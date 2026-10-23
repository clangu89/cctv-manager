/**
 * CCTV Manager - Local CCTV Bridge & RTSP Relay
 * Version: 1.2.0 (Low-Latency Stream Hub)
 * พอร์ต: 3880
 * ใช้โมดูลมาตรฐาน Node.js ทั้งหมด (Zero-dependency)
 */

const http = require('http');
const net = require('net');
const dgram = require('dgram');
const os = require('os');
const { exec, spawn } = require('child_process');

const PORT = 3880;

// OUI Prefixes สำหรับตรวจสอบยี่ห้อกล้องวงจรปิดจาก MAC Address
const MAC_VENDORS = {
  // TP-Link (Tapo / Kasa)
  'B0:19:21': 'TP-Link Tapo', 'B0:95:75': 'TP-Link Tapo', '18:D6:C7': 'TP-Link Tapo',
  'D8:47:32': 'TP-Link Tapo', 'EC:08:6B': 'TP-Link Tapo', '54:AF:97': 'TP-Link Tapo',
  'A8:42:A1': 'TP-Link Tapo', 'CC:32:E5': 'TP-Link Tapo',
  '50:C7:BF': 'TP-Link Tapo', 'AC:84:C6': 'TP-Link Tapo', 'B0:4E:26': 'TP-Link Tapo',
  '00:31:92': 'TP-Link Tapo', '30:DE:4B': 'TP-Link Tapo', '70:4F:57': 'TP-Link Tapo',
  // Hikvision
  '44:19:B6': 'Hikvision', 'C0:56:E3': 'Hikvision', '10:DA:43': 'Hikvision',
  '40:22:D8': 'Hikvision', 'BC:AD:28': 'Hikvision', 'A4:14:37': 'Hikvision',
  // Dahua / IMOU
  '3C:EF:8C': 'Dahua', 'A0:BD:1D': 'Dahua', 'E0:50:8B': 'Dahua',
  '90:02:A9': 'Dahua', '4C:11:BF': 'Dahua', 'B4:A3:82': 'Dahua',
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
  console.log(`[Bridge] FFmpeg status: ${hasFfmpeg ? 'FOUND (Low-latency ready)' : 'NOT FOUND'}`);
});

function setCorsHeaders(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
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
      '<wsa:Action xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing">http://schemas.xmlsoap.org/ws/2005:04:discovery/Probe</wsa:Action>' +
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

// ค้นหากล้อง DirectShow (Webcam) ในเครื่อง
function getAvailableWebcams() {
  return new Promise((resolve) => {
    if (os.platform() !== 'win32' || !hasFfmpeg) {
      return resolve([]);
    }
    exec('ffmpeg -list_devices true -f dshow -i dummy 2>&1', { timeout: 3500 }, (err, stdout, stderr) => {
      const output = (stdout || '') + (stderr || '');
      const devices = [];
      const regex = /"([^"]+)"\s+\(video\)/g;
      let match;
      while ((match = regex.exec(output)) !== null) {
        if (!devices.includes(match[1])) {
          devices.push(match[1]);
        }
      }
      resolve(devices);
    });
  });
}

// ทดสอบความพร้อมของสตรีม RTSP/HTTP
function probeStreamConnection(streamUrl, timeoutMs = 4000) {
  return new Promise((resolve) => {
    if (!hasFfmpeg) {
      return resolve({ success: false, error: 'ไม่พบ FFmpeg ในระบบ' });
    }

    const args = streamUrl.startsWith('rtsp')
      ? ['-rtsp_transport', 'tcp', '-i', streamUrl, '-t', '2', '-frames:v', '1', '-f', 'null', '-']
      : ['-i', streamUrl, '-t', '2', '-frames:v', '1', '-f', 'null', '-'];

    const child = spawn('ffmpeg', args);
    let stderr = '';
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch (e) {}
      resolve({ success: false, error: 'การเชื่อมต่อหมดเวลา (Timeout 4s) ตรวจสอบว่า IP และ Port 554 ถูกต้อง' });
    }, timeoutMs);

    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (stderr.includes('Video:') || code === 0) {
        const resMatch = stderr.match(/([0-9]{3,4}x[0-9]{3,4})/);
        resolve({
          success: true,
          resolution: resMatch ? resMatch[1] : 'Unknown',
          message: 'เชื่อมต่อและดึงสัญญาณภาพสำเร็จ'
        });
      } else {
        let cleanError = 'ไม่สามารถเชื่อมต่อสัญญาณภาพได้';
        if (stderr.includes('Connection refused')) {
          cleanError = 'Connection refused: ปลายทางไม่ได้เปิดพอร์ต RTSP หรือ IP ไม่ถูกต้อง';
        } else if (stderr.includes('401 Unauthorized') || stderr.includes('Authentication failed')) {
          cleanError = '401 Unauthorized: รหัสผ่านไม่ถูกต้อง (สำหรับกล้อง Tapo ต้องใช้ "Camera Account" ที่สร้างในแอป Tapo ไม่ใช่อีเมลบัญชี TP-Link)';
        } else if (stderr.includes('404 Not Found') || stderr.includes('Invalid data')) {
          cleanError = 'Stream path ไม่ถูกต้อง (สำหรับ Tapo แนะนำใช้ /stream1 หรือ /stream2)';
        } else if (stderr.includes('No route to host') || stderr.includes('Network is unreachable')) {
          cleanError = 'ไม่พบอุปกรณ์ที่ IP นี้ในวงแลน';
        }
        resolve({ success: false, error: cleanError, raw: stderr.slice(-300) });
      }
    });
  });
}

// =========================================================================
// STREAM HUB: จัดการสตรีม FFmpeg 1 โปรเซสต่อกล้อง + Latest-Frame Dropper
// =========================================================================
const BOUNDARY = 'myboundary';
const activeStreams = new Map(); // key -> StreamEntry

function killProcessTree(pid) {
  if (!pid) return;
  if (os.platform() === 'win32') {
    exec(`taskkill /pid ${pid} /T /F`, () => {});
  } else {
    try { process.kill(-pid, 'SIGKILL'); } catch (e) {
      try { process.kill(pid, 'SIGKILL'); } catch (e2) {}
    }
  }
}

function getOrCreateStream(key, isWebcam, rtspUrl, deviceName, scaleWidth = 960, fps = 20, quality = 5) {
  if (activeStreams.has(key)) {
    const entry = activeStreams.get(key);
    if (entry.cleanupTimer) {
      clearTimeout(entry.cleanupTimer);
      entry.cleanupTimer = null;
    }
    return entry;
  }

  let ffmpegArgs = [];
  if (isWebcam) {
    ffmpegArgs = [
      '-f', 'dshow',
      '-i', `video=${deviceName}`,
      '-an',
      '-vf', `scale=${scaleWidth}:-2`,
      '-q:v', `${quality}`,
      '-r', `${fps}`,
      '-f', 'mjpeg',
      '-'
    ];
  } else {
    ffmpegArgs = [
      '-fflags', 'nobuffer',
      '-flags', 'low_delay',
      '-rtsp_transport', 'tcp',
      '-probesize', '32768',
      '-analyzeduration', '500000',
      '-i', rtspUrl,
      '-an',
      '-vf', `scale=${scaleWidth}:-2`,
      '-q:v', `${quality}`,
      '-r', `${fps}`,
      '-f', 'mjpeg',
      '-'
    ];
  }

  const child = spawn('ffmpeg', ffmpegArgs);
  const entry = {
    key: key,
    child: child,
    clients: new Set(),
    lastFrame: null,
    cleanupTimer: null
  };

  activeStreams.set(key, entry);
  console.log(`[StreamHub] Started new FFmpeg PID=${child.pid} for ${key.slice(0, 40)}... (scale=${scaleWidth}, fps=${fps})`);

  let buffer = Buffer.alloc(0);

  child.stdout.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);

    while (true) {
      const soi = buffer.indexOf(Buffer.from([0xFF, 0xD8]));
      if (soi === -1) {
        buffer = Buffer.alloc(0);
        break;
      }

      const eoi = buffer.indexOf(Buffer.from([0xFF, 0xD9]), soi + 2);
      if (eoi === -1) {
        if (soi > 0) {
          buffer = buffer.slice(soi);
        }
        break;
      }

      const jpegFrame = buffer.slice(soi, eoi + 2);
      buffer = buffer.slice(eoi + 2);
      entry.lastFrame = jpegFrame;

      // Broadcast เฟรมไปยังผู้ชมทุกคน
      const header = `--${BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpegFrame.length}\r\n\r\n`;
      for (const clientRes of entry.clients) {
        // BACKPRESSURE: ถ้า Socket ติดคิวสะสม ให้ทิ้งเฟรมนี้เพื่อไม่ให้ภาพดีเลย์
        if (clientRes.writableLength > 32768 || clientRes.writableNeedDrain) {
          continue;
        }
        try {
          clientRes.write(header);
          clientRes.write(jpegFrame);
          clientRes.write('\r\n');
        } catch (err) {
          entry.clients.delete(clientRes);
        }
      }
    }
  });

  child.stderr.on('data', () => {});

  child.on('close', (code) => {
    console.log(`[StreamHub] FFmpeg closed PID=${child.pid} code=${code}`);
    for (const clientRes of entry.clients) {
      try { clientRes.end(); } catch (e) {}
    }
    activeStreams.delete(key);
  });

  return entry;
}

function removeClientFromStream(entry, res) {
  entry.clients.delete(res);
  if (entry.clients.size === 0) {
    if (entry.cleanupTimer) clearTimeout(entry.cleanupTimer);
    entry.cleanupTimer = setTimeout(() => {
      if (entry.clients.size === 0) {
        console.log(`[StreamHub] Cleaning up idle stream PID=${entry.child ? entry.child.pid : 'N/A'}`);
        if (entry.child) {
          killProcessTree(entry.child.pid);
        }
        activeStreams.delete(entry.key);
      }
    }, 2000);
  }
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
      version: '1.2.0',
      platform: os.platform(),
      hasFfmpeg: hasFfmpeg,
      activeStreamsCount: activeStreams.size,
      time: new Date().toISOString()
    }));
    return;
  }

  // Endpoint: รายชื่อกล้องเว็บแคมในเครื่อง
  if (pathname === '/webcams') {
    const webcams = await getAvailableWebcams();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'success', webcams: webcams }));
    return;
  }

  // Endpoint: ทดสอบการเชื่อมต่อสตรีม
  if (pathname === '/probe-stream') {
    const testUrl = parsedUrl.searchParams.get('url');
    if (!testUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Missing ?url= parameter' }));
      return;
    }
    const result = await probeStreamConnection(testUrl);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
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

  // Endpoint: แปลงสัญญาณ RTSP / Webcam เป็น MJPEG Stream แบบ Low-Latency Stream Hub
  if (pathname === '/stream.mjpeg') {
    const isWebcam = parsedUrl.searchParams.get('type') === 'webcam';
    const deviceName = parsedUrl.searchParams.get('device') || 'Integrated Camera';
    const rtspUrl = parsedUrl.searchParams.get('rtsp');
    const scaleWidth = parseInt(parsedUrl.searchParams.get('scale'), 10) || 960;
    const fps = parseInt(parsedUrl.searchParams.get('fps'), 10) || 20;
    const quality = parseInt(parsedUrl.searchParams.get('q'), 10) || 5;

    if (!isWebcam && !rtspUrl) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Missing ?rtsp= URL or ?type=webcam');
      return;
    }

    if (!hasFfmpeg) {
      res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('เครื่องนี้ยังไม่ได้ติดตั้ง FFmpeg');
      return;
    }

    const streamKey = isWebcam ? `webcam:${deviceName}` : rtspUrl;
    const entry = getOrCreateStream(streamKey, isWebcam, rtspUrl, deviceName, scaleWidth, fps, quality);

    res.writeHead(200, {
      'Content-Type': `multipart/x-mixed-replace; boundary=--${BOUNDARY}`,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Connection': 'close',
      'Pragma': 'no-cache'
    });

    entry.clients.add(res);

    // ส่งเฟรมล่าสุดทันที (Instant First Frame)
    if (entry.lastFrame) {
      try {
        res.write(`--${BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${entry.lastFrame.length}\r\n\r\n`);
        res.write(entry.lastFrame);
        res.write('\r\n');
      } catch (e) {}
    }

    const cleanup = () => {
      removeClientFromStream(entry, res);
    };

    req.on('close', cleanup);
    res.on('close', cleanup);
    return;
  }

  // Endpoint: ดึงภาพ Snapshot 1 เฟรมจาก RTSP หรือ HTTP
  if (pathname === '/snapshot') {
    const isWebcam = parsedUrl.searchParams.get('type') === 'webcam';
    const deviceName = parsedUrl.searchParams.get('device') || 'Integrated Camera';
    const rtspUrl = parsedUrl.searchParams.get('rtsp');

    // ถ้ามีเฟรมล่าสุดใน Stream Hub ให้ส่งคืนได้ทันทีโดยไม่ต้องเรียก FFmpeg ซ้ำ
    const streamKey = isWebcam ? `webcam:${deviceName}` : rtspUrl;
    if (activeStreams.has(streamKey) && activeStreams.get(streamKey).lastFrame) {
      res.writeHead(200, { 'Content-Type': 'image/jpeg' });
      res.end(activeStreams.get(streamKey).lastFrame);
      return;
    }

    if ((isWebcam || rtspUrl) && hasFfmpeg) {
      res.writeHead(200, { 'Content-Type': 'image/jpeg' });
      const ffmpegArgs = isWebcam
        ? ['-f', 'dshow', '-i', `video=${deviceName}`, '-frames:v', '1', '-q:v', '2', '-f', 'image2', '-']
        : ['-rtsp_transport', 'tcp', '-i', rtspUrl, '-frames:v', '1', '-q:v', '2', '-f', 'image2', '-'];

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

// ดักจับ Shutdown เพื่อเคลียร์ FFmpeg ทั้งหมด
function handleShutdown() {
  console.log('[Bridge] Shutting down, cleaning all streams...');
  for (const [key, entry] of activeStreams) {
    if (entry.child) killProcessTree(entry.child.pid);
  }
  process.exit(0);
}
process.on('SIGINT', handleShutdown);
process.on('SIGTERM', handleShutdown);

server.listen(PORT, '0.0.0.0', () => {
  console.log('====================================================');
  console.log(` CCTV Manager Local Bridge v1.2.0 (Stream Hub)`);
  console.log(` http://localhost:${PORT}`);
  console.log(` Low-latency FFmpeg with Latest-Frame Dropper Ready`);
  console.log('====================================================');
});
