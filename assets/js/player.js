/**
 * CCTV Manager - Camera Player & Matrix Viewer
 */

class CameraPlayerManager {
  constructor() {
    this.layout = localStorage.getItem(APP_CONFIG.STORAGE_KEYS.LAYOUT) || '2x2'; // 1x1, 2x2, 3x3
    this.activeSlots = {}; // slotIndex -> cameraProfile
    this.snapshotTimers = {};
  }

  setLayout(layout) {
    this.layout = layout;
    localStorage.setItem(APP_CONFIG.STORAGE_KEYS.LAYOUT, layout);
    this.renderMatrix();
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

    // ตรวจสอบรูปแบบการสตรีม
    if (camera.rtspUrl && bridgeAvailable) {
      // โหมดสตรีมผ่าน Local Bridge (FFmpeg RTSP -> MJPEG)
      const streamSrc = `${bridgeUrl}/stream.mjpeg?rtsp=${encodeURIComponent(camera.rtspUrl)}`;
      mediaContent = `<img src="${streamSrc}" class="camera-stream-img" alt="${camera.name}" onerror="app.handleStreamError(${slotIndex})" />`;
      streamNotice = '<span class="badge badge-success"><i class="fas fa-bolt"></i> Bridge Relay</span>';
    } else if (camera.httpUrl && (camera.httpUrl.endsWith('.m3u8') || camera.streamType === 'hls')) {
      // HLS Stream
      mediaContent = `<video id="video-slot-${slotIndex}" class="camera-stream-video" autoplay muted playsinline controls></video>`;
      streamNotice = '<span class="badge badge-info"><i class="fas fa-film"></i> HLS</span>';
    } else if (camera.httpUrl && (camera.httpUrl.includes('mjpg') || camera.httpUrl.includes('stream') || camera.streamType === 'mjpeg')) {
      // HTTP MJPEG Stream
      mediaContent = `<img src="${camera.httpUrl}" class="camera-stream-img" alt="${camera.name}" onerror="app.handleStreamError(${slotIndex})" />`;
      streamNotice = '<span class="badge badge-info"><i class="fas fa-play"></i> MJPEG</span>';
    } else {
      // Fallback: แสดงการแจ้งเตือนและ Snapshot Auto-Refresh หรือ External Player Launch
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
              <i class="fas fa-info-circle text-info"></i> กล้อง RTSP ต้องการ Local Bridge หรือโปรแกรมภายนอกเพื่อเปิดดู
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

    slotEl.innerHTML = `
      <div class="slot-header">
        <div class="slot-title">
          <span class="status-dot online"></span>
          <strong>${camera.name}</strong>
          <span class="text-muted small ml-1">(${camera.ip})</span>
          ${streamNotice}
        </div>
        <div class="slot-actions">
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

  stopSlot(slotIndex) {
    if (this.snapshotTimers[slotIndex]) {
      clearInterval(this.snapshotTimers[slotIndex]);
      delete this.snapshotTimers[slotIndex];
    }
  }

  stopAll() {
    Object.keys(this.snapshotTimers).forEach(slotIndex => this.stopSlot(slotIndex));
  }
}

window.playerManager = new CameraPlayerManager();
