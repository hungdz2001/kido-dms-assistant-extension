# Fast Employee Status Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chuyển ngay từ tìm nhân viên `Đang hoạt động` sang `Ngừng hoạt động` khi bảng DMS đã xác nhận rỗng, đồng thời giữ pause/stop phản hồi nhanh.

**Architecture:** Giữ nguyên queue và UI hiện tại. Thêm bộ phân loại snapshot thuần, detector chỉ đọc table container, và một `MutationObserver` có timeout dự phòng 3 giây; queue dùng outcome `found|empty|timeout` thay cho hai lần polling 8 giây.

**Tech Stack:** Chrome Extension Manifest V3, JavaScript ES5-compatible content script, DOM `MutationObserver`, Node.js `assert`, Cloudflare Worker/Wrangler, GitHub Release.

---

### Task 1: Phân loại trạng thái bảng và empty state

**Files:**
- Modify: `employee-account-creator.js`
- Test: `employee-account-creator.test.cjs`

- [ ] **Step 1: Viết failing tests cho bộ phân loại trạng thái**

Thêm cạnh nhóm test `employeeRowStatusFromText`:

```js
assert.equal(typeof bridge.isEmployeeTableEmptyText, "function");
assert.equal(bridge.isEmployeeTableEmptyText("Trống"), true);
assert.equal(bridge.isEmployeeTableEmptyText("Không có dữ liệu"), true);
assert.equal(bridge.isEmployeeTableEmptyText("No data"), true);
assert.equal(bridge.isEmployeeTableEmptyText("Trạng thái Đang hoạt động"), false);

assert.equal(typeof bridge.classifyEmployeeSearchSnapshot, "function");
assert.equal(bridge.classifyEmployeeSearchSnapshot({
  rowInfo: { status: "active" },
  loading: false,
  empty: false
}), "found");
assert.equal(bridge.classifyEmployeeSearchSnapshot({
  rowInfo: null,
  loading: true,
  empty: true
}), "pending");
assert.equal(bridge.classifyEmployeeSearchSnapshot({
  rowInfo: null,
  loading: false,
  empty: true
}), "empty");
assert.equal(bridge.classifyEmployeeSearchSnapshot({
  rowInfo: null,
  loading: false,
  empty: false
}), "pending");
```

- [ ] **Step 2: Chạy test để xác nhận RED**

Run:

```powershell
node "AUTO TẠO TÀI KHOẢN NHÂN VIÊN\employee-account-creator.test.cjs"
```

Expected: FAIL vì `isEmployeeTableEmptyText` hoặc `classifyEmployeeSearchSnapshot` chưa tồn tại.

- [ ] **Step 3: Thêm helper thuần và detector table-scoped**

Thêm sau `findEmployeeRowInfoByCode()`:

```js
function isEmployeeTableEmptyText(text) {
  var plain = stripAccents(text).toLowerCase().replace(/\s+/g, " ").trim();
  return plain === "trong" ||
    plain.indexOf("khong co du lieu") >= 0 ||
    plain.indexOf("no data") >= 0;
}

function classifyEmployeeSearchSnapshot(snapshot) {
  snapshot = snapshot || {};
  if (snapshot.rowInfo) return "found";
  if (snapshot.loading) return "pending";
  return snapshot.empty ? "empty" : "pending";
}

function findEmployeeTableContainer() {
  if (typeof document === "undefined") return null;
  var selectors = [
    ".ant-table-wrapper",
    ".ant-table",
    ".el-table",
    "[role='table']"
  ];
  return Array.from(document.querySelectorAll(selectors.join(","))).find(function(node) {
    return isVisible(node) && !isOwnExtensionElement(node) &&
      node.querySelector("tbody,.ant-table-placeholder,.ant-empty,.el-table__empty-block,[role='row']");
  }) || null;
}

function isEmployeeTableEmpty(container) {
  if (!container) return false;
  var emptyNode = container.querySelector(
    ".ant-table-placeholder,.ant-empty,.el-table__empty-block"
  );
  return !!(emptyNode && isVisible(emptyNode) && isEmployeeTableEmptyText(visibleText(emptyNode)));
}
```

Export hai helper thuần trong `api`:

```js
isEmployeeTableEmptyText: isEmployeeTableEmptyText,
classifyEmployeeSearchSnapshot: classifyEmployeeSearchSnapshot,
```

- [ ] **Step 4: Chạy test để xác nhận GREEN**

Run:

```powershell
node "AUTO TẠO TÀI KHOẢN NHÂN VIÊN\employee-account-creator.test.cjs"
```

Expected: `employee account creator tests passed`.

- [ ] **Step 5: Commit helper**

```powershell
git add employee-account-creator.js employee-account-creator.test.cjs
git commit -m "Add employee table search state detection"
```

