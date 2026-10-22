/**
 * CCTV Manager - Google Apps Script Client API
 */

class GasApiClient {
  constructor() {
    this.gasUrl = localStorage.getItem(APP_CONFIG.STORAGE_KEYS.GAS_URL) || APP_CONFIG.DEFAULT_GAS_URL;
  }

  setGasUrl(url) {
    this.gasUrl = (url || '').trim();
    localStorage.setItem(APP_CONFIG.STORAGE_KEYS.GAS_URL, this.gasUrl);
  }

  getGasUrl() {
    return this.gasUrl;
  }

  // ทดสอบการเชื่อมต่อ API
  async ping() {
    if (!this.gasUrl) return { success: false, message: 'ยังไม่ได้ระบุ GAS WebApp URL' };
    try {
      const res = await fetch(`${this.gasUrl}?action=ping`, {
        method: 'GET',
        mode: 'cors'
      });
      if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
      const data = await res.json();
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // ดึงรายการกล้องทั้งหมด
  async listCameras() {
    // โหลดจาก LocalStorage ก่อนเสมอเพื่อความรวดเร็ว
    const localCams = this.getLocalCameras();

    if (!this.gasUrl) {
      return { success: true, source: 'local', data: localCams };
    }

    try {
      const res = await fetch(`${this.gasUrl}?action=list`, {
        method: 'GET',
        mode: 'cors'
      });
      if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
      const result = await res.json();
      if (result.status === 'success' && Array.isArray(result.data)) {
        // อัปเดตลง LocalStorage เพื่อแคชไว้
        this.saveLocalCameras(result.data);
        return { success: true, source: 'cloud', data: result.data };
      }
      return { success: true, source: 'local', data: localCams };
    } catch (err) {
      console.warn('[GAS API] Failed to fetch cloud cameras, using local cache:', err);
      return { success: true, source: 'local_fallback', data: localCams, warning: err.message };
    }
  }

  // บันทึกโปรไฟล์กล้องเดี่ยว
  async saveCamera(camera) {
    // อัปเดต LocalStorage ทันที
    const currentList = this.getLocalCameras();
    const now = new Date().toISOString();
    if (!camera.id) camera.id = 'cam_' + Date.now().toString(36);
    camera.updatedAt = now;
    if (!camera.createdAt) camera.createdAt = now;

    const idx = currentList.findIndex(c => c.id === camera.id);
    if (idx >= 0) {
      currentList[idx] = { ...currentList[idx], ...camera };
    } else {
      currentList.unshift(camera);
    }
    this.saveLocalCameras(currentList);

    // ซิงค์ขึ้น Google Apps Script
    if (this.gasUrl) {
      try {
        await fetch(this.gasUrl, {
          method: 'POST',
          mode: 'no-cors', // Google Apps Script Web App รองรับ no-cors redirect
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ action: 'save', data: camera })
        });
      } catch (err) {
        console.warn('[GAS API] Cloud sync failed:', err);
      }
    }

    return { success: true, data: camera };
  }

  // บันทึกกล้องหลายตัวพร้อมกัน
  async bulkSaveCameras(cameras) {
    const currentList = this.getLocalCameras();
    const updated = [...currentList];

    for (const cam of cameras) {
      if (!cam.id) cam.id = 'cam_' + Math.random().toString(36).slice(2, 9);
      const idx = updated.findIndex(c => c.id === cam.id || (c.ip && c.ip === cam.ip));
      if (idx >= 0) {
        updated[idx] = { ...updated[idx], ...cam };
      } else {
        updated.push(cam);
      }
    }
    this.saveLocalCameras(updated);

    if (this.gasUrl) {
      try {
        await fetch(this.gasUrl, {
          method: 'POST',
          mode: 'no-cors',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ action: 'bulkSave', cameras: cameras })
        });
      } catch (err) {
        console.warn('[GAS API] Bulk cloud sync failed:', err);
      }
    }

    return { success: true, count: cameras.length };
  }

  // ลบโปรไฟล์กล้อง
  async deleteCamera(id) {
    const currentList = this.getLocalCameras().filter(c => c.id !== id);
    this.saveLocalCameras(currentList);

    if (this.gasUrl) {
      try {
        await fetch(this.gasUrl, {
          method: 'POST',
          mode: 'no-cors',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ action: 'delete', id: id })
        });
      } catch (err) {
        console.warn('[GAS API] Cloud delete failed:', err);
      }
    }

    return { success: true };
  }

  // Local Storage Helpers
  getLocalCameras() {
    try {
      const data = localStorage.getItem(APP_CONFIG.STORAGE_KEYS.CAMERAS);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      return [];
    }
  }

  saveLocalCameras(list) {
    try {
      localStorage.setItem(APP_CONFIG.STORAGE_KEYS.CAMERAS, JSON.stringify(list));
    } catch (e) {}
  }
}

window.gasApi = new GasApiClient();
