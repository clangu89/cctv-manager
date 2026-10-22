/**
 * CCTV Manager - Google Apps Script Backend API
 * เชื่อมต่อและบันทึกข้อมูลกล้องวงจรปิดลง Google Sheets
 */

const CONFIG = {
  CAMERAS_SHEET: 'Cameras',
  LOGS_SHEET: 'DiscoveryLogs',
  DEFAULT_HEADERS: [
    'id', 'name', 'brand', 'ip', 'port', 'rtspPort',
    'username', 'password', 'channel', 'streamType',
    'rtspUrl', 'httpUrl', 'group', 'favorite', 'notes',
    'lastSeen', 'createdAt', 'updatedAt'
  ],
  LOGS_HEADERS: ['timestamp', 'subnet', 'ip', 'openPorts', 'brandGuess', 'status']
};

/**
 * ฟังก์ชันเริ่มต้นสร้างตารางใน Google Sheets
 */
function setupDatabase() {
  const ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.create('CCTV_Manager_DB');
  
  // สร้างหรือเชื่อมชีต Cameras
  let camSheet = ss.getSheetByName(CONFIG.CAMERAS_SHEET);
  if (!camSheet) {
    camSheet = ss.insertSheet(CONFIG.CAMERAS_SHEET);
    camSheet.appendRow(CONFIG.DEFAULT_HEADERS);
    camSheet.getRange(1, 1, 1, CONFIG.DEFAULT_HEADERS.length)
      .setFontWeight('bold')
      .setBackground('#1a237e')
      .setFontColor('#ffffff');
    camSheet.setFrozenRows(1);
  }

  // สร้างหรือเชื่อมชีต DiscoveryLogs
  let logSheet = ss.getSheetByName(CONFIG.LOGS_SHEET);
  if (!logSheet) {
    logSheet = ss.insertSheet(CONFIG.LOGS_SHEET);
    logSheet.appendRow(CONFIG.LOGS_HEADERS);
    logSheet.getRange(1, 1, 1, CONFIG.LOGS_HEADERS.length)
      .setFontWeight('bold')
      .setBackground('#263238')
      .setFontColor('#ffffff');
    logSheet.setFrozenRows(1);
  }

  return {
    spreadsheetId: ss.getId(),
    spreadsheetUrl: ss.getUrl()
  };
}

/**
 * Handle HTTP GET Requests
 */
function doGet(e) {
  try {
    const params = (e && e.parameter) ? e.parameter : {};
    const action = params.action || 'list';

    if (action === 'ping') {
      return jsonResponse({
        status: 'success',
        message: 'CCTV Manager API is running',
        timestamp: new Date().toISOString()
      });
    }

    if (action === 'list') {
      const cameras = getCamerasList();
      return jsonResponse({
        status: 'success',
        count: cameras.length,
        data: cameras
      });
    }

    return jsonResponse({
      status: 'error',
      message: 'Unknown action: ' + action
    });
  } catch (err) {
    return jsonResponse({
      status: 'error',
      message: err.toString()
    });
  }
}

/**
 * Handle HTTP POST Requests (Support CORS-friendly text/plain JSON payload)
 */
function doPost(e) {
  try {
    let payload = {};
    if (e && e.postData && e.postData.contents) {
      try {
        payload = JSON.parse(e.postData.contents);
      } catch (err) {
        payload = e.parameter || {};
      }
    } else if (e && e.parameter) {
      payload = e.parameter;
    }

    const action = payload.action || 'save';

    if (action === 'save') {
      const camera = payload.data || payload;
      const result = saveCamera(camera);
      return jsonResponse({
        status: 'success',
        message: 'Camera profile saved successfully',
        data: result
      });
    }

    if (action === 'bulkSave') {
      const cameras = payload.cameras || [];
      const results = bulkSaveCameras(cameras);
      return jsonResponse({
        status: 'success',
        message: 'Bulk cameras saved successfully',
        count: results.length,
        data: results
      });
    }

    if (action === 'delete') {
      const id = payload.id;
      if (!id) {
        return jsonResponse({ status: 'error', message: 'Missing camera id' });
      }
      deleteCamera(id);
      return jsonResponse({
        status: 'success',
        message: 'Camera deleted successfully',
        id: id
      });
    }

    if (action === 'logDiscovery') {
      const log = payload.log || {};
      logDiscovery(log);
      return jsonResponse({
        status: 'success',
        message: 'Discovery logged'
      });
    }

    return jsonResponse({
      status: 'error',
      message: 'Unknown action: ' + action
    });
  } catch (err) {
    return jsonResponse({
      status: 'error',
      message: err.toString()
    });
  }
}

function getCamerasSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    setupDatabase();
  }
  let sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.CAMERAS_SHEET);
  if (!sheet) {
    setupDatabase();
    sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.CAMERAS_SHEET);
  }
  return sheet;
}

function getCamerasList() {
  const sheet = getCamerasSheet();
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];

  const headers = data[0];
  const list = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue; // ข้ามแถวที่ไม่มี ID

    const item = {};
    headers.forEach((h, idx) => {
      item[h] = row[idx];
    });
    list.push(item);
  }

  return list;
}

function saveCamera(cam) {
  const sheet = getCamerasSheet();
  const data = sheet.getDataRange().getValues();
  const now = new Date().toISOString();

  // สร้าง ID ถ้ายังไม่มี
  if (!cam.id) {
    cam.id = 'cam_' + Utilities.getUuid().slice(0, 8);
    cam.createdAt = now;
  }
  cam.updatedAt = now;
  if (!cam.lastSeen) cam.lastSeen = now;

  let existingRow = -1;
  // ค้นหาว่ามี ID นี้หรือ IP+Channel นี้แล้วหรือไม่
  for (let i = 1; i < data.length; i++) {
    const rowId = data[i][0];
    const rowIp = data[i][3];
    const rowChannel = data[i][8];
    if (rowId === cam.id || (cam.ip && rowIp === cam.ip && String(rowChannel) === String(cam.channel || '1'))) {
      existingRow = i + 1;
      if (!cam.id) cam.id = rowId;
      if (!cam.createdAt) cam.createdAt = data[i][16] || now;
      break;
    }
  }

  const rowData = [
    cam.id || '',
    cam.name || 'Unnamed Camera',
    cam.brand || 'Generic',
    cam.ip || '',
    cam.port || 80,
    cam.rtspPort || 554,
    cam.username || 'admin',
    cam.password || '',
    cam.channel || '1',
    cam.streamType || 'rtsp',
    cam.rtspUrl || '',
    cam.httpUrl || '',
    cam.group || 'Default',
    cam.favorite ? true : false,
    cam.notes || '',
    cam.lastSeen || now,
    cam.createdAt || now,
    cam.updatedAt || now
  ];

  if (existingRow > 0) {
    sheet.getRange(existingRow, 1, 1, rowData.length).setValues([rowData]);
  } else {
    sheet.appendRow(rowData);
  }

  return cam;
}

function bulkSaveCameras(cameras) {
  return cameras.map(c => saveCamera(c));
}

function deleteCamera(id) {
  const sheet = getCamerasSheet();
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === id) {
      sheet.deleteRow(i + 1);
      return true;
    }
  }
  return false;
}

function logDiscovery(log) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG.LOGS_SHEET);
  if (!sheet) {
    setupDatabase();
    sheet = ss.getSheetByName(CONFIG.LOGS_SHEET);
  }
  sheet.appendRow([
    new Date().toISOString(),
    log.subnet || '',
    log.ip || '',
    Array.isArray(log.openPorts) ? log.openPorts.join(',') : (log.openPorts || ''),
    log.brandGuess || 'Unknown',
    log.status || 'Discovered'
  ]);
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
