/**
 * CCTV Manager - Network Scanner
 * รองรับทั้งการสแกนผ่านเบราว์เซอร์โดยตรง และสแกนผ่าน Local Bridge
 */

class NetworkScanner {
  constructor() {
    this.bridgeUrl = localStorage.getItem(APP_CONFIG.STORAGE_KEYS.LOCAL_BRIDGE_URL) || APP_CONFIG.DEFAULT_LOCAL_BRIDGE_URL;
    this.isBridgeAvailable = false;
    this.isScanning = false;
    this.abortController = null;
  }

  setBridgeUrl(url) {
    this.bridgeUrl = (url || '').trim();
    localStorage.setItem(APP_CONFIG.STORAGE_KEYS.LOCAL_BRIDGE_URL, this.bridgeUrl);
  }

  // ตรวจสอบสถานะ Local Bridge
  async checkBridge() {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1500);
      const res = await fetch(`${this.bridgeUrl}/health`, {
        signal: controller.signal,
        mode: 'cors'
      });
      clearTimeout(timeoutId);
      if (res.ok) {
        const info = await res.json();
        this.isBridgeAvailable = true;
        return { available: true, info };
      }
    } catch (e) {
      this.isBridgeAvailable = false;
    }
    return { available: false };
  }

  // ดึง Subnet จากเครื่อง
  async getLocalSubnet() {
    if (this.isBridgeAvailable) {
      try {
        const res = await fetch(`${this.bridgeUrl}/network-info`);
        const data = await res.json();
        if (data.networks && data.networks.length > 0) {
          return data.networks[0].subnetPrefix;
        }
      } catch (e) {}
    }

    // WebRTC Local IP detection (ถ้าทำได้ในเบราว์เซอร์)
    return new Promise((resolve) => {
      let resolved = false;
      try {
        const pc = new (window.RTCPeerConnection || window.mozRTCPeerConnection || window.webkitRTCPeerConnection)({
          iceServers: []
        });
        pc.createDataChannel('');
        pc.createOffer().then(offer => pc.setLocalDescription(offer)).catch(() => {});
        pc.onicecandidate = (ice) => {
          if (!ice || !ice.candidate || !ice.candidate.candidate) return;
          const match = ice.candidate.candidate.match(/([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})\.[0-9]{1,3}/);
          if (match && !match[1].startsWith('127') && !resolved) {
            resolved = true;
            pc.close();
            resolve(match[1]);
          }
        };
        setTimeout(() => {
          if (!resolved) resolve('192.168.1');
        }, 1200);
      } catch (e) {
        resolve('192.168.1');
      }
    });
  }

  // สแกนผ่าน Local Bridge (TCP Port Scan + ARP + ONVIF)
  async scanViaBridge(subnetPrefix, start = 1, end = 254, onProgress = null) {
    if (onProgress) onProgress(10, 'กำลังเชื่อมต่อ Local Bridge...');
    try {
      // เรียก ONVIF Multicast ควบคู่
      const onvifPromise = fetch(`${this.bridgeUrl}/onvif-probe`).then(r => r.json()).catch(() => ({ devices: [] }));

      if (onProgress) onProgress(30, `กำลังสแกนพอร์ต CCTV (554, 80, 8000, 37777) ในวง ${subnetPrefix}.*...`);

      const res = await fetch(`${this.bridgeUrl}/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subnetPrefix: subnetPrefix,
          start: start,
          end: end,
          ports: [554, 80, 8000, 8080, 8899, 37777, 8554]
        })
      });

      if (!res.ok) throw new Error('Bridge scan failed');
      const scanData = await res.json();
      const onvifData = await onvifPromise;

      if (onProgress) onProgress(90, 'กำลังประมวลผลข้อมูลอุปกรณ์...');

      const results = (scanData.cameras || []).map(cam => {
        const onvifMatch = (onvifData.devices || []).find(d => d.ip === cam.ip);
        return {
          ip: cam.ip,
          openPorts: cam.openPorts || [],
          mac: cam.mac || '',
          brand: cam.brandGuess || 'Unknown Camera',
          isCctv: cam.isCctv,
          onvif: !!onvifMatch,
          discoverySource: 'local_bridge'
        };
      });

      if (onProgress) onProgress(100, `สแกนเสร็จสิ้น พบ ${results.length} อุปกรณ์`);
      return results;
    } catch (err) {
      console.error('Scan via bridge error:', err);
      throw err;
    }
  }

  // สแกนจากเบราว์เซอร์โดยตรง (Browser HTTP Fast Sweep)
  async scanViaBrowser(subnetPrefix, start = 1, end = 254, onProgress = null) {
    this.isScanning = true;
    this.abortController = new AbortController();

    const portsToProbe = [80, 8080, 8000, 81];
    const total = end - start + 1;
    let completed = 0;
    const foundDevices = [];

    const probeIp = async (ip) => {
      if (!this.isScanning) return;
      let isAlive = false;
      const detectedPorts = [];

      for (const port of portsToProbe) {
        if (!this.isScanning) break;
        const reached = await this.testBrowserEndpoint(ip, port, 400);
        if (reached) {
          isAlive = true;
          detectedPorts.push(port);
        }
      }

      if (isAlive) {
        const guess = this.guessBrowserDevice(detectedPorts);
        const device = {
          ip: ip,
          openPorts: detectedPorts,
          brand: guess,
          isCctv: detectedPorts.includes(8000) || detectedPorts.includes(80),
          discoverySource: 'browser_sweep'
        };
        foundDevices.push(device);
      }

      completed++;
      if (onProgress) {
        const pct = Math.round((completed / total) * 100);
        onProgress(pct, `กำลังสแกน ${ip} (${completed}/${total})...`, foundDevices);
      }
    };

    // Concurrency pool 15
    const queue = [];
    for (let i = start; i <= end; i++) {
      queue.push(`${subnetPrefix}.${i}`);
    }

    const concurrency = 15;
    const executing = [];
    for (const ip of queue) {
      if (!this.isScanning) break;
      const p = probeIp(ip).then(() => {
        executing.splice(executing.indexOf(p), 1);
      });
      executing.push(p);
      if (executing.length >= concurrency) {
        await Promise.race(executing);
      }
    }
    await Promise.all(executing);

    this.isScanning = false;
    return foundDevices;
  }

  testBrowserEndpoint(ip, port, timeoutMs = 400) {
    return new Promise((resolve) => {
      let done = false;
      const timer = setTimeout(() => {
        if (!done) {
          done = true;
          resolve(false);
        }
      }, timeoutMs);

      // ใช้ Image probe สำหรับ snapshot endpoints หรือ favicon
      const img = new Image();
      img.onload = () => {
        if (!done) {
          done = true;
          clearTimeout(timer);
          resolve(true);
        }
      };
      img.onerror = () => {
        // บางครั้งติด CORS/401 Unauthorized แต่หมายความว่า IP มีชีวิตอยู่จริง!
        if (!done) {
          done = true;
          clearTimeout(timer);
          resolve(true);
        }
      };

      try {
        img.src = `http://${ip}:${port}/favicon.ico?_t=${Date.now()}`;
      } catch (e) {
        if (!done) {
          done = true;
          clearTimeout(timer);
          resolve(false);
        }
      }
    });
  }

  guessBrowserDevice(ports) {
    if (ports.includes(8000)) return 'Hikvision / Hilook (Web/SDK)';
    if (ports.includes(81)) return 'ESP32-CAM / IP Camera';
    if (ports.includes(8080)) return 'IP Camera / Web Server';
    if (ports.includes(80)) return 'IP Camera / Web Device';
    return 'Network Camera';
  }

  stopScan() {
    this.isScanning = false;
    if (this.abortController) {
      this.abortController.abort();
    }
  }
}

window.networkScanner = new NetworkScanner();