### Task 2: Observer phản hồi nhanh và hỗ trợ pause/stop

**Files:**
- Modify: `employee-account-creator.js`
- Test: `employee-account-creator.test.cjs`

- [ ] **Step 1: Viết failing tests cho control state và observer contract**

Thêm vào nhóm queue control:

```js
assert.equal(typeof bridge.employeeSearchControlState, "function");
assert.equal(bridge.employeeSearchControlState({ status: "running" }), "run");
assert.equal(bridge.employeeSearchControlState({ status: "paused" }), "pause");
assert.equal(bridge.employeeSearchControlState({ pause_requested: true }), "pause");
assert.equal(bridge.employeeSearchControlState({ status: "cancelled" }), "stop");
assert.equal(bridge.employeeSearchControlState({ stop_requested: true }), "stop");
assert.equal(bridge.employeeSearchControlState(null), "stop");

assert.equal(source.includes("function observeEmployeeSearchOutcome"), true);
const observerBody = source.match(
  /async function observeEmployeeSearchOutcome[\s\S]+?async function waitForEmployeeSearchOutcome/
)[0];
assert.equal(observerBody.includes("new MutationObserver"), true);
assert.equal(observerBody.includes("observer.disconnect()"), true);
assert.equal(observerBody.includes("employeeSearchControlState"), true);
assert.equal(observerBody.includes("EMPLOYEE_SEARCH_TIMEOUT_MS"), true);
```

- [ ] **Step 2: Chạy test để xác nhận RED**

Run:

```powershell
node "AUTO TẠO TÀI KHOẢN NHÂN VIÊN\employee-account-creator.test.cjs"
```

Expected: FAIL vì control helper/observer chưa tồn tại.

- [ ] **Step 3: Thêm constants và control helper**

Khai báo gần constants queue:

```js
var EMPLOYEE_SEARCH_TIMEOUT_MS = 3000;
var EMPLOYEE_SEARCH_CONTROL_POLL_MS = 150;
var EMPLOYEE_SEARCH_EMPTY_STABLE_MS = 120;
```

Thêm gần `shouldStopEmployeeQueue()`:

```js
function employeeSearchControlState(queue) {
  if (!queue || shouldStopEmployeeQueue(queue)) return "stop";
  if (isEmployeeQueuePaused(queue)) return "pause";
  return "run";
}
```

Export:

```js
employeeSearchControlState: employeeSearchControlState,
```

- [ ] **Step 4: Thêm observer và wrapper resume**

Thêm sau `ensureEmployeeUpdateSearchState()`:

```js
async function observeEmployeeSearchOutcome(employeeCode, timeoutMs) {
  var container = findEmployeeTableContainer();
  var timeout = Math.max(Number(timeoutMs) || EMPLOYEE_SEARCH_TIMEOUT_MS, 500);
  var started = Date.now();
  var dirty = true;
  var Observer = root.MutationObserver || (typeof MutationObserver !== "undefined" && MutationObserver);
  var observer = null;

  function connectObserver() {
    if (observer || !Observer || !container) return;
    observer = new Observer(function() {
      dirty = true;
    });
    observer.observe(container, { childList: true, subtree: true, attributes: true });
  }

  connectObserver();

  try {
    while (Date.now() - started < timeout) {
      var queue = await readAdminControlQueue();
      var control = employeeSearchControlState(queue);
      if (control === "stop") throw createAdminControlError("Da dung han automation.", "cancelled");
      if (control === "pause") return { state: "paused", rowInfo: null };

      if (!container) {
        container = findEmployeeTableContainer();
        if (container) {
          dirty = true;
          connectObserver();
        }
      }

      if (dirty || !observer) {
        dirty = false;
        var rowInfo = findEmployeeRowInfoByCode(employeeCode);
        var state = classifyEmployeeSearchSnapshot({
          rowInfo: rowInfo,
          loading: isEmployeeListLoading(),
          empty: isEmployeeTableEmpty(container)
        });
        if (state === "found") return { state: state, rowInfo: rowInfo };
        if (state === "empty") {
          await rawSleep(EMPLOYEE_SEARCH_EMPTY_STABLE_MS);
          var stableRow = findEmployeeRowInfoByCode(employeeCode);
          if (!stableRow && !isEmployeeListLoading() && isEmployeeTableEmpty(container)) {
            return { state: "empty", rowInfo: null };
          }
          dirty = true;
        }
      }
      await rawSleep(EMPLOYEE_SEARCH_CONTROL_POLL_MS);
    }
    return { state: "timeout", rowInfo: null };
  } finally {
    if (observer) observer.disconnect();
  }
}

async function waitForEmployeeSearchOutcome(employeeCode, timeoutMs) {
  while (true) {
    var outcome = await observeEmployeeSearchOutcome(employeeCode, timeoutMs);
    if (outcome.state !== "paused") return outcome;
    await waitForAdminRunControl();
  }
}
```

