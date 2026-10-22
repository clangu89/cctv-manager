# CCTV Manager (เว็บแอปพลิเคชันจัดการและดูกล้องวงจรปิดในวงแลน)

เว็บแอปพลิเคชันสำหรับค้นหา เชื่อมต่อ เปิดดู และบันทึกโปรไฟล์กล้องวงจรปิด (CCTV) ในเครือข่ายวงแลนเดียวกัน (Local Network) โดยเชื่อมต่อฐานข้อมูล Google Sheets ผ่าน Google Apps Script API และ Deploy หน้าเว็บขึ้น GitHub Pages

🌐 **เข้าใช้งานผ่านหน้าเว็บ (GitHub Pages):** [https://clangu89.github.io/cctv-manager/](https://clangu89.github.io/cctv-manager/)

---

## 🌟 คุณสมบัติเด่น (Key Features)

1. **ระบบค้นหากล้องในวงแลน (LAN Camera Discovery)**:
   - **Browser Direct Sweep Mode**: สแกนช่วง IP ที่ระบุ (เช่น `192.168.1.1` - `192.168.1.254`) ตรวจสอบพอร์ต HTTP/Webcam ผ่านเบราว์เซอร์ได้ทันทีโดยไม่ต้องติดตั้งโปรแกรมเสริม
   - **Deep CCTV Scan (Local Bridge)**: สแกนพอร์ต TCP ระดับเครือข่าย (`554` RTSP, `80`, `8000` Hikvision, `8080`, `8899` ONVIF, `37777` Dahua) พร้อมดึง MAC Address OUI และยิงแพ็กเก็ต ONVIF WS-Discovery อัตโนมัติ
2. **รองรับกล้องวงจรปิดมาตรฐานยอดนิยม (Brand Presets & URL Generator)**:
   - **Hikvision / Hilook**: สร้าง RTSP Channel 101/102 และ Snapshot ISAPI อัตโนมัติ
   - **Dahua / IMOU**: สร้าง RTSP Subtype 0/1 และ CGI Snapshot อัตโนมัติ
   - **TP-Link Tapo**: สร้าง RTSP stream1/stream2 อัตโนมัติ
   - **Uniview (UNV)**: สร้าง RTSP media/video1 อัตโนมัติ
   - **ESP32-CAM / Generic RTSP / HTTP MJPEG / HLS**
3. **จอภาพสดแบบ Matrix (Live Matrix Viewer)**:
   - ปรับมุมมองได้ทั้ง **1x1 (จอเดี่ยว), 2x2 (4 จอ), 3x3 (9 จอ)**
   - สลับช่องสัญญาณอิสระ, ถ่ายภาพหน้าจอ (Snapshot Capture ดาวน์โหลดไฟล์ `.png`), ขยายเต็มจอ (Fullscreen)
   - สตรีมภาพสดผ่าน Local Bridge (FFmpeg RTSP -> MJPEG Relay) หรือเปิดส่งต่อไปยัง VLC Player ในคลิกเดียว
4. **บันทึกโปรไฟล์ลง Google Sheets ผ่าน Google Apps Script**:
   - บันทึกและซิงค์โปรไฟล์กล้องอัตโนมัติลง Google Sheets เพื่อเปิดดูภายหลังได้จากทุกอุปกรณ์
   - จัดหมวดหมู่/สถานที่ (เช่น หน้าบ้าน, โกดัง, โรงรถ) และติดดาวรายการโปรด (Favorites)
   - มีระบบแคช LocalStorage ในตัว เปิดใช้งานได้ทันทีแม้ไม่ได้ต่อเน็ต

---

## 🛠️ โครงสร้างของระบบ (Architecture)

```
CCTV Manager/
├── index.html                   # หน้าเว็บหลัก Single Page Application (GitHub Pages)
├── assets/
│   ├── css/
│   │   └── style.css            # ธีมมืด Dark Security Control Room
│   └── js/
│       ├── config.js            # กำหนดค่าเริ่มต้น และ Brand URL Templates
│       ├── api.js               # เชื่อมต่อ REST API กับ Google Apps Script
│       ├── scanner.js           # ระบบสแกนหาอุปกรณ์ (Browser Probe + Local Bridge)
│       ├── player.js            # ตัวจัดการตาราง Matrix และเครื่องเล่นวิดีโอ
│       └── app.js               # ตัวควบคุมหลักของ UI และเหตุการณ์ทั้งหมด
├── gas-backend/
│   ├── Code.gs                  # โค้ด Google Apps Script (doGet, doPost, setupDatabase)
│   └── appsscript.json          # ไฟล์คอนฟิกของ Google Apps Script
└── local-bridge/
    ├── package.json
    ├── server.js                # Local HTTP Bridge (Node.js พอร์ต 3880)
    └── start-bridge.bat         # สคริปต์ดับเบิลคลิกเปิด Bridge บน Windows
```

---

## 🚀 วิธีเปิดใช้งาน Local CCTV Bridge (สำหรับการดูกล้อง RTSP สดบนหน้าเว็บ)

เบราว์เซอร์ทั่วไปไม่รองรับโปรโตคอล `rtsp://` โดยตรง หากต้องการให้ภาพสดจากกล้อง Hikvision, Dahua, Tapo แสดงในหน้าเว็บได้ทันที:

1. เข้าไปที่โฟลเดอร์ `local-bridge`
2. ดับเบิลคลิกไฟล์ **`start-bridge.bat`** (หรือพิมพ์คำสั่ง `node server.js` ในเทอร์มินัล)
3. ระบบจะเปิด Bridge ที่ `http://localhost:3880` พร้อมแปลงสตรีม RTSP เป็นภาพสดส่งต่อให้หน้าเว็บทันที!

---

## 📊 ข้อมูลเชื่อมต่อ Google Apps Script & Google Sheets

- **Google Sheet Database**: [คลิกเพื่อเปิดดู Google Sheets](https://drive.google.com/open?id=12c1we6uw12R27ui7fXDXleuXbVG9FxAezTMOMQr7fIE)
- **Google Apps Script Editor**: [คลิกเพื่อเปิดดูสคริปต์](https://script.google.com/d/1GuQjOf7Nd5uCioT97aFoFCfQ43aQcXLK2zKtv3yRgVnlgni3_W_FVNxT/edit)
