/**
 * CCTV Manager - Camera Player & Matrix Viewer
 * Version: 1.2.0 (Low-Latency & Explicit Socket Abort)
 */

class CameraPlayerManager {
  constructor() {
    this.layout = localStorage.getItem(APP_CONFIG.STORAGE_KEYS.LAYOUT) || '2x2'; // 1x1, 2x2, 3x3
    this.activeSlots = {}; // slotIndex -> cameraProfile
    this.snapshotTimers = {};
    this.streamWatchdogs = {};
    this.webcamStreams = {}; // slotIndex -> MediaStream
  }

  setLayout(layout) {
    this.stopAll();
    this.layout = layout;
    localStorage.setItem(APP_CONFIG.STORAGE_KEYS.LAYOUT, layout);
    this.renderMatrix();
    if (window.app && typeof window.app.autoPopulateGrid === 'function') {
      window.app.autoPopulateGrid();
    }
  }

  getSlotCount() {
    if (this.layout === '1x1') return 1;
    if (this.layout === '3x3') return 9;
    return 4; // default 2x2
  }

  // มอบหมายกล้องเข้าสู่ช่องใน Matrix
  assignCameraToSlot(slotIndex, camera) {
    this.stopSlot(slotIndex);
    this.activeSlots[slotIndex] = camera;
    this.renderSlot(slotIndex);
  }

  // ถอดกล้องออกจากช่อง
  removeCameraFromSlot(slotIndex) {
    this.stopSlot(slotIndex);
    delete this.activeSlots[slotIndex];
    this.renderSlot(slotIndex);
  }

  // สร้างโครงสร้าง Grid Matrix ทั้งหมด
  renderMatrix() {
    const container = document.getElementById('cameraGrid');
    if (!container) return;

    container.className = `camera-grid layout-${this.layout}`;
    container.innerHTML = '';

    const count = this.getSlotCount();
    for (let i = 0; i < count; i++) {
      const slotEl = document.createElement('div');
      slotEl.className = 'grid-slot';
      slotEl.id = `slot-${i}`;
      container.appendChild(slotEl);
      this.renderSlot(i);
    }
  }

