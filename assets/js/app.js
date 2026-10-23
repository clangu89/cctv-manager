/**
 * CCTV Manager - Main Application Controller
 */

class CCTVApp {
  constructor() {
    this.cameras = [];
    this.currentFilter = 'all';
    this.searchTerm = '';
    this.discoveredDevices = [];
  }

  async init() {
    console.log(`[CCTV Manager] Initializing v${APP_CONFIG.VERSION}...`);

    // ตรวจสอบสถานะ Local Bridge
    await this.checkBridgeStatus();

    // ดึง Subnet สำหรับช่องสแกน
    const subnet = await window.networkScanner.getLocalSubnet();
    const subnetInput = document.getElementById('scanSubnet');
    if (subnetInput) subnetInput.value = subnet;

    // โหลดรายการกล้องจาก Google Apps Script / Cache
    await this.loadCameras();

    // เริ่มต้น Matrix Viewer
    window.playerManager.renderMatrix();

    // เติมกล้องช่องแรกๆ อัตโนมัติถ้ามี
    this.autoPopulateGrid();

    // ผูกเหตุการณ์ Form เปลี่ยนยี่ห้อกล้อง -> Auto generate URL
    this.bindBrandSelectEvent();

    // เริ่มการตรวจสอบ Bridge เป็นระยะ
    setInterval(() => this.checkBridgeStatus(true), 15000);
  }

  async checkBridgeStatus(silent = false) {
    const res = await window.networkScanner.checkBridge();
    const badge = document.getElementById('bridgeStatusBadge');
    const notice = document.getElementById('bridgeBanner');

    if (res.available) {
      if (badge) {
        badge.className = 'badge badge-success';
        badge.innerHTML = `<i class="fas fa-check-circle"></i> Bridge Online (${res.info.hasFfmpeg ? 'FFmpeg Ready' : 'No FFmpeg'})`;
      }
      if (notice) notice.style.display = 'none';
    } else {
      if (badge) {
        badge.className = 'badge badge-warning';
        badge.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Browser Direct Mode';
      }
      if (notice && !silent) notice.style.display = 'block';
    }
  }

  async loadCameras() {
    const res = await window.gasApi.listCameras();
    this.cameras = res.data || [];
    this.renderCameraList();
    this.updateStats();

    const gasBadge = document.getElementById('gasStatusBadge');
    if (gasBadge) {
      if (res.source === 'cloud') {
        gasBadge.className = 'badge badge-success';
        gasBadge.innerHTML = '<i class="fas fa-cloud"></i> Google Sheets Synced';
      } else {
        gasBadge.className = 'badge badge-secondary';
        gasBadge.innerHTML = '<i class="fas fa-hdd"></i> Local Storage Active';
      }
    }
  }

  autoPopulateGrid() {
    const count = window.playerManager.getSlotCount();
    for (let i = 0; i < count; i++) {
      if (this.cameras[i]) {
        window.playerManager.assignCameraToSlot(i, this.cameras[i]);
      }
    }
  }

  updateStats() {
    const totalEl = document.getElementById('totalCamerasCount');
    if (totalEl) totalEl.innerText = this.cameras.length;

    const favCount = this.cameras.filter(c => c.favorite).length;
    const favEl = document.getElementById('favCamerasCount');
    if (favEl) favEl.innerText = favCount;
  }

