const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const bridge = require("./employee-account-creator.js");
const supportWorker = require("./telegram-support-worker.js");
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "manifest.json"), "utf8"));
const source = fs.readFileSync(path.join(__dirname, "employee-account-creator.js"), "utf8");
const workerSource = fs.readFileSync(path.join(__dirname, "telegram-support-worker.js"), "utf8");
const wranglerSource = fs.readFileSync(path.join(__dirname, "wrangler.toml"), "utf8");
const releaseScriptPath = path.join(__dirname, "release-extension.ps1");

function assertNoMojibake(label, value) {
  ["Táº", "Ä‘", "HÆ", "TÃ€", "NhÃ", "viÃ"].forEach((pattern) => {
    assert.equal(String(value).includes(pattern), false, `${label} contains mojibake ${pattern}`);
  });
}

{
  assert.equal(bridge.EXTENSION_AUTHOR, "HƯNG ĐẸP TRAI");
  assert.equal(manifest.version, "1.2.8");
  assert.equal(bridge.EXTENSION_VERSION, manifest.version);
  assert.match(bridge.buildUiFooterHtml(), /Phát triển bởi/);
  assert.match(bridge.buildUiFooterHtml(), /HƯNG ĐẸP TRAI/);
  assert.equal(bridge.TOOLBAR_VISIBLE_KEY, "lmb_toolbar_visible_v1");
  assert.equal(bridge.CONTROL_PANEL_MODE_KEY, "lmb_control_panel_mode_v1");
  assert.equal(bridge.CONTROL_PANEL_POSITION_KEY, "lmb_control_panel_position_v1");
  assert.equal(bridge.isToolbarVisibleSetting({}), false);
  assert.equal(bridge.isToolbarVisibleSetting({ lmb_toolbar_visible_v1: true }), true);
  assert.equal(bridge.isToolbarVisibleSetting({ lmb_toolbar_visible_v1: false }), false);
  assert.equal(manifest.background.service_worker, "background.js");
  assert.equal(manifest.permissions.includes("scripting"), true);
  assert.equal(manifest.host_permissions.includes("https://admin2.kido.vn/*"), true);
  assert.equal(manifest.host_permissions.includes("https://kdc-employee-support.chillwithdms.workers.dev/*"), true);
  assertNoMojibake("manifest.name", manifest.name);
  assertNoMojibake("manifest.description", manifest.description);
  assertNoMojibake("manifest.action.default_title", manifest.action.default_title);
  assert.deepEqual(manifest.icons, {
    "16": "icons/kido-helper-16.png",
    "32": "icons/kido-helper-32.png",
    "48": "icons/kido-helper-48.png",
    "128": "icons/kido-helper-128.png"
  });
  assert.deepEqual(manifest.action.default_icon, manifest.icons);
  Object.values(manifest.icons).forEach((iconPath) => {
    assert.equal(fs.existsSync(path.join(__dirname, iconPath)), true, iconPath);
  });
  assert.equal(Array.isArray(manifest.web_accessible_resources), true);
  assert.equal(manifest.web_accessible_resources.some((entry) => {
    return Array.isArray(entry.resources)
      && entry.resources.includes("icons/kido-helper-128.png")
      && Array.isArray(entry.matches)
      && entry.matches.includes("https://admin2.kido.vn/*");
  }), true);
  assert.deepEqual(manifest.content_scripts[0].matches, ["https://admin2.kido.vn/*"]);
  assert.deepEqual(manifest.content_scripts[0].js, ["employee-account-creator.js"]);
  assert.equal(JSON.stringify(manifest).includes("copilot.k-ai.vn"), false);
  assert.equal(JSON.stringify(manifest).includes("kdc-mail-proxy"), false);
  assert.equal(fs.existsSync(releaseScriptPath), true);
  const releaseScript = fs.readFileSync(releaseScriptPath, "utf8");
  assert.equal(releaseScript.includes("dms-assistant-extension-v$Version.zip"), true);
  assert.equal(releaseScript.includes("gh.exe"), true);
  assert.equal(releaseScript.includes("release create"), true);
  assert.equal(releaseScript.includes("Compress-Archive"), true);
  assert.equal(releaseScript.includes("wrangler deploy"), true);
  assert.equal(releaseScript.includes("EXTENSION_MIN_SUPPORTED_VERSION"), true);
  assert.equal(releaseScript.includes("[System.Text.RegularExpressions.Regex]::IsMatch"), true);
  assert.equal(releaseScript.includes("$releaseViewCode"), true);
  assert.equal(source.includes("copilot.k-ai.vn"), false);
  assert.equal(source.includes("kdc-mail-proxy"), false);
  assert.equal(source.includes("--lmb-font"), true);
  assert.equal(source.includes("Segoe UI"), true);
  const styleBody = source.match(/function ensureUiStyles[\s\S]+?function setFabLabel/)[0];
  const styleBodyWithoutFontVar = styleBody.replace(/--lmb-font:[^;]+;/g, "");
  assert.deepEqual(styleBodyWithoutFontVar.match(/font:[^";]*Arial,sans-serif/g) || [], []);
  ["--lmb-shell", "--lmb-body", "--lmb-surface", "--lmb-blue"].forEach((token) => {
    assert.equal(styleBody.includes(token), true, `missing hybrid pro token ${token}`);
  });
  assert.equal(styleBody.includes("--lmb-shell:#102033"), true);
  assert.equal(styleBody.includes("--lmb-body:#eef4fb"), true);
  assert.equal(styleBody.includes("--lmb-surface:#ffffff"), true);
  assert.equal(styleBody.includes("--lmb-blue:#1e88ff"), true);
  assert.equal(styleBody.includes("--lmb-success:#16a34a"), true);
  assert.equal(styleBody.includes("--lmb-danger:#ef4444"), true);
  assert.equal(styleBody.includes("#lmb_control_center{position:fixed;right:18px;bottom:20px;z-index:2147483647;width:min(420px"), true);
  assert.equal(styleBody.includes("#lmb_control_center{position:fixed;right:18px;bottom:20px;z-index:2147483647;width:min(390px"), false);
  assert.equal(styleBody.includes("#lmb_control_center{position:fixed;right:18px;bottom:20px;z-index:2147483647;width:min(390px,calc(100vw - 36px));background:#07111f"), false);
  assert.equal(styleBody.includes("background:var(--lmb-shell)"), true);
  assert.equal(styleBody.includes(".lmb-status-strip"), false);
  assert.equal(styleBody.includes(".lmb-status-card"), false);
  assert.equal(styleBody.includes(".lmb-header-meta"), true);
  assert.equal(styleBody.includes(".lmb-meta-chip"), true);
  assert.equal(styleBody.includes(".lmb-create-stepper"), true);
  assert.equal(styleBody.includes(".lmb-panel-card"), true);
  assert.equal(source.includes('id="lmb_status_strip"'), false);
  assert.equal(source.includes("lmb-status-card"), false);
  assert.equal(source.includes("lmb-header-meta"), true);
  assert.equal(source.includes("lmb-meta-chip"), true);
  assert.equal(source.includes("lmb-create-checklist"), false);
  assert.equal(source.includes("lmb-create-stepper"), true);
  assert.equal(source.includes("Chọn ngành"), true);
  assert.equal(source.includes("Nhập file"), true);
  assert.equal(source.includes("Theo dõi tiến độ"), true);
  assert.equal(styleBody.includes("lmb-control-avatar"), true);
  assert.equal(styleBody.includes("lmb-robot-icon"), true);
  assert.equal(styleBody.includes("lmb-robot-img"), true);
  assert.equal(source.includes("icons/kido-helper-128.png"), true);
  assert.equal(source.includes("runtime.getURL"), true);
  assert.equal(source.includes('<i></i>'), false);
  assert.equal(styleBody.includes(".lmb-robot-icon:before"), false);
  assert.equal(styleBody.includes(".lmb-robot-icon:after"), false);
  assert.equal(styleBody.includes(".lmb-robot-icon i"), false);
  assert.equal(styleBody.includes("lmb-control-window"), true);
  assert.equal(styleBody.includes("lmb-control-bubble"), true);
  assert.equal(source.includes('addEventListener("pointerdown"'), true);
  assert.equal(source.includes('addEventListener("pointermove"'), true);
  assert.equal(source.includes('addEventListener("pointerup"'), true);
  assert.equal(styleBody.includes("lmb-ai-kicker"), true);
  assert.equal(styleBody.includes("lmb-module"), true);
  assert.equal(source.includes("lmb_control_minimize"), true);
  assert.equal(source.includes("lmb_control_close"), true);
  assert.equal(source.includes("lmb_control_bubble"), true);
  assert.equal(source.includes("setControlPanelMode"), true);
  assert.equal(source.includes("makeControlPanelBubbleDraggable"), true);
  assert.equal(source.includes("[TOOLBAR_VISIBLE_KEY]: false"), true);
  assert.equal(source.includes("Phát triển bởi"), true);
  assert.equal(source.includes("Phụ trách"), false);
  [
    "bấm cây bút",
    "bấm biểu tượng cây bút",
    "mở form",
    "trong form",
    "AI workflow",
    "Extension sẽ",
    "Extension chỉ",
    "bam cay but",
    "Da bam",
    "Gui loi nay cho Hung",
    "Khong dong duoc form",
    "form cap nhat",
    "form Them"
  ].forEach((phrase) => {
    assert.equal(source.includes(phrase), false, `informal copy remains: ${phrase}`);
  });
  assert.equal(source.includes("Trung tâm điều phối AI"), false);
  assert.equal(source.includes("DMS Assistant"), true);
  assert.equal(source.includes(">Nhật ký<"), true);
  assert.equal(typeof bridge.compareVersionStrings, "function");
  assert.equal(bridge.compareVersionStrings("1.2.0", "1.1.9"), 1);
  assert.equal(bridge.compareVersionStrings("1.0.0", "1.0.0"), 0);
  assert.equal(bridge.compareVersionStrings("1.0.0", "1.0.1"), -1);
  assert.equal(typeof bridge.shouldShowExtensionUpdate, "function");
  assert.equal(bridge.shouldShowExtensionUpdate({ latest_version: "1.2.0" }, "1.1.0"), true);
  assert.equal(bridge.shouldShowExtensionUpdate({ latest_version: "1.1.0" }, "1.1.0"), false);
  assert.equal(typeof bridge.isExtensionUpdateRequired, "function");
  assert.equal(bridge.isExtensionUpdateRequired({ min_supported_version: "1.2.0" }, "1.1.0"), true);
  assert.equal(bridge.isExtensionUpdateRequired({ min_supported_version: "1.2.8" }, "1.2.8"), false);
  assert.equal(typeof bridge.isExtensionAutomationLocked, "function");
  assert.equal(bridge.isExtensionAutomationLocked({ min_supported_version: "1.2.0" }, "1.1.0"), true);
  assert.equal(bridge.isExtensionAutomationLocked({ min_supported_version: "1.2.8" }, "1.2.8"), false);
  assert.equal(typeof bridge.normalizeControlPanelMode, "function");
  assert.equal(bridge.normalizeControlPanelMode("minimized"), "minimized");
  assert.equal(bridge.normalizeControlPanelMode("weird"), "open");
  assert.equal(typeof bridge.clampControlPanelPosition, "function");
  assert.deepEqual(bridge.clampControlPanelPosition({ x: -20, y: 900 }, { width: 800, height: 600 }, { width: 52, height: 52 }), { x: 8, y: 540 });
  assert.equal(typeof bridge.buildRequiredUpdateTestInfo, "function");
  const forcedUpdateInfo = bridge.buildRequiredUpdateTestInfo({
    latest_version: "1.2.8",
    min_supported_version: "1.2.8",
    release_notes: ["Bản production"]
  }, "1.2.8");
  assert.equal(forcedUpdateInfo.latest_version, "1.2.9");
  assert.equal(forcedUpdateInfo.min_supported_version, "1.2.9");
  assert.equal(bridge.isExtensionAutomationLocked(forcedUpdateInfo, "1.2.8"), true);
  assert.equal(forcedUpdateInfo.release_notes[0], "Chế độ kiểm thử bắt buộc cập nhật trên máy hiện tại.");
  assert.equal(source.includes("UPDATE_REQUIRED_TEST_KEY"), true);
  assert.equal(source.includes("applyRequiredUpdateTestMode"), true);
  assert.equal(source.includes("function syncRequiredExtensionUpdateLock"), true);
  assert.equal(source.includes("lmb_employee_import_button"), true);
  assert.equal(source.includes("lmb_update_import_button"), true);
  assert.equal(source.includes("Phiên bản hiện tại không còn được hỗ trợ"), true);
  assert.equal(source.includes("UPDATE_NOTICE_SNOOZE_KEY"), true);
  assert.equal(source.includes("function checkExtensionUpdate"), true);
  assert.equal(source.includes("function renderExtensionUpdateBanner"), true);
  assert.equal(source.includes("lmb_update_notice"), true);
  assert.equal(source.includes("lmb_update_download"), true);
  assert.equal(source.includes("lmb_update_changelog"), true);
  assert.equal(source.includes("lmb_update_snooze"), true);
  assert.equal(source.includes("Tải bản mới"), true);
  assert.equal(source.includes("Xem thay đổi"), true);
  assert.equal(source.includes("Nhắc lại sau"), true);
  assert.equal(typeof bridge.withUtf8Bom, "function");
  assert.equal(bridge.withUtf8Bom("Tạo nhân viên").startsWith("\uFEFF"), true);
  assert.equal(bridge.withUtf8Bom("\uFEFFTạo nhân viên"), "\uFEFFTạo nhân viên");
  const downloadBody = source.match(/function downloadTextFile[\s\S]+?function makeSignature/)[0];
  assert.equal(downloadBody.includes("withUtf8Bom"), true);
  assert.equal(typeof bridge.extractMailData, "undefined");
  assert.equal(typeof bridge.buildSendRequest, "undefined");
  assert.equal(bridge.isToolbarHostName("admin2.kido.vn"), true);
  assert.equal(bridge.isToolbarHostName("copilot.k-ai.vn"), false);
  const clickBody = source.match(/function highFidelityClickElement[\s\S]+?function commitDropdownOption/)[0];
  assert.equal(clickBody.includes('dispatchPointerMouse(target, "click"'), false);
  assert.equal(clickBody.includes("target.click()"), true);
  assert.equal(source.includes("function buildGuideStepsHtml"), true);
  assert.equal(source.includes("function buildStatusPillHtml"), true);
  assert.equal(source.includes("lmb-control-center"), true);
  assert.equal(source.includes("lmb-guide-steps"), true);
  assert.equal(source.includes("Chọn ngành cần tạo"), true);
  assert.equal(source.includes("Nhập file Excel/CSV nhân sự"), true);
  assert.equal(source.includes("Không tắt tab DMS khi automation đang chạy"), true);
  assert.equal(source.includes("lmb-toast-close"), true);
  assert.equal(source.includes("lmb-admin-close"), true);
  assert.equal(source.includes("function setEmployeeReviewOpen"), true);
  assert.equal(source.includes("body.lmb-review-open #lmb_control_center"), true);
  assert.equal(source.includes("body.lmb-review-open .lmb-toast"), true);
  const reviewLayoutBody = source.match(/function showEmployeeReview[\s\S]+?function latestText/)[0];
  assert.equal(reviewLayoutBody.includes("setEmployeeReviewOpen(true)"), true);
  assert.equal(reviewLayoutBody.includes("closeEmployeeReview(box)"), true);
  assert.equal(manifest.name, "AUTO TẠO TÀI KHOẢN NHÂN VIÊN - HƯNG ĐẸP TRAI");
}

{
  assert.equal(bridge.FEEDBACK_WORKER_URL, "https://kdc-employee-support.chillwithdms.workers.dev/feedback");
  assert.equal(
    bridge.buildEmployeeSearchUrl("KDBMT0290"),
    "https://admin2.kido.vn/userManager/list?status=ACTIVE&keyword=KDBMT0290"
  );
  assert.equal(
    bridge.buildEmployeeSearchUrl("KD B/01"),
    "https://admin2.kido.vn/userManager/list?status=ACTIVE&keyword=KD%20B%2F01"
  );
  assert.equal(
    bridge.buildEmployeeSearchUrl("KDBMT0290", false),
    "https://admin2.kido.vn/userManager/list?keyword=KDBMT0290"
  );
  assert.equal(typeof bridge.buildEmployeeUpdateSearchUrl, "function");
  assert.equal(
    bridge.buildEmployeeUpdateSearchUrl({ employee_code: "KDBMK0299", update_task: "resignation" }, "active"),
    "https://admin2.kido.vn/userManager/list?status=ACTIVE&keyword=KDBMK0299"
  );
  assert.equal(
    bridge.buildEmployeeUpdateSearchUrl({ employee_code: "KDBMK0299", update_task: "resignation" }, "all"),
    "https://admin2.kido.vn/userManager/list?keyword=KDBMK0299"
  );
  assert.equal(
    bridge.buildEmployeeUpdateSearchUrl({ employee_code: "KDBMK0299", update_task: "add_mid_autumn" }, "active"),
    "https://admin2.kido.vn/userManager/list?status=ACTIVE&keyword=KDBMK0299"
  );
  assert.equal(typeof bridge.employeeRowStatusFromText, "function");
  assert.equal(bridge.employeeRowStatusFromText("KDBMK0299 Lê Thị Thùy Lợi Đang hoạt động GT"), "active");
  assert.equal(bridge.employeeRowStatusFromText("KDBMK0299 Lê Thị Thùy Lợi Ngừng hoạt động GT"), "inactive");
  assert.equal(bridge.employeeRowStatusFromText("KDBMK0299 Lê Thị Thùy Lợi GT"), "unknown");
  assert.equal(bridge.normalizeControlPanelTab("commands"), "update");
  assert.equal(bridge.normalizeControlPanelTab("update"), "update");

  assert.deepEqual(bridge.normalizeEmployeeUpdateTask({
    employee_code: " KDBMT0290 ",
    resignation_date: "9.6.2026",
    full_name: "Nguyen Van Lanh",
    note: "Nghi viec"
  }, "resignation"), {
    employee_code: "KDBMT0290",
    full_name: "Nguyen Van Lanh",
    update_task: "resignation",
    resignation_date: "09/06/2026",
    target_category: "",
    note: "Nghi viec",
    source_row: ""
  });
  assert.deepEqual(bridge.normalizeEmployeeUpdateTask({
    ma_nhan_vien: "KDBMT0290",
    ho_va_ten: "Nguyen Van Lanh"
  }, "add_mid_autumn"), {
    employee_code: "KDBMT0290",
    full_name: "Nguyen Van Lanh",
    update_task: "add_mid_autumn",
    resignation_date: "",
    target_category: "Trung thu",
    note: "",
    source_row: ""
  });
  assert.deepEqual(bridge.employeeUpdateMissingFields({
    update_task: "resignation",
    employee_code: "KDBMT0290",
    resignation_date: "09/06/2026"
  }), []);
  assert.equal(bridge.employeeUpdateMissingFields({
    update_task: "resignation",
    employee_code: "KDBMT0290"
  }).length, 1);
  const updateRows = bridge.parseEmployeeUpdateRows([
    ["MA NHAN VIEN", "NGAY NGHI VIEC", "HO VA TEN", "GHI CHU"],
    ["KDBMT0290", "9.6.2026", "Nguyen Van Lanh", "Nghi viec"]
  ], "resignation");
  assert.equal(updateRows.employees.length, 1);
  assert.equal(updateRows.employees[0].employee_code, "KDBMT0290");
  assert.equal(updateRows.employees[0].resignation_date, "09/06/2026");
  assert.equal(bridge.buildEmployeeUpdateTemplateWorkbook("resignation").includes("NGAY NGHI VIEC"), true);
  assert.equal(bridge.buildEmployeeUpdateTemplateWorkbook("add_mid_autumn").includes("TRUNG THU"), true);
  const htmlTemplate = bridge.buildEmployeeUpdateTemplateWorkbook("resignation")
    .replace("KDBMT0290", "TESTAGENT4")
    .replace("09/06/2026", "9/6/2026")
    .replace("Nguyen Van Lanh", "Nguyễn Văn A");
  const htmlUpdateRows = bridge.parseEmployeeUpdateHtml(htmlTemplate, "resignation");
  assert.equal(htmlUpdateRows.employees.length, 1);
  assert.equal(htmlUpdateRows.employees[0].employee_code, "TESTAGENT4");
  assert.equal(htmlUpdateRows.employees[0].resignation_date, "09/06/2026");
  const csvTemplate = bridge.buildEmployeeUpdateTemplateCsv("resignation")
    .replace("KDBMT0290", "TESTAGENT4")
    .replace("09/06/2026", "9/6/2026")
    .replace("Nguyen Van Lanh", "Nguyễn Văn A");
  const csvUpdateRows = bridge.parseEmployeeUpdateCsv(csvTemplate, "resignation");
  assert.equal(csvUpdateRows.employees.length, 1);
  assert.equal(csvUpdateRows.employees[0].employee_code, "TESTAGENT4");
  assert.equal(csvUpdateRows.employees[0].resignation_date, "09/06/2026");
  assert.throws(function() {
    bridge.parseEmployeeUpdateHtml([
      '<html xmlns:x="urn:schemas-microsoft-com:office:excel">',
      '<head><link rel=File-List href="template-nhan-vien-nghi-viec_files/filelist.xml"></head>',
      '<frameset><frame src="template-nhan-vien-nghi-viec_files/sheet001.htm"></frameset>',
      '<table><tr><td>&#171;</td><td>&#187;</td></tr></table>',
      '</html>'
    ].join(""), "resignation");
  }, /Excel.*sheet001\.htm/);

  const payload = bridge.buildSupportFeedbackPayload({
    type: "feature",
    urgency: "high",
    sender: "Admin NPP",
    message: "Can them nut bao loi nhanh",
    log: "Dang tao TEST001",
    url: "https://admin2.kido.vn/userManager/list",
    command: "can them nut bao loi nhanh"
  });
  assert.equal(payload.source, "employee-extension");
  assert.equal(payload.version, "1.2.8");
  assert.equal(payload.type, "feature");
  assert.equal(payload.urgency, "high");
  assert.equal(payload.sender, "Admin NPP");
  assert.equal(payload.message, "Can them nut bao loi nhanh");
  assert.equal(payload.context.url, "https://admin2.kido.vn/userManager/list");
  assert.equal(payload.context.log, "Dang tao TEST001");
  assert.match(payload.context.time, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(typeof bridge.buildEmployeeResultAttachment, "function");
  assert.equal(typeof bridge.buildEmployeeUpdateResultAttachment, "function");
  const updateAttachment = bridge.buildEmployeeUpdateResultAttachment([
    {
      employee_code: "TESTAGENT4",
      full_name: "Nguyễn Văn A",
      update_task: "Đóng nhân viên nghỉ việc",
      update_status: "Lỗi",
      update_error: "Không tìm thấy hồ sơ"
    }
  ]);
  assert.match(updateAttachment.filename, /^ket-qua-cap-nhat-nhan-vien-\d{4}-\d{2}-\d{2}\.xls$/);
  assert.equal(updateAttachment.mime_type, "application/vnd.ms-excel");
  assert.equal(updateAttachment.kind, "employee_update_result");
  assert.equal(updateAttachment.size_bytes, Buffer.byteLength(Buffer.from(updateAttachment.content_base64, "base64")));
  const decodedUpdateAttachment = Buffer.from(updateAttachment.content_base64, "base64").toString("utf8");
  assert.equal(decodedUpdateAttachment.startsWith("\uFEFF"), true);
  assert.match(decodedUpdateAttachment, /Nguyễn Văn A/);
  assert.match(decodedUpdateAttachment, /Không tìm thấy hồ sơ/);
  const payloadWithAttachment = bridge.buildSupportFeedbackPayload({
    type: "bug",
    urgency: "high",
    message: "Lỗi cập nhật nhân viên TESTAGENT4",
    attachment: updateAttachment
  });
  assert.deepEqual(payloadWithAttachment.attachment, updateAttachment);
  const oversizedAttachment = {
    filename: "ket-qua-qua-lon.xls",
    mime_type: "application/vnd.ms-excel",
    kind: "employee_update_result",
    content_base64: Buffer.alloc(3 * 1024 * 1024 + 1).toString("base64"),
    size_bytes: 3 * 1024 * 1024 + 1
  };
  const payloadWithoutOversizedAttachment = bridge.buildSupportFeedbackPayload({
    type: "bug",
    urgency: "high",
    message: "Lỗi cập nhật nhân viên",
    attachment: oversizedAttachment
  });
  assert.equal(payloadWithoutOversizedAttachment.attachment, undefined);
  assert.match(payloadWithoutOversizedAttachment.message, /File ket qua qua lon nen khong dinh kem/);
  assert.throws(function() {
    bridge.buildSupportFeedbackPayload({ message: "   " });
  }, /Nhap noi dung phan hoi/);

  const controlBody = source.match(/function installEmployeeImportButton[\s\S]+?function isToolbarHostName/)[0];
  assert.equal(controlBody.includes("lmb-control-tabs"), true);
  assert.equal(controlBody.includes("lmb-tab-button"), true);
  assert.equal(controlBody.includes("lmb_tab_create"), true);
  assert.equal(controlBody.includes("lmb_tab_commands"), false);
  assert.equal(controlBody.includes("lmb_tab_update"), true);
  assert.equal(controlBody.includes("lmb_tab_support"), true);
  assert.equal(controlBody.includes("lmb_tab_logs"), true);
  assert.equal(controlBody.includes("lmb_export_log_button"), true);
  assert.equal(source.includes("CONTROL_PANEL_ACTIVE_TAB_KEY"), true);
  assert.equal(source.includes("function setControlPanelTab"), true);
  assert.equal(controlBody.includes("lmb_command_input"), false);
  assert.equal(controlBody.includes("lmb_update_task_choice"), true);
  assert.equal(controlBody.includes("lmb_update_template_button"), true);
  assert.equal(controlBody.includes("lmb_update_import_button"), true);
  assert.equal(controlBody.includes("lmb_feedback_message"), true);
  assert.equal(controlBody.includes("lmb_feedback_attach_latest"), true);
  assert.equal(controlBody.includes("lmb_feedback_pick_attachment"), true);
  assert.equal(controlBody.includes("lmb_feedback_clear_attachment"), true);
  assert.equal(controlBody.includes("Đính kèm file kết quả gần nhất"), true);
  assert.equal(controlBody.includes("Chọn file kết quả"), true);
  assert.equal(controlBody.includes("lmb_ticket_status"), true);
  assert.equal(controlBody.includes("lmb_ticket_refresh"), true);
  assert.equal(controlBody.includes("Yêu cầu hỗ trợ"), true);
  assert.equal(source.includes("lmb-ticket-card"), true);
  assert.equal(source.includes("lmb-ticket-status-processing"), true);
  assert.equal(source.includes("SUPPORT_TICKET_ACTIVE_POLL_MS"), true);
  assert.equal(source.includes("SUPPORT_TICKET_DONE_POLL_MS"), true);
  assert.equal(source.includes("function normalizeSupportTicketStatus"), true);
  assert.equal(source.includes("function supportTicketPollDelay"), true);
  assert.equal(source.includes("Ticket đã chuyển sang"), true);
  assert.equal(source.includes("root.setTimeout"), true);
  assert.equal(source.includes("Làm mới trạng thái"), true);
  assert.equal(controlBody.includes("refreshLatestResultAttachmentUi"), true);
  assert.equal(source.includes("LAST_RESULT_ATTACHMENT_KEY"), true);
  assert.equal(source.includes("lmb_latest_result_attachment_v1"), true);
  assert.equal(source.includes("function arrayBufferToBase64"), true);
  assert.equal(source.includes("function buildManualSupportAttachment"), true);
  assert.equal(source.includes("function rememberLatestResultAttachment"), true);
  assert.equal(source.includes("function loadLatestResultAttachment"), true);
  assert.equal(source.includes("chromeStorageGet(LAST_RESULT_ATTACHMENT_KEY)"), true);
  assert.equal(source.includes("LAST_RESULT_ATTACHMENT_KEY]: latestResultAttachment"), true);
  assert.equal(source.includes("function saveLatestSupportTicket"), true);
  assert.equal(source.includes("function pollLatestSupportTicketStatus"), true);
  assert.equal(source.includes("attachment: attachLatest && latestResultAttachment ? latestResultAttachment : null"), true);
  assert.equal(source.includes("Đã gửi báo cáo kèm file kết quả"), true);
  assert.equal(source.includes("Worker chưa nhận file đính kèm"), true);
  assert.equal(controlBody.includes("sendSupportFeedback"), true);
  assert.equal(source.includes("function syncOilCategoryNotice"), true);
  assert.equal(controlBody.includes("lmb_oil_category_notice"), true);
  assert.equal(controlBody.includes("Ngành Dầu chưa được kiểm thử đầy đủ"), true);
  assert.equal(controlBody.includes("liên hệ Hưng"), true);
  assert.equal(controlBody.includes('categoryChoice.addEventListener("change", syncOilCategoryNotice)'), true);
  assert.equal(source.includes("function buildEmployeeSearchUrl"), true);
  assert.equal(source.includes("function clickEmployeeEditButton"), true);
  assert.equal(typeof bridge.isOwnExtensionElement, "function");
  assert.equal(bridge.isOwnExtensionElement({
    id: "lmb_control_center",
    className: "lmb-control-center",
    getAttribute(name) {
      return name === "id" ? this.id : this.className;
    },
    closest(selector) {
      return selector.includes("#lmb_control_center") ? this : null;
    }
  }), true);
  const employeeModalBody = source.match(/function findEmployeeModal[\s\S]+?function findEmployeeUpdateModal/)[0];
  assert.equal(employeeModalBody.includes("isOwnExtensionElement(el)"), true);
  assert.equal(source.includes("function buildSupportFeedbackPayload"), true);
  assert.equal(source.includes("function sendSupportFeedback"), true);
}

{
  assert.equal(typeof supportWorker.workerCapabilities, "function");
  assert.equal(typeof supportWorker.createTicketId, "function");
  assert.equal(typeof supportWorker.ticketStatusLabel, "function");
  assert.equal(typeof supportWorker.validateFeedbackPayload, "function");
  assert.equal(typeof supportWorker.formatTelegramMessage, "function");
  assert.equal(supportWorker.WORKER_VERSION, "1.2.8");
  assert.equal(typeof supportWorker.extensionUpdateInfo, "function");
  const extensionInfo = supportWorker.extensionUpdateInfo();
  assert.equal(extensionInfo.latest_version, "1.2.8");
  assert.equal(extensionInfo.min_supported_version, "1.2.8");
  assert.match(extensionInfo.download_url, /^https:\/\/github\.com\/hungdz2001\/kido-dms-assistant-extension\/releases\/download\/v1\.2\.8\/dms-assistant-extension-v1\.2\.8\.zip$/);
  assert.match(extensionInfo.changelog_url, /^https:\/\/github\.com\/hungdz2001\/kido-dms-assistant-extension\/releases\/tag\/v1\.2\.8$/);
  assert.equal(workerSource.includes("GITHUB_RELEASE_REPO"), true);
  assert.equal(Array.isArray(extensionInfo.release_notes), true);
  assert.match(workerSource, /\/extension-version/);
  assert.deepEqual(supportWorker.workerCapabilities({ SUPPORT_TICKETS: { get() {}, put() {} } }), {
    attachments: true,
    telegram_actions: true,
    ticket_sync: true
  });
  assert.equal(supportWorker.workerCapabilities({}).ticket_sync, false);
  assert.match(supportWorker.createTicketId(new Date("2026-06-10T01:02:03Z"), function() { return 0.1; }), /^KIDO-20260610-/);
  assert.equal(supportWorker.ticketStatusLabel("processing"), "Đang xử lý");
  const valid = supportWorker.validateFeedbackPayload({
    source: "employee-extension",
    type: "bug",
    urgency: "urgent",
    sender: "Tester",
    message: "Loi tao nhan vien TEST001",
    context: {
      url: "https://admin2.kido.vn/userManager/list",
      time: "2026-06-09T01:02:03.000Z",
      log: "HTTP 500"
    }
  });
  assert.equal(valid.ok, true);
  assert.equal(valid.value.message, "Loi tao nhan vien TEST001");
  const workerAttachmentContent = "\uFEFFNguyễn Văn A\nKhông tạo được tài khoản";
  const workerAttachment = {
    filename: "ket-qua-tao-nhan-vien-2026-06-10.xls",
    mime_type: "application/vnd.ms-excel",
    content_base64: Buffer.from(workerAttachmentContent, "utf8").toString("base64"),
    size_bytes: Buffer.byteLength(workerAttachmentContent, "utf8"),
    kind: "employee_create_result"
  };
  const validWithAttachment = supportWorker.validateFeedbackPayload({
    source: "employee-extension",
    type: "bug",
    urgency: "high",
    sender: "Tester",
    message: "Loi tao nhan vien TEST001",
    attachment: workerAttachment
  });
  assert.equal(validWithAttachment.ok, true);
  assert.deepEqual(validWithAttachment.value.attachment, workerAttachment);
  assert.match(supportWorker.formatTelegramMessage(validWithAttachment.value), /Dinh kem: ket-qua-tao-nhan-vien-2026-06-10\.xls/);
  assert.equal(supportWorker.validateFeedbackPayload({
    message: "Loi",
    attachment: { filename: "", content_base64: workerAttachment.content_base64 }
  }).ok, false);
  assert.equal(supportWorker.validateFeedbackPayload({
    message: "Loi",
    attachment: {
      filename: "ket-qua-qua-lon.xls",
      mime_type: "application/vnd.ms-excel",
      content_base64: Buffer.alloc(3 * 1024 * 1024 + 1).toString("base64"),
      size_bytes: 3 * 1024 * 1024 + 1,
      kind: "employee_update_result"
    }
  }).ok, false);
  assert.equal(supportWorker.validateFeedbackPayload({ message: "" }).ok, false);
  assert.equal(supportWorker.validateFeedbackPayload({ message: "x".repeat(5001) }).ok, false);
  const telegramText = supportWorker.formatTelegramMessage(valid.value);
  assert.match(telegramText, /KIDO Employee Extension/);
  assert.match(telegramText, /Loi tao nhan vien TEST001/);
  assert.match(supportWorker.formatTelegramMessage(Object.assign({ ticket_id: "KIDO-20260610-ABC123", ticket_status: "received" }, valid.value)), /Ticket: KIDO-20260610-ABC123/);
  assert.match(workerSource, /TELEGRAM_BOT_TOKEN/);
  assert.match(workerSource, /TELEGRAM_CHAT_ID/);
  assert.match(workerSource, /\/feedback/);
  assert.match(workerSource, /\/telegram-webhook/);
  assert.match(workerSource, /\/ticket-status/);
  assert.match(workerSource, /reply_markup/);
  assert.match(workerSource, /answerCallbackQuery/);
  assert.match(workerSource, /sendDocument/);
  assert.match(wranglerSource, /binding\s*=\s*"SUPPORT_TICKETS"/);
}

{
  const pageChrome = { runtime: {} };
  const extensionChrome = { storage: { local: {} }, runtime: {} };
  assert.equal(bridge.selectExtensionChromeApi([pageChrome, extensionChrome]), extensionChrome);
  assert.equal(bridge.selectExtensionChromeApi([pageChrome]), null);

  const queue = {
    id: "emp_test",
    employees: [
      { employee_code: "TEST6868_5", full_name: "TEST AGENT 5", phone: "0549871659" }
    ]
  };
  const adminUrl = bridge.buildAdminEmployeeQueueUrl(queue);
  assert.match(adminUrl, /^https:\/\/admin2\.kido\.vn\/userManager\/list\?status=ACTIVE#lmb_employee_queue=/);
  assert.deepEqual(bridge.decodeEmployeeQueueFromHash(new URL(adminUrl).hash), queue);
  assert.equal(bridge.employeeAdminUrlForCategory("Bánh"), "https://admin2.kido.vn/userManager/list?status=ACTIVE");
  assert.equal(bridge.employeeAdminUrlForCategory("Dầu"), "https://admin2.kido.vn/userManager/list");
  assert.equal(bridge.employeeAdminUrlForCategory("Dau"), "https://admin2.kido.vn/userManager/list");
  assert.equal(bridge.normalizeEmployeeCategoryChoice("Dầu ăn"), "Dầu");
  assert.equal(bridge.normalizeEmployeeCategoryChoice("Banh"), "Bánh");
  const oilQueue = {
    id: "emp_oil_test",
    category_choice: "Dầu",
    employees: [
      { employee_code: "TEST6868_6", full_name: "TEST AGENT 6", phone: "0876213852", category: "Dầu" }
    ]
  };
  const oilAdminUrl = bridge.buildAdminEmployeeQueueUrl(oilQueue);
  assert.match(oilAdminUrl, /^https:\/\/admin2\.kido\.vn\/userManager\/list#lmb_employee_queue=/);
  assert.deepEqual(bridge.decodeEmployeeQueueFromHash(new URL(oilAdminUrl).hash), oilQueue);
  const selectedOilEmployees = bridge.applyEmployeeCategoryChoice(queue.employees, "Dầu");
  assert.equal(selectedOilEmployees[0].category, "Dầu");
  assert.notEqual(selectedOilEmployees[0], queue.employees[0]);
  assert.equal(bridge.decodeEmployeeQueueFromHash("#other=value"), null);
  assert.equal(bridge.removeEmployeeQueueHashValue(new URL(adminUrl).hash), "");
  assert.equal(bridge.removeEmployeeQueueHashValue("#foo=1&lmb_employee_queue=abc&bar=2"), "#foo=1&bar=2");
  const reviewBody = source.match(/function showEmployeeReview[\s\S]+?function latestText/)[0];
  assert.equal(reviewBody.includes("lmb_emp_category_choice"), true);
  assert.equal(reviewBody.includes("applyEmployeeCategoryChoice"), true);
  assert.equal(reviewBody.includes("employeeAdminUrlForCategory"), true);
  assert.equal(reviewBody.includes("lmb-review-grid"), true);
  assert.equal(reviewBody.includes("buildGuideStepsHtml"), true);
  assert.equal(reviewBody.includes("Bước tiếp theo"), true);
}

{
  assert.equal(bridge.shouldStopEmployeeQueue({ status: "running" }), false);
  assert.equal(bridge.shouldStopEmployeeQueue({ status: "stopping" }), true);
  assert.equal(bridge.shouldStopEmployeeQueue({ status: "cancelled" }), true);
  assert.equal(bridge.shouldStopEmployeeQueue({ stop_requested: true }), true);
  assert.equal(bridge.isEmployeeQueuePaused({ status: "paused" }), true);
  assert.equal(bridge.isEmployeeQueuePaused({ pause_requested: true }), true);
  assert.equal(bridge.isEmployeeQueuePaused({ status: "running" }), false);
  assert.equal(bridge.isEmployeeQueueRunnable({ status: "running", employees: [{}] }), true);
  assert.equal(bridge.isEmployeeQueueRunnable({ employees: [{}] }), true);
  assert.equal(bridge.isEmployeeQueueRunnable({ status: "paused", employees: [{}] }), false);
  assert.equal(bridge.isEmployeeQueueRunnable({ status: "stopping", employees: [{}] }), false);
  assert.equal(bridge.isEmployeeQueueRunnable({ status: "stopped", employees: [{}] }), false);
  assert.equal(bridge.isEmployeeQueueRunnable({ status: "cancelled", employees: [{}] }), false);
  assert.equal(bridge.isEmployeeQueueRunnable({ status: "done", employees: [{}] }), false);
  assert.equal(bridge.isEmployeeQueueRunnable({ stop_requested: true, employees: [{}] }), false);
  assert.equal(bridge.isEmployeeQueueRunnable({ status: "running", employees: [] }), false);

  const requestStopBody = source.match(/async function requestAdminStop[\s\S]+?function adminPanel/)[0];
  assert.equal(requestStopBody.includes("chromeStorageRemove(EMPLOYEE_BATCH_KEY)"), true);
  assert.equal(requestStopBody.includes("clearEmployeeQueueHash()"), true);
  const adminPanelBody = source.match(/function adminPanel[\s\S]+?async function runAdminEmployeeQueue/)[0];
  assert.equal(typeof bridge.buildEmployeeAutomationDashboardState, "function");
  const createDashboard = bridge.buildEmployeeAutomationDashboardState({
    queue_type: "employee_create",
    status: "running",
    current_index: 3,
    employees: Array.from({ length: 10 }, (_, index) => ({
      employee_code: "TEST" + String(index + 1).padStart(3, "0"),
      full_name: "Nhân viên " + (index + 1),
      position: "NVBH",
      position_form: "Nhân viên bán hàng",
      phone: "090000000" + index
    })),
    results: [
      { employee_code: "TEST001", full_name: "Nhân viên 1", create_status: "Thành công" },
      { employee_code: "TEST002", full_name: "Nhân viên 2", create_status: "Lỗi", create_error: "Không đọc được mật khẩu" },
      { employee_code: "TEST003", full_name: "Nhân viên 3", create_status: "Lỗi", create_error: "Mã nhân viên hoặc số điện thoại đã tồn tại." }
    ]
  }, "Đang tạo nhân viên", { canPause: true });
  assert.equal(createDashboard.total, 10);
  assert.equal(createDashboard.processed, 3);
  assert.equal(createDashboard.remaining, 7);
  assert.equal(createDashboard.successCount, 1);
  assert.equal(createDashboard.errorCount, 2);
  assert.equal(createDashboard.progressPercent, 30);
  assert.equal(createDashboard.statusLabel, "Đang chạy");
  assert.equal(createDashboard.currentItem.primary, "TEST004");
  assert.match(createDashboard.currentItem.secondary, /Nhân viên 4/);
  assert.match(createDashboard.currentItem.meta, /NVBH/);
  assert.equal(createDashboard.latestError.employee_code, "TEST003");
  assert.match(createDashboard.latestError.message, /Mã nhân viên hoặc số điện thoại đã tồn tại/);
  const duplicateDashboard = bridge.buildEmployeeAutomationDashboardState({
    queue_type: "employee_create",
    status: "done",
    current_index: 3,
    employees: [
      { employee_code: "TEST001", full_name: "Nhân viên 1" },
      { employee_code: "TEST002", full_name: "Nhân viên 2" },
      { employee_code: "TEST003", full_name: "Nhân viên 3" }
    ],
    results: [
      { employee_code: "TEST001", full_name: "Nhân viên 1", create_status: "Thành công" },
      { employee_code: "TEST002", full_name: "Nhân viên 2", create_status: "Lỗi", create_error: "Mã nhân viên hoặc số điện thoại đã tồn tại." },
      { employee_code: "TEST003", full_name: "Nhân viên 3", create_status: "Lỗi", create_error: "Không đọc được mật khẩu" }
    ]
  }, "Hoàn tất phiên chạy", {});
  assert.equal(duplicateDashboard.successCount, 1);
  assert.equal(duplicateDashboard.errorCount, 2);
  assert.equal(duplicateDashboard.latestError.employee_code, "TEST003");
  assert.match(duplicateDashboard.latestError.message, /Không đọc được mật khẩu/);
  const duplicateLatestDashboard = bridge.buildEmployeeAutomationDashboardState({
    queue_type: "employee_create",
    status: "done",
    current_index: 2,
    employees: [
      { employee_code: "TEST001", full_name: "Nhân viên 1" },
      { employee_code: "TEST002", full_name: "Nhân viên 2" }
    ],
    results: [
      { employee_code: "TEST001", full_name: "Nhân viên 1", create_status: "Thành công" },
      { employee_code: "TEST002", full_name: "Nhân viên 2", create_status: "Lỗi", create_error: "Mã nhân viên hoặc số điện thoại đã tồn tại." }
    ]
  }, "Hoàn tất phiên chạy", {});
  assert.equal(duplicateLatestDashboard.successCount, 1);
  assert.equal(duplicateLatestDashboard.errorCount, 1);
  assert.equal(duplicateLatestDashboard.latestError.employee_code, "TEST002");
  assert.match(duplicateLatestDashboard.latestError.message, /Mã nhân viên hoặc số điện thoại đã tồn tại/);
  const updateDashboard = bridge.buildEmployeeAutomationDashboardState({
    queue_type: "employee_update",
    status: "running",
    current_index: 1,
    employees: [
      { employee_code: "TEST001", full_name: "Nguyễn Văn A", update_task: "resignation", resignation_date: "10/06/2026" },
      { employee_code: "TEST002", full_name: "Trần Văn B", update_task: "add_mid_autumn", target_category: "Trung thu" }
    ],
    results: [
      { employee_code: "TEST001", full_name: "Nguyễn Văn A", update_task: "resignation", update_status: "Thành công" }
    ]
  }, "Đang cập nhật hồ sơ", { canPause: true });
  assert.equal(updateDashboard.total, 2);
  assert.equal(updateDashboard.processed, 1);
  assert.equal(updateDashboard.currentItem.primary, "TEST002");
  assert.match(updateDashboard.currentItem.meta, /Thêm ngành Trung thu/);
  assert.equal(updateDashboard.latestError, null);
  const inactiveResignationResults = [
    {
      employee_code: "KDBMK0299",
      full_name: "Lê Thị Thùy Lợi",
      update_task: "resignation",
      update_status: "Thành công",
      update_error: "Nhân viên đã ngừng hoạt động trước đó."
    }
  ];
  const inactiveResignationDashboard = bridge.buildEmployeeAutomationDashboardState({
    queue_type: "employee_update",
    status: "done",
    current_index: 1,
    employees: [
      { employee_code: "KDBMK0299", full_name: "Lê Thị Thùy Lợi", update_task: "resignation", resignation_date: "12/06/2026" }
    ],
    results: inactiveResignationResults
  }, "Hoàn tất phiên chạy", {});
  assert.equal(inactiveResignationDashboard.successCount, 1);
  assert.equal(inactiveResignationDashboard.errorCount, 0);
  assert.equal(inactiveResignationDashboard.latestError, null);
  const inactiveWorkbook = bridge.buildEmployeeUpdateResultWorkbook(inactiveResignationResults);
  assert.match(inactiveWorkbook, /GHI CHÚ/);
  assert.doesNotMatch(inactiveWorkbook, /GHI CHÚ LỖI/);
  assert.match(inactiveWorkbook, /Nhân viên đã ngừng hoạt động trước đó\./);
  assert.equal(source.includes("queue.search_mode"), true);
  assert.equal(source.includes("buildEmployeeUpdateSearchUrl(item, \"all\")"), true);
  assert.equal(source.includes("Không tìm thấy nhân viên ở trạng thái đang hoạt động hoặc ngừng hoạt động."), true);
  assert.equal(adminPanelBody.includes("buildEmployeeAutomationDashboardState"), true);
  assert.equal(adminPanelBody.includes("lmb-admin-progress"), true);
  assert.equal(adminPanelBody.includes("lmb-admin-stats"), true);
  assert.equal(adminPanelBody.includes("lmb-admin-current"), true);
  assert.equal(adminPanelBody.includes("lmb-admin-error"), true);
  assert.equal(source.includes("Hoàn tất phiên chạy"), true);
  assert.equal(source.includes("Đã dừng phiên chạy"), true);
  assert.equal(adminPanelBody.includes("requestAdminPause()"), true);
  assert.equal(adminPanelBody.includes("requestAdminResume()"), true);
  assert.equal(adminPanelBody.includes("requestAdminStop()"), true);
  assert.equal(adminPanelBody.includes("Gửi báo cáo lỗi"), true);
  assert.equal(adminPanelBody.includes("Gui loi nay cho Hung"), false);
  assert.equal(adminPanelBody.includes("attachment: options.reportAttachment"), true);
  assert.equal(adminPanelBody.includes("saveLatestSupportTicket"), true);
  const initAdminBody = source.match(/async function initAdminAutomation[\s\S]+?async function initBrowser/)[0];
  assert.equal(initAdminBody.includes("isEmployeeQueueRunnable(queue)"), true);
  assert.equal(initAdminBody.includes("isEmployeeQueuePaused(queue)"), true);
  const controlSleepBody = source.match(/function sleep[\s\S]+?async function waitFor/)[0];
  assert.equal(controlSleepBody.includes("waitForAdminRunControl()"), true);
  const fillFormBody = source.match(/async function fillEmployeeForm[\s\S]+?async function applyEmployeeResignationUpdate/)[0];
  assert.equal(fillFormBody.includes("waitForAdminRunControl()"), true);
  assert.equal(fillFormBody.includes('selectByLabel(modal, "Nganh hang"'), false);
  const createOneBody = source.match(/async function createOneEmployee[\s\S]+?function downloadEmployeeResults/)[0];
  assert.equal(createOneBody.includes("isAdminControlError(err)"), true);
  const createOneBeforeOpenForm = createOneBody.slice(0, createOneBody.indexOf("modal = await clickAddEmployeeButton();"));
  assert.equal(createOneBeforeOpenForm.includes("employeeAlreadyVisibleOnCurrentPage(employee)"), false);
  assert.equal(createOneBody.includes("isDuplicateEmployeeSubmitError(err.message)"), true);
  const submitOutcomeBody = source.match(/async function waitForEmployeeSubmitOutcome[\s\S]+?async function createOneEmployee/)[0];
  assert.ok(
    submitOutcomeBody.indexOf("readEmployeeSubmitError(modal)") < submitOutcomeBody.indexOf("employeeAlreadyVisibleOnCurrentPage(employee)")
  );
  const clickAddBody = source.match(/async function clickAddEmployeeButton[\s\S]+?function fieldTextMatches/)[0];
  assert.equal(source.includes("function findAddEmployeeButton"), true);
  assert.equal(clickAddBody.includes("await waitFor(findAddEmployeeButton"), true);
  assert.equal(clickAddBody.includes("Khong tim thay nut + them nhan vien"), true);

  const queue = {
    current_index: 1,
    employees: [
      { employee_code: "TEST6868_1", phone: "0913814567" },
      { employee_code: "TEST6868_2", phone: "0975659059" }
    ]
  };
  assert.deepEqual(bridge.employeeAtQueueIndex(queue), queue.employees[1]);

  assert.deepEqual(bridge.employeeFormMismatches(queue.employees[1], {
    employee_code: "TEST6868_2",
    portal_sap_code: "TEST6868_2",
    full_name: "TEST AGENT 1",
    phone: "0913814567",
    username: "TEST6868_2",
    start_date: "01/06/2026"
  }), [
    "phone: dang la 0913814567, can 0975659059"
  ]);

  assert.equal(bridge.employeeAlreadyVisibleInText(
    { employee_code: "TEST6868_3", phone: "0999945678" },
    "ID Ma nhan vien Ten nhan vien 41945 TEST6868_3 TEST AGENT 2"
  ), true);
  assert.equal(bridge.employeeAlreadyVisibleInText(
    { employee_code: "TEST6868_30", phone: "0999945678" },
    "ID Ma nhan vien Ten nhan vien 41945 TEST6868_3 TEST AGENT 2"
  ), false);
  assert.equal(bridge.isDuplicateEmployeeSubmitError("Ma nhan vien hoac so dien thoai da ton tai."), true);
  assert.equal(bridge.isDuplicateEmployeeSubmitError("M\u00e3 nh\u00e2n vi\u00ean ho\u1eb7c s\u1ed1 \u0111i\u1ec7n tho\u1ea1i \u0111\u00e3 t\u1ed3n t\u1ea1i."), true);
}

{
  assert.equal(bridge.isEmployeeCreateCompleteAfterSubmit({
    create_clicked: false,
    modal_closed: false,
    generated_username: "TEST6868_1",
    generated_password: "Datchitieu@2025"
  }), false);
  assert.equal(bridge.isEmployeeCreateCompleteAfterSubmit({
    create_clicked: true,
    modal_closed: false,
    generated_username: "TEST6868_1",
    generated_password: "Datchitieu@2025"
  }), false);
  assert.equal(bridge.isEmployeeCreateCompleteAfterSubmit({
    create_clicked: true,
    modal_closed: false,
    row_visible: true,
    generated_username: "TEST6868_1",
    generated_password: "Datchitieu@2025"
  }), true);
  assert.equal(bridge.isEmployeeCreateCompleteAfterSubmit({
    create_clicked: true,
    modal_closed: true,
    generated_username: "TEST6868_1",
    generated_password: "Datchitieu@2025"
  }), true);
}

{
  assert.equal(bridge.isSuccessfulEmployeeResult({ create_status: "Thành công" }), true);
  assert.equal(bridge.isSuccessfulEmployeeResult({ create_status: "Da ton tai" }), false);
  assert.equal(bridge.isSuccessfulEmployeeResult({ create_status: "Đã tồn tại" }), false);
  assert.equal(bridge.isSuccessfulEmployeeResult({ create_status: "Lỗi" }), false);
  assert.equal(source.includes('result.create_status = "Da ton tai";'), false);
  assert.equal(source.includes('var DUPLICATE_EMPLOYEE_ERROR = "Mã nhân viên hoặc số điện thoại đã tồn tại.";'), true);
  assert.equal(source.includes('result.create_error = DUPLICATE_EMPLOYEE_ERROR;'), true);
  assert.equal(source.includes('findGlobalEmployeeSubmitError'), true);
  assert.equal(source.includes('findGlobalEmployeeSubmitErrorNodes()'), true);
  assert.equal(source.includes('ignoredGlobalErrorNodes'), true);

  const result = bridge.createEmployeeResultDefaults({
    employee_code: "TEST6868_5",
    username: "TEST6868_5"
  });
  assert.equal(result.generated_username, "TEST6868_5");
  assert.equal(result.generated_password, "Datchitieu@2025");
  assert.equal(result.create_error, "");
  const duplicateWorkbook = bridge.buildEmployeeResultWorkbook([{
    employee_code: "TEST6868_6",
    full_name: "Nguyễn Văn A",
    create_status: "Lỗi",
    create_error: "Mã nhân viên hoặc số điện thoại đã tồn tại."
  }]);
  assert.match(duplicateWorkbook, /Mã nhân viên hoặc số điện thoại đã tồn tại\./);
}

{
  assert.equal(bridge.normalizeVietnamPhone("941955986"), "0941955986");
  assert.equal(bridge.normalizeVietnamPhone("951753456"), "0951753456");
  assert.equal(bridge.normalizeVietnamPhone("753321475"), "0753321475");
  assert.equal(bridge.normalizeVietnamPhone("9517534563"), "9517534563");
  assert.equal(bridge.normalizeVietnamPhone("0964.498.692"), "0964498692");
  assert.equal(bridge.normalizeVietnamPhone("0902114179"), "0902114179");
  assert.equal(bridge.normalizeVietnamPhone("12345"), "12345");
  assert.equal(bridge.normalizeDateText("01.06.2026"), "01/06/2026");
  assert.equal(bridge.normalizeDateText("8.2.1984"), "08/02/1984");
  assert.equal(bridge.normalizeDateText("17/02/2002"), "17/02/2002");
  assert.deepEqual(bridge.parseDateParts("1/6/2026"), {
    day: 1,
    month: 6,
    year: 2026,
    value: "01/06/2026"
  });
  assert.deepEqual(bridge.parseDatePickerTitle("Thg 06 2026"), { month: 6, year: 2026 });
  assert.equal(bridge.isDateCellForTarget("1", "Thg 06 2026", "01/06/2026"), true);
  assert.equal(bridge.isDateCellForTarget("1", "Thg 07 2026", "01/06/2026"), false);
}

{
  assert.equal(bridge.normalizePersonName("NGUY\u1ec4N HO\u00c0NG THI\u1ec6N"), "Nguy\u1ec5n Ho\u00e0ng Thi\u1ec7n");
  assert.equal(bridge.normalizePersonName("tr\u1ea7n th\u1ecb m\u1ef9 duy\u00ean"), "Tr\u1ea7n Th\u1ecb M\u1ef9 Duy\u00ean");
  assert.equal(bridge.normalizePersonName("  L\u00ca   XU\u00c2N   H\u1ea0NH  "), "L\u00ea Xu\u00e2n H\u1ea1nh");
  assert.equal(bridge.normalizePersonName("NGUY\u1ec4N-V\u0102N A"), "Nguy\u1ec5n-V\u0103n A");

  const employee = bridge.normalizeEmployee({
    full_name: "NGUY\u1ec4N HO\u00c0NG THI\u1ec6N",
    employee_code: "KDBDN0108",
    position: "\u0110HKD",
    province: "NINH B\u00ccNH",
    phone: "975659059",
    email: "existing.mail@kdc.vn",
    start_date: "01/06/2026"
  });
  assert.equal(employee.full_name, "Nguy\u1ec5n Ho\u00e0ng Thi\u1ec7n");
  assert.equal(employee.employee_code, "KDBDN0108");
  assert.equal(employee.portal_sap_code, "KDBDN0108");
  assert.equal(employee.username, "KDBDN0108");
  assert.equal(employee.email, "existing.mail@kdc.vn");
}

{
  const employee = bridge.normalizeEmployee({
    full_name: "TEST AGENT 7",
    employee_code: "TEST6868_7",
    position: "NVBH",
    phone: "951753456",
    start_date: "01/06/2026"
  });
  assert.equal(employee.phone, "0951753456");
  assert.deepEqual(bridge.employeeMissingFields(employee), []);
}

{
  [
    "ĐHKD",
    "DHKD",
    "ĐH KD",
    "ĐH.KD",
    "ĐH-KD",
    "DIEU HANH KINH DOANH",
    "Điều hành kinh doanh"
  ].forEach((position) => {
    assert.equal(bridge.normalizeEmployee({
      full_name: "TEST DHKD POSITION",
      employee_code: "TEST_DHKD_POSITION",
      position,
      province: "NINH BÌNH",
      phone: "975659059",
      start_date: "01/06/2026"
    }).position_form, "Điều hành kinh doanh", position);
  });
}

{
  const employee = bridge.normalizeEmployee({
    full_name: "TEST DHKD",
    employee_code: "TEST6868_DHKD",
    position: "ĐHKD",
    province: "NINH BÌNH",
    phone: "975659059",
    start_date: "01/06/2026"
  });
  assert.equal(employee.position_form, "Điều hành kinh doanh");
  assert.equal(employee.main_base, "NINH BÌNH");
  assert.equal(employee.phone, "0975659059");
  assert.equal(employee.email, "dhkd.t@kdc.vn");
  assert.equal(bridge.employeeRequiresMainBase(employee), true);
  assert.deepEqual(bridge.employeeMissingFields(employee), []);
}

{
  assert.equal(bridge.generateDHKDEmailFromName("Nguyễn Văn A"), "a.nv@kdc.vn");
  assert.equal(bridge.generateDHKDEmailFromName("Nguyễn Văn B"), "b.nv@kdc.vn");
  assert.equal(bridge.generateDHKDEmailFromName("Hoàng Thị Lợi"), "loi.ht@kdc.vn");
  assert.equal(bridge.generateDHKDEmailFromName("Trần Thị Tư Trâm"), "tram.ttt@kdc.vn");

  const dhkd = bridge.normalizeEmployee({
    full_name: "Hoàng Thị Lợi",
    employee_code: "KDBDN0108",
    position: "ĐHKD",
    province: "NINH BÌNH",
    phone: "975659059",
    start_date: "01/06/2026"
  });
  assert.equal(dhkd.email, "loi.ht@kdc.vn");

  const nvbh = bridge.normalizeEmployee({
    full_name: "Nguyễn Văn A",
    employee_code: "KDBDN0109",
    position: "NVBH",
    phone: "941955986",
    start_date: "01/06/2026"
  });
  assert.equal(nvbh.email, "");

  const existing = bridge.normalizeEmployee({
    full_name: "Nguyễn Văn A",
    employee_code: "KDBDN0110",
    position: "ĐHKD",
    province: "NINH BÌNH",
    phone: "941955986",
    email: "custom.email@kdc.vn",
    start_date: "01/06/2026"
  });
  assert.equal(existing.email, "custom.email@kdc.vn");
}

{
  const employee = bridge.normalizeEmployee({
    full_name: "TEST DHKD NO BASE",
    employee_code: "TEST6868_DHKD_2",
    position: "DHKD",
    phone: "975659059",
    start_date: "01/06/2026"
  });
  assert.equal(employee.position_form, "Điều hành kinh doanh");
  assert.deepEqual(bridge.employeeMissingFields(employee), ["Main base/Tỉnh"]);
}

{
  const employee = bridge.normalizeEmployee({
    full_name: "TEST AGENT 8",
    employee_code: "TEST6868_8",
    position: "NVBH",
    phone: "9517534563",
    start_date: "01/06/2026"
  });
  assert.equal(employee.phone, "9517534563");
  assert.deepEqual(bridge.employeeMissingFields(employee), []);
}

{
  const text = [
    "Thông tin đăng nhập",
    "Tên đăng nhập: TEST6868_2",
    "Mật khẩu mặc định: Datchitieu@2025",
    "Mật khẩu này cần được thay đổi trong lần đăng nhập đầu tiên"
  ].join("\n");
  const credentials = bridge.parseGeneratedCredentialsText(text);
  assert.deepEqual(credentials, {
    generated_username: "TEST6868_2",
    generated_password: "Datchitieu@2025"
  });
}

{
  const text = [
    "Them nhan vien",
    "Ho va ten",
    "Ma nhan vien",
    "Ten dang nhap:",
    "Trang thai: Dang hoat dong",
    "Thong tin dang nhap",
    "Ten dang nhap: TEST6868_3",
    "Mat khau mac dinh: Datchitieu@2025",
    "Mat khau nay can duoc thay doi trong lan dang nhap dau tien"
  ].join("\n");
  const credentials = bridge.parseGeneratedCredentialsText(text);
  assert.deepEqual(credentials, {
    generated_username: "TEST6868_3",
    generated_password: "Datchitieu@2025"
  });
}

{
  const transcript = [
    "Agent da doc file nhan su.",
    "NHAN_SU_CREATE_JSON",
    JSON.stringify({
      employees: [
        {
          full_name: "NGUYEN VAN A",
          employee_code: "KDBDN0108",
          phone: "975659059",
          position: "NVBH",
          start_date: "01.06.2026"
        },
        {
          full_name: "TRAN VAN B",
          employee_code: "KDBDN0112",
          phone: "0912228486",
          position: "DHKD",
          province: "NAM ĐỊNH",
          start_date: "02/06/2026"
        }
      ]
    }),
    "END_NHAN_SU_CREATE_JSON"
  ].join("\n");
  const batch = bridge.extractEmployeeBatch(transcript);
  assert.equal(batch.employees.length, 2);
  assert.deepEqual(batch.employees[0], {
    full_name: "Nguyen Van A",
    employee_code: "KDBDN0108",
    portal_sap_code: "KDBDN0108",
    position: "NVBH",
    position_form: "Nhân viên bán hàng",
    phone: "0975659059",
    email: "",
    username: "KDBDN0108",
    status: "Đang hoạt động",
    sales_channel: "GT",
    category: "Bánh",
    start_date: "01/06/2026",
    end_date: "",
    source_row: ""
  });
  assert.equal(batch.employees[1].position_form, "Điều hành kinh doanh");
  assert.equal(batch.employees[1].main_base, "NAM ĐỊNH");
}

{
  const html = bridge.buildEmployeeResultWorkbook([
    {
      full_name: "Nguyễn Văn A",
      employee_code: "KDBDN0108",
      phone: "0975659059",
      username: "KDBDN0108",
      generated_username: "KDBDN0108",
      generated_password: "Datchitieu@2025",
      create_status: "Thành công",
      create_error: ""
    }
  ]);
  assert.match(html, /<table/);
  assert.match(html, /MẬT KHẨU MẶC ĐỊNH/);
  assert.match(html, /MÃ NHÂN VIÊN/);
  assert.match(html, /Nguyễn Văn A/);
  assert.match(html, /Thành công/);
  assert.match(html, /Content-Type/);
  assert.match(html, /font-family:Segoe UI/);
  assert.match(html, /Datchitieu@2025/);
  assert.match(html, /mso-number-format:'\\@'/);
  assert.match(html, /0975659059/);
  const downloadEmployeeResultsBody = source.match(/function downloadEmployeeResults[\s\S]+?function downloadEmployeeUpdateResults/)[0];
  assert.equal(downloadEmployeeResultsBody.includes("downloadWorkbookFile"), true);
  const createAttachment = bridge.buildEmployeeResultAttachment([
    {
      full_name: "Nguyễn Văn A",
      employee_code: "KDBDN0108",
      generated_username: "KDBDN0108",
      generated_password: "Datchitieu@2025",
      create_status: "Lỗi",
      create_error: "Không tạo được tài khoản"
    }
  ]);
  assert.match(createAttachment.filename, /^ket-qua-tao-nhan-vien-\d{4}-\d{2}-\d{2}\.xls$/);
  assert.equal(createAttachment.kind, "employee_create_result");
  const decodedCreateAttachment = Buffer.from(createAttachment.content_base64, "base64").toString("utf8");
  assert.equal(decodedCreateAttachment.startsWith("\uFEFF"), true);
  assert.match(decodedCreateAttachment, /Nguyễn Văn A/);
  assert.match(decodedCreateAttachment, /Không tạo được tài khoản/);
}

{
  const csv = [
    "STT,MÃ DMS,VÙNG,TỈNH,HỌ VÀ TÊN,NGÀY SINH,CHỨC VỤ,CẤP QUẢN LÝ TRỰC TIẾP,NƠI LÀM VIỆC,LÝ DO,NGÀY NHẬN VIỆC,ĐTDĐ,GHI CHÚ",
    "1,KDBMD0361,MIỀN ĐÔNG 2,LÂM ĐỒNG,NGUYỄN HOÀNG THIỆN,02.01.1979,NVBH,NGÔ QUỐC TUÂN,NPP THỦY LỘC,THAY THẾ,01.06.2026,941955986,"
  ].join("\n");
  const batch = bridge.parseEmployeeCsv(csv);
  assert.equal(batch.employees.length, 1);
  assert.equal(batch.employees[0].employee_code, "KDBMD0361");
  assert.equal(batch.employees[0].portal_sap_code, "KDBMD0361");
  assert.equal(batch.employees[0].username, "KDBMD0361");
  assert.equal(batch.employees[0].phone, "0941955986");
  assert.equal(batch.employees[0].start_date, "01/06/2026");
}

{
  const csv = [
    "STT,MÃ DMS,VÙNG,TỈNH,HỌ VÀ TÊN,NGÀY SINH,CHỨC VỤ,CẤP QUẢN LÝ TRỰC TIẾP,NƠI LÀM VIỆC,LÝ DO,NGÀY NHẬN VIỆC,ĐTDĐ,GHI CHÚ",
    "1,KDBDN0108,ĐBSH,NINH BÌNH,HOÀNG THỊ LỢI,29.8.1983,ĐHKD,ĐÀO NGỌC DUẨN,NPP CƯỜNG THỊNH,THAY THẾ,01.06.2026,975659059,"
  ].join("\n");
  const batch = bridge.parseEmployeeCsv(csv);
  assert.equal(batch.employees.length, 1);
  assert.equal(batch.employees[0].position_form, "Điều hành kinh doanh");
  assert.equal(batch.employees[0].main_base, "NINH BÌNH");
  assert.deepEqual(bridge.employeeMissingFields(batch.employees[0]), []);
}

{
  const csv = [
    "STT,MÃ DMS,VÙNG,TỈNH,HỌ VÀ TÊN,NGÀY SINH,CHỨC VỤ,CẤP QUẢN LÝ TRỰC TIẾP,NƠI LÀM VIỆC,LÝ DO,NGÀY NHẬN VIỆC,ĐTDĐ,EMAIL,GHI CHÚ",
    "1,KDBDN0108,ĐBSH,NINH BÌNH,HOÀNG THỊ LỢI,29.8.1983,ĐHKD,ĐÀO NGỌC DUẨN,NPP CƯỜNG THỊNH,THAY THẾ,01.06.2026,975659059,loi.custom@kdc.vn,"
  ].join("\n");
  const batch = bridge.parseEmployeeCsv(csv);
  assert.equal(batch.employees.length, 1);
  assert.equal(batch.employees[0].position_form, "Điều hành kinh doanh");
  assert.equal(batch.employees[0].email, "loi.custom@kdc.vn");
}

{
  const terms = bridge.inputSearchTerms("So dien thoai");
  assert.equal(terms.some((term) => bridge.fieldTextMatches("Số điện thoại liên hệ", term)), true);
  assert.equal(terms.some((term) => bridge.fieldTextMatches("Email", term)), false);
}

{
  assert.equal(bridge.optionTextMatches("Điều hành kinh doanh", "Điều hành kinh doanh"), true);
  assert.equal(bridge.optionTextMatches("ĐIỀU HÀNH KINH DOANH", "Điều hành kinh doanh"), true);
  assert.equal(bridge.optionTextMatches("Nhân viên bán hàng Điều hành kinh doanh", "Điều hành kinh doanh"), false);
  assert.equal(typeof bridge.selectedValueMatches, "function");
  const multiCategorySelect = {
    tagName: "div",
    getAttribute() {
      return "";
    },
    querySelector() {
      return null;
    },
    querySelectorAll(selector) {
      if (!selector.includes(".ant-select-selection-item")) return [];
      return [
        {
          value: "",
          innerText: "Bánh",
          textContent: "Bánh",
          getAttribute(name) {
            return name === "title" ? "Bánh" : "";
          }
        },
        {
          value: "",
          innerText: "Trung Thu",
          textContent: "Trung Thu",
          getAttribute(name) {
            return name === "title" ? "Trung Thu" : "";
          }
        }
      ];
    }
  };
  assert.equal(bridge.selectedValueMatches(multiCategorySelect, "Trung thu"), true);
  assert.equal(bridge.selectedValueMatches(multiCategorySelect, "Dầu"), false);
  assert.deepEqual(bridge.employeeFormMismatches({
    position_form: "Điều hành kinh doanh",
    main_base: "NINH BÌNH"
  }, {
    position_form: "Nhân viên bán hàng",
    main_base: ""
  }), [
    "position_form: dang la Nhân viên bán hàng, can Điều hành kinh doanh",
    "main_base: dang la , can NINH BÌNH"
  ]);
  assert.equal(source.includes("findDropdownOptionByExactText"), true);
  assert.equal(source.includes("waitForSelectLabelValue"), true);
  assert.equal(source.includes("commitDropdownOption"), true);
  assert.equal(source.includes("keyboardSelectDropdownOption"), true);
  assert.equal(source.includes(".ant-select-selection-selected-value"), true);
  const selectByLabelBody = source.match(/async function selectByLabel[\s\S]+?function clickRadioText/)[0];
  const webDropdownBranch = selectByLabelBody.slice(selectByLabelBody.indexOf("await openDropdownForSelect(select);"));
  const firstSearchAttempt = webDropdownBranch.indexOf("searchAndCommitDropdownOption(select, optionText)");
  const earlyMissingOptionThrow = webDropdownBranch.indexOf('throw new Error("Khong tim thay lua chon "');
  assert.equal(firstSearchAttempt >= 0, true);
  assert.equal(earlyMissingOptionThrow === -1 || firstSearchAttempt < earlyMissingOptionThrow, true);
  const searchAndCommitBody = source.match(/async function searchAndCommitDropdownOption[\s\S]+?async function keyboardSelectDropdownOption/)[0];
  assert.equal(searchAndCommitBody.includes("waitFor(function()"), true);
}

async function runAsyncTests() {
  const attachmentContent = "\uFEFFNguyễn Văn A\nKhông tạo được tài khoản";
  const attachment = {
    filename: "ket-qua-tao-nhan-vien-2026-06-10.xls",
    mime_type: "application/vnd.ms-excel",
    content_base64: Buffer.from(attachmentContent, "utf8").toString("base64"),
    size_bytes: Buffer.byteLength(attachmentContent, "utf8"),
    kind: "employee_create_result"
  };
  function makeTicketKv() {
    const store = new Map();
    return {
      store,
      async get(key) {
        return store.has(key) ? store.get(key) : null;
      },
      async put(key, value) {
        store.set(key, value);
      }
    };
  }
  const ticketKv = makeTicketKv();
  const originalFetch = global.fetch;
  try {
    const optionsRes = await supportWorker.handleFeedback(new Request("https://worker.test/feedback", {
      method: "OPTIONS"
    }), { SUPPORT_TICKETS: ticketKv });
    const optionsJson = await optionsRes.json();
    assert.equal(optionsJson.ok, true);
    assert.equal(optionsJson.worker_version, "1.2.8");
    assert.equal(optionsJson.capabilities.attachments, true);
    assert.equal(optionsJson.capabilities.telegram_actions, true);
    assert.equal(optionsJson.capabilities.ticket_sync, true);

    const getRes = await supportWorker.handleFeedback(new Request("https://worker.test/feedback", {
      method: "GET"
    }), {});
    const getJson = await getRes.json();
    assert.equal(getJson.capabilities.ticket_sync, false);

    const versionRes = await supportWorker.handleFeedback(new Request("https://worker.test/extension-version", {
      method: "GET"
    }), { SUPPORT_TICKETS: ticketKv });
    const versionJson = await versionRes.json();
    assert.equal(versionJson.ok, true);
    assert.equal(versionJson.latest_version, "1.2.8");
    assert.equal(versionJson.min_supported_version, "1.2.8");
    assert.match(versionJson.download_url, /github\.com\/hungdz2001\/kido-dms-assistant-extension\/releases\/download\/v1\.2\.8\/dms-assistant-extension-v1\.2\.8\.zip/);

    const callsWithoutAttachment = [];
    global.fetch = async function(url, options) {
      callsWithoutAttachment.push({ url: String(url), options: options || {} });
      return new Response(JSON.stringify({ ok: true, result: { message_id: 11, chat: { id: "chat" } } }), { status: 200 });
    };
    const resWithoutAttachment = await supportWorker.handleFeedback(new Request("https://worker.test/feedback", {
      method: "POST",
      body: JSON.stringify({
        source: "employee-extension",
        type: "bug",
        urgency: "high",
        sender: "Tester",
        message: "Loi khong kem file"
      })
    }), {
      TELEGRAM_BOT_TOKEN: "token",
      TELEGRAM_CHAT_ID: "chat",
      SUPPORT_TICKETS: ticketKv
    });
    const jsonWithoutAttachment = await resWithoutAttachment.json();
    assert.equal(jsonWithoutAttachment.ok, true);
    assert.match(jsonWithoutAttachment.ticket_id, /^KIDO-\d{8}-/);
    assert.equal(jsonWithoutAttachment.attachment_received, false);
    assert.equal(jsonWithoutAttachment.attachment_sent, false);
    assert.equal(jsonWithoutAttachment.capabilities.ticket_sync, true);
    assert.equal(callsWithoutAttachment.length, 1);
    assert.match(callsWithoutAttachment[0].url, /sendMessage/);
    assert.equal(JSON.parse(callsWithoutAttachment[0].options.body).reply_markup.inline_keyboard[0][0].text, "Đã nhận");

    const callsWithAttachment = [];
    global.fetch = async function(url, options) {
      callsWithAttachment.push({ url: String(url), options: options || {} });
      return new Response(JSON.stringify({ ok: true, result: { message_id: callsWithAttachment.length + 20, chat: { id: "chat" } } }), { status: 200 });
    };
    const resWithAttachment = await supportWorker.handleFeedback(new Request("https://worker.test/feedback", {
      method: "POST",
      body: JSON.stringify({
        source: "employee-extension",
        type: "bug",
        urgency: "high",
        sender: "Tester",
        message: "Loi co kem file",
        attachment: attachment
      })
    }), {
      TELEGRAM_BOT_TOKEN: "token",
      TELEGRAM_CHAT_ID: "chat",
      SUPPORT_TICKETS: ticketKv
    });
    const jsonWithAttachment = await resWithAttachment.json();
    assert.equal(jsonWithAttachment.ok, true);
    assert.equal(jsonWithAttachment.attachment_received, true);
    assert.equal(jsonWithAttachment.attachment_sent, true);
    assert.equal(jsonWithAttachment.worker_version, "1.2.8");
    assert.equal(callsWithAttachment.length, 2);
    assert.match(callsWithAttachment[0].url, /sendMessage/);
    assert.match(callsWithAttachment[1].url, /sendDocument/);
    assert.equal(callsWithAttachment[1].options.body instanceof FormData, true);

    const callsWithoutKv = [];
    global.fetch = async function(url, options) {
      callsWithoutKv.push({ url: String(url), options: options || {} });
      return new Response(JSON.stringify({ ok: true, result: { message_id: 30, chat: { id: "chat" } } }), { status: 200 });
    };
    const resWithoutKv = await supportWorker.handleFeedback(new Request("https://worker.test/feedback", {
      method: "POST",
      body: JSON.stringify({
        source: "employee-extension",
        type: "bug",
        urgency: "high",
        sender: "Tester",
        message: "Loi co kem file khong co KV",
        attachment: attachment
      })
    }), {
      TELEGRAM_BOT_TOKEN: "token",
      TELEGRAM_CHAT_ID: "chat"
    });
    const jsonWithoutKv = await resWithoutKv.json();
    assert.equal(jsonWithoutKv.ok, true);
    assert.equal(jsonWithoutKv.attachment_sent, true);
    assert.equal(jsonWithoutKv.capabilities.ticket_sync, false);
    assert.equal(callsWithoutKv.length, 2);
    assert.match(callsWithoutKv[1].url, /sendDocument/);

    const callbackCalls = [];
    global.fetch = async function(url, options) {
      callbackCalls.push({ url: String(url), options: options || {} });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    const callbackRes = await supportWorker.handleFeedback(new Request("https://worker.test/telegram-webhook", {
      method: "POST",
      body: JSON.stringify({
        callback_query: {
          id: "callback-1",
          data: "ticket:" + jsonWithAttachment.ticket_id + ":processing",
          message: {
            message_id: 20,
            chat: { id: "chat" },
            text: "Ticket: " + jsonWithAttachment.ticket_id
          },
          from: { first_name: "Hung" }
        }
      })
    }), {
      TELEGRAM_BOT_TOKEN: "token",
      TELEGRAM_CHAT_ID: "chat",
      SUPPORT_TICKETS: ticketKv
    });
    assert.equal((await callbackRes.json()).ok, true);
    assert.equal(callbackCalls.some((call) => /answerCallbackQuery/.test(call.url)), true);
    assert.equal(callbackCalls.some((call) => /editMessageText/.test(call.url)), true);

    const earlyAnswerCalls = [];
    global.fetch = async function(url, options) {
      earlyAnswerCalls.push({ url: String(url), options: options || {} });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    const earlyAnswerRes = await supportWorker.handleFeedback(new Request("https://worker.test/telegram-webhook", {
      method: "POST",
      body: JSON.stringify({
        callback_query: {
          id: "callback-fast",
          data: "ticket:KIDO-20260610-FAST01:done",
          message: {
            message_id: 21,
            chat: { id: "chat" },
            text: "Ticket: KIDO-20260610-FAST01"
          },
          from: { first_name: "Hung" }
        }
      })
    }), {
      TELEGRAM_BOT_TOKEN: "token",
      TELEGRAM_CHAT_ID: "chat",
      SUPPORT_TICKETS: {
        async get() { throw new Error("KV dang cham"); },
        async put() { throw new Error("KV dang cham"); }
      }
    });
    const earlyAnswerJson = await earlyAnswerRes.json();
    assert.equal(earlyAnswerJson.ok, true);
    assert.equal(earlyAnswerJson.ticket_sync, false);
    assert.match(earlyAnswerCalls[0].url, /answerCallbackQuery/);

    const replyRes = await supportWorker.handleFeedback(new Request("https://worker.test/telegram-webhook", {
      method: "POST",
      body: JSON.stringify({
        message: {
          text: "Cần kiểm tra lại file kết quả",
          chat: { id: "chat" },
          reply_to_message: {
            text: "Ticket: " + jsonWithAttachment.ticket_id
          },
          from: { first_name: "Hung" }
        }
      })
    }), {
      TELEGRAM_BOT_TOKEN: "token",
      TELEGRAM_CHAT_ID: "chat",
      SUPPORT_TICKETS: ticketKv
    });
    assert.equal((await replyRes.json()).ok, true);

    const statusRes = await supportWorker.handleFeedback(new Request("https://worker.test/ticket-status?id=" + encodeURIComponent(jsonWithAttachment.ticket_id), {
      method: "GET"
    }), { SUPPORT_TICKETS: ticketKv });
    const statusJson = await statusRes.json();
    assert.equal(statusJson.ok, true);
    assert.equal(statusJson.ticket.status, "processing");
    assert.equal(statusJson.ticket.latest_note, "Cần kiểm tra lại file kết quả");
  } finally {
    global.fetch = originalFetch;
  }
}

{
  assert.deepEqual(bridge.employeeFormMismatches({
    position_form: "Điều hành kinh doanh",
    main_base: "NINH BÌNH"
  }, {
    position_form: "DIEU HANH KINH DOANH",
    main_base: "Ninh Bình"
  }), []);
}

runAsyncTests().then(function() {
  console.log("employee account creator tests passed");
}).catch(function(err) {
  console.error(err);
  process.exitCode = 1;
});
