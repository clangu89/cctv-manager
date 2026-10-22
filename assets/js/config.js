/**
 * CCTV Manager - Configuration & Brand Templates
 */

const APP_CONFIG = {
  VERSION: '1.0.0',
  DEFAULT_GAS_URL: 'https://script.google.com/macros/s/AKfycbyIJ4aD81K-2ZDyNoqwkZ10Sz-UkBkPugJcydLOr3pZSEA9L0a7VvS3aWrVf1raXlNzQw/exec',
  DEFAULT_LOCAL_BRIDGE_URL: 'http://localhost:3880',
  STORAGE_KEYS: {
    GAS_URL: 'cctv_gas_url',
    LOCAL_BRIDGE_URL: 'cctv_bridge_url',
    CAMERAS: 'cctv_saved_cameras',
    LAYOUT: 'cctv_matrix_layout',
    SETTINGS: 'cctv_settings'
  },
  COMMON_PORTS: [554, 80, 8000, 8080, 8899, 37777, 8554],
  BRAND_TEMPLATES: {
    'hikvision': {
      name: 'Hikvision / Hilook',
      defaultPort: 80,
      defaultRtspPort: 554,
      buildRtspUrl: (c) => {
        const auth = (c.username && c.password) ? `${encodeURIComponent(c.username)}:${encodeURIComponent(c.password)}@` : '';
        const ch = (c.channel || 1);
        const sub = c.streamType === 'sub' ? '02' : '01';
        return `rtsp://${auth}${c.ip}:${c.rtspPort || 554}/Streaming/Channels/${ch}${sub}`;
      },
      buildSnapshotUrl: (c) => {
        const ch = (c.channel || 1);
        return `http://${c.ip}:${c.port || 80}/ISAPI/Streaming/channels/${ch}01/picture`;
      }
    },
    'dahua': {
      name: 'Dahua / IMOU',
      defaultPort: 80,
      defaultRtspPort: 554,
      buildRtspUrl: (c) => {
        const auth = (c.username && c.password) ? `${encodeURIComponent(c.username)}:${encodeURIComponent(c.password)}@` : '';
        const ch = (c.channel || 1);
        const subtype = c.streamType === 'sub' ? 1 : 0;
        return `rtsp://${auth}${c.ip}:${c.rtspPort || 554}/cam/realmonitor?channel=${ch}&subtype=${subtype}`;
      },
      buildSnapshotUrl: (c) => {
        const ch = (c.channel || 1);
        return `http://${c.ip}:${c.port || 80}/cgi-bin/snapshot.cgi?channel=${ch}`;
      }
    },
    'tapo': {
      name: 'TP-Link Tapo',
      defaultPort: 80,
      defaultRtspPort: 554,
      buildRtspUrl: (c) => {
        const auth = (c.username && c.password) ? `${encodeURIComponent(c.username)}:${encodeURIComponent(c.password)}@` : '';
        const stream = c.streamType === 'sub' ? 'stream2' : 'stream1';
        return `rtsp://${auth}${c.ip}:${c.rtspPort || 554}/${stream}`;
      },
      buildSnapshotUrl: () => ''
    },
    'uniview': {
      name: 'Uniview (UNV)',
      defaultPort: 80,
      defaultRtspPort: 554,
      buildRtspUrl: (c) => {
        const auth = (c.username && c.password) ? `${encodeURIComponent(c.username)}:${encodeURIComponent(c.password)}@` : '';
        const stream = c.streamType === 'sub' ? 'video2' : 'video1';
        return `rtsp://${auth}${c.ip}:${c.rtspPort || 554}/media/${stream}`;
      },
      buildSnapshotUrl: (c) => `http://${c.ip}:${c.port || 80}/images/snapshot.jpg`
    },
    'esp32': {
      name: 'ESP32-CAM',
      defaultPort: 81,
      defaultRtspPort: 554,
      buildRtspUrl: () => '',
      buildHttpUrl: (c) => `http://${c.ip}:${c.port || 81}/stream`,
      buildSnapshotUrl: (c) => `http://${c.ip}:${c.port || 80}/capture`
    },
    'generic_rtsp': {
      name: 'Generic RTSP Camera',
      defaultPort: 80,
      defaultRtspPort: 554,
      buildRtspUrl: (c) => {
        const auth = (c.username && c.password) ? `${encodeURIComponent(c.username)}:${encodeURIComponent(c.password)}@` : '';
        return `rtsp://${auth}${c.ip}:${c.rtspPort || 554}/live/ch0`;
      },
      buildSnapshotUrl: () => ''
    },
    'custom': {
      name: 'Custom / Custom URL',
      defaultPort: 80,
      defaultRtspPort: 554,
      buildRtspUrl: (c) => c.rtspUrl || '',
      buildSnapshotUrl: (c) => c.httpUrl || ''
    }
  }
};