Nếu table container không xuất hiện, vòng chờ vẫn kiểm tra row/control mỗi 150 ms và trả `timeout` sau 3 giây.

- [ ] **Step 5: Chạy full test**

Run:

```powershell
node "AUTO TẠO TÀI KHOẢN NHÂN VIÊN\employee-account-creator.test.cjs"
```

Expected: `employee account creator tests passed`.

- [ ] **Step 6: Commit observer**

```powershell
git add employee-account-creator.js employee-account-creator.test.cjs
git commit -m "Observe employee search results without fixed waits"
```

### Task 3: Tích hợp outcome vào update queue

**Files:**
- Modify: `employee-account-creator.js`
- Test: `employee-account-creator.test.cjs`

- [ ] **Step 1: Viết failing tests cho active → inactive tức thời**

Thay các source assertions hiện tại quanh `runAdminEmployeeUpdateQueue()` bằng:

```js
const updateQueueBody = source.match(
  /async function runAdminEmployeeUpdateQueue[\s\S]+?var okCount = results\.filter/
)[0];
assert.equal(updateQueueBody.includes("waitForEmployeeSearchOutcome(item.employee_code"), true);
assert.equal(updateQueueBody.includes("}, 8000, 300)"), false);
assert.equal(updateQueueBody.includes('activeOutcome.state === "empty"'), true);
assert.equal(updateQueueBody.includes('activeOutcome.state === "timeout"'), true);
assert.equal(updateQueueBody.includes('queue.search_mode = "inactive"'), true);
assert.equal(updateQueueBody.includes('inactiveOutcome.state === "found"'), true);
assert.equal(updateQueueBody.includes('inactiveOutcome.state === "empty"'), true);
assert.equal(updateQueueBody.includes("UPDATE_TASK_MID_AUTUMN"), true);
```

Giữ các assertions hiện có:

```js
assert.equal(updateQueueBody.includes("queue.stop_requested = false"), false);
assert.equal(updateQueueBody.includes("queue.pause_requested = false"), false);
```

- [ ] **Step 2: Chạy test để xác nhận RED**

Run:

```powershell
node "AUTO TẠO TÀI KHOẢN NHÂN VIÊN\employee-account-creator.test.cjs"
```

Expected: FAIL vì queue vẫn dùng `waitFor(..., 8000, 300)`.

- [ ] **Step 3: Thay polling bằng outcome observer**

Trong `runAdminEmployeeUpdateQueue()` thay hai khối `waitFor(findEmployeeRowInfoByCode, 8000, 300)` bằng luồng:

```js
var activeOutcome = await waitForEmployeeSearchOutcome(
  item.employee_code,
  EMPLOYEE_SEARCH_TIMEOUT_MS
);
rowInfo = activeOutcome.rowInfo;

if (!rowInfo &&
    normalizeEmployeeUpdateTaskType(item.update_task) === UPDATE_TASK_RESIGNATION &&
    (activeOutcome.state === "empty" || activeOutcome.state === "timeout")) {
  queue.search_mode = "inactive";
  queue.admin_url = buildEmployeeUpdateSearchUrl(item, "inactive");
  await chromeStorageSet((function() {
    var obj = {};
    obj[EMPLOYEE_BATCH_KEY] = queue;
    return obj;
  })());
  searchMode = "inactive";
  await applyEmployeeListStatusFilter(searchMode);
  var inactiveOutcome = await waitForEmployeeSearchOutcome(
    item.employee_code,
    EMPLOYEE_SEARCH_TIMEOUT_MS
  );
  rowInfo = inactiveOutcome.rowInfo;
}
```

Tạo `notFoundResult` ngay trong queue khi:

```js
if (!rowInfo && normalizeEmployeeUpdateTaskType(item.update_task) === UPDATE_TASK_MID_AUTUMN) {
  notFoundResult = createEmployeeUpdateResultDefaults(normalizeEmployeeUpdateTask(item, item.update_task));
  notFoundResult.update_status = "Lỗi";
  notFoundResult.update_error = "Không tìm thấy nhân viên đang hoạt động.";
}
```

Giữ nhánh resignation:

```js
if (!rowInfo && searchMode === "inactive" &&
    normalizeEmployeeUpdateTaskType(item.update_task) === UPDATE_TASK_RESIGNATION) {
  notFoundResult = createEmployeeUpdateResultDefaults(normalizeEmployeeUpdateTask(item, item.update_task));
  notFoundResult.update_status = "Lỗi";
  notFoundResult.update_error = "Không tìm thấy nhân viên ở trạng thái đang hoạt động hoặc ngừng hoạt động.";
}
```