  // วาดรายการโปรไฟล์กล้องใน Sidebar / List View
  renderCameraList() {
    const container = document.getElementById('cameraListContainer');
    if (!container) return;

    let filtered = this.cameras.filter(c => {
      const matchSearch = (c.name || '').toLowerCase().includes(this.searchTerm.toLowerCase()) ||
                          (c.ip || '').includes(this.searchTerm) ||
                          (c.group || '').toLowerCase().includes(this.searchTerm.toLowerCase());
      if (this.currentFilter === 'favorite') return matchSearch && c.favorite;
      if (this.currentFilter !== 'all') return matchSearch && c.group === this.currentFilter;
      return matchSearch;
    });

    if (filtered.length === 0) {
      container.innerHTML = `
        <div class="text-center text-muted p-4">
          <i class="fas fa-video fa-2x mb-2"></i>
          <div>ยังไม่มีรายการกล้องที่บันทึกไว้</div>
          <button class="btn btn-sm btn-primary mt-2" onclick="app.openAddCameraModal()">
            <i class="fas fa-plus"></i> เพิ่มโปรไฟล์กล้อง
          </button>
        </div>
      `;
      return;
    }

    container.innerHTML = filtered.map(cam => `
      <div class="camera-card ${cam.favorite ? 'is-fav' : ''}" data-id="${cam.id}">
        <div class="camera-card-body">
          <div class="d-flex align-items-center justify-content-between">
            <h6 class="camera-name text-truncate mb-0">
              <span class="status-indicator"></span>
              ${cam.name}
            </h6>
            <button class="btn-icon star-btn ${cam.favorite ? 'active' : ''}" onclick="app.toggleFavorite('${cam.id}')" title="รายการโปรด">
              <i class="fas fa-star"></i>
            </button>
          </div>
          <div class="camera-meta mt-1">
            <span class="badge badge-dark">${cam.brand || 'CCTV'}</span>
            <span class="text-muted small">${cam.ip}</span>
            <span class="badge badge-outline-secondary small">${cam.group || 'Default'}</span>
          </div>
        </div>
        <div class="camera-card-actions">
          <button class="btn btn-xs btn-success" onclick="app.playInFirstAvailableSlot('${cam.id}')" title="เปิดดูใน Grid">
            <i class="fas fa-play"></i> เปิดดู
          </button>
          <button class="btn btn-xs btn-outline-info" onclick="app.openEditCameraModal('${cam.id}')" title="แก้ไข">
            <i class="fas fa-edit"></i>
          </button>
          <button class="btn btn-xs btn-outline-danger" onclick="app.deleteCamera('${cam.id}')" title="ลบ">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </div>
    `).join('');
  }

  // เล่นกล้องในช่องที่ยังว่าง หรือช่องแรก
  playInFirstAvailableSlot(cameraId) {
    const cam = this.cameras.find(c => c.id === cameraId);
    if (!cam) return;

    const count = window.playerManager.getSlotCount();
    let targetSlot = 0;
    for (let i = 0; i < count; i++) {
      if (!window.playerManager.activeSlots[i]) {
        targetSlot = i;
        break;
      }
    }
    window.playerManager.assignCameraToSlot(targetSlot, cam);
    this.showToast(`กำลังเปิดกล้อง "${cam.name}" ในช่อง ${targetSlot + 1}`);
  }

  // ระบบสแกนเครือข่าย
  async startScan() {
    const subnet = (document.getElementById('scanSubnet').value || '192.168.1').trim();
    const start = parseInt(document.getElementById('scanStart').value, 10) || 1;
    const end = parseInt(document.getElementById('scanEnd').value, 10) || 254;
    const mode = document.getElementById('scanMode').value; // 'auto', 'bridge', 'browser'

    const btn = document.getElementById('startScanBtn');
    const stopBtn = document.getElementById('stopScanBtn');
    const progressBar = document.getElementById('scanProgressBar');
    const progressStatus = document.getElementById('scanProgressStatus');
    const resultsContainer = document.getElementById('scanResultsContainer');

    btn.style.display = 'none';
    stopBtn.style.display = 'inline-block';
    if (progressBar) progressBar.style.width = '0%';
    if (resultsContainer) resultsContainer.innerHTML = '<div class="text-muted p-3">กำลังค้นหาอุปกรณ์...</div>';

    this.discoveredDevices = [];

    const onProgress = (pct, text, currentList) => {
      if (progressBar) progressBar.style.width = `${pct}%`;
      if (progressStatus) progressStatus.innerText = text;
      if (currentList && currentList.length > 0) {
        this.renderDiscoveredList(currentList);
      }
    };

    try {
      const useBridge = (mode === 'bridge') || (mode === 'auto' && window.networkScanner.isBridgeAvailable);
      let found = [];

      if (useBridge) {
        found = await window.networkScanner.scanViaBridge(subnet, start, end, onProgress);
      } else {
        found = await window.networkScanner.scanViaBrowser(subnet, start, end, onProgress);
      }

      this.discoveredDevices = found;
      this.renderDiscoveredList(found);
      this.showToast(`สแกนเสร็จสิ้น พบกล้องและอุปกรณ์ ${found.length} รายการ`, 'success');
    } catch (err) {
      this.showToast(`การสแกนเกิดข้อผิดพลาด: ${err.message}`, 'error');
    } finally {
      btn.style.display = 'inline-block';
      stopBtn.style.display = 'none';
    }
  }

