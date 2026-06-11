# DMS Assistant

Extension hỗ trợ tạo và cập nhật tài khoản nhân viên trên DMS.

## Tải bản mới

Vào mục **Releases** của repo này, tải file:

```text
dms-assistant-extension-v<version>.zip
```

Giải nén file ZIP, mở `chrome://extensions`, bật **Developer mode**, rồi chọn **Load unpacked** vào thư mục vừa giải nén.

## Phát hành bản mới

Chạy script:

```powershell
.\release-extension.ps1 -Version 1.2.1
```

Script sẽ cập nhật version, chạy test, đóng gói ZIP, tạo GitHub Release và deploy Worker để người dùng nhận thông báo cập nhật trong DMS Assistant.