Không gọi `updateOneEmployee()` khi `rowInfo` không tồn tại; nhờ vậy không phát sinh thêm lượt chờ 15 giây trong hàm con.

- [ ] **Step 4: Chạy full test và kiểm tra không còn fixed wait**

Run:

```powershell
node "AUTO TẠO TÀI KHOẢN NHÂN VIÊN\employee-account-creator.test.cjs"
rg -n "8000, 300|search_mode = \"all\"" "AUTO TẠO TÀI KHOẢN NHÂN VIÊN\employee-account-creator.js"
```

Expected:

- Test output: `employee account creator tests passed`.
- `rg` không tìm thấy fixed wait cũ hoặc `search_mode = "all"`.

- [ ] **Step 5: Commit queue integration**

```powershell
git add employee-account-creator.js employee-account-creator.test.cjs
git commit -m "Speed up inactive employee fallback"
```

### Task 4: Phát hành v1.2.10 và xác minh production

**Files:**
- Modify: `manifest.json`
- Modify: `employee-account-creator.js`
- Modify: `employee-account-creator.test.cjs`
- Modify: `telegram-support-worker.js`
- Generated: `artifacts/dms-assistant-extension-v1.2.10.zip`

- [ ] **Step 1: Cập nhật version expectations và release notes**

Đổi extension/Worker/min-supported thành `1.2.10`. Release notes Worker:

```js
release_notes: [
  "Tăng tốc kiểm tra nhân viên đã ngừng hoạt động bằng cách phát hiện bảng rỗng theo thời gian thực.",
  "Chuyển bộ lọc trạng thái ngay khi DMS xác nhận không có kết quả.",
  "Giữ nút Tạm dừng và Dừng hẳn phản hồi trong lúc chờ kết quả tìm kiếm."
]
```

Trong test, cập nhật mọi expectation production `1.2.9` thành `1.2.10`; test local forced update phải kỳ vọng patch kế tiếp `1.2.11`.

- [ ] **Step 2: Chạy test và diff validation**

Run:

```powershell
node "AUTO TẠO TÀI KHOẢN NHÂN VIÊN\employee-account-creator.test.cjs"
git diff --check
```

Expected:

- `employee account creator tests passed`
- `git diff --check` exit code 0.

- [ ] **Step 3: Commit source v1.2.10**

```powershell
git add employee-account-creator.js employee-account-creator.test.cjs manifest.json telegram-support-worker.js
git commit -m "Release faster employee status fallback"
```

- [ ] **Step 4: Tạo release và deploy Worker**

Run:

```powershell
& "C:\WINDOWS\System32\WindowsPowerShell\v1.0\powershell.exe" `
  -NoProfile -ExecutionPolicy Bypass `
  -File "AUTO TẠO TÀI KHOẢN NHÂN VIÊN\release-extension.ps1" `
  -Version "1.2.10" `
  -MinSupportedVersion "1.2.10"
```

Expected:

- Tests pass inside script.
- GitHub Release URL ends with `/releases/tag/v1.2.10`.
- Wrangler reports deployed Worker.
- ZIP exists at `artifacts/dms-assistant-extension-v1.2.10.zip`.

- [ ] **Step 5: Xác minh production**

Run:

```powershell
curl.exe "https://kdc-employee-support.chillwithdms.workers.dev/extension-version?current=1.2.9"
curl.exe -I -L "https://github.com/hungdz2001/kido-dms-assistant-extension/releases/download/v1.2.10/dms-assistant-extension-v1.2.10.zip"
node "AUTO TẠO TÀI KHOẢN NHÂN VIÊN\employee-account-creator.test.cjs"
git status --short
```

Expected:

- Endpoint trả `latest_version` và `min_supported_version` là `1.2.10`.
- Release asset trả HTTP `200 OK`.
- Tests pass.
- Git status sạch.

- [ ] **Step 6: Push commits**

```powershell
git push origin main
```

Expected: `main` trên GitHub chứa toàn bộ thay đổi `v1.2.10`.

## Manual Acceptance

1. Reload extension trong `chrome://extensions`.
2. Import file đóng nhân viên có một mã chỉ tồn tại ở trạng thái inactive.
3. Quan sát: khi bảng active hiện `Trống`, dropdown chuyển sang `Ngừng hoạt động` trong khoảng 0,3–1 giây, không chờ 8 giây.
4. Với nhân viên active, row xuất hiện và form mở như hiện tại.
5. Với mã không tồn tại ở cả hai trạng thái, kết quả lỗi xuất hiện sau tối đa khoảng 6 giây cộng thời gian DMS render.
6. Trong lúc chờ bảng, `Tạm dừng` dừng chuyển filter; `Tiếp tục` tạo observer mới; `Dừng hẳn` hủy queue ngay.