  // วาดและเปิดวิดีโอในช่องที่กำหนด
  renderSlot(slotIndex) {
    const slotEl = document.getElementById(`slot-${slotIndex}`);
    if (!slotEl) return;

    const camera = this.activeSlots[slotIndex];

    if (!camera) {
      slotEl.innerHTML = `
        <div class="empty-slot">
          <div class="empty-icon"><i class="fas fa-video-slash"></i></div>
          <div class="empty-text">ช่อง ${slotIndex + 1}: ยังไม่มีการเลือกกล้อง</div>
          <button class="btn btn-sm btn-outline-primary mt-2" onclick="app.openSelectCameraModal(${slotIndex})">
            <i class="fas fa-plus"></i> เลือกกล้องมาเปิดที่นี่
          </button>
        </div>
      `;
      return;
    }

    const bridgeAvailable = window.networkScanner && window.networkScanner.isBridgeAvailable;
    const bridgeUrl = (window.networkScanner && window.networkScanner.bridgeUrl) || APP_CONFIG.DEFAULT_LOCAL_BRIDGE_URL;

    let mediaContent = '';
    let streamNotice = '';
    const isWebcam = camera.streamType === 'webcam' || (camera.brand && camera.brand.includes('Webcam')) || camera.httpUrl === 'webcam:local';

    // 1. โหมดกล้องหน้าโน้ตบุ๊ก (Notebook Webcam)
    if (isWebcam) {
      mediaContent = `<video id="video-slot-${slotIndex}" class="camera-stream-video" autoplay playsinline muted></video>`;
      streamNotice = '<span class="badge badge-success"><i class="fas fa-laptop"></i> Notebook Webcam</span>';
      this.initWebcamStream(slotIndex);
    }
    // 2. โหมดกล้อง RTSP ผ่าน Local Bridge Relay (Low-Latency Stream Hub)
    else if (camera.rtspUrl && bridgeAvailable) {
      const scaleParam = (this.layout === '3x3') ? 640 : 960;
      const fpsParam = (camera.streamType === 'sub') ? 25 : 20;
      const streamSrc = `${bridgeUrl}/stream.mjpeg?rtsp=${encodeURIComponent(camera.rtspUrl)}&scale=${scaleParam}&fps=${fpsParam}&q=5&slot=${slotIndex}`;
      mediaContent = `<img id="stream-img-${slotIndex}" src="${streamSrc}" class="camera-stream-img" alt="${camera.name}" onload="playerManager.handleStreamLoaded(${slotIndex})" onerror="playerManager.handleStreamError(${slotIndex})" />`;
      
      const isSub = (camera.streamType === 'sub' || (camera.rtspUrl && camera.rtspUrl.includes('stream2')));
      streamNotice = `
        <span id="badge-slot-${slotIndex}" class="badge ${isSub ? 'badge-success' : 'badge-info'}">
          <i class="fas fa-bolt"></i> ${isSub ? 'SD ลื่นไหล' : 'HD คมชัด'}
        </span>
      `;
      
      // ตั้ง Watchdog ตรวจสอบว่ามีภาพเข้ามาจริงภายใน 4 วินาทีหรือไม่
      this.startStreamWatchdog(slotIndex, camera);
    }
    // 3. HLS Stream
    else if (camera.httpUrl && (camera.httpUrl.endsWith('.m3u8') || camera.streamType === 'hls')) {
      mediaContent = `<video id="video-slot-${slotIndex}" class="camera-stream-video" autoplay muted playsinline controls></video>`;
      streamNotice = `<span class="badge badge-info"><i class="fas fa-film"></i> HLS</span>`;
    }
    // 4. HTTP MJPEG Stream
    else if (camera.httpUrl && (camera.httpUrl.includes('mjpg') || camera.httpUrl.includes('stream') || camera.streamType === 'mjpeg')) {
      mediaContent = `<img src="${camera.httpUrl}" class="camera-stream-img" alt="${camera.name}" onerror="playerManager.handleStreamError(${slotIndex})" />`;
      streamNotice = `<span class="badge badge-info"><i class="fas fa-play"></i> MJPEG</span>`;
    }
    // 5. Fallback: Snapshot หรือปุ่มเปิดภายนอก
    else {
      const snapshotUrl = camera.httpUrl || (camera.rtspUrl && bridgeAvailable ? `${bridgeUrl}/snapshot?rtsp=${encodeURIComponent(camera.rtspUrl)}` : '');
      if (snapshotUrl) {
        mediaContent = `<img id="snap-slot-${slotIndex}" src="${snapshotUrl}" class="camera-stream-img" alt="${camera.name}" />`;
        streamNotice = '<span class="badge badge-warning"><i class="fas fa-camera"></i> Snapshot</span>';
        this.startSnapshotPolling(slotIndex, snapshotUrl);
      } else {
        mediaContent = `
          <div class="empty-slot">
            <div class="empty-icon text-warning"><i class="fas fa-video"></i></div>
            <div class="font-weight-bold text-light">${camera.name}</div>
            <div class="text-muted small">${camera.ip} (${camera.brand || 'RTSP'})</div>
            <div class="alert alert-dark p-2 mt-2 small text-left" style="font-size:12px;">
              <i class="fas fa-info-circle text-info"></i> ต้องเปิด Local Bridge เพื่อแปลงสัญญาณ RTSP สด
            </div>
            <div class="btn-group mt-1">
              <a href="vlc://${camera.rtspUrl}" class="btn btn-sm btn-primary" title="เปิดใน VLC">
                <i class="fas fa-play"></i> เปิดด้วย VLC
              </a>
              <button class="btn btn-sm btn-outline-secondary" onclick="app.copyRtspUrl('${camera.id}')" title="คัดลอก RTSP URL">
                <i class="fas fa-copy"></i> คัดลอก RTSP
              </button>
            </div>
          </div>
        `;
      }
    }

    const isSubStream = (camera.streamType === 'sub' || (camera.rtspUrl && (camera.rtspUrl.includes('stream2') || camera.rtspUrl.includes('102') || camera.rtspUrl.includes('subtype=1'))));

    slotEl.innerHTML = `
      <div class="slot-header">
        <div class="slot-title">
          <span id="dot-slot-${slotIndex}" class="status-dot online"></span>
          <strong>${camera.name}</strong>
          <span class="text-muted small ml-1">(${camera.ip || 'Local'})</span>
          ${streamNotice}
        </div>
        <div class="slot-actions">
          ${camera.rtspUrl ? `
            <button class="btn btn-xs ${isSubStream ? 'btn-success' : 'btn-outline-info'} mr-1" onclick="app.toggleSlotQuality(${slotIndex})" title="สลับความละเอียด HD / SD (ลื่นไหล)">
              ${isSubStream ? '<i class="fas fa-feather-alt"></i> SD ลื่น' : '<i class="fas fa-film"></i> HD'}
            </button>
          ` : ''}
          <button class="btn-icon" onclick="app.captureSlotSnapshot(${slotIndex})" title="บันทึกภาพนิ่ง"><i class="fas fa-camera"></i></button>
          <button class="btn-icon" onclick="app.toggleSlotFullscreen(${slotIndex})" title="เต็มจอ"><i class="fas fa-expand"></i></button>
          <button class="btn-icon" onclick="playerManager.removeCameraFromSlot(${slotIndex})" title="ปิดช่องนี้"><i class="fas fa-times"></i></button>
        </div>
      </div>
      <div class="slot-media" id="media-slot-${slotIndex}">
        ${mediaContent}
      </div>
      <div class="slot-footer">
        <span class="badge badge-secondary">${camera.brand || 'CCTV'}</span>
        <span class="text-muted small">${camera.group || 'Default'}</span>
        <button class="btn-link-action ml-auto" onclick="app.openEditCameraModal('${camera.id}')">
          <i class="fas fa-cog"></i> ตั้งค่า
        </button>
      </div>
    `;

    // ถ้าเป็น HLS Video ให้ Initialize
    if (camera.httpUrl && camera.httpUrl.endsWith('.m3u8')) {
      const videoEl = document.getElementById(`video-slot-${slotIndex}`);
      if (videoEl && window.Hls && Hls.isSupported()) {
        const hls = new Hls();
        hls.loadSource(camera.httpUrl);
        hls.attachMedia(videoEl);
      }
    }
  }