  stopScan() {
    window.networkScanner.stopScan();
    this.showToast('หยุดการสแกนแล้ว');
  }

  renderDiscoveredList(devices) {
    const container = document.getElementById('scanResultsContainer');
    if (!container) return;

    if (!devices || devices.length === 0) {
      container.innerHTML = '<div class="text-muted p-3 text-center">ไม่พบอุปกรณ์กล้องในช่วง IP นี้</div>';
      return;
    }

    container.innerHTML = `
      <div class="d-flex justify-content-between align-items-center mb-2">
        <span class="font-weight-bold">พบทั้งหมด ${devices.length} รายการ</span>
        <button class="btn btn-xs btn-primary" onclick="app.saveAllDiscovered()">
          <i class="fas fa-save"></i> บันทึกทั้งหมดลง Google Sheets
        </button>
      </div>
      <div class="table-responsive">
        <table class="table table-sm table-dark table-hover mb-0">
          <thead>
            <tr>
              <th>IP Address</th>
              <th>ยี่ห้อ / อุปกรณ์</th>
              <th>พอร์ตที่เปิด</th>
              <th>สถานะ</th>
              <th class="text-right">การจัดการ</th>
            </tr>
          </thead>
          <tbody>
            ${devices.map((d, idx) => `
              <tr>
                <td><strong>${d.ip}</strong></td>
                <td><span class="badge ${d.isCctv ? 'badge-primary' : 'badge-secondary'}">${d.brand}</span></td>
                <td><code>${(d.openPorts || []).join(', ')}</code></td>
                <td><span class="status-dot online"></span> พร้อมเชื่อมต่อ</td>
                <td class="text-right">
                  <button class="btn btn-xs btn-success" onclick="app.quickAddCamera(${idx})">
                    <i class="fas fa-plus"></i> บันทึกโปรไฟล์
                  </button>
                  <button class="btn btn-xs btn-outline-info" onclick="app.testDiscoveredCam(${idx})">
                    <i class="fas fa-play"></i> ทดลองเปิด
                  </button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  // เพิ่มกล้องจากการสแกนทันที
  async quickAddCamera(index) {
    const dev = this.discoveredDevices[index];
    if (!dev) return;

    let brandKey = this.detectBrandKey(dev.brand);
    if (dev.mac && dev.mac.toUpperCase().startsWith('B0:19:21')) brandKey = 'tapo';
    if (dev.ip === '192.168.1.3') brandKey = 'tapo';

    // ถ้าเป็นกล้อง CCTV ที่ต้องมีรหัสผ่าน ให้เปิด Modal เพื่อให้กรอก Username/Password
    if (dev.isCctv && brandKey !== 'notebook_webcam') {
      const brandInfo = APP_CONFIG.BRAND_TEMPLATES[brandKey] || APP_CONFIG.BRAND_TEMPLATES['tapo'];
      this.openAddCameraModal({
        name: brandKey === 'tapo' ? `กล้อง Tapo (${dev.ip})` : `${brandInfo.name} (${dev.ip})`,
        ip: dev.ip,
        brand: brandKey,
        port: dev.openPorts.includes(80) ? 80 : 80,
        rtspPort: 554,
        username: '',
        password: ''
      });
      this.showToast(`กรุณากรอก Username/Password ของกล้อง ${dev.ip} ก่อนบันทึกนะคะ`, 'info');
      return;
    }

    const brandInfo = APP_CONFIG.BRAND_TEMPLATES[brandKey] || APP_CONFIG.BRAND_TEMPLATES['hikvision'];

    const newCam = {
      name: `${brandInfo.name} (${dev.ip})`,
      brand: brandInfo.name,
      ip: dev.ip,
      port: dev.openPorts.includes(80) ? 80 : (dev.openPorts[0] || 80),
      rtspPort: dev.openPorts.includes(554) ? 554 : 554,
      username: 'admin',
      password: '',
      channel: '1',
      streamType: 'main',
      group: 'Default',
      favorite: false
    };

    newCam.rtspUrl = brandInfo.buildRtspUrl(newCam);
    newCam.httpUrl = brandInfo.buildSnapshotUrl ? brandInfo.buildSnapshotUrl(newCam) : '';

    await window.gasApi.saveCamera(newCam);
    await this.loadCameras();
    this.showToast(`บันทึกโปรไฟล์ ${newCam.name} สำเร็จแล้ว`, 'success');
  }

  async saveAllDiscovered() {
    if (!this.discoveredDevices || this.discoveredDevices.length === 0) return;
    for (let i = 0; i < this.discoveredDevices.length; i++) {
      await this.quickAddCamera(i);
    }
    this.showToast(`บันทึกกล้องทั้งหมด ${this.discoveredDevices.length} ตัวเรียบร้อยแล้ว`, 'success');
  }

  testDiscoveredCam(index) {
    const dev = this.discoveredDevices[index];
    if (!dev) return;
    this.openAddCameraModal({
      ip: dev.ip,
      brand: this.detectBrandKey(dev.brand)
    });
  }

  detectBrandKey(brandText) {
    const text = (brandText || '').toLowerCase();
    if (text.includes('notebook') || text.includes('webcam') || text.includes('integrated')) return 'notebook_webcam';
    if (text.includes('hikvision') || text.includes('hilook')) return 'hikvision';
    if (text.includes('dahua') || text.includes('imou')) return 'dahua';
    if (text.includes('tapo') || text.includes('tp-link')) return 'tapo';
    if (text.includes('uniview') || text.includes('unv')) return 'uniview';
    if (text.includes('esp32')) return 'esp32';
    return 'generic_rtsp';
  }

  // Modal จัดการโปรไฟล์กล้อง
  openAddCameraModal(prefill = {}) {
    document.getElementById('cameraModalTitle').innerText = 'เพิ่มโปรไฟล์กล้องใหม่';
    document.getElementById('cameraIdInput').value = '';
    document.getElementById('camNameInput').value = prefill.name || '';
    document.getElementById('camBrandSelect').value = prefill.brand || 'hikvision';
    document.getElementById('camIpInput').value = prefill.ip || '';
    document.getElementById('camPortInput').value = prefill.port || '80';
    document.getElementById('camRtspPortInput').value = prefill.rtspPort || '554';
    document.getElementById('camUserInput').value = prefill.username || 'admin';
    document.getElementById('camPassInput').value = prefill.password || '';
    document.getElementById('camChannelInput').value = prefill.channel || '1';
    document.getElementById('camStreamSelect').value = prefill.streamType || 'main';
    document.getElementById('camGroupInput').value = prefill.group || 'Default';
    document.getElementById('camRtspUrlInput').value = prefill.rtspUrl || '';
    document.getElementById('camHttpUrlInput').value = prefill.httpUrl || '';

    this.updateGeneratedUrls();
    $('#cameraModal').modal('show');
  }

  openEditCameraModal(id) {
    const cam = this.cameras.find(c => c.id === id);
    if (!cam) return;

    let brandKey = this.detectBrandKey(cam.brand);
    if (cam.ip === '192.168.1.3' || (cam.rtspUrl && cam.rtspUrl.includes('stream1'))) {
      brandKey = 'tapo';
    }

    document.getElementById('cameraModalTitle').innerText = `แก้ไขโปรไฟล์: ${cam.name}`;
    document.getElementById('cameraIdInput').value = cam.id;
    document.getElementById('camNameInput').value = cam.name || '';
    document.getElementById('camBrandSelect').value = brandKey;
    document.getElementById('camIpInput').value = cam.ip || '';
    document.getElementById('camPortInput').value = cam.port || '80';
    document.getElementById('camRtspPortInput').value = cam.rtspPort || '554';
    document.getElementById('camUserInput').value = cam.username || '';
    document.getElementById('camPassInput').value = cam.password || '';
    document.getElementById('camChannelInput').value = cam.channel || '1';
    document.getElementById('camStreamSelect').value = cam.streamType || 'main';
    document.getElementById('camGroupInput').value = cam.group || 'Default';
    document.getElementById('camRtspUrlInput').value = cam.rtspUrl || '';
    document.getElementById('camHttpUrlInput').value = cam.httpUrl || '';

    this.updateGeneratedUrls();
    $('#cameraModal').modal('show');
  }

  bindBrandSelectEvent() {
    const inputs = ['camBrandSelect', 'camIpInput', 'camPortInput', 'camRtspPortInput', 'camUserInput', 'camPassInput', 'camChannelInput', 'camStreamSelect'];
    inputs.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', () => this.updateGeneratedUrls());
    });
  }

  updateGeneratedUrls() {
    const brand = document.getElementById('camBrandSelect').value;
    const template = APP_CONFIG.BRAND_TEMPLATES[brand];
    if (!template) return;

    // แสดงคำแนะนำการตั้งค่าบัญชีกล้อง Tapo
    const tapoBanner = document.getElementById('tapoGuideBanner');
    if (tapoBanner) {
      tapoBanner.style.display = (brand === 'tapo') ? 'block' : 'none';
    }

    if (brand === 'notebook_webcam') {
      const ipInput = document.getElementById('camIpInput');
      if (!ipInput.value || ipInput.value === '192.168.1.100') ipInput.value = '127.0.0.1';
      document.getElementById('camPortInput').value = '0';
      document.getElementById('camRtspPortInput').value = '0';
      document.getElementById('camStreamSelect').value = 'main';
      document.getElementById('camRtspUrlInput').value = '';
      document.getElementById('camHttpUrlInput').value = 'webcam:local';
      return;
    }

    const dummy = {
      ip: document.getElementById('camIpInput').value || '192.168.1.100',
      port: document.getElementById('camPortInput').value || template.defaultPort,
      rtspPort: document.getElementById('camRtspPortInput').value || template.defaultRtspPort,
      username: document.getElementById('camUserInput').value,
      password: document.getElementById('camPassInput').value,
      channel: document.getElementById('camChannelInput').value || '1',
      streamType: document.getElementById('camStreamSelect').value || 'main'
    };

    const rtspInput = document.getElementById('camRtspUrlInput');
    const httpInput = document.getElementById('camHttpUrlInput');

    if (template.buildRtspUrl) rtspInput.value = template.buildRtspUrl(dummy);
    if (template.buildSnapshotUrl) httpInput.value = template.buildSnapshotUrl(dummy);
    if (template.buildHttpUrl) httpInput.value = template.buildHttpUrl(dummy);
  }

  // ทดสอบการเชื่อมต่อสตรีมจาก Modal
  async testCameraConnection() {
    const brand = document.getElementById('camBrandSelect').value;
    const rtspUrl = document.getElementById('camRtspUrlInput').value.trim();
    const resultBox = document.getElementById('camTestResultBox');
    const btn = document.getElementById('testConnBtn');

    if (!resultBox) return;
    resultBox.style.display = 'block';
    resultBox.className = 'mt-3 p-2 small alert alert-info';
    resultBox.innerHTML = '<i class="fas fa-spinner fa-spin"></i> กำลังทดสอบการเชื่อมต่อ...';

    if (btn) btn.disabled = true;

    try {
      // 1. ถ้าเป็นกล้องโน้ตบุ๊ก
      if (brand === 'notebook_webcam') {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: true });
          stream.getTracks().forEach(t => t.stop());
          resultBox.className = 'mt-3 p-2 small alert alert-success';
          resultBox.innerHTML = '<i class="fas fa-check-circle"></i> ตรวจพบกล้องหน้าโน้ตบุ๊ก (Integrated Webcam) พร้อมใช้งาน 100%';
        } catch (e) {
          resultBox.className = 'mt-3 p-2 small alert alert-danger';
          resultBox.innerHTML = `<i class="fas fa-times-circle"></i> เบราว์เซอร์ไม่ได้รับอนุญาตให้เข้าถึงกล้องหน้า: ${e.message}`;
        }
        return;
      }

      // 2. ถ้าเป็นกล้อง RTSP/CCTV
      if (!rtspUrl) {
        resultBox.className = 'mt-3 p-2 small alert alert-warning';
        resultBox.innerHTML = 'กรุณาระบุหรือสร้าง RTSP URL ก่อนทำการทดสอบ';
        return;
      }

      const bridgeUrl = (window.networkScanner && window.networkScanner.bridgeUrl) || APP_CONFIG.DEFAULT_LOCAL_BRIDGE_URL;
      const res = await fetch(`${bridgeUrl}/probe-stream?url=${encodeURIComponent(rtspUrl)}`);
      const data = await res.json();

      if (data.success) {
        resultBox.className = 'mt-3 p-2 small alert alert-success';
        resultBox.innerHTML = `<i class="fas fa-check-circle"></i> เชื่อมต่อสำเร็จ! ความละเอียด: ${data.resolution || 'HD'}`;
      } else {
        resultBox.className = 'mt-3 p-2 small alert alert-danger';
        resultBox.innerHTML = `<i class="fas fa-times-circle"></i> <strong>ทดสอบไม่สำเร็จ:</strong> ${data.error || 'ไม่สามารถติดต่อกล้องได้'}`;
      }
    } catch (err) {
      resultBox.className = 'mt-3 p-2 small alert alert-warning';
      resultBox.innerHTML = `<i class="fas fa-exclamation-triangle"></i> ไม่สามารถเรียก Local Bridge เพื่อทดสอบได้: ${err.message}`;
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // วินิจฉัยข้อผิดพลาดของช่องที่ภาพไม่ขึ้น
  async diagnoseSlot(slotIndex) {
    const camera = window.playerManager.activeSlots[slotIndex];
    if (!camera) return;

    const box = document.getElementById(`diag-box-${slotIndex}`);
    if (!box) return;

    box.style.display = 'block';
    box.innerHTML = '<i class="fas fa-spinner fa-spin"></i> กำลังตรวจสอบสัญญาณเครือข่ายและพอร์ต 554...';

    const bridgeUrl = (window.networkScanner && window.networkScanner.bridgeUrl) || APP_CONFIG.DEFAULT_LOCAL_BRIDGE_URL;
    try {
      if (!camera.rtspUrl) {
        box.innerHTML = '⚠️ กล้องนี้ไม่มี RTSP URL กรุณากดปุ่ม "แก้ไข IP" เพื่อกรอก URL';
        return;
      }

      const res = await fetch(`${bridgeUrl}/probe-stream?url=${encodeURIComponent(camera.rtspUrl)}`);
      const data = await res.json();

      if (data.success) {
        box.className = 'small alert alert-success p-2 mb-2 text-left';
        box.innerHTML = `<strong>ผลการตรวจ:</strong> กล้องส่งสัญญาณปกติ (${data.resolution}) กำลังรีเฟรชช่อง...`;
        setTimeout(() => window.playerManager.renderSlot(slotIndex), 1000);
      } else {
        box.className = 'small alert alert-danger p-2 mb-2 text-left';
        if (data.error && (data.error.includes('401') || data.error.includes('Unauthorized') || data.error.includes('Authentication') || data.error.includes('รหัสผ่าน'))) {
          box.innerHTML = `
            <strong><i class="fas fa-lock text-warning"></i> ${data.error}</strong>
            <div class="mt-2 text-light" style="font-size:11px;">
              💡 <strong>วิธีดูรหัสผ่านกล้อง Tapo:</strong><br>
              1. เปิดแอป <strong>Tapo</strong> ในมือถือ<br>
              2. กดเลือกกล้อง &gt; ไอคอนฟันเฟือง ⚙️ (มุมขวาบน)<br>
              3. เลือก <strong>การตั้งค่าขั้นสูง (Advanced Settings)</strong> &gt; <strong>บัญชีผู้ใช้กล้อง (Camera Account)</strong><br>
              4. ดูหรือสร้าง Username และ Password แล้วกดปุ่มสีน้ำเงินด้านล่างเพื่อนำมากรอกค่ะ
            </div>
          `;
        } else {
          box.innerHTML = `<strong>สาเหตุ:</strong> ${data.error}`;
        }
      }
    } catch (e) {
      box.className = 'small alert alert-warning p-2 mb-2 text-left';
      box.innerHTML = `ไม่สามารถเชื่อมต่อ Local Bridge ได้: ${e.message}`;
    }
  }

  // สลับโปรไฟล์เป็นกล้องหน้าโน้ตบุ๊กทันที
  async switchToWebcam(cameraId, slotIndex) {
    const cam = this.cameras.find(c => c.id === cameraId) || { id: cameraId };
    cam.name = 'กล้องหน้าโน้ตบุ๊ก';
    cam.brand = 'กล้องหน้าโน้ตบุ๊ก (Notebook Webcam)';
    cam.streamType = 'webcam';
    cam.httpUrl = 'webcam:local';
    cam.rtspUrl = '';
    cam.ip = '127.0.0.1';

    await window.gasApi.saveCamera(cam);
    await this.loadCameras();
    window.playerManager.assignCameraToSlot(slotIndex, cam);
    this.showToast('สลับโปรไฟล์เป็นกล้องหน้าโน้ตบุ๊กเรียบร้อยแล้ว ภาพสดพร้อมทำงานค่ะ', 'success');
  }

  async saveCameraFromModal() {
    const id = document.getElementById('cameraIdInput').value;
    const name = document.getElementById('camNameInput').value.trim() || 'Camera';
    const brand = document.getElementById('camBrandSelect').selectedOptions[0].text;
    const ip = document.getElementById('camIpInput').value.trim();
    const port = parseInt(document.getElementById('camPortInput').value, 10) || 80;
    const rtspPort = parseInt(document.getElementById('camRtspPortInput').value, 10) || 554;
    const username = document.getElementById('camUserInput').value;
    const password = document.getElementById('camPassInput').value;
    const channel = document.getElementById('camChannelInput').value;
    const streamType = document.getElementById('camStreamSelect').value;
    const group = document.getElementById('camGroupInput').value.trim() || 'Default';
    const rtspUrl = document.getElementById('camRtspUrlInput').value.trim();
    const httpUrl = document.getElementById('camHttpUrlInput').value.trim();

    const cameraObj = {
      id: id || undefined,
      name,
      brand,
      ip,
      port,
      rtspPort,
      username,
      password,
      channel,
      streamType,
      group,
      rtspUrl,
      httpUrl,
      favorite: false
    };

    await window.gasApi.saveCamera(cameraObj);
    $('#cameraModal').modal('hide');
    await this.loadCameras();
    this.showToast(`บันทึกโปรไฟล์ "${name}" สำเร็จ`, 'success');
  }

  async deleteCamera(id) {
    if (!confirm('คุณต้องการลบโปรไฟล์กล้องนี้ใช่หรือไม่?')) return;
    await window.gasApi.deleteCamera(id);
    await this.loadCameras();
    this.showToast('ลบโปรไฟล์กล้องเรียบร้อยแล้ว');
  }

  async toggleFavorite(id) {
    const cam = this.cameras.find(c => c.id === id);
    if (!cam) return;
    cam.favorite = !cam.favorite;
    await window.gasApi.saveCamera(cam);
    this.renderCameraList();
    this.updateStats();
  }

  copyRtspUrl(id) {
    const cam = this.cameras.find(c => c.id === id);
    if (cam && cam.rtspUrl) {
      navigator.clipboard.writeText(cam.rtspUrl);
      this.showToast('คัดลอก RTSP URL ลงคลิปบอร์ดแล้ว', 'info');
    }
  }

  // การถ่ายภาพ Snapshot จากช่อง
  captureSlotSnapshot(slotIndex) {
    const slotEl = document.getElementById(`slot-${slotIndex}`);
    if (!slotEl) return;
    const img = slotEl.querySelector('img.camera-stream-img');
    if (!img) {
      this.showToast('ไม่สามารถจับภาพนิ่งได้ในขณะนี้', 'warning');
      return;
    }

    try {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || 1280;
      canvas.height = img.naturalHeight || 720;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      const link = document.createElement('a');
      link.download = `CCTV_Snapshot_Slot${slotIndex + 1}_${Date.now()}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
      this.showToast('บันทึกภาพหน้าจอเรียบร้อยแล้ว', 'success');
    } catch (e) {
      // CORS Canvas protection fallback
      window.open(img.src, '_blank');
    }
  }

  toggleSlotFullscreen(slotIndex) {
    const slotEl = document.getElementById(`slot-${slotIndex}`);
    if (!slotEl) return;
    if (!document.fullscreenElement) {
      slotEl.requestFullscreen().catch(err => console.log(err));
    } else {
      document.exitFullscreen();
    }
  }

  openSettingsModal() {
    document.getElementById('settingsGasUrlInput').value = window.gasApi.getGasUrl();
    document.getElementById('settingsBridgeUrlInput').value = window.networkScanner.bridgeUrl;
    $('#settingsModal').modal('show');
  }

  saveSettings() {
    const gasUrl = document.getElementById('settingsGasUrlInput').value.trim();
    const bridgeUrl = document.getElementById('settingsBridgeUrlInput').value.trim();

    window.gasApi.setGasUrl(gasUrl);
    window.networkScanner.setBridgeUrl(bridgeUrl);

    $('#settingsModal').modal('hide');
    this.showToast('บันทึกการตั้งค่าเรียบร้อยแล้ว', 'success');
    this.checkBridgeStatus();
    this.loadCameras();
  }

  openSelectCameraModal(slotIndex) {
    this.targetAssignSlot = slotIndex;
    const container = document.getElementById('selectCameraModalList');
    if (!container) return;

    if (this.cameras.length === 0) {
      container.innerHTML = '<div class="text-muted p-3">ไม่มีโปรไฟล์กล้องในระบบ กรุณาเพิ่มกล้องก่อน</div>';
    } else {
      container.innerHTML = this.cameras.map(c => `
        <div class="list-group-item list-group-item-action bg-dark text-light d-flex justify-content-between align-items-center" style="cursor:pointer;" onclick="app.confirmAssignSlot('${c.id}')">
          <div>
            <strong>${c.name}</strong>
            <div class="small text-muted">${c.ip} • ${c.brand || 'CCTV'}</div>
          </div>
          <button class="btn btn-sm btn-primary">เลือก</button>
        </div>
      `).join('');
    }

    $('#selectCameraModal').modal('show');
  }

  confirmAssignSlot(cameraId) {
    const cam = this.cameras.find(c => c.id === cameraId);
    if (cam && this.targetAssignSlot !== undefined) {
      window.playerManager.assignCameraToSlot(this.targetAssignSlot, cam);
    }
    $('#selectCameraModal').modal('hide');
  }

  handleStreamError(slotIndex) {
    console.warn(`[Player] Stream failed on slot ${slotIndex}`);
  }

  showToast(message, type = 'info') {
    const toast = document.getElementById('appToast');
    const body = document.getElementById('toastBody');
    if (toast && body) {
      body.innerText = message;
      $(toast).toast({ delay: 3500 });
      $(toast).toast('show');
    }
  }
}

window.app = new CCTVApp();
document.addEventListener('DOMContentLoaded', () => window.app.init());
