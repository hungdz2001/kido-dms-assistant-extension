# Fast Employee Status Fallback Design

**Goal:** Khi đóng nhân viên nghỉ việc, chuyển ngay từ bộ lọc `Đang hoạt động` sang `Ngừng hoạt động` sau khi DMS xác nhận bảng không có kết quả, thay vì chờ hết timeout 8 giây.

## Architecture

Giữ nguyên queue và luồng cập nhật hiện tại. Thay phần chờ dòng nhân viên bằng một bộ quan sát trạng thái bảng dùng `MutationObserver`, kết hợp kiểm tra spinner, dòng kết quả và empty state của DMS.

Helper mới trả một trong ba kết quả:

- `found`: đã thấy đúng dòng nhân viên.
- `empty`: bảng tải xong và DMS hiển thị trạng thái rỗng.
- `timeout`: không xác định được kết quả trong thời gian dự phòng.

## Data Flow

1. Chọn bộ lọc `Đang hoạt động`.
2. Theo dõi bảng:
   - Nếu thấy đúng mã nhân viên, xử lý như hiện tại.
   - Nếu spinner đã kết thúc và thấy empty state `Trống`, chuyển ngay sang `Ngừng hoạt động`.
   - Nếu DOM không phát tín hiệu rõ ràng, timeout dự phòng sau 3 giây rồi mới fallback.
3. Sau khi chọn `Ngừng hoạt động`, tiếp tục theo dõi:
   - Thấy nhân viên inactive: tính thành công với ghi chú đã ngừng hoạt động trước đó.
   - Bảng rỗng: trả lỗi không tìm thấy ở cả hai trạng thái.
4. Tác vụ `Thêm ngành Trung thu` không được fallback sang inactive.

## Detection Rules

- Chỉ đọc kết quả sau khi spinner/loading mask không còn hiển thị.
- Empty state được nhận diện qua vùng bảng bằng các dấu hiệu:
  - `.ant-table-placeholder`
  - `.ant-empty`
  - `.el-table__empty-block`
  - nội dung chuẩn hóa bằng `stripAccents()` bằng `trong`, `khong co du lieu` hoặc `no data`.
- Không quét toàn trang để tránh nhận nhầm chữ `Trống` từ UI khác.
- `MutationObserver` chỉ quan sát container bảng và phải được `disconnect()` khi found, empty, timeout, pause hoặc stop.

## Queue Controls

- Trong lúc quan sát DOM, kiểm tra `waitForAdminRunControl()` theo nhịp tối đa 150 ms.
- `Tạm dừng` hủy observer hiện tại và không tự chuyển filter; khi tiếp tục, hệ thống tạo observer mới cho cùng trạng thái tìm kiếm với timeout mới.
- `Dừng hẳn` hủy observer, thoát queue bằng admin control error và không ghi thêm kết quả.

## Failure Handling

- Không tìm thấy table container: dùng polling dự phòng tối đa 3 giây.
- DMS loading kéo dài: không kết luận empty khi spinner còn hiển thị.
- DOM thay đổi nhưng chưa ổn định: yêu cầu empty state tồn tại sau hai lần kiểm tra cách nhau khoảng 120 ms.
- Không xác định được found/empty sau timeout: tác vụ nghỉ việc vẫn chuyển sang inactive; tác vụ Trung thu giữ hành vi lỗi active hiện tại.

## Testing

- Unit test helper nhận diện empty state chỉ trong table container.
- Test `found` trả ngay khi dòng đúng mã xuất hiện.
- Test `empty` trả ngay sau khi spinner kết thúc và placeholder xuất hiện.
- Test không trả `empty` khi spinner còn hoạt động.
- Test fallback active → inactive không chờ timeout khi DMS đã hiển thị `Trống`.
- Test tác vụ Trung thu không fallback inactive.
- Test pause/stop cắt bộ quan sát và không tạo kết quả sai.
- Bump extension và Worker lên `1.2.10`, đóng gói GitHub Release và deploy Worker sau khi full test pass.

## Compatibility

Không đổi template, queue schema, Telegram payload, file kết quả hoặc logic cập nhật form. Bản `1.2.10` chỉ thay cơ chế chờ kết quả tìm kiếm.