  // เริ่มสตรีมกล้องหน้าโน้ตบุ๊กผ่าน HTML5 WebRTC getUserMedia
  async initWebcamStream(slotIndex) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false
      });
      this.webcamStreams[slotIndex] = stream;
      const videoEl = document.getElementById(`video-slot-${slotIndex}`);
      if (videoEl) {
        videoEl.srcObject = stream;
        videoEl.play().catch(e => console.warn(e));
      }
    } catch (err) {
      console.warn('Webcam getUserMedia failed, trying bridge:', err);
      const bridgeUrl = (window.networkScanner && window.networkScanner.bridgeUrl) || APP_CONFIG.DEFAULT_LOCAL_BRIDGE_URL;
      const mediaSlot = document.getElementById(`media-slot-${slotIndex}`);
      if (mediaSlot) {
        mediaSlot.innerHTML = `<img src="${bridgeUrl}/stream.mjpeg?type=webcam&scale=960&fps=20&q=5&_t=${Date.now()}" class="camera-stream-img" alt="Notebook Webcam" />`;
      }
    }
  }

  startStreamWatchdog(slotIndex, camera) {
    if (this.streamWatchdogs[slotIndex]) clearTimeout(this.streamWatchdogs[slotIndex]);
    this.streamWatchdogs[slotIndex] = setTimeout(() => {
      const img = document.getElementById(`stream-img-${slotIndex}`);
      if (img && (!img.complete || img.naturalWidth === 0)) {
        this.handleStreamError(slotIndex);
      }
    }, 4500);
  }

  handleStreamLoaded(slotIndex) {
    if (this.streamWatchdogs[slotIndex]) {
      clearTimeout(this.streamWatchdogs[slotIndex]);
      delete this.streamWatchdogs[slotIndex];
    }
    const dot = document.getElementById(`dot-slot-${slotIndex}`);
    if (dot) dot.className = 'status-dot online';
  }

  handleStreamError(slotIndex) {
    if (this.streamWatchdogs[slotIndex]) {
      clearTimeout(this.streamWatchdogs[slotIndex]);
      delete this.streamWatchdogs[slotIndex];
    }

    const dot = document.getElementById(`dot-slot-${slotIndex}`);
    if (dot) dot.className = 'status-dot offline';

    const badge = document.getElementById(`badge-slot-${slotIndex}`);
    if (badge) {
      badge.className = 'badge badge-danger';
      badge.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Stream Offline';
    }

    const camera = this.activeSlots[slotIndex];
    const mediaSlot = document.getElementById(`media-slot-${slotIndex}`);
    if (!mediaSlot || !camera) return;

    const isLocalMachine = (camera.ip === '127.0.0.1' || camera.ip === 'localhost');

    mediaSlot.innerHTML = `
      <div class="empty-slot p-3 text-center">
        <div class="text-danger mb-2"><i class="fas fa-exclamation-circle fa-2x"></i></div>
        <h6 class="text-danger font-weight-bold mb-1">ภาพสดไม่แสดง (Stream Offline)</h6>
        <div class="small text-muted mb-2">
          ไม่สามารถเชื่อมต่อ <strong>${camera.name || camera.ip}</strong> (${camera.ip})
        </div>
        <div id="diag-box-${slotIndex}" class="small alert alert-secondary p-2 mb-2 text-left" style="font-size:11px;">
          <i class="fas fa-spinner fa-spin"></i> กำลังตรวจสอบสัญญาณเครือข่ายและรหัสผ่านกล้อง...
        </div>
        <div class="btn-group btn-group-sm flex-wrap justify-content-center">
          <button class="btn btn-primary" onclick="app.openEditCameraModal('${camera.id}')">
            <i class="fas fa-key"></i> ใส่ Username / Password กล้อง
          </button>
          <button class="btn btn-outline-info" onclick="app.diagnoseSlot(${slotIndex})">
            <i class="fas fa-sync"></i> ตรวจสอบอีกครั้ง
          </button>
          ${isLocalMachine ? `
            <button class="btn btn-warning" onclick="app.switchToWebcam('${camera.id}', ${slotIndex})" title="หากเครื่องนี้คือโน้ตบุ๊กของคุณ">
              <i class="fas fa-video"></i> สลับเป็นกล้องโน้ตบุ๊ก
            </button>
          ` : ''}
        </div>
      </div>
    `;

    setTimeout(() => {
      if (window.app && typeof window.app.diagnoseSlot === 'function') {
        window.app.diagnoseSlot(slotIndex);
      }
    }, 150);
  }

  startSnapshotPolling(slotIndex, url) {
    if (this.snapshotTimers[slotIndex]) clearInterval(this.snapshotTimers[slotIndex]);
    this.snapshotTimers[slotIndex] = setInterval(() => {
      const img = document.getElementById(`snap-slot-${slotIndex}`);
      if (img) {
        const sep = url.includes('?') ? '&' : '?';
        img.src = `${url}${sep}_t=${Date.now()}`;
      }
    }, 2000);
  }

  // สั่งตัดการเชื่อมต่อ Socket และเคลียร์ Memory ทันที
  stopSlot(slotIndex) {
    if (this.snapshotTimers[slotIndex]) {
      clearInterval(this.snapshotTimers[slotIndex]);
      delete this.snapshotTimers[slotIndex];
    }
    if (this.streamWatchdogs[slotIndex]) {
      clearTimeout(this.streamWatchdogs[slotIndex]);
      delete this.streamWatchdogs[slotIndex];
    }
    if (this.webcamStreams[slotIndex]) {
      try {
        this.webcamStreams[slotIndex].getTracks().forEach(track => track.stop());
      } catch (e) {}
      delete this.webcamStreams[slotIndex];
    }

    // ตัดการเชื่อมต่อ HTTP Multipart Stream ทันทีเพื่อไม่ให้ค้างโปรเซส FFmpeg
    const slotEl = document.getElementById(`slot-${slotIndex}`);
    if (slotEl) {
      const img = slotEl.querySelector('img.camera-stream-img');
      if (img) {
        img.onload = null;
        img.onerror = null;
        img.removeAttribute('src');
        img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
      }
      const vid = slotEl.querySelector('video');
      if (vid) {
        try {
          vid.pause();
          vid.removeAttribute('src');
          vid.load();
        } catch (e) {}
      }
    }
  }

  stopAll() {
    const count = this.getSlotCount();
    for (let i = 0; i < count; i++) {
      this.stopSlot(i);
    }
    this.activeSlots = {};
  }
}

window.playerManager = new CameraPlayerManager();
