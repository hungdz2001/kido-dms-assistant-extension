(function(root) {
  "use strict";

  var WORKER_ORIGIN = "";
  var SEND_PATH = "";
  var FEEDBACK_WORKER_URL = "https://kdc-employee-support.chillwithdms.workers.dev/feedback";
  var EXTENSION_VERSION = "1.2.2";
  var STORAGE_KEY = "lmb_last_sent_signature_v1";
  var EMPLOYEE_BATCH_KEY = "lmb_employee_batch_v1";
  var EMPLOYEE_QUEUE_HASH_KEY = "lmb_employee_queue";
  var TOOLBAR_VISIBLE_KEY = "lmb_toolbar_visible_v1";
  var LAST_ADMIN_LOG_KEY = "lmb_last_admin_log_v1";
  var LAST_SUPPORT_TICKET_KEY = "lmb_last_support_ticket_v1";
  var LAST_RESULT_ATTACHMENT_KEY = "lmb_latest_result_attachment_v1";
  var UPDATE_NOTICE_SNOOZE_KEY = "lmb_update_notice_snooze_v1";
  var UPDATE_REQUIRED_TEST_KEY = "lmb_force_update_required_test_v1";
  var UPDATE_NOTICE_SNOOZE_MS = 12 * 60 * 60 * 1000;
  var CONTROL_PANEL_ACTIVE_TAB_KEY = "lmb_active_control_tab_v1";
  var SUPPORT_TICKET_ACTIVE_POLL_MS = 5000;
  var SUPPORT_TICKET_DONE_POLL_MS = 60000;
  var ADMIN_EMPLOYEE_BAKERY_URL = "https://admin2.kido.vn/userManager/list?status=ACTIVE";
  var ADMIN_EMPLOYEE_OIL_URL = "https://admin2.kido.vn/userManager/list";
  var ADMIN_EMPLOYEE_URL = ADMIN_EMPLOYEE_BAKERY_URL;
  var DEFAULT_EMPLOYEE_PASSWORD = "Datchitieu@2025";
  var EMPLOYEE_UPDATE_QUEUE_TYPE = "employee_update";
  var UPDATE_TASK_RESIGNATION = "resignation";
  var UPDATE_TASK_MID_AUTUMN = "add_mid_autumn";
  var MID_AUTUMN_CATEGORY = "Trung thu";
  var EXTENSION_TITLE = "AUTO TẠO TÀI KHOẢN NHÂN VIÊN";
  var EXTENSION_AUTHOR = "HƯNG ĐẸP TRAI";
  var SUPPORT_ATTACHMENT_MAX_BYTES = 3 * 1024 * 1024;
  var ADMIN_HOST_RE = /(^|\.)admin2\.kido\.vn$/i;

  function stripAccents(value) {
    try {
      return String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\u0111/g, "d")
        .replace(/\u0110/g, "D")
        .replace(/đ/g, "d")
        .replace(/Đ/g, "D");
    } catch (e) {
      return String(value || "").replace(/đ/g, "d").replace(/Đ/g, "D");
    }
  }

  function normalizeSpace(value) {
    return String(value || "").replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  }

  function cleanField(value) {
    return normalizeSpace(value).replace(/^["'`]+|["'`]+$/g, "").trim();
  }

  function limitText(value, max) {
    var text = cleanField(value);
    var limit = max || 1000;
    return text.length > limit ? text.slice(0, limit) : text;
  }

  function utf8ByteLength(value) {
    var text = String(value || "");
    if (typeof Buffer !== "undefined") return Buffer.byteLength(text, "utf8");
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(text).length;
    return unescape(encodeURIComponent(text)).length;
  }

  function base64ByteLength(value) {
    var text = String(value || "").replace(/\s/g, "");
    if (!text) return 0;
    var padding = (text.match(/=+$/) || [""])[0].length;
    return Math.max(0, Math.floor(text.length * 3 / 4) - padding);
  }

  function normalizeSupportAttachment(attachment) {
    if (!attachment || typeof attachment !== "object") return { attachment: null, note: "" };
    var filename = limitText(attachment.filename, 160);
    var contentBase64 = String(attachment.content_base64 || "").replace(/\s/g, "");
    var sizeBytes = Number(attachment.size_bytes) || base64ByteLength(contentBase64);
    if (!filename || !contentBase64 || !sizeBytes) return { attachment: null, note: "" };
    if (sizeBytes > SUPPORT_ATTACHMENT_MAX_BYTES) {
      return {
        attachment: null,
        note: "File ket qua qua lon nen khong dinh kem. Vui long tai file ket qua tren may va gui rieng khi can kiem tra chi tiet."
      };
    }
    return {
      attachment: {
        filename: filename,
        mime_type: limitText(attachment.mime_type || "application/octet-stream", 120),
        content_base64: contentBase64,
        size_bytes: sizeBytes,
        kind: limitText(attachment.kind || "employee_update_result", 80)
      },
      note: ""
    };
  }

  function buildSupportFeedbackPayload(input) {
    input = input || {};
    var message = limitText(input.message, 5000);
    if (!message) throw new Error("Nhap noi dung phan hoi truoc khi gui.");
    var attachmentInfo = normalizeSupportAttachment(input.attachment);
    if (attachmentInfo.note) {
      message = limitText(message + "\n\n" + attachmentInfo.note, 5000);
    }
    var payload = {
      source: "employee-extension",
      version: EXTENSION_VERSION,
      type: limitText(input.type || "feedback", 40) || "feedback",
      urgency: limitText(input.urgency || "normal", 40) || "normal",
      sender: limitText(input.sender || "", 120),
      message: message,
      context: {
        url: limitText(input.url || (root.location && root.location.href) || "", 500),
        time: input.time || new Date().toISOString(),
        log: limitText(input.log || "", 4000),
        command: limitText(input.command || "", 500)
      }
    };
    if (attachmentInfo.attachment) payload.attachment = attachmentInfo.attachment;
    return payload;
  }

  function formatSupportLogLine(message, options) {
    var status = options && options.status ? options.status : options && options.canResume ? "paused" : options && options.canPause ? "running" : "info";
    return "[" + new Date().toISOString() + "] " + status + " - " + cleanField(message);
  }

  function encodeUtf8Base64(value) {
    var text = String(value || "");
    if (typeof Buffer !== "undefined") return Buffer.from(text, "utf8").toString("base64");
    if (root && root.btoa) {
      return root.btoa(unescape(encodeURIComponent(text)));
    }
    throw new Error("Khong ho tro ma hoa queue.");
  }

  function decodeUtf8Base64(value) {
    var text = String(value || "");
    if (typeof Buffer !== "undefined") return Buffer.from(text, "base64").toString("utf8");
    if (root && root.atob) {
      return decodeURIComponent(escape(root.atob(text)));
    }
    throw new Error("Khong ho tro giai ma queue.");
  }

  function arrayBufferToBase64(buffer) {
    if (typeof Buffer !== "undefined") return Buffer.from(buffer).toString("base64");
    var bytes = new Uint8Array(buffer || []);
    var binary = "";
    for (var i = 0; i < bytes.length; i += 0x8000) {
      var chunk = bytes.subarray(i, i + 0x8000);
      binary += String.fromCharCode.apply(null, chunk);
    }
    return root.btoa(binary);
  }

  function supportAttachmentMimeType(file) {
    var type = cleanField(file && file.type);
    var filename = cleanField(file && file.name).toLowerCase();
    if (type) return type;
    if (/\.csv$/i.test(filename)) return "text/csv";
    if (/\.txt$/i.test(filename)) return "text/plain";
    if (/\.xlsx$/i.test(filename)) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    return "application/vnd.ms-excel";
  }

  function normalizeEmployeeCategoryChoice(category) {
    var plain = stripAccents(category).toLowerCase();
    return plain.indexOf("dau") >= 0 ? "Dầu" : "Bánh";
  }

  function employeeAdminUrlForCategory(category) {
    return normalizeEmployeeCategoryChoice(category) === "Dầu" ? ADMIN_EMPLOYEE_OIL_URL : ADMIN_EMPLOYEE_BAKERY_URL;
  }

  function applyEmployeeCategoryChoice(employees, category) {
    var selectedCategory = normalizeEmployeeCategoryChoice(category);
    return (employees || []).map(function(employee) {
      return Object.assign({}, employee, { category: selectedCategory });
    });
  }

  function buildEmployeeSearchUrl(employeeCode, activeOnly) {
    var params = [];
    if (activeOnly !== false) params.push("status=ACTIVE");
    var code = cleanField(employeeCode);
    if (code) params.push("keyword=" + encodeURIComponent(code));
    return "https://admin2.kido.vn/userManager/list" + (params.length ? "?" + params.join("&") : "");
  }

  function employeeAdminUrlForQueue(queue) {
    if (queue && queue.queue_type === EMPLOYEE_UPDATE_QUEUE_TYPE) {
      var employee = employeeAtQueueIndex(queue, queue.current_index || 0) || (queue.employees || [])[0] || {};
      return buildEmployeeSearchUrl(employee.employee_code, true);
    }
    return employeeAdminUrlForCategory(queue && queue.category_choice);
  }

  function buildAdminEmployeeQueueUrl(queue, baseUrl) {
    var encoded = encodeURIComponent(encodeUtf8Base64(JSON.stringify(queue || {})));
    var targetUrl = baseUrl || employeeAdminUrlForQueue(queue);
    return targetUrl + "#" + EMPLOYEE_QUEUE_HASH_KEY + "=" + encoded;
  }

  function decodeEmployeeQueueFromHash(hash) {
    var value = String(hash || "").replace(/^#/, "");
    if (!value) return null;
    var params = new URLSearchParams(value);
    var encoded = params.get(EMPLOYEE_QUEUE_HASH_KEY);
    if (!encoded) return null;
    return JSON.parse(decodeUtf8Base64(decodeURIComponent(encoded)));
  }

  function removeEmployeeQueueHashValue(hash) {
    var value = String(hash || "").replace(/^#/, "");
    if (!value) return "";
    var params = new URLSearchParams(value);
    params.delete(EMPLOYEE_QUEUE_HASH_KEY);
    var next = params.toString();
    return next ? "#" + next : "";
  }

  function clearEmployeeQueueHash() {
    if (!root.location || !root.history || !root.history.replaceState) return;
    var nextHash = removeEmployeeQueueHashValue(root.location.hash);
    root.history.replaceState(null, document.title, root.location.pathname + root.location.search + nextHash);
  }

  function isApprovalText(text) {
    var plain = stripAccents(text).toLowerCase();
    return /(duyet|ok|dong y|xac nhan).{0,50}(gui|send|mail|email)/i.test(plain) ||
           /(gui|send).{0,30}(di|mail|email).{0,50}(duyet|ok|xac nhan)/i.test(plain);
  }

  function uniqueEmails(text) {
    var matches = String(text || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
    var seen = {};
    return matches.filter(function(email) {
      var key = email.toLowerCase();
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  function extractLabel(text, labelPattern, stopPattern) {
    var re = new RegExp(labelPattern + "\\s*(?:l\\u00e0|la|:|=)\\s*([\\s\\S]+?)(?=" + stopPattern + "|$)", "i");
    var m = re.exec(text);
    return m ? cleanField(m[1]) : "";
  }

  function trimApprovalTail(value) {
    return cleanField(String(value || "").replace(/\s*(?:Duy[e\u1ec7]t|OK|Ok|ok)\s*,?\s*g[u\u1eedi]i\s*(?:\u0111i|di)?\.?\s*$/i, ""));
  }

  function extractInlineCommand(text) {
    var emails = uniqueEmails(text);
    var stopForSubject = "\\s*(?:,|\\n)?\\s*(?:body|n\\u1ed9i dung|noi dung)\\s*(?:l\\u00e0|la|:|=)|\\s*(?:Duy[e\u1ec7]t|OK|Ok|ok)\\s*,?\\s*g[u\u1eedi]i|$";
    var stopForBody = "\\s*(?:Duy[e\u1ec7]t|OK|Ok|ok)\\s*,?\\s*g[u\u1eedi]i|$";
    var subject = extractLabel(text, "(?:subject|ti\\u00eau \\u0111\\u1ec1(?: email)?|tieu de(?: email)?)", stopForSubject);
    var body = extractLabel(text, "(?:body|n\\u1ed9i dung(?: email)?|noi dung(?: email)?)", stopForBody);

    subject = trimApprovalTail(subject.replace(/,\s*$/g, ""));
    body = trimApprovalTail(body);

    if (!emails.length || !subject || !body) return null;
    return {
      to_email: emails.join(","),
      subject: subject,
      body: body,
      source: "user_message"
    };
  }

  function extractDraft(text) {
    var markers = [
      "E. B\u1ea2N NH\u00c1P EMAIL N\u1ed8I B\u1ed8",
      "E. BAN NHAP EMAIL NOI BO",
      "B\u1ea2N NH\u00c1P EMAIL N\u1ed8I B\u1ed8",
      "BAN NHAP EMAIL NOI BO"
    ];
    var upper = stripAccents(text).toUpperCase();
    var start = -1;
    markers.forEach(function(marker) {
      var idx = upper.lastIndexOf(stripAccents(marker).toUpperCase());
      if (idx > start) start = idx;
    });
    var segment = start >= 0 ? text.slice(start) : text;
    var emails = uniqueEmails(segment);

    var subjectMatch = /(?:Ti\u00eau \u0111\u1ec1 email|Tieu de email|Subject)[ \t]*:[ \t]*([^\r\n]+)/i.exec(segment);
    var bodyMatch = /(?:N\u1ed9i dung email|Noi dung email|N\u1ed9i dung|Noi dung)\s*:\s*([\s\S]+)/i.exec(segment);
    if (!emails.length || !subjectMatch || !bodyMatch) return null;

    var body = bodyMatch[1]
      .replace(/\n\s*F\.\s*(?:TR\u1ea0NG TH\u00c1I|TRANG THAI)[\s\S]*$/i, "")
      .replace(/\n\s*(?:F\.|TR\u1ea0NG TH\u00c1I|TRANG THAI)\b[\s\S]*$/i, "");

    return {
      to_email: emails.join(","),
      subject: cleanField(subjectMatch[1]),
      body: cleanField(body),
      source: "draft"
    };
  }

  function extractMailData(text) {
    var draft = extractDraft(text);
    if (draft) return draft;

    var inlineHint = isApprovalText(text) ||
      /(?:subject|ti\u00eau \u0111\u1ec1|tieu de)[\s\S]{0,300}(?:body|n\u1ed9i dung|noi dung)\s*(?:l\u00e0|la|:|=)/i.test(text);
    if (inlineHint) {
      var inline = extractInlineCommand(text);
      if (inline) return inline;
    }
    return null;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function buildUiFooterHtml() {
    return '<div class="lmb-footer"><span>Phụ trách</span><b>' + escapeHtml(EXTENSION_AUTHOR) + '</b></div>';
  }

  function buildUiHeaderHtml(title, subtitle) {
    return '<div class="lmb-card__header">' +
      '<div class="lmb-mark">AI</div>' +
      '<div class="lmb-card__heading">' +
      '<div class="lmb-card__title">' + escapeHtml(title || EXTENSION_TITLE) + '</div>' +
      '<div class="lmb-card__subtitle">' + escapeHtml(subtitle || "") + '</div>' +
      '</div>' +
      '</div>';
  }

  function buildStatusPillHtml(status, label) {
    var key = cleanField(status || "ready").toLowerCase();
    return '<span class="lmb-status-pill lmb-status-' + escapeHtml(key) + '">' +
      escapeHtml(label || "Sẵn sàng") +
      '</span>';
  }

  function buildGuideStepsHtml(mode) {
    var compact = mode === "compact";
    var steps = [
      "Chọn ngành cần tạo: Bánh hoặc Dầu.",
      "Nhập file Excel/CSV nhân sự.",
      "Kiểm tra danh sách và chọn Duyệt & tạo tự động."
    ];
    return '<div class="lmb-guide' + (compact ? " lmb-guide-compact" : "") + '">' +
      '<div class="lmb-guide-title">Quy trình xử lý</div>' +
      '<ol class="lmb-guide-steps">' +
      steps.map(function(step) {
        return '<li>' + escapeHtml(step) + '</li>';
      }).join("") +
      '</ol>' +
      '<div class="lmb-guide-tip">Không tắt tab DMS khi automation đang chạy. File kết quả sẽ tự tải xuống khi hoàn tất.</div>' +
      '</div>';
  }

  function ensureUiStyles() {
    if (typeof document === "undefined" || !document.head || document.getElementById("lmb_styles")) return;
    var style = document.createElement("style");
    style.id = "lmb_styles";
    style.textContent = [
      "#lmb_toast,#lmb_confirm,#lmb_employee_review,#lmb_admin_panel,#lmb_control_center,.lmb-fab{--lmb-font:\"Segoe UI\",Roboto,\"Helvetica Neue\",Arial,sans-serif;--lmb-ink:#e5f2ff;--lmb-muted:#8aa4bd;--lmb-panel:#07111f;--lmb-panel-2:#0b1728;--lmb-line:rgba(148,163,184,.26);--lmb-cyan:#22d3ee;--lmb-teal:#14b8a6;box-sizing:border-box;font-family:var(--lmb-font);letter-spacing:0}",
      "#lmb_toast * ,#lmb_confirm * ,#lmb_employee_review * ,#lmb_admin_panel * ,#lmb_control_center * ,.lmb-fab *{box-sizing:border-box}",
      ".lmb-toast{position:fixed;right:18px;bottom:360px;z-index:2147483647;max-width:390px;padding:12px 42px 12px 14px;border-radius:8px;box-shadow:0 14px 34px rgba(15,23,42,.24);font:13px/1.45 var(--lmb-font);background:#1f2937;color:#fff;border-left:4px solid #38bdf8}",
      ".lmb-toast-close,.lmb-admin-close{position:absolute;top:7px;right:8px;width:26px;height:26px;border:0;border-radius:6px;background:rgba(255,255,255,.14);color:inherit;font:800 16px/1 var(--lmb-font);cursor:pointer;display:flex;align-items:center;justify-content:center}.lmb-toast-close:hover,.lmb-admin-close:hover{background:rgba(255,255,255,.24)}",
      ".lmb-toast.is-ok{background:#064e3b;border-left-color:#34d399}.lmb-toast.is-error{background:#991b1b;border-left-color:#f97316}",
      ".lmb-card{position:fixed;right:18px;bottom:128px;z-index:2147483647;background:#fff;color:#111827;border:1px solid #dbe3ea;border-radius:8px;box-shadow:0 22px 54px rgba(15,23,42,.28);font:13px/1.45 var(--lmb-font);overflow:hidden}",
      ".lmb-mail-card{width:min(460px,calc(100vw - 36px))}.lmb-employee-card{width:min(920px,calc(100vw - 36px));max-height:82vh}",
      ".lmb-employee-card{bottom:24px;max-height:calc(100vh - 48px)}body.lmb-review-open #lmb_control_center{display:none}body.lmb-review-open .lmb-toast{top:18px;bottom:auto}",
      ".lmb-card__header{padding:14px 16px;border-bottom:1px solid #e5e7eb;background:#f8fafc;display:flex;align-items:center;gap:10px}",
      ".lmb-mark{width:34px;height:34px;border-radius:8px;background:#0f766e;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:12px;flex:0 0 auto}",
      ".lmb-card__heading{min-width:0}.lmb-card__title{font-weight:800;font-size:14px;color:#0f172a}.lmb-card__subtitle{font-size:12px;color:#64748b;margin-top:2px}",
      ".lmb-card__body{padding:14px 16px;display:grid;gap:10px}.lmb-note{background:#eff6ff;border:1px solid #bfdbfe;color:#1e3a8a;border-radius:8px;padding:9px 10px}",
      ".lmb-field{display:grid;gap:6px;color:#d8e7f5;font-weight:800}.lmb-field span{font-size:11px;text-transform:none;letter-spacing:.01em}.lmb-field input,.lmb-field textarea,.lmb-field select{width:100%;box-sizing:border-box;padding:9px 11px;border:1px solid rgba(148,163,184,.32);border-radius:8px;background:rgba(15,23,42,.72);color:#eff6ff;font:13px/1.45 var(--lmb-font);outline:none}.lmb-field input:focus,.lmb-field textarea:focus,.lmb-field select:focus{border-color:rgba(34,211,238,.82);box-shadow:0 0 0 3px rgba(34,211,238,.14)}.lmb-field textarea{resize:vertical;min-height:150px}.lmb-card .lmb-field{color:#334155}.lmb-card .lmb-field input,.lmb-card .lmb-field textarea,.lmb-card .lmb-field select{background:#fff;color:#0f172a;border-color:#cbd5e1}",
      ".lmb-table-wrap{max-height:48vh;overflow:auto;padding:0 16px 14px}.lmb-table{width:100%;border-collapse:collapse;font-size:12px}.lmb-table th{position:sticky;top:0;background:#f1f5f9;color:#334155;border:1px solid #dbe3ea;padding:7px;text-align:left}.lmb-table td{border:1px solid #e5e7eb;padding:7px;vertical-align:top}.lmb-table tr:nth-child(even){background:#f8fafc}",
      ".lmb-actions{padding:12px 16px;border-top:1px solid #e5e7eb;display:flex;justify-content:space-between;gap:10px;align-items:center;background:#fff}.lmb-actions__buttons{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}",
      ".lmb-footer{font-size:11px;color:#8aa4bd;display:flex;align-items:center;gap:6px}.lmb-footer b{color:#67e8f9;font-weight:900}.lmb-card .lmb-footer{color:#64748b}.lmb-card .lmb-footer b{color:#0f766e}",
      ".lmb-btn{padding:8px 12px;border-radius:8px;border:1px solid rgba(148,163,184,.36);background:rgba(15,23,42,.72);color:#e6f4ff;font:800 13px var(--lmb-font);cursor:pointer}.lmb-btn:hover{border-color:rgba(34,211,238,.72);background:rgba(8,47,73,.8)}.lmb-btn:disabled{opacity:.65;cursor:not-allowed}.lmb-btn-primary{border-color:#14b8a6;background:#0f766e;color:#fff}.lmb-btn-blue{border-color:#2563eb;background:#2563eb;color:#fff}.lmb-btn-danger{border-color:#dc2626;background:#dc2626;color:#fff}.lmb-card .lmb-btn{background:#fff;color:#0f172a;border-color:#cbd5e1}.lmb-card .lmb-btn-primary{background:#047857;color:#fff;border-color:#047857}",
      ".lmb-fab{position:fixed;right:18px;z-index:2147483647;padding:10px 13px;border:0;border-radius:8px;color:#fff;font:800 13px var(--lmb-font);box-shadow:0 12px 30px rgba(15,23,42,.24);cursor:pointer;min-width:128px;text-align:left}.lmb-fab small{display:block;font-weight:700;font-size:10px;opacity:.88;margin-top:1px}",
      ".lmb-status-pill{display:inline-flex;align-items:center;justify-content:center;border-radius:999px;padding:6px 9px;font:900 11px/1 var(--lmb-font);border:1px solid transparent;white-space:nowrap}.lmb-status-ready{background:rgba(16,185,129,.14);color:#a7f3d0;border-color:rgba(52,211,153,.42)}.lmb-status-running{background:rgba(34,211,238,.14);color:#a5f3fc;border-color:rgba(34,211,238,.45)}.lmb-status-paused{background:rgba(245,158,11,.14);color:#fde68a;border-color:rgba(245,158,11,.4)}.lmb-status-stopped,.lmb-status-error{background:rgba(239,68,68,.16);color:#fecaca;border-color:rgba(248,113,113,.45)}.lmb-status-done{background:rgba(16,185,129,.14);color:#a7f3d0;border-color:rgba(52,211,153,.42)}",
      ".lmb-guide{border:1px solid rgba(148,163,184,.24);background:rgba(8,47,73,.2);border-radius:8px;padding:10px;display:grid;gap:8px}.lmb-guide-title{font-weight:900;color:#e0f2fe;font-size:12px}.lmb-guide-steps{margin:0;padding-left:18px;color:#b6c9dd;font-size:12px;line-height:1.55}.lmb-guide-tip{border-left:3px solid #22d3ee;padding-left:8px;color:#b6c9dd;font-size:12px;line-height:1.45}.lmb-guide-compact{padding:9px}.lmb-guide-compact .lmb-guide-steps{display:grid;gap:2px}",
      ".lmb-oil-notice{border:1px solid rgba(251,191,36,.42);background:rgba(120,53,15,.22);border-left:3px solid #f59e0b;border-radius:8px;padding:9px 10px;color:#fde68a;font-size:12px;line-height:1.45;display:grid;gap:3px}.lmb-oil-notice[hidden]{display:none!important}.lmb-oil-notice b{color:#fef3c7;font-weight:900}.lmb-oil-notice span{color:#f8e7b5}",
      ".lmb-module,.lmb-mini-card{border:1px solid rgba(148,163,184,.24);background:linear-gradient(180deg,rgba(15,23,42,.72),rgba(8,13,24,.72));border-radius:8px;padding:11px;display:grid;gap:10px}.lmb-module-head{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}.lmb-module-title,.lmb-mini-title{font-weight:900;color:#f8fbff;font-size:12px}.lmb-module-subtitle{color:#8aa4bd;font-size:11px;line-height:1.45;margin-top:2px}.lmb-command-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:end}.lmb-log-preview{max-height:72px;overflow:auto;border-left:3px solid #22d3ee;padding-left:8px;color:#b6c9dd;font-size:11px;white-space:pre-wrap;line-height:1.45}.lmb-check{display:flex;gap:8px;align-items:flex-start;color:#cfe5f7;font:800 12px/1.35 var(--lmb-font)}.lmb-check input{margin-top:2px;accent-color:#14b8a6}.lmb-check small{display:block;color:#8aa4bd;font-weight:700;margin-top:2px}.lmb-support-actions{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}",
      ".lmb-ticket-card{border:1px solid rgba(148,163,184,.28);border-left:4px solid #38bdf8;background:linear-gradient(135deg,rgba(15,23,42,.88),rgba(8,47,73,.58));border-radius:8px;padding:10px;display:grid;gap:6px;box-shadow:0 10px 30px rgba(2,6,23,.18)}.lmb-ticket-head{display:flex;justify-content:space-between;align-items:center;gap:8px}.lmb-ticket-head span,.lmb-ticket-title{font-weight:950;color:#f8fbff;font-size:12px}.lmb-ticket-head b{border-radius:999px;padding:5px 8px;background:rgba(59,130,246,.18);color:#bfdbfe;font-size:11px;white-space:nowrap}.lmb-ticket-id{font-weight:900;color:#e0f2fe;font-size:12px}.lmb-ticket-meta,.lmb-ticket-empty{color:#9fb5ca;font-size:11px}.lmb-ticket-note{border-top:1px solid rgba(148,163,184,.18);padding-top:6px;color:#d8e7f5;font-size:11px;line-height:1.45}.lmb-ticket-status-received{border-left-color:#22d3ee}.lmb-ticket-status-received .lmb-ticket-head b{background:rgba(34,211,238,.16);color:#a5f3fc}.lmb-ticket-status-processing{border-left-color:#f59e0b;background:linear-gradient(135deg,rgba(67,36,12,.86),rgba(15,23,42,.72))}.lmb-ticket-status-processing .lmb-ticket-head b{background:rgba(245,158,11,.22);color:#fde68a}.lmb-ticket-status-need_info{border-left-color:#f97316;background:linear-gradient(135deg,rgba(124,45,18,.88),rgba(15,23,42,.72))}.lmb-ticket-status-need_info .lmb-ticket-head b{background:rgba(249,115,22,.22);color:#fed7aa}.lmb-ticket-status-done{border-left-color:#22c55e;background:linear-gradient(135deg,rgba(6,78,59,.84),rgba(15,23,42,.72))}.lmb-ticket-status-done .lmb-ticket-head b{background:rgba(34,197,94,.2);color:#bbf7d0}",
      ".lmb-update-notice{border:1px solid rgba(34,211,238,.36);border-left:4px solid #22d3ee;background:linear-gradient(135deg,rgba(8,47,73,.78),rgba(15,23,42,.82));border-radius:8px;padding:10px;display:grid;gap:8px}.lmb-update-notice[hidden]{display:none!important}.lmb-update-notice.is-required{border-left-color:#f97316;background:linear-gradient(135deg,rgba(124,45,18,.82),rgba(15,23,42,.82))}.lmb-update-head{display:flex;justify-content:space-between;gap:8px;align-items:center}.lmb-update-head span{font-weight:950;color:#f8fbff;font-size:12px}.lmb-update-head b{border-radius:999px;padding:4px 8px;background:rgba(34,211,238,.16);color:#a5f3fc;font-size:11px}.lmb-update-copy{color:#cfe5f7;font-size:11px;line-height:1.45}.lmb-update-notice ul{margin:0;padding-left:16px;color:#9fb5ca;font-size:11px;line-height:1.45}.lmb-update-actions{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}",
      ".lmb-control-tabs{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;padding:9px 10px;background:rgba(2,6,23,.96);border-top:1px solid rgba(148,163,184,.18);border-bottom:1px solid rgba(148,163,184,.16)}.lmb-tab-button{border:1px solid rgba(148,163,184,.25);background:rgba(15,23,42,.86);color:#9fb5ca;border-radius:8px;padding:8px 6px;font:900 12px/1.1 var(--lmb-font);cursor:pointer;white-space:nowrap}.lmb-tab-button:hover{color:#e0f2fe;border-color:rgba(34,211,238,.42)}.lmb-tab-button.is-active{background:linear-gradient(135deg,#0f766e,#0891b2);color:#fff;border-color:rgba(103,232,249,.72);box-shadow:0 8px 22px rgba(8,145,178,.24)}.lmb-tab-button.has-attention{border-color:#fb923c;background:rgba(154,52,18,.28);color:#fed7aa}.lmb-tab-button.is-active.has-attention{background:linear-gradient(135deg,#0f766e,#0891b2);color:#fff}.lmb-tab-panel{display:none;gap:10px}.lmb-tab-panel.is-active{display:grid}.lmb-tab-hint{font-size:12px;line-height:1.45;color:#8aa4bd}.lmb-log-panel{min-height:156px;max-height:260px;overflow:auto;border:1px solid rgba(148,163,184,.24);background:rgba(2,6,23,.52);border-radius:8px;padding:10px;color:#d8e7f5;font-size:12px;line-height:1.45;white-space:pre-wrap}.lmb-control-center.is-update-required #lmb_employee_import_button,.lmb-control-center.is-update-required #lmb_update_import_button{opacity:.48;filter:saturate(.65);cursor:not-allowed}",
      "#lmb_control_center{position:fixed;right:18px;bottom:20px;z-index:2147483647;width:min(390px,calc(100vw - 36px));background:#07111f;color:#e5f2ff;border:1px solid rgba(34,211,238,.22);border-radius:8px;box-shadow:0 24px 64px rgba(2,6,23,.5),0 0 0 1px rgba(255,255,255,.04) inset;overflow:hidden}.lmb-control-center{display:grid}.lmb-control-head{padding:14px;background:radial-gradient(circle at 20% 0,rgba(34,211,238,.18),transparent 38%),linear-gradient(135deg,#08111f,#0f172a 62%,#102334);color:#fff;display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.lmb-control-brand{display:flex;align-items:center;gap:10px;min-width:0}.lmb-control-avatar{width:38px;height:38px;border-radius:8px;background:linear-gradient(135deg,#22d3ee,#14b8a6);display:flex;align-items:center;justify-content:center;box-shadow:0 0 24px rgba(34,211,238,.32);flex:0 0 auto}.lmb-control-avatar span{width:27px;height:22px;border-radius:7px;background:#e0f2fe;color:#0f172a;display:flex;align-items:center;justify-content:center;font:900 11px var(--lmb-font)}.lmb-ai-kicker{color:#67e8f9;font-size:10px;font-weight:900;letter-spacing:.12em;text-transform:uppercase}.lmb-control-title{font-weight:950;font-size:14px;line-height:1.25}.lmb-control-subtitle{margin-top:3px;color:#b6c9dd;font-size:12px;line-height:1.35}.lmb-control-body{padding:11px 12px 12px;display:grid;gap:10px;max-height:min(500px,calc(100vh - 190px));overflow:auto;background:linear-gradient(180deg,#07111f,#08111b)}.lmb-control-actions{display:grid;grid-template-columns:1fr;gap:8px}.lmb-control-primary{width:100%;border:1px solid rgba(103,232,249,.48);border-radius:8px;background:linear-gradient(135deg,#7c3aed,#0891b2);color:#fff;padding:12px;font:950 13px/1.2 var(--lmb-font);cursor:pointer;text-align:left;box-shadow:0 12px 28px rgba(8,145,178,.24)}.lmb-control-primary small{display:block;font-size:11px;font-weight:800;color:#d8f8ff;opacity:.95;margin-top:3px}.lmb-control-primary:hover{filter:brightness(1.06)}.lmb-control-primary:disabled{opacity:.65;cursor:not-allowed}.lmb-control-meta{display:flex;justify-content:space-between;align-items:center;gap:8px;padding-top:2px}.lmb-review-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(220px,280px);gap:12px;align-items:start}.lmb-review-summary{display:grid;gap:8px}.lmb-review-next{font-weight:800;color:#0f172a;font-size:12px}",
      "#lmb_admin_panel{position:fixed;left:18px;right:auto;bottom:20px;z-index:2147483647;width:min(560px,calc(100vw - 36px));border-radius:8px;box-shadow:0 22px 58px rgba(15,23,42,.36);background:#111827;color:white;overflow:hidden;font:13px/1.45 var(--lmb-font)}.lmb-admin-body{position:relative;padding:14px 42px 14px 14px;display:grid;gap:11px}.lmb-admin-top{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}.lmb-admin-title{font-weight:950;color:#fff}.lmb-admin-message{color:#dbeafe;line-height:1.5}.lmb-admin-hint{font-size:12px;color:#cbd5e1;border-left:3px solid #38bdf8;padding-left:8px}.lmb-admin-progress{display:grid;gap:6px}.lmb-admin-progress-head{display:flex;justify-content:space-between;color:#cbd5e1;font-size:12px;font-weight:800}.lmb-admin-progress-track{height:8px;border-radius:999px;background:rgba(148,163,184,.22);overflow:hidden}.lmb-admin-progress-bar{height:100%;border-radius:999px;background:linear-gradient(90deg,#22d3ee,#14b8a6);transition:width .18s ease}.lmb-admin-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.lmb-admin-stat{border:1px solid rgba(148,163,184,.24);border-radius:8px;padding:8px;background:rgba(15,23,42,.56)}.lmb-admin-stat span{display:block;color:#9fb5ca;font-size:11px;font-weight:800}.lmb-admin-stat b{display:block;margin-top:2px;color:#fff;font-size:18px;line-height:1}.lmb-admin-current,.lmb-admin-error{border:1px solid rgba(148,163,184,.24);border-left:3px solid #22d3ee;border-radius:8px;padding:9px;background:rgba(15,23,42,.5);display:grid;gap:3px}.lmb-admin-error{border-left-color:#f97316;background:rgba(124,45,18,.32)}.lmb-admin-card-label{color:#9fb5ca;font-size:11px;font-weight:900}.lmb-admin-card-title{color:#f8fafc;font-weight:950}.lmb-admin-card-meta{color:#cbd5e1;font-size:12px}.lmb-run-controls{display:flex;gap:8px;flex-wrap:wrap}@media(max-width:720px){#lmb_control_center{left:18px;right:18px;width:auto}.lmb-employee-card{left:12px;right:12px;bottom:12px;width:auto;max-height:calc(100vh - 24px)}#lmb_admin_panel{left:18px;right:18px;bottom:236px;width:auto}.lmb-review-grid{grid-template-columns:1fr}.lmb-toast{left:18px;right:18px;bottom:410px;max-width:none}body.lmb-review-open .lmb-toast{top:12px;bottom:auto}}"
    ].join("\n");
    document.head.appendChild(style);
  }

  function setFabLabel(button, title, subtitle) {
    button.innerHTML = escapeHtml(title) + (subtitle ? "<small>" + escapeHtml(subtitle) + "</small>" : "");
  }

  function isToolbarVisibleSetting(value) {
    if (value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, TOOLBAR_VISIBLE_KEY)) {
      return value[TOOLBAR_VISIBLE_KEY] === true;
    }
    return value === true;
  }

  function looksLikeHtml(value) {
    return /<\s*(?:br|p|div|ul|ol|li|table|tbody|thead|tr|td|th|h[1-6])(?:\s|\/|>)/i.test(String(value || ""));
  }

  function formatBodyAsHtml(value) {
    var body = String(value || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
    if (looksLikeHtml(body)) return body;
    return escapeHtml(body).replace(/\n/g, "<br>");
  }

  function normalizeVietnamPhone(value) {
    var digits = String(value || "").replace(/\D+/g, "");
    if (digits.indexOf("84") === 0 && (digits.length === 11 || digits.length === 12)) {
      return "0" + digits.slice(2);
    }
    if (digits.length === 9) {
      return "0" + digits;
    }
    return digits;
  }

  function normalizeNameWord(value) {
    var text = String(value || "").toLocaleLowerCase("vi-VN");
    if (!text) return "";
    return text.charAt(0).toLocaleUpperCase("vi-VN") + text.slice(1);
  }

  function normalizePersonName(value) {
    return normalizeSpace(value)
      .split(" ")
      .map(function(part) {
        return part.split("-").map(normalizeNameWord).join("-");
      })
      .join(" ");
  }

  function normalizeDateText(value) {
    var raw = String(value || "").trim();
    if (!raw) return "";
    var parts = raw.split(/[./-]/);
    if (parts.length === 3 && parts.every(function(part) { return /^\d+$/.test(part); })) {
      var day = String(parseInt(parts[0], 10)).padStart(2, "0");
      var month = String(parseInt(parts[1], 10)).padStart(2, "0");
      var year = String(parseInt(parts[2], 10)).padStart(4, "0");
      return day + "/" + month + "/" + year;
    }
    return raw;
  }

  function parseDateParts(value) {
    var normalized = normalizeDateText(value);
    var match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(normalized);
    if (!match) return null;
    return {
      day: parseInt(match[1], 10),
      month: parseInt(match[2], 10),
      year: parseInt(match[3], 10),
      value: normalized
    };
  }

  function parseDatePickerTitle(value) {
    var plain = stripAccents(value).toLowerCase();
    var match = /(?:thg|thang)\s*(\d{1,2})\s*(\d{4})/.exec(plain);
    if (!match) return null;
    return {
      month: parseInt(match[1], 10),
      year: parseInt(match[2], 10)
    };
  }

  function isDateCellForTarget(cellText, pickerTitle, targetDate) {
    var target = parseDateParts(targetDate);
    var title = parseDatePickerTitle(pickerTitle);
    if (!target || !title) return false;
    return parseInt(String(cellText || "").trim(), 10) === target.day &&
      title.month === target.month &&
      title.year === target.year;
  }

  function normalizePositionForm(value) {
    var plain = stripAccents(value).toUpperCase().replace(/[^A-Z0-9]+/g, "");
    if (plain === "NVBH") return "Nhân viên bán hàng";
    if (plain === "DHKD" || plain === "DIEUHANHKINHDOANH") return "Điều hành kinh doanh";
    return cleanField(value);
  }

  function employeeRequiresMainBase(employeeOrPosition) {
    var value = employeeOrPosition && typeof employeeOrPosition === "object"
      ? firstText([employeeOrPosition.position_form, employeeOrPosition.position])
      : employeeOrPosition;
    var plain = stripAccents(value).toUpperCase().replace(/[^A-Z0-9]+/g, "");
    return plain === "DHKD" || plain.indexOf("DIEUHANHKINHDOANH") >= 0;
  }

  function generateDHKDEmailFromName(fullName) {
    var parts = stripAccents(fullName)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (parts.length < 2) return "";
    var givenName = parts[parts.length - 1];
    var initials = parts.slice(0, -1).map(function(part) {
      return part.charAt(0);
    }).join("");
    return givenName + "." + initials + "@kdc.vn";
  }

  function firstText(values) {
    for (var i = 0; i < values.length; i += 1) {
      if (values[i] !== undefined && values[i] !== null && String(values[i]).trim()) {
        return String(values[i]).trim();
      }
    }
    return "";
  }

  function normalizeEmployee(raw) {
    raw = raw || {};
    var employeeCode = firstText([raw.employee_code, raw.ma_nhan_vien, raw.ma_dms, raw["MÃ DMS"], raw["Mã DMS"]]);
    var position = firstText([raw.position, raw.position_raw, raw.chuc_vu, raw["CHỨC VỤ"], raw["Chức vụ"]]);
    var positionForm = normalizePositionForm(position);
    var province = firstText([raw.province, raw.tinh, raw["TỈNH"], raw["Tỉnh"]]);
    var mainBase = firstText([raw.main_base, raw.mainBase, raw.mainbase, raw["MAIN BASE"], raw["Main base"], province]);
    var fullName = normalizePersonName(firstText([raw.full_name, raw.ho_va_ten, raw.name, raw["HỌ VÀ TÊN"], raw["Họ và tên"]]));
    var email = firstText([raw.email, raw.mail, raw.EMAIL, raw.Email, raw["EMAIL"], raw["Email"], raw["E-MAIL"], raw["E-mail"]]);
    if (!email && employeeRequiresMainBase(positionForm)) {
      email = generateDHKDEmailFromName(fullName);
    }
    var employee = {
      full_name: fullName,
      employee_code: employeeCode,
      portal_sap_code: employeeCode,
      position: position,
      position_form: positionForm,
      phone: normalizeVietnamPhone(firstText([raw.phone, raw.dtd_d, raw.dtdd, raw.so_dien_thoai, raw["ĐTDĐ"], raw["Số điện thoại"]])),
      email: email,
      username: employeeCode,
      status: firstText([raw.status, raw.trang_thai]) || "Đang hoạt động",
      sales_channel: firstText([raw.sales_channel, raw.kenh_ban_hang]) || "GT",
      category: firstText([raw.category, raw.nganh_hang]) || "Bánh",
      start_date: normalizeDateText(firstText([raw.start_date, raw.ngay_nhan_viec, raw["NGÀY NHẬN VIỆC"]])),
      end_date: normalizeDateText(firstText([raw.end_date, raw.thoi_gian_ket_thuc])),
      source_row: firstText([raw.source_row, raw._source_row, raw.row, raw.stt, raw.STT])
    };
    if (province) employee.province = province;
    if (employeeRequiresMainBase(positionForm)) employee.main_base = mainBase;
    return employee;
  }

  function normalizeEmployeeUpdateTaskType(value) {
    var plain = stripAccents(value || "").toLowerCase();
    if (plain.indexOf("trung") >= 0 || plain.indexOf("mid") >= 0) return UPDATE_TASK_MID_AUTUMN;
    return value === UPDATE_TASK_MID_AUTUMN ? UPDATE_TASK_MID_AUTUMN : UPDATE_TASK_RESIGNATION;
  }

  function normalizeEmployeeUpdateTask(raw, taskType) {
    raw = raw || {};
    var resolvedTask = normalizeEmployeeUpdateTaskType(taskType || raw.update_task || raw.task_type);
    var employeeCode = firstText([
      raw.employee_code,
      raw.ma_nhan_vien,
      raw.ma_dms,
      raw["MÃ DMS"],
      raw["Mã DMS"],
      raw["MÃ NHÂN VIÊN"],
      raw["Mã nhân viên"],
      raw["MA NHAN VIEN"]
    ]);
    var resignationDate = resolvedTask === UPDATE_TASK_RESIGNATION
      ? normalizeDateText(firstText([
        raw.resignation_date,
        raw.ngay_nghi_viec,
        raw.end_date,
        raw.thoi_gian_ket_thuc,
        raw["NGÀY NGHỈ VIỆC"],
        raw["Ngày nghỉ việc"],
        raw["NGAY NGHI VIEC"],
        raw["THỜI GIAN KẾT THÚC"],
        raw["THOI GIAN KET THUC"]
      ]))
      : "";
    return {
      employee_code: cleanField(employeeCode),
      full_name: normalizePersonName(firstText([raw.full_name, raw.ho_va_ten, raw.name, raw["HỌ VÀ TÊN"], raw["Họ và tên"], raw["HO VA TEN"]])),
      update_task: resolvedTask,
      resignation_date: resignationDate,
      target_category: resolvedTask === UPDATE_TASK_MID_AUTUMN ? MID_AUTUMN_CATEGORY : "",
      note: firstText([raw.note, raw.ghi_chu, raw["GHI CHÚ"], raw["Ghi chú"], raw["GHI CHU"]]),
      source_row: firstText([raw.source_row, raw._source_row, raw.row, raw.stt, raw.STT])
    };
  }

  function employeeUpdateMissingFields(item) {
    item = item || {};
    var missing = [];
    if (!item.employee_code) missing.push("Mã nhân viên");
    if (normalizeEmployeeUpdateTaskType(item.update_task) === UPDATE_TASK_RESIGNATION && !item.resignation_date) {
      missing.push("Ngày nghỉ việc");
    }
    return missing;
  }

  function employeeMissingFields(employee) {
    employee = employee || {};
    if (employee.phone) employee.phone = normalizeVietnamPhone(employee.phone);
    var missing = [];
    [
      ["full_name", "Họ và tên"],
      ["employee_code", "Mã nhân viên"],
      ["portal_sap_code", "Mã Portal/SAP"],
      ["position", "Chức vụ"],
      ["phone", "Số điện thoại"],
      ["username", "Tên đăng nhập"],
      ["start_date", "Thời gian bắt đầu"]
    ].forEach(function(item) {
      if (!employee[item[0]]) missing.push(item[1]);
    });
    if (employee.phone && !/^\d{10}$/.test(employee.phone)) {
      missing.push("Số điện thoại không đúng 10 số Việt Nam");
    }
    if (employeeRequiresMainBase(employee) && !employee.main_base) {
      missing.push("Main base/Tỉnh");
    }
    return missing;
  }

  function createEmployeeResultDefaults(employee) {
    employee = employee || {};
    return Object.assign({}, employee, {
      generated_username: employee.username || employee.employee_code || "",
      generated_password: DEFAULT_EMPLOYEE_PASSWORD,
      create_status: "",
      created_time: new Date().toLocaleString("vi-VN"),
      create_error: ""
    });
  }

  function createEmployeeUpdateResultDefaults(item) {
    item = item || {};
    return Object.assign({}, item, {
      update_status: "",
      updated_time: new Date().toLocaleString("vi-VN"),
      update_error: ""
    });
  }

  function isSuccessfulEmployeeResult(item) {
    var status = stripAccents(item && item.create_status).toLowerCase();
    return status === "thanh cong" || status === "da ton tai";
  }

  function isSuccessfulEmployeeUpdateResult(item) {
    var status = stripAccents(item && item.update_status).toLowerCase();
    return status === "thanh cong";
  }

  function employeeAtQueueIndex(queue, index) {
    var employees = queue && Array.isArray(queue.employees) ? queue.employees : [];
    var idx = typeof index === "number" ? index : parseInt(queue && queue.current_index || 0, 10);
    return employees[idx] || null;
  }

  function shouldStopEmployeeQueue(queue) {
    return !!(queue && (
      queue.stop_requested ||
      queue.status === "stopping" ||
      queue.status === "stopped" ||
      queue.status === "cancelled"
    ));
  }

  function isEmployeeQueuePaused(queue) {
    return !!(queue && (queue.pause_requested || queue.status === "paused"));
  }

  function isEmployeeQueueRunnable(queue) {
    return !!(
      queue &&
      Array.isArray(queue.employees) &&
      queue.employees.length &&
      queue.status !== "done" &&
      !isEmployeeQueuePaused(queue) &&
      !shouldStopEmployeeQueue(queue)
    );
  }

  function createAdminControlError(message, code) {
    var err = new Error(message || "Automation da bi dung.");
    err.is_admin_control = true;
    err.admin_control_code = code || "cancelled";
    return err;
  }

  function isAdminControlError(err) {
    return !!(err && err.is_admin_control);
  }

  function comparableEmployeeValue(field, value) {
    if (field === "phone") return normalizeVietnamPhone(value);
    if (field === "start_date" || field === "end_date") return normalizeDateText(value);
    if (field === "position_form" || field === "main_base") return normalizeOptionText(value);
    return cleanField(value);
  }

  function employeeFormMismatches(employee, actualValues) {
    var checks = [
      ["employee_code", "employee_code"],
      ["portal_sap_code", "portal_sap_code"],
      ["full_name", "full_name"],
      ["position_form", "position_form"],
      ["phone", "phone"],
      ["username", "username"],
      ["main_base", "main_base"],
      ["start_date", "start_date"]
    ];
    var mismatches = [];
    checks.forEach(function(pair) {
      var field = pair[0];
      var expectedRaw = employee && employee[field];
      var actualRaw = actualValues && actualValues[pair[1]];
      var expected = comparableEmployeeValue(field, expectedRaw);
      var actual = comparableEmployeeValue(field, actualRaw);
      if (expected && actual !== expected) {
        mismatches.push(field + ": dang la " + cleanField(actualRaw) + ", can " + cleanField(expectedRaw));
      }
    });
    return mismatches;
  }

  function escapeRegExp(value) {
    return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function employeeTokenExistsInText(token, text) {
    var wanted = stripAccents(token).toUpperCase();
    if (!wanted) return false;
    var plain = stripAccents(text).toUpperCase();
    var re = new RegExp("(^|[^A-Z0-9_])" + escapeRegExp(wanted) + "([^A-Z0-9_]|$)");
    return re.test(plain);
  }

  function employeeAlreadyVisibleInText(employee, text) {
    return employeeTokenExistsInText(employee && employee.employee_code, text);
  }

  function employeeAlreadyVisibleOnCurrentPage(employee) {
    if (typeof document === "undefined" || !document.body) return false;
    var rows = Array.from(document.querySelectorAll("tr,.ant-table-row,[role='row']"))
      .filter(isVisible);
    if (rows.length) {
      return rows.some(function(row) {
        return employeeAlreadyVisibleInText(employee, visibleText(row));
      });
    }
    var nodes = Array.from(document.body.children).filter(function(node) {
      return node.id !== "lmb_admin_panel" &&
        node.id !== "lmb_control_center" &&
        node.id !== "lmb_employee_button" &&
        node.id !== "lmb_employee_import_button" &&
        isVisible(node);
    });
    return employeeAlreadyVisibleInText(employee, nodes.map(visibleText).join("\n"));
  }

  function isDuplicateEmployeeSubmitError(text) {
    var plain = stripAccents(text).toLowerCase();
    return plain.indexOf("ma nhan vien hoac so dien thoai da ton tai") >= 0 ||
      (plain.indexOf("ma nhan vien") >= 0 &&
        plain.indexOf("so dien thoai") >= 0 &&
        plain.indexOf("ton tai") >= 0);
  }

  function extractJsonBetween(text, startMarker, endMarker) {
    var value = String(text || "");
    var start = -1;
    var markerRe = new RegExp("(^|\\n)\\s*" + startMarker + "\\s*(?:\\n|$)", "g");
    var match;
    while ((match = markerRe.exec(value)) !== null) {
      start = markerRe.lastIndex;
    }
    if (start < 0) return "";
    var afterStart = start;
    var end = value.indexOf(endMarker, afterStart);
    if (end < 0) return "";
    return value.slice(afterStart, end).trim();
  }

  function extractEmployeeBatch(text) {
    var rawJson = extractJsonBetween(text, "NHAN_SU_CREATE_JSON", "END_NHAN_SU_CREATE_JSON");
    if (!rawJson) return null;
    var parsed = JSON.parse(rawJson);
    var rows = Array.isArray(parsed) ? parsed : parsed.employees;
    if (!Array.isArray(rows)) {
      throw new Error("NHAN_SU_CREATE_JSON phải có employees là mảng.");
    }
    var employees = rows.map(normalizeEmployee);
    return {
      employees: employees,
      created_at: new Date().toISOString()
    };
  }

  function buildEmployeeResultWorkbook(results) {
    var columns = [
      ["source_row", "DÒNG"],
      ["employee_code", "MÃ NHÂN VIÊN"],
      ["portal_sap_code", "MÃ PORTAL/SAP"],
      ["full_name", "HỌ VÀ TÊN"],
      ["position", "CHỨC VỤ"],
      ["phone", "SỐ ĐIỆN THOẠI"],
      ["email", "EMAIL"],
      ["username", "TÊN ĐĂNG NHẬP DỰ KIẾN"],
      ["generated_username", "TÊN ĐĂNG NHẬP"],
      ["generated_password", "MẬT KHẨU MẶC ĐỊNH"],
      ["status", "TRẠNG THÁI"],
      ["sales_channel", "KÊNH BÁN HÀNG"],
      ["category", "NGÀNH HÀNG"],
      ["province", "TỈNH"],
      ["main_base", "MAIN BASE"],
      ["start_date", "THỜI GIAN BẮT ĐẦU"],
      ["end_date", "THỜI GIAN KẾT THÚC"],
      ["create_status", "TRẠNG THÁI TẠO"],
      ["created_time", "THỜI GIAN TẠO"],
      ["create_error", "GHI CHÚ LỖI"]
    ];
    var textColumns = {
      employee_code: true,
      portal_sap_code: true,
      phone: true,
      username: true,
      generated_username: true,
      generated_password: true
    };
    var rows = [
      "<tr>" + columns.map(function(col) {
        return "<th>" + escapeHtml(col[1]) + "</th>";
      }).join("") + "</tr>"
    ];
    (results || []).forEach(function(item) {
      rows.push("<tr>" + columns.map(function(col) {
        var style = textColumns[col[0]] ? " style=\"mso-number-format:'\\@';\"" : "";
        return "<td" + style + ">" + escapeHtml(item[col[0]] || "") + "</td>";
      }).join("") + "</tr>");
    });
    return [
      "<html>",
      "<head><meta charset=\"utf-8\"><meta http-equiv=\"Content-Type\" content=\"text/html; charset=utf-8\"><style>body,table{font-family:Segoe UI,Arial,sans-serif;font-size:12px}th{background:#e0f2fe;font-weight:700}</style></head>",
      "<body>",
      "<table border=\"1\">",
      rows.join(""),
      "</table>",
      "</body>",
      "</html>"
    ].join("");
  }

  function detectDelimiter(line) {
    var candidates = [",", ";", "\t"];
    var best = ",";
    var bestCount = -1;
    candidates.forEach(function(delimiter) {
      var count = String(line || "").split(delimiter).length;
      if (count > bestCount) {
        best = delimiter;
        bestCount = count;
      }
    });
    return best;
  }

  function parseDelimitedRows(text) {
    var value = String(text || "").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    var delimiter = detectDelimiter(value.split("\n")[0] || "");
    var rows = [];
    var row = [];
    var cell = "";
    var inQuotes = false;

    for (var i = 0; i < value.length; i += 1) {
      var ch = value[i];
      var next = value[i + 1];
      if (ch === '"' && inQuotes && next === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === delimiter && !inQuotes) {
        row.push(cell);
        cell = "";
      } else if (ch === "\n" && !inQuotes) {
        row.push(cell);
        if (row.some(function(item) { return String(item).trim(); })) rows.push(row);
        row = [];
        cell = "";
      } else {
        cell += ch;
      }
    }
    row.push(cell);
    if (row.some(function(item) { return String(item).trim(); })) rows.push(row);
    return rows;
  }

  function decodeHtmlText(value) {
    return String(value || "")
      .replace(/<\s*br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&#(\d+);/g, function(_, code) {
        return String.fromCharCode(parseInt(code, 10));
      })
      .replace(/&#x([0-9a-f]+);/gi, function(_, code) {
        return String.fromCharCode(parseInt(code, 16));
      })
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .trim();
  }

  function parseHtmlTableRows(html) {
    var text = String(html || "");
    var tableMatch = /<table[\s\S]*?<\/table>/i.exec(text);
    var table = tableMatch ? tableMatch[0] : text;
    var rows = [];
    var rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    var rowMatch;
    while ((rowMatch = rowRe.exec(table)) !== null) {
      var cells = [];
      var cellRe = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
      var cellMatch;
      while ((cellMatch = cellRe.exec(rowMatch[1])) !== null) {
        cells.push(normalizeSpace(decodeHtmlText(cellMatch[1])));
      }
      if (cells.some(function(cell) { return String(cell || "").trim(); })) rows.push(cells);
    }
    return rows;
  }

  function headerKey(value) {
    return stripAccents(value).toUpperCase().replace(/[^A-Z0-9]+/g, "");
  }

  function rowValue(row, headerMap, keys) {
    for (var i = 0; i < keys.length; i += 1) {
      var index = headerMap[headerKey(keys[i])];
      if (index !== undefined && row[index] !== undefined && String(row[index]).trim()) {
        return String(row[index]).trim();
      }
    }
    return "";
  }

  function normalizeEmployeeTableRow(row, headerMap, rowNumber) {
    return normalizeEmployee({
      source_row: String(rowNumber || ""),
      full_name: rowValue(row, headerMap, ["HỌ VÀ TÊN", "HO VA TEN", "Họ và tên"]),
      employee_code: rowValue(row, headerMap, ["MÃ DMS", "MA DMS", "MÃ NHÂN VIÊN", "MA NHAN VIEN"]),
      position: rowValue(row, headerMap, ["CHỨC VỤ", "CHUC VU"]),
      phone: rowValue(row, headerMap, ["ĐTDĐ", "DTDD", "SỐ ĐIỆN THOẠI", "SO DIEN THOAI"]),
      email: rowValue(row, headerMap, ["EMAIL", "MAIL", "E-MAIL", "E MAIL"]),
      start_date: rowValue(row, headerMap, ["NGÀY NHẬN VIỆC", "NGAY NHAN VIEC"]),
      region: rowValue(row, headerMap, ["VÙNG", "VUNG"]),
      province: rowValue(row, headerMap, ["TỈNH", "TINH"]),
      manager: rowValue(row, headerMap, ["CẤP QUẢN LÝ TRỰC TIẾP", "CAP QUAN LY TRUC TIEP"]),
      workplace: rowValue(row, headerMap, ["NƠI LÀM VIỆC", "NOI LAM VIEC"]),
      reason: rowValue(row, headerMap, ["LÝ DO", "LY DO"]),
      note: rowValue(row, headerMap, ["GHI CHÚ", "GHI CHU"])
    });
  }

  function parseEmployeeRows(rows) {
    if (!rows || rows.length < 2) return { employees: [], created_at: new Date().toISOString() };
    var headers = rows[0].map(function(item) { return String(item || "").trim(); });
    var headerMap = {};
    headers.forEach(function(header, index) {
      headerMap[headerKey(header)] = index;
    });
    var employees = [];
    rows.slice(1).forEach(function(row, idx) {
      if (!row.some(function(item) { return String(item || "").trim(); })) return;
      var employee = normalizeEmployeeTableRow(row, headerMap, idx + 2);
      if (employee.full_name || employee.employee_code || employee.phone) employees.push(employee);
    });
    return {
      employees: employees,
      created_at: new Date().toISOString()
    };
  }

  function parseEmployeeCsv(text) {
    return parseEmployeeRows(parseDelimitedRows(text));
  }

  function normalizeEmployeeUpdateTableRow(row, headerMap, rowNumber, taskType) {
    return normalizeEmployeeUpdateTask({
      source_row: String(rowNumber || ""),
      employee_code: rowValue(row, headerMap, ["MÃ NHÂN VIÊN", "MA NHAN VIEN", "MÃ DMS", "MA DMS"]),
      full_name: rowValue(row, headerMap, ["HỌ VÀ TÊN", "HO VA TEN", "Họ và tên"]),
      resignation_date: rowValue(row, headerMap, ["NGÀY NGHỈ VIỆC", "NGAY NGHI VIEC", "THỜI GIAN KẾT THÚC", "THOI GIAN KET THUC"]),
      note: rowValue(row, headerMap, ["GHI CHÚ", "GHI CHU"])
    }, taskType);
  }

  function parseEmployeeUpdateRows(rows, taskType) {
    if (!rows || rows.length < 2) return { employees: [], task_type: normalizeEmployeeUpdateTaskType(taskType), created_at: new Date().toISOString() };
    var headers = rows[0].map(function(item) { return String(item || "").trim(); });
    var headerMap = {};
    headers.forEach(function(header, index) {
      headerMap[headerKey(header)] = index;
    });
    var employees = [];
    rows.slice(1).forEach(function(row, idx) {
      if (!row.some(function(item) { return String(item || "").trim(); })) return;
      var employee = normalizeEmployeeUpdateTableRow(row, headerMap, idx + 2, taskType);
      if (employee.employee_code || employee.full_name) employees.push(employee);
    });
    return {
      employees: employees,
      task_type: normalizeEmployeeUpdateTaskType(taskType),
      created_at: new Date().toISOString()
    };
  }

  function parseEmployeeUpdateCsv(text, taskType) {
    return parseEmployeeUpdateRows(parseDelimitedRows(text), taskType);
  }

  function parseEmployeeUpdateHtml(html, taskType) {
    var text = String(html || "");
    var batch = parseEmployeeUpdateRows(parseHtmlTableRows(text), taskType);
    if (!batch.employees.length && /sheet\d+\.htm/i.test(text) && /<frameset|File-List|Excel\.Sheet/i.test(text)) {
      throw new Error("File Excel nay da bi luu thanh nhieu file Web Page, du lieu nam trong sheet001.htm nen extension khong doc duoc file .xls chinh. Hay tai lai template CSV tren extension hoac Save As CSV/XLSX roi import lai.");
    }
    return batch;
  }

  function buildWorkbookTable(columns, rows) {
    var textColumns = { employee_code: true, phone: true, username: true, generated_username: true, generated_password: true };
    var htmlRows = [
      "<tr>" + columns.map(function(col) {
        return "<th>" + escapeHtml(col[1]) + "</th>";
      }).join("") + "</tr>"
    ];
    (rows || []).forEach(function(row) {
      htmlRows.push("<tr>" + columns.map(function(col) {
        var key = col[0];
        var value = row && row[key] !== undefined ? row[key] : "";
        var style = textColumns[key] ? " style=\"mso-number-format:'\\@'\"" : "";
        return "<td" + style + ">" + escapeHtml(value) + "</td>";
      }).join("") + "</tr>");
    });
    return "<html><head><meta charset=\"utf-8\"><meta http-equiv=\"Content-Type\" content=\"text/html; charset=utf-8\"><style>body,table{font-family:Segoe UI,Arial,sans-serif;font-size:12px}th{background:#e0f2fe;font-weight:700}</style></head><body><table border=\"1\">" + htmlRows.join("") + "</table></body></html>";
  }

  function csvEscape(value) {
    var text = String(value == null ? "" : value);
    return /[",\r\n;]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }

  function buildCsvText(columns, rows) {
    var lines = [
      columns.map(function(col) { return csvEscape(col[1]); }).join(",")
    ];
    (rows || []).forEach(function(row) {
      lines.push(columns.map(function(col) {
        return csvEscape(row && row[col[0]] !== undefined ? row[col[0]] : "");
      }).join(","));
    });
    return lines.join("\r\n");
  }

  function employeeUpdateTemplateData(taskType) {
    var resolvedTask = normalizeEmployeeUpdateTaskType(taskType);
    return resolvedTask === UPDATE_TASK_RESIGNATION
      ? {
        columns: [
          ["employee_code", "MA NHAN VIEN"],
          ["resignation_date", "NGAY NGHI VIEC"],
          ["full_name", "HO VA TEN"],
          ["note", "GHI CHU"]
        ],
        sample: [{ employee_code: "KDBMT0290", resignation_date: "09/06/2026", full_name: "Nguyen Van Lanh", note: "" }]
      }
      : {
        columns: [
          ["employee_code", "MA NHAN VIEN"],
          ["full_name", "HO VA TEN"],
          ["target_category", "TRUNG THU"],
          ["note", "GHI CHU"]
        ],
        sample: [{ employee_code: "KDBMT0290", full_name: "Nguyen Van Lanh", target_category: MID_AUTUMN_CATEGORY, note: "" }]
      };
  }

  function buildEmployeeUpdateTemplateWorkbook(taskType) {
    var data = employeeUpdateTemplateData(taskType);
    return buildWorkbookTable(data.columns, data.sample);
  }

  function buildEmployeeUpdateTemplateCsv(taskType) {
    var data = employeeUpdateTemplateData(taskType);
    return buildCsvText(data.columns, data.sample);
  }

  function buildEmployeeUpdateResultWorkbook(results) {
    return buildWorkbookTable([
      ["source_row", "DONG"],
      ["employee_code", "MA NHAN VIEN"],
      ["full_name", "HO VA TEN"],
      ["update_task", "TAC VU"],
      ["resignation_date", "NGAY NGHI VIEC"],
      ["target_category", "NGANH CAN THEM"],
      ["update_status", "TRANG THAI CAP NHAT"],
      ["updated_time", "THOI GIAN CAP NHAT"],
      ["update_error", "GHI CHU LOI"]
    ], results || []);
  }

  function buildWorkbookAttachment(filename, html, kind) {
    var content = withUtf8Bom(html);
    return {
      filename: filename,
      mime_type: "application/vnd.ms-excel",
      content_base64: encodeUtf8Base64(content),
      size_bytes: utf8ByteLength(content),
      kind: kind
    };
  }

  function buildEmployeeResultAttachment(results) {
    return buildWorkbookAttachment(
      "ket-qua-tao-nhan-vien-" + new Date().toISOString().slice(0, 10) + ".xls",
      buildEmployeeResultWorkbook(results),
      "employee_create_result"
    );
  }

  function buildEmployeeUpdateResultAttachment(results) {
    return buildWorkbookAttachment(
      "ket-qua-cap-nhat-nhan-vien-" + new Date().toISOString().slice(0, 10) + ".xls",
      buildEmployeeUpdateResultWorkbook(results),
      "employee_update_result"
    );
  }

  function bytesToString(bytes) {
    return new TextDecoder("utf-8").decode(bytes);
  }

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream === "undefined") {
      throw new Error("Trinh duyet chua ho tro giai nen file .xlsx. Hay luu file thanh CSV va import lai.");
    }
    var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    var buffer = await new Response(stream).arrayBuffer();
    return new Uint8Array(buffer);
  }

  function readUint16(view, offset) {
    return view.getUint16(offset, true);
  }

  function readUint32(view, offset) {
    return view.getUint32(offset, true);
  }

  function findEndOfCentralDirectory(view) {
    for (var i = view.byteLength - 22; i >= 0; i -= 1) {
      if (readUint32(view, i) === 0x06054b50) return i;
    }
    return -1;
  }

  async function readZipEntries(arrayBuffer) {
    var view = new DataView(arrayBuffer);
    var eocd = findEndOfCentralDirectory(view);
    if (eocd < 0) throw new Error("File .xlsx khong hop le.");
    var entryCount = readUint16(view, eocd + 10);
    var centralOffset = readUint32(view, eocd + 16);
    var entries = {};
    var offset = centralOffset;
    var allBytes = new Uint8Array(arrayBuffer);

    for (var i = 0; i < entryCount; i += 1) {
      if (readUint32(view, offset) !== 0x02014b50) break;
      var method = readUint16(view, offset + 10);
      var compressedSize = readUint32(view, offset + 20);
      var fileNameLength = readUint16(view, offset + 28);
      var extraLength = readUint16(view, offset + 30);
      var commentLength = readUint16(view, offset + 32);
      var localOffset = readUint32(view, offset + 42);
      var name = bytesToString(allBytes.slice(offset + 46, offset + 46 + fileNameLength));

      var localNameLength = readUint16(view, localOffset + 26);
      var localExtraLength = readUint16(view, localOffset + 28);
      var dataStart = localOffset + 30 + localNameLength + localExtraLength;
      var compressed = allBytes.slice(dataStart, dataStart + compressedSize);
      var data;
      if (method === 0) data = compressed;
      else if (method === 8) data = await inflateRaw(compressed);
      else throw new Error("Khong ho tro kieu nen trong .xlsx: " + method);
      entries[name] = data;
      offset += 46 + fileNameLength + extraLength + commentLength;
    }
    return entries;
  }

  function parseXml(text) {
    var parser = new DOMParser();
    var doc = parser.parseFromString(text, "application/xml");
    if (doc.querySelector("parsererror")) throw new Error("Khong doc duoc XML trong file Excel.");
    return doc;
  }

  function xmlNodes(doc, localName) {
    return Array.from(doc.getElementsByTagNameNS("*", localName));
  }

  function colLettersToIndex(col) {
    var result = 0;
    for (var i = 0; i < col.length; i += 1) {
      result = result * 26 + col.charCodeAt(i) - 64;
    }
    return result - 1;
  }

  function xlsxCellText(cell, sharedStrings) {
    var type = cell.getAttribute("t");
    if (type === "inlineStr") return cell.textContent || "";
    var valueNode = xmlNodes(cell, "v")[0];
    var value = valueNode ? valueNode.textContent || "" : "";
    if (type === "s" && value !== "") {
      return sharedStrings[parseInt(value, 10)] || "";
    }
    return value;
  }

  async function readEmployeeXlsxRows(arrayBuffer) {
    if (typeof DOMParser === "undefined") {
      throw new Error("Moi truong nay khong ho tro doc .xlsx.");
    }
    var entries = await readZipEntries(arrayBuffer);
    var sharedStrings = [];
    if (entries["xl/sharedStrings.xml"]) {
      var sharedDoc = parseXml(bytesToString(entries["xl/sharedStrings.xml"]));
      sharedStrings = xmlNodes(sharedDoc, "si").map(function(si) {
        return si.textContent || "";
      });
    }

    var workbookDoc = parseXml(bytesToString(entries["xl/workbook.xml"]));
    var relsDoc = parseXml(bytesToString(entries["xl/_rels/workbook.xml.rels"]));
    var relMap = {};
    xmlNodes(relsDoc, "Relationship").forEach(function(rel) {
      relMap[rel.getAttribute("Id")] = rel.getAttribute("Target");
    });
    var firstSheet = xmlNodes(workbookDoc, "sheet")[0];
    if (!firstSheet) throw new Error("File Excel khong co sheet.");
    var rid = firstSheet.getAttribute("r:id") || firstSheet.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
    var target = relMap[rid] || "worksheets/sheet1.xml";
    if (target[0] === "/") target = target.slice(1);
    if (target.indexOf("xl/") !== 0) target = "xl/" + target;
    if (!entries[target]) throw new Error("Khong tim thay sheet dau tien trong file Excel.");

    var sheetDoc = parseXml(bytesToString(entries[target]));
    var rows = [];
    xmlNodes(sheetDoc, "row").forEach(function(rowNode) {
      var row = [];
      xmlNodes(rowNode, "c").forEach(function(cell) {
        var ref = cell.getAttribute("r") || "";
        var letters = ref.replace(/\d+/g, "");
        var index = colLettersToIndex(letters);
        row[index] = xlsxCellText(cell, sharedStrings);
      });
      for (var i = 0; i < row.length; i += 1) {
        if (row[i] === undefined) row[i] = "";
      }
      rows.push(row);
    });
    return rows;
  }

  async function parseEmployeeXlsx(arrayBuffer) {
    return parseEmployeeRows(await readEmployeeXlsxRows(arrayBuffer));
  }

  async function parseEmployeeUpdateXlsx(arrayBuffer, taskType) {
    return parseEmployeeUpdateRows(await readEmployeeXlsxRows(arrayBuffer), taskType);
  }

  async function parseEmployeeFile(file) {
    var name = String(file && file.name || "").toLowerCase();
    if (name.endsWith(".csv") || name.endsWith(".txt")) {
      return parseEmployeeCsv(await file.text());
    }
    if (name.endsWith(".xlsx")) {
      return parseEmployeeXlsx(await file.arrayBuffer());
    }
    throw new Error("Chi ho tro file .xlsx hoac .csv.");
  }

  async function parseEmployeeUpdateFile(file, taskType) {
    var name = String(file && file.name || "").toLowerCase();
    if (name.endsWith(".csv") || name.endsWith(".txt")) {
      return parseEmployeeUpdateCsv(await file.text(), taskType);
    }
    if (name.endsWith(".xls") || name.endsWith(".html") || name.endsWith(".htm")) {
      return parseEmployeeUpdateHtml(await file.text(), taskType);
    }
    if (name.endsWith(".xlsx")) {
      return parseEmployeeUpdateXlsx(await file.arrayBuffer(), taskType);
    }
    throw new Error("Chi ho tro file .xls, .xlsx hoac .csv.");
  }

  function buildSendRequest(data) {
    var url = new URL(SEND_PATH, WORKER_ORIGIN);
    return {
      url: url.toString(),
      options: {
        method: "POST",
        credentials: "omit",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          to_email: data.to_email,
          subject: data.subject,
          body: formatBodyAsHtml(data.body)
        })
      }
    };
  }

  function createConfirmState() {
    var activeSignature = "";
    var suppressedSignatures = {};

    return {
      shouldAutoOpen: function(data) {
        var sig = makeSignature(data);
        return activeSignature !== sig && !suppressedSignatures[sig];
      },
      markOpen: function(data) {
        activeSignature = makeSignature(data);
      },
      markClosed: function(data, suppress) {
        var sig = makeSignature(data);
        if (activeSignature === sig) activeSignature = "";
        if (suppress) suppressedSignatures[sig] = true;
      },
      clearSuppressed: function(data) {
        delete suppressedSignatures[makeSignature(data)];
      }
    };
  }

  var confirmState = createConfirmState();
  var adminAutomationStarted = false;
  var adminStopRequested = false;
  var adminPauseRequested = false;
  var adminPausePanelShown = false;
  var toolbarUiVisible = false;
  var toolbarToggleListenerStarted = false;
  var latestSupportLog = "";
  var latestResultAttachment = null;
  var latestSupportTicket = null;
  var supportTicketPollTimer = null;

  function toast(message, state) {
    ensureUiStyles();
    var old = document.getElementById("lmb_toast");
    if (old) old.remove();
    var el = document.createElement("div");
    el.id = "lmb_toast";
    el.className = "lmb-toast" + (state === "error" ? " is-error" : state === "ok" ? " is-ok" : "");
    if (state === "error") markControlPanelTabAttention("logs");
    var content = document.createElement("div");
    content.textContent = message;
    var close = document.createElement("button");
    close.type = "button";
    close.className = "lmb-toast-close";
    close.setAttribute("aria-label", "Dong thong bao");
    close.textContent = "x";
    close.addEventListener("click", function() {
      if (el.parentNode) el.remove();
    });
    el.appendChild(content);
    el.appendChild(close);
    document.body.appendChild(el);
    setTimeout(function() { if (el.parentNode) el.remove(); }, 3500);
  }

  async function sendMail(data) {
    var request = buildSendRequest(data);
    var res = await fetch(request.url, request.options);
    var text = await res.text();
    var parsed = null;
    try { parsed = JSON.parse(text); } catch (e) {}
    if (!res.ok) throw new Error("HTTP " + res.status + ": " + text.slice(0, 180));
    if (!parsed || parsed.ok !== true) {
      throw new Error(parsed && parsed.error ? parsed.error : text.slice(0, 180));
    }
    return parsed;
  }

  async function sendSupportFeedback(input) {
    var payload = input && input.source === "employee-extension" ? input : buildSupportFeedbackPayload(input);
    var chromeApi = getExtensionChromeApi();
    if (chromeApi && chromeApi.runtime && chromeApi.runtime.sendMessage) {
      try {
        var relay = await new Promise(function(resolve, reject) {
          chromeApi.runtime.sendMessage({
            type: "LMB_SEND_SUPPORT_FEEDBACK",
            payload: payload
          }, function(response) {
            var lastError = chromeApi.runtime.lastError;
            if (lastError) {
              reject(new Error(lastError.message));
              return;
            }
            resolve(response || {});
          });
        });
        if (!relay || relay.ok !== true) {
          throw new Error(relay && relay.error ? relay.error : "Background khong tra ve ket qua gui Telegram.");
        }
        return relay;
      } catch (relayErr) {
        if (!/Receiving end does not exist|Could not establish connection/i.test(relayErr.message || "")) {
          throw relayErr;
        }
      }
    }
    var res;
    try {
      res = await fetch(FEEDBACK_WORKER_URL, {
        method: "POST",
        credentials: "omit",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
    } catch (err) {
      throw new Error("Khong ket noi duoc Support Worker. Hay kiem tra Worker URL da deploy, manifest da co quyen domain va extension da Reload.");
    }
    var text = await res.text();
    var parsed = null;
    try { parsed = JSON.parse(text); } catch (e) {}
    if (!res.ok) {
      throw new Error("HTTP " + res.status + ": " + text.slice(0, 180));
    }
    if (!parsed || parsed.ok !== true) {
      throw new Error(parsed && parsed.error ? parsed.error : text.slice(0, 180));
    }
    return parsed;
  }

  async function checkSupportWorkerConnection() {
    var chromeApi = getExtensionChromeApi();
    if (chromeApi && chromeApi.runtime && chromeApi.runtime.sendMessage) {
      return new Promise(function(resolve, reject) {
        chromeApi.runtime.sendMessage({ type: "LMB_PING_SUPPORT_WORKER" }, function(response) {
          var lastError = chromeApi.runtime.lastError;
          if (lastError) {
            reject(new Error(lastError.message));
            return;
          }
          resolve(response || {});
        });
      });
    }
    var res = await fetch(FEEDBACK_WORKER_URL, { method: "OPTIONS", credentials: "omit" });
    var text = await res.text();
    var parsed = null;
    try { parsed = JSON.parse(text); } catch (e) {}
    return Object.assign({
      ok: res.ok,
      status: res.status,
      body: text.slice(0, 220)
    }, parsed || {});
  }

  function rememberSupportLog(message, options) {
    latestSupportLog = formatSupportLogLine(message, options);
    try { localStorage.setItem(LAST_ADMIN_LOG_KEY, latestSupportLog); } catch (e) {}
    return latestSupportLog;
  }

  function readLatestSupportLog() {
    if (latestSupportLog) return latestSupportLog;
    try { return localStorage.getItem(LAST_ADMIN_LOG_KEY) || ""; } catch (e) {}
    return "";
  }

  function ticketStatusLabel(status) {
    var key = normalizeSupportTicketStatus(status);
    if (key === "received") return "Đã nhận";
    if (key === "processing") return "Đang xử lý";
    if (key === "need_info") return "Cần bổ sung";
    if (key === "done") return "Hoàn tất";
    if (key === "sent") return "Đã gửi";
    return "Chưa có ticket hỗ trợ.";
  }

  function normalizeSupportTicketStatus(status) {
    var key = cleanField(status || "").toLowerCase();
    if (key === "received" || key === "processing" || key === "need_info" || key === "done") return key;
    return "sent";
  }

  function supportTicketPollDelay(ticket) {
    return normalizeSupportTicketStatus(ticket && ticket.status) === "done"
      ? SUPPORT_TICKET_DONE_POLL_MS
      : SUPPORT_TICKET_ACTIVE_POLL_MS;
  }

  function formatSupportTicketUpdatedAt(value) {
    if (!value) return "";
    var date = new Date(value);
    if (isNaN(date.getTime())) return cleanField(value);
    try {
      return date.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
    } catch (e) {
      return cleanField(value);
    }
  }

  function supportEndpoint(path) {
    return FEEDBACK_WORKER_URL.replace(/\/feedback(?:\?.*)?$/i, path);
  }

  function compareVersionStrings(left, right) {
    var a = String(left || "0").split(".").map(function(part) { return parseInt(part, 10) || 0; });
    var b = String(right || "0").split(".").map(function(part) { return parseInt(part, 10) || 0; });
    var length = Math.max(a.length, b.length);
    for (var i = 0; i < length; i += 1) {
      var av = a[i] || 0;
      var bv = b[i] || 0;
      if (av > bv) return 1;
      if (av < bv) return -1;
    }
    return 0;
  }

  function shouldShowExtensionUpdate(info, currentVersion) {
    return !!(info && info.latest_version && compareVersionStrings(info.latest_version, currentVersion || EXTENSION_VERSION) > 0);
  }

  function isExtensionUpdateRequired(info, currentVersion) {
    return !!(info && info.min_supported_version && compareVersionStrings(info.min_supported_version, currentVersion || EXTENSION_VERSION) > 0);
  }

  function isExtensionAutomationLocked(info, currentVersion) {
    return isExtensionUpdateRequired(info, currentVersion || EXTENSION_VERSION);
  }

  function bumpPatchVersion(version) {
    var parts = String(version || EXTENSION_VERSION).split(".").map(function(part) {
      var n = parseInt(part, 10);
      return Number.isFinite(n) && n >= 0 ? n : 0;
    });
    while (parts.length < 3) parts.push(0);
    parts[2] += 1;
    return parts.slice(0, 3).join(".");
  }

  function buildRequiredUpdateTestInfo(info, currentVersion) {
    var forcedVersion = bumpPatchVersion(currentVersion || EXTENSION_VERSION);
    var base = info && typeof info === "object" ? info : {};
    return Object.assign({}, base, {
      latest_version: forcedVersion,
      min_supported_version: forcedVersion,
      release_title: "DMS Assistant " + forcedVersion + " - kiểm thử",
      release_notes: ["Chế độ kiểm thử bắt buộc cập nhật trên máy hiện tại."].concat(Array.isArray(base.release_notes) ? base.release_notes : []),
      __local_required_update_test: true
    });
  }

  function installedExtensionVersion() {
    var chromeApi = getExtensionChromeApi();
    try {
      if (chromeApi && chromeApi.runtime && chromeApi.runtime.getManifest) {
        return chromeApi.runtime.getManifest().version || EXTENSION_VERSION;
      }
    } catch (e) {}
    return EXTENSION_VERSION;
  }

  function isExtensionUpdateSnoozed(info) {
    if (isExtensionUpdateRequired(info, installedExtensionVersion())) return false;
    try {
      var raw = localStorage.getItem(UPDATE_NOTICE_SNOOZE_KEY);
      var saved = raw ? JSON.parse(raw) : null;
      return !!(saved && saved.version === info.latest_version && Number(saved.until) > Date.now());
    } catch (e) {
      return false;
    }
  }

  function snoozeExtensionUpdate(info) {
    if (!info || !info.latest_version) return;
    try {
      localStorage.setItem(UPDATE_NOTICE_SNOOZE_KEY, JSON.stringify({
        version: info.latest_version,
        until: Date.now() + UPDATE_NOTICE_SNOOZE_MS
      }));
    } catch (e) {}
  }

  function isRequiredUpdateTestModeEnabled() {
    try {
      return localStorage.getItem(UPDATE_REQUIRED_TEST_KEY) === "1";
    } catch (e) {
      return false;
    }
  }

  function applyRequiredUpdateTestMode(info) {
    return isRequiredUpdateTestModeEnabled() ? buildRequiredUpdateTestInfo(info, installedExtensionVersion()) : info;
  }

  function syncRequiredExtensionUpdateLock(locked) {
    if (typeof document === "undefined") return;
    var isLocked = !!locked;
    var panel = document.getElementById("lmb_control_center");
    if (panel) panel.classList.toggle("is-update-required", isLocked);
    ["lmb_employee_import_button", "lmb_update_import_button"].forEach(function(id) {
      var button = document.getElementById(id);
      if (!button) return;
      button.disabled = isLocked;
      if (isLocked) {
        button.setAttribute("aria-disabled", "true");
        button.setAttribute("title", "Cập nhật DMS Assistant trước khi chạy automation.");
      } else {
        button.removeAttribute("aria-disabled");
        button.removeAttribute("title");
      }
    });
  }

  function renderExtensionUpdateBanner(info) {
    var banner = typeof document !== "undefined" ? document.getElementById("lmb_update_notice") : null;
    if (!banner) return;
    var currentVersion = installedExtensionVersion();
    var required = isExtensionUpdateRequired(info, currentVersion);
    if (!shouldShowExtensionUpdate(info, currentVersion) || (!required && isExtensionUpdateSnoozed(info))) {
      syncRequiredExtensionUpdateLock(false);
      banner.hidden = true;
      banner.innerHTML = "";
      return;
    }
    var notes = Array.isArray(info.release_notes) ? info.release_notes.slice(0, 3) : [];
    syncRequiredExtensionUpdateLock(required);
    banner.hidden = false;
    banner.className = "lmb-update-notice" + (required ? " is-required" : "");
    banner.innerHTML =
      '<div class="lmb-update-head"><span>' + (required ? "Cần cập nhật DMS Assistant" : "Có bản cập nhật mới") + '</span><b>v' + escapeHtml(info.latest_version) + '</b></div>' +
      '<div class="lmb-update-copy">' + (required ? "Phiên bản hiện tại không còn được hỗ trợ. Vui lòng cập nhật trước khi tiếp tục chạy automation." : "Bản mới đã sẵn sàng cho DMS Assistant.") + '</div>' +
      (notes.length ? '<ul>' + notes.map(function(note) { return '<li>' + escapeHtml(note) + '</li>'; }).join("") + '</ul>' : "") +
      '<div class="lmb-update-actions">' +
      '<button id="lmb_update_download" class="lmb-btn lmb-btn-primary" type="button">Tải bản mới</button>' +
      '<button id="lmb_update_changelog" class="lmb-btn" type="button">Xem thay đổi</button>' +
      (required ? "" : '<button id="lmb_update_snooze" class="lmb-btn" type="button">Nhắc lại sau</button>') +
      '</div>';
    var downloadButton = document.getElementById("lmb_update_download");
    if (downloadButton) {
      downloadButton.addEventListener("click", function() {
        if (info.download_url) root.open(info.download_url, "_blank", "noopener,noreferrer");
        else toast("Chưa có link tải bản mới. Vui lòng liên hệ Hưng để nhận gói cập nhật.", "error");
      });
    }
    var changelogButton = document.getElementById("lmb_update_changelog");
    if (changelogButton) {
      changelogButton.addEventListener("click", function() {
        if (info.changelog_url) root.open(info.changelog_url, "_blank", "noopener,noreferrer");
      });
    }
    var snoozeButton = document.getElementById("lmb_update_snooze");
    if (snoozeButton) {
      snoozeButton.addEventListener("click", function() {
        snoozeExtensionUpdate(info);
        banner.hidden = true;
        toast("Đã ẩn thông báo cập nhật trong hôm nay.", "ok");
      });
    }
  }

  async function checkExtensionUpdate() {
    var res = await fetch(supportEndpoint("/extension-version?current=" + encodeURIComponent(installedExtensionVersion())), {
      method: "GET",
      credentials: "omit"
    });
    var json = null;
    try { json = await res.json(); } catch (e) {}
    if (!res.ok || !json || json.ok !== true) return null;
    json = applyRequiredUpdateTestMode(json);
    renderExtensionUpdateBanner(json);
    return json;
  }

  function readLatestSupportTicket() {
    if (latestSupportTicket) return latestSupportTicket;
    try {
      var raw = localStorage.getItem(LAST_SUPPORT_TICKET_KEY);
      latestSupportTicket = raw ? JSON.parse(raw) : null;
    } catch (e) {
      latestSupportTicket = null;
    }
    return latestSupportTicket;
  }

  function refreshSupportTicketStatusView(ticket) {
    var statusEl = typeof document !== "undefined" ? document.getElementById("lmb_ticket_status") : null;
    if (!statusEl) return;
    var current = ticket || readLatestSupportTicket();
    if (!current || !current.ticket_id) {
      statusEl.className = "lmb-ticket-card lmb-ticket-status-empty";
      statusEl.innerHTML = '<div class="lmb-ticket-title">Yêu cầu hỗ trợ</div><div class="lmb-ticket-empty">Chưa có ticket hỗ trợ.</div>';
      return;
    }
    var statusKey = normalizeSupportTicketStatus(current.status || "sent");
    var updated = formatSupportTicketUpdatedAt(current.updated_at);
    statusEl.className = "lmb-ticket-card lmb-ticket-status-" + statusKey;
    statusEl.innerHTML =
      '<div class="lmb-ticket-head"><span>Yêu cầu hỗ trợ</span><b>' + escapeHtml(ticketStatusLabel(statusKey)) + '</b></div>' +
      '<div class="lmb-ticket-id">Ticket ' + escapeHtml(current.ticket_id) + '</div>' +
      '<div class="lmb-ticket-meta">' + (updated ? "Cập nhật: " + escapeHtml(updated) : "Đang chờ cập nhật từ Telegram") + '</div>' +
      (current.latest_note ? '<div class="lmb-ticket-note">Phản hồi: ' + escapeHtml(current.latest_note) + '</div>' : "");
  }

  function saveLatestSupportTicket(response) {
    if (!response || !response.ticket_id) return null;
    latestSupportTicket = {
      ticket_id: response.ticket_id,
      status: response.ticket_status || "sent",
      latest_note: response.latest_note || "",
      updated_at: new Date().toISOString()
    };
    try { localStorage.setItem(LAST_SUPPORT_TICKET_KEY, JSON.stringify(latestSupportTicket)); } catch (e) {}
    refreshSupportTicketStatusView(latestSupportTicket);
    return latestSupportTicket;
  }

  function refreshLatestResultAttachmentUi() {
    var checkbox = typeof document !== "undefined" ? document.getElementById("lmb_feedback_attach_latest") : null;
    var hint = typeof document !== "undefined" ? document.getElementById("lmb_feedback_attach_hint") : null;
    var typeEl = typeof document !== "undefined" ? document.getElementById("lmb_feedback_type") : null;
    var pickButton = typeof document !== "undefined" ? document.getElementById("lmb_feedback_pick_attachment") : null;
    var clearButton = typeof document !== "undefined" ? document.getElementById("lmb_feedback_clear_attachment") : null;
    if (checkbox) {
      checkbox.disabled = !latestResultAttachment;
      if (latestResultAttachment && typeEl && typeEl.value === "bug") checkbox.checked = true;
      if (!latestResultAttachment) checkbox.checked = false;
    }
    if (hint) {
      hint.textContent = latestResultAttachment
        ? "Sẵn sàng gửi kèm: " + latestResultAttachment.filename
        : "Chưa có file kết quả trong phiên hiện tại.";
    }
    if (pickButton) pickButton.textContent = latestResultAttachment ? "Đổi file kết quả" : "Chọn file kết quả";
    if (clearButton) clearButton.hidden = !latestResultAttachment;
  }

  function normalizeLatestResultAttachment(attachment) {
    var info = normalizeSupportAttachment(attachment);
    return info.attachment || null;
  }

  async function buildManualSupportAttachment(file) {
    if (!file) throw new Error("Chua chon file ket qua.");
    var filename = cleanField(file.name || "ket-qua-automation.xls");
    var sizeBytes = Number(file.size) || 0;
    if (sizeBytes > SUPPORT_ATTACHMENT_MAX_BYTES) {
      throw new Error("File ket qua vuot 3 MB, vui long gui rieng file nay khi can kiem tra chi tiet.");
    }
    var buffer = await file.arrayBuffer();
    var attachment = normalizeLatestResultAttachment({
      filename: filename,
      mime_type: supportAttachmentMimeType(file),
      content_base64: arrayBufferToBase64(buffer),
      size_bytes: buffer.byteLength || sizeBytes,
      kind: "employee_update_result"
    });
    if (!attachment) throw new Error("Khong doc duoc noi dung file ket qua.");
    return attachment;
  }

  async function loadLatestResultAttachment() {
    if (latestResultAttachment) {
      refreshLatestResultAttachmentUi();
      return latestResultAttachment;
    }
    try {
      var stored = await chromeStorageGet(LAST_RESULT_ATTACHMENT_KEY);
      latestResultAttachment = normalizeLatestResultAttachment(stored);
      if (!latestResultAttachment && stored) {
        await chromeStorageRemove(LAST_RESULT_ATTACHMENT_KEY);
      }
    } catch (e) {
      latestResultAttachment = null;
    }
    refreshLatestResultAttachmentUi();
    return latestResultAttachment;
  }

  function rememberLatestResultAttachment(attachment) {
    latestResultAttachment = normalizeLatestResultAttachment(attachment);
    refreshLatestResultAttachmentUi();
    if (latestResultAttachment) {
      chromeStorageSet({ [LAST_RESULT_ATTACHMENT_KEY]: latestResultAttachment }).catch(function() {});
    } else {
      chromeStorageRemove(LAST_RESULT_ATTACHMENT_KEY).catch(function() {});
    }
    return latestResultAttachment;
  }

  function supportFeedbackSuccessMessage(response, attachmentRequested) {
    if (attachmentRequested && response && response.attachment_sent) return "Đã gửi báo cáo kèm file kết quả.";
    if (attachmentRequested && (!response || response.attachment_sent !== true)) return "Đã gửi báo cáo, Worker chưa nhận file đính kèm.";
    return "Đã gửi báo cáo qua Telegram.";
  }

  async function pollLatestSupportTicketStatus(options) {
    options = options || {};
    var ticket = readLatestSupportTicket();
    if (!ticket || !ticket.ticket_id) {
      refreshSupportTicketStatusView(ticket);
      return null;
    }
    var oldStatus = normalizeSupportTicketStatus(ticket.status || "sent");
    var res = await fetch(supportEndpoint("/ticket-status?id=" + encodeURIComponent(ticket.ticket_id)), {
      method: "GET",
      credentials: "omit"
    });
    var json = null;
    try { json = await res.json(); } catch (e) {}
    if (!res.ok || !json || json.ok !== true || !json.ticket) return null;
    latestSupportTicket = {
      ticket_id: json.ticket.ticket_id || ticket.ticket_id,
      status: json.ticket.status || ticket.status || "sent",
      latest_note: json.ticket.latest_note || "",
      updated_at: json.ticket.updated_at || new Date().toISOString()
    };
    try { localStorage.setItem(LAST_SUPPORT_TICKET_KEY, JSON.stringify(latestSupportTicket)); } catch (e2) {}
    refreshSupportTicketStatusView(latestSupportTicket);
    var newStatus = normalizeSupportTicketStatus(latestSupportTicket.status || "sent");
    if (oldStatus && newStatus !== oldStatus) {
      toast("Ticket đã chuyển sang: " + ticketStatusLabel(newStatus), "ok");
      markControlPanelTabAttention("support");
    } else if (options.manual) {
      toast("Đã cập nhật trạng thái ticket.", "ok");
    }
    if (latestSupportTicket.latest_note) {
      latestSupportLog = formatSupportLogLine("Phản hồi Telegram cho " + latestSupportTicket.ticket_id + ": " + latestSupportTicket.latest_note, { status: latestSupportTicket.status });
      try { localStorage.setItem(LAST_ADMIN_LOG_KEY, latestSupportLog); } catch (e3) {}
      refreshSupportLogPreview();
    }
    return latestSupportTicket;
  }

  function scheduleSupportTicketPolling(delay) {
    if (supportTicketPollTimer) root.clearTimeout(supportTicketPollTimer);
    supportTicketPollTimer = root.setTimeout(function() {
      supportTicketPollTimer = null;
      var panel = document.getElementById("lmb_control_center");
      if (!panel || panel.hidden) {
        scheduleSupportTicketPolling(SUPPORT_TICKET_ACTIVE_POLL_MS);
        return;
      }
      pollLatestSupportTicketStatus().then(function(ticket) {
        scheduleSupportTicketPolling(supportTicketPollDelay(ticket || readLatestSupportTicket()));
      }).catch(function() {
        scheduleSupportTicketPolling(SUPPORT_TICKET_ACTIVE_POLL_MS);
      });
    }, delay);
  }

  function startSupportTicketPolling() {
    if (supportTicketPollTimer) return;
    pollLatestSupportTicketStatus().then(function(ticket) {
      scheduleSupportTicketPolling(supportTicketPollDelay(ticket || readLatestSupportTicket()));
    }).catch(function() {
      scheduleSupportTicketPolling(SUPPORT_TICKET_ACTIVE_POLL_MS);
    });
  }

  function withUtf8Bom(text) {
    var value = String(text || "");
    return value.charCodeAt(0) === 0xFEFF ? value : "\uFEFF" + value;
  }

  function downloadTextFile(filename, text) {
    var blob = new Blob([withUtf8Bom(text)], { type: "text/plain;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
  }

  function downloadCsvFile(filename, text) {
    var blob = new Blob([withUtf8Bom(text)], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
  }

  function downloadWorkbookFile(filename, html) {
    var blob = new Blob([withUtf8Bom(html)], { type: "application/vnd.ms-excel;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
  }

  function makeSignature(data) {
    return [data.to_email, data.subject, data.body].join("\n").slice(0, 2000);
  }

  function showConfirm(data, options) {
    ensureUiStyles();
    var sig = makeSignature(data);
    var existing = document.getElementById("lmb_confirm");
    if (existing && existing.getAttribute("data-lmb-signature") === sig && !(options && options.force)) {
      return false;
    }
    if (existing) existing.remove();

    var box = document.createElement("div");
    box.id = "lmb_confirm";
    box.className = "lmb-card lmb-mail-card";
    box.setAttribute("data-lmb-signature", sig);

    box.innerHTML =
      buildUiHeaderHtml("Xác nhận gửi email", "Kiểm tra người nhận, tiêu đề và nội dung trước khi gửi.") +
      '<div class="lmb-card__body">' +
      '<div class="lmb-note">Email chỉ được gửi sau khi bạn xác nhận bằng nút <b>Gửi email</b>. Có thể điều chỉnh trực tiếp các trường bên dưới.</div>' +
      '<label class="lmb-field"><span>Người nhận</span><input id="lmb_to" /></label>' +
      '<label class="lmb-field"><span>Tiêu đề</span><input id="lmb_subject" /></label>' +
      '<label class="lmb-field"><span>Nội dung email</span><textarea id="lmb_body" rows="9"></textarea></label>' +
      '</div>' +
      '<div class="lmb-actions">' +
      buildUiFooterHtml() +
      '<div class="lmb-actions__buttons">' +
      '<button id="lmb_cancel" class="lmb-btn" type="button">Hủy</button>' +
      '<button id="lmb_send" class="lmb-btn lmb-btn-primary" type="button">Gửi email</button>' +
      '</div>' +
      '</div>';

    document.body.appendChild(box);
    confirmState.markOpen(data);
    document.getElementById("lmb_to").value = data.to_email;
    document.getElementById("lmb_subject").value = data.subject;
    document.getElementById("lmb_body").value = data.body;

    document.getElementById("lmb_cancel").addEventListener("click", function() {
      confirmState.markClosed(data, true);
      box.remove();
    });
    document.getElementById("lmb_send").addEventListener("click", async function() {
      var btn = document.getElementById("lmb_send");
      var payload = {
        to_email: document.getElementById("lmb_to").value.trim(),
        subject: document.getElementById("lmb_subject").value.trim(),
        body: document.getElementById("lmb_body").value.trim()
      };
      if (!payload.to_email || !payload.subject || !payload.body) {
        toast("Thieu To, Subject hoac Body.", "error");
        return;
      }
      btn.disabled = true;
      btn.textContent = "Đang gửi...";
      try {
        await sendMail(payload);
        try { localStorage.setItem(STORAGE_KEY, makeSignature(payload)); } catch (e) {}
        confirmState.markClosed(data, true);
        toast("Da gui email thanh cong.", "ok");
        box.remove();
      } catch (err) {
        btn.disabled = false;
        btn.textContent = "Gửi email";
        toast("Chua gui duoc: " + err.message, "error");
      }
    });
    return true;
  }

  function selectExtensionChromeApi(candidates) {
    var list = candidates || [];
    for (var i = 0; i < list.length; i += 1) {
      var candidate = list[i];
      if (candidate && candidate.storage && candidate.storage.local) {
        return candidate;
      }
    }
    return null;
  }

  function getExtensionChromeApi() {
    var candidates = [];
    if (typeof chrome !== "undefined") candidates.push(chrome);
    if (typeof globalThis !== "undefined" && globalThis.chrome) candidates.push(globalThis.chrome);
    if (root && root.chrome) candidates.push(root.chrome);
    return selectExtensionChromeApi(candidates);
  }

  function localStorageSetObject(obj) {
    try {
      if (!root || !root.localStorage) return false;
      Object.keys(obj || {}).forEach(function(key) {
        root.localStorage.setItem(key, JSON.stringify(obj[key]));
      });
      return true;
    } catch (e) {
      return false;
    }
  }

  function localStorageGetObject(key) {
    try {
      if (!root || !root.localStorage) return undefined;
      var value = root.localStorage.getItem(key);
      return value ? JSON.parse(value) : undefined;
    } catch (e) {
      return undefined;
    }
  }

  function localStorageRemoveObject(key) {
    try {
      if (!root || !root.localStorage) return false;
      root.localStorage.removeItem(key);
      return true;
    } catch (e) {
      return false;
    }
  }

  function chromeStorageSet(obj) {
    return new Promise(function(resolve, reject) {
      var chromeApi = getExtensionChromeApi();
      if (!chromeApi) {
        if (localStorageSetObject(obj)) resolve();
        else reject(new Error("Extension chua co quyen storage."));
        return;
      }
      chromeApi.storage.local.set(obj, function() {
        var err = chromeApi.runtime && chromeApi.runtime.lastError;
        if (err) reject(new Error(err.message));
        else resolve();
      });
    });
  }

  function chromeStorageGet(key) {
    return new Promise(function(resolve, reject) {
      var chromeApi = getExtensionChromeApi();
      if (!chromeApi) {
        resolve(localStorageGetObject(key));
        return;
      }
      chromeApi.storage.local.get(key, function(obj) {
        var err = chromeApi.runtime && chromeApi.runtime.lastError;
        if (err) reject(new Error(err.message));
        else resolve(obj[key]);
      });
    });
  }

  function chromeStorageRemove(key) {
    return new Promise(function(resolve, reject) {
      var chromeApi = getExtensionChromeApi();
      if (!chromeApi) {
        localStorageRemoveObject(key);
        resolve();
        return;
      }
      chromeApi.storage.local.remove(key, function() {
        var err = chromeApi.runtime && chromeApi.runtime.lastError;
        if (err) reject(new Error(err.message));
        else resolve();
      });
    });
  }

  function employeeSummaryRows(employees) {
    return (employees || []).map(function(employee, idx) {
      var missing = employeeMissingFields(employee);
      var status = missing.length ? "Loi: " + missing.join(", ") : "OK";
      return "<tr>" +
        "<td>" + escapeHtml(String(idx + 1)) + "</td>" +
        "<td>" + escapeHtml(employee.employee_code) + "</td>" +
        "<td>" + escapeHtml(employee.full_name) + "</td>" +
        "<td>" + escapeHtml(employee.position) + "</td>" +
        "<td>" + escapeHtml(employee.phone) + "</td>" +
        "<td>" + escapeHtml(employee.start_date) + "</td>" +
        "<td>" + escapeHtml(status) + "</td>" +
      "</tr>";
    }).join("");
  }

  function setEmployeeReviewOpen(active) {
    if (!document.body || !document.body.classList) return;
    document.body.classList.toggle("lmb-review-open", !!active);
  }

  function closeEmployeeReview(box) {
    if (box && box.parentNode) box.remove();
    setEmployeeReviewOpen(false);
  }

  function showEmployeeReview(batch) {
    ensureUiStyles();
    var existing = document.getElementById("lmb_employee_review");
    if (existing) closeEmployeeReview(existing);

    var employees = batch.employees || [];
    var invalidCount = employees.filter(function(employee) {
      return employeeMissingFields(employee).length > 0;
    }).length;
    var preferredCategory = normalizeEmployeeCategoryChoice(batch.category_choice || "Bánh");

    var box = document.createElement("div");
    box.id = "lmb_employee_review";
    box.className = "lmb-card lmb-employee-card";

    box.innerHTML =
      buildUiHeaderHtml("Duyệt tạo nhân viên tự động", "Kiểm tra danh sách trước khi extension thao tác trên DMS.") +
      '<div class="lmb-card__body">' +
      '<div class="lmb-review-grid">' +
      '<div class="lmb-review-summary">' +
      '<div class="lmb-note">' +
      'Tổng: <b>' + escapeHtml(String(employees.length)) + '</b> nhân viên. ' +
      'Dòng lỗi hoặc thiếu dữ liệu sẽ được ghi vào file kết quả và bỏ qua khi tạo: <b>' + escapeHtml(String(invalidCount)) + '</b>.' +
      '</div>' +
      '<div class="lmb-review-next">Bước tiếp theo</div>' +
      buildGuideStepsHtml("compact") +
      '</div>' +
      '<div class="lmb-review-summary">' +
      '<label class="lmb-field" for="lmb_emp_category_choice">' +
      '<span>Ngành tạo tài khoản</span>' +
      '<select id="lmb_emp_category_choice">' +
      '<option value="Bánh"' + (preferredCategory === "Bánh" ? " selected" : "") + '>Bánh - dùng link danh sách đang hoạt động</option>' +
      '<option value="Dầu"' + (preferredCategory === "Dầu" ? " selected" : "") + '>Dầu - dùng link danh sách chung</option>' +
      '</select>' +
      '</label>' +
      '<div class="lmb-guide-tip">Kiểm tra lại ngành trước khi duyệt. Ngành đã chọn sẽ áp dụng cho toàn bộ danh sách trong lần chạy này.</div>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '<div class="lmb-table-wrap">' +
      '<table class="lmb-table">' +
      '<thead><tr>' +
      '<th>STT</th>' +
      '<th>Mã NV</th>' +
      '<th>Họ và tên</th>' +
      '<th>Chức vụ</th>' +
      '<th>SĐT</th>' +
      '<th>Bắt đầu</th>' +
      '<th>Trạng thái</th>' +
      '</tr></thead><tbody>' + employeeSummaryRows(employees) + '</tbody></table>' +
      '</div>' +
      '<div class="lmb-actions">' +
      buildUiFooterHtml() +
      '<div class="lmb-actions__buttons">' +
      '<button id="lmb_emp_cancel" class="lmb-btn" type="button">Hủy</button>' +
      '<button id="lmb_emp_approve" class="lmb-btn lmb-btn-blue" type="button">Duyệt & tạo tự động</button>' +
      '</div>' +
      '</div>';

    document.body.appendChild(box);
    setEmployeeReviewOpen(true);
    document.getElementById("lmb_emp_cancel").addEventListener("click", function() {
      closeEmployeeReview(box);
    });
    document.getElementById("lmb_emp_approve").addEventListener("click", async function() {
      var btn = document.getElementById("lmb_emp_approve");
      btn.disabled = true;
      btn.textContent = "Đang mở trang DMS...";
      try {
        var categorySelect = document.getElementById("lmb_emp_category_choice");
        var selectedCategory = normalizeEmployeeCategoryChoice(categorySelect ? categorySelect.value : "Bánh");
        var queueEmployees = applyEmployeeCategoryChoice(employees, selectedCategory);
        var queue = {
          id: "emp_" + Date.now(),
          status: "pending",
          category_choice: selectedCategory,
          admin_url: employeeAdminUrlForCategory(selectedCategory),
          current_index: 0,
          employees: queueEmployees,
          results: [],
          created_at: new Date().toISOString()
        };
        var adminUrl = queue.admin_url;
        if (getExtensionChromeApi()) {
          try {
            await chromeStorageSet((function() {
              var obj = {};
              obj[EMPLOYEE_BATCH_KEY] = queue;
              return obj;
            })());
          } catch (storageErr) {
            adminUrl = buildAdminEmployeeQueueUrl(queue);
          }
        } else {
          adminUrl = buildAdminEmployeeQueueUrl(queue);
        }
        toast("Da chuan bi queue tao nhan vien. Dang mo admin2.kido.vn...", "ok");
        root.open(adminUrl, "_blank");
        closeEmployeeReview(box);
      } catch (err) {
        btn.disabled = false;
        btn.textContent = "Duyệt & tạo tự động";
        toast("Chua the bat dau tao nhan vien: " + err.message, "error");
      }
    });
  }

  function employeeUpdateTaskLabel(taskType) {
    return normalizeEmployeeUpdateTaskType(taskType) === UPDATE_TASK_MID_AUTUMN ? "Thêm ngành Trung thu" : "Đóng nhân viên nghỉ việc";
  }

  function employeeUpdateSummaryRows(items) {
    return (items || []).map(function(item, idx) {
      var missing = employeeUpdateMissingFields(item);
      var status = missing.length ? "Loi: " + missing.join(", ") : "OK";
      return "<tr>" +
        "<td>" + escapeHtml(String(idx + 1)) + "</td>" +
        "<td>" + escapeHtml(item.employee_code) + "</td>" +
        "<td>" + escapeHtml(item.full_name) + "</td>" +
        "<td>" + escapeHtml(employeeUpdateTaskLabel(item.update_task)) + "</td>" +
        "<td>" + escapeHtml(item.resignation_date || item.target_category || "") + "</td>" +
        "<td>" + escapeHtml(status) + "</td>" +
        "</tr>";
    }).join("");
  }

  function showEmployeeUpdateReview(batch) {
    ensureUiStyles();
    var existing = document.getElementById("lmb_employee_review");
    if (existing) closeEmployeeReview(existing);

    var items = batch.employees || [];
    var taskType = normalizeEmployeeUpdateTaskType(batch.task_type);
    var invalidCount = items.filter(function(item) {
      return employeeUpdateMissingFields(item).length > 0;
    }).length;

    var box = document.createElement("div");
    box.id = "lmb_employee_review";
    box.className = "lmb-card lmb-employee-card";
    box.innerHTML =
      buildUiHeaderHtml("Duyệt cập nhật nhân viên", employeeUpdateTaskLabel(taskType) + " theo file template.") +
      '<div class="lmb-card__body">' +
      '<div class="lmb-review-grid">' +
      '<div class="lmb-review-summary">' +
      '<div class="lmb-note">' +
      'Tổng: <b>' + escapeHtml(String(items.length)) + '</b> nhân viên. ' +
      (invalidCount ? '<b>' + escapeHtml(String(invalidCount)) + '</b> dòng cần kiểm tra.' : 'Tất cả dòng đủ dữ liệu để chạy.') +
      '</div>' +
      '<div class="lmb-review-next">Bước tiếp theo</div>' +
      '<div class="lmb-guide-tip">Hệ thống sẽ tra cứu theo mã nhân viên, mở cửa sổ cập nhật hồ sơ, áp dụng thay đổi và lưu kết quả từng dòng.</div>' +
      '</div>' +
      '<div class="lmb-review-summary">' +
      '<div class="lmb-review-next">Tác vụ</div>' +
      '<div class="lmb-guide-tip">' + escapeHtml(employeeUpdateTaskLabel(taskType)) + '</div>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '<div class="lmb-table-wrap">' +
      '<table class="lmb-table"><thead><tr><th>#</th><th>Mã NV</th><th>Họ tên</th><th>Tác vụ</th><th>Giá trị</th><th>Trạng thái</th></tr></thead><tbody>' +
      employeeUpdateSummaryRows(items) +
      '</tbody></table>' +
      '</div>' +
      '<div class="lmb-actions">' +
      '<div class="lmb-footer"><span>Tác giả</span><b>' + escapeHtml(EXTENSION_AUTHOR) + '</b></div>' +
      '<div class="lmb-actions__buttons"><button id="lmb_emp_cancel" class="lmb-btn" type="button">Hủy</button><button id="lmb_emp_approve" class="lmb-btn lmb-btn-primary" type="button"' + (invalidCount ? " disabled" : "") + '>Duyệt & cập nhật</button></div>' +
      '</div>';

    document.body.appendChild(box);
    setEmployeeReviewOpen(true);
    document.getElementById("lmb_emp_cancel").addEventListener("click", function() {
      closeEmployeeReview(box);
    });
    document.getElementById("lmb_emp_approve").addEventListener("click", async function() {
      var btn = document.getElementById("lmb_emp_approve");
      btn.disabled = true;
      btn.textContent = "Đang mở trang DMS...";
      try {
        var queue = {
          id: "emp_update_" + Date.now(),
          queue_type: EMPLOYEE_UPDATE_QUEUE_TYPE,
          task_type: taskType,
          status: "pending",
          admin_url: buildEmployeeSearchUrl(items[0] && items[0].employee_code, true),
          current_index: 0,
          employees: items,
          results: [],
          created_at: new Date().toISOString()
        };
        var adminUrl = queue.admin_url;
        if (getExtensionChromeApi()) {
          try {
            await chromeStorageSet((function() {
              var obj = {};
              obj[EMPLOYEE_BATCH_KEY] = queue;
              return obj;
            })());
          } catch (storageErr) {
            adminUrl = buildAdminEmployeeQueueUrl(queue);
          }
        } else {
          adminUrl = buildAdminEmployeeQueueUrl(queue);
        }
        toast("Da chuan bi queue cap nhat nhan vien. Dang mo admin2.kido.vn...", "ok");
        root.open(adminUrl, "_blank");
        closeEmployeeReview(box);
      } catch (err) {
        btn.disabled = false;
        btn.textContent = "Duyệt & cập nhật";
        toast("Chua the bat dau cap nhat nhan vien: " + err.message, "error");
      }
    });
  }

  function latestText() {
    return document.body ? document.body.innerText || "" : "";
  }

  function detectAndConfirm(text) {
    if (!isApprovalText(text)) return false;
    var tail = text.slice(Math.max(0, text.length - 12000));
    var data = extractMailData(tail);
    if (!data) {
      toast("Da thay lenh duyet nhung chua trich duoc email.", "error");
      return false;
    }
    if (!confirmState.shouldAutoOpen(data)) return false;
    var sig = makeSignature(data);
    try {
      if (localStorage.getItem(STORAGE_KEY) === sig) return false;
    } catch (e) {}
    if (showConfirm(data)) {
      toast("Da nhan lenh duyet. Kiem tra noi dung va chon Gui email.", "ok");
      return true;
    }
    return false;
  }

  function installManualButton() {
    ensureUiStyles();
    if (document.getElementById("lmb_button")) return;
    var btn = document.createElement("button");
    btn.id = "lmb_button";
    btn.type = "button";
    btn.className = "lmb-fab lmb-fab-mail";
    setFabLabel(btn, "Gửi email", "Duyệt bản nháp");
    btn.addEventListener("click", function() {
      var data = extractMailData(latestText().slice(-16000));
      if (!data) {
        toast("Chua trich duoc email. Hay dam bao co To/Subject/Body hoac ban nhap email trong lenh.", "error");
        return;
      }
      confirmState.clearSuppressed(data);
      showConfirm(data, { force: true });
    });
    document.body.appendChild(btn);
  }

  function installEmployeeButton() {
    ensureUiStyles();
    if (document.getElementById("lmb_employee_button")) return;
    var btn = document.createElement("button");
    btn.id = "lmb_employee_button";
    btn.type = "button";
    btn.className = "lmb-fab lmb-fab-employee";
    setFabLabel(btn, "Tạo nhân viên", "Từ JSON agent");
    btn.addEventListener("click", function() {
      try {
        var batch = extractEmployeeBatch(latestText().slice(-80000));
        if (!batch || !batch.employees.length) {
          toast("Chua thay block NHAN_SU_CREATE_JSON trong cau tra loi cua agent.", "error");
          return;
        }
        showEmployeeReview(batch);
      } catch (err) {
        toast("Khong doc duoc danh sach nhan vien: " + err.message, "error");
      }
    });
    document.body.appendChild(btn);
  }

  function refreshSupportLogPreview() {
    var text = readLatestSupportLog() || "Chưa có nhật ký automation.";
    ["lmb_latest_log_preview", "lmb_log_tab_preview"].forEach(function(id) {
      var preview = document.getElementById(id);
      if (preview) preview.textContent = text;
    });
  }

  function normalizeControlPanelTab(tabName) {
    var key = cleanField(tabName || "").toLowerCase();
    if (key === "commands") return "update";
    return ["create", "update", "support", "logs"].indexOf(key) >= 0 ? key : "create";
  }

  function readControlPanelTab() {
    try {
      return normalizeControlPanelTab(localStorage.getItem(CONTROL_PANEL_ACTIVE_TAB_KEY));
    } catch (e) {}
    return "create";
  }

  function markControlPanelTabAttention(tabName) {
    var panel = document.getElementById("lmb_control_center");
    if (!panel) return;
    var tab = normalizeControlPanelTab(tabName);
    var button = panel.querySelector('[data-lmb-tab-button="' + tab + '"]');
    if (button && !button.classList.contains("is-active")) {
      button.classList.add("has-attention");
    }
  }

  function setControlPanelTab(tabName) {
    var activeTab = normalizeControlPanelTab(tabName);
    var panel = document.getElementById("lmb_control_center");
    if (!panel) return activeTab;
    Array.prototype.forEach.call(panel.querySelectorAll("[data-lmb-tab-button]"), function(button) {
      var isActive = button.getAttribute("data-lmb-tab-button") === activeTab;
      button.classList.toggle("is-active", isActive);
      if (isActive) button.classList.remove("has-attention");
      button.setAttribute("aria-selected", isActive ? "true" : "false");
    });
    Array.prototype.forEach.call(panel.querySelectorAll("[data-lmb-tab-panel]"), function(tabPanel) {
      var isActive = tabPanel.getAttribute("data-lmb-tab-panel") === activeTab;
      tabPanel.classList.toggle("is-active", isActive);
      tabPanel.hidden = !isActive;
    });
    try {
      localStorage.setItem(CONTROL_PANEL_ACTIVE_TAB_KEY, activeTab);
    } catch (e) {}
    return activeTab;
  }

  function syncOilCategoryNotice() {
    var categoryChoice = document.getElementById("lmb_control_category_choice");
    var notice = document.getElementById("lmb_oil_category_notice");
    if (!notice) return;
    var isOil = normalizeEmployeeCategoryChoice(categoryChoice ? categoryChoice.value : "Bánh") === "Dầu";
    notice.hidden = !isOil;
    notice.setAttribute("aria-hidden", isOil ? "false" : "true");
  }

  function installEmployeeImportButton() {
    ensureUiStyles();
    if (document.getElementById("lmb_control_center")) return;
    var panel = document.createElement("div");
    panel.id = "lmb_control_center";
    panel.className = "lmb-control-center";
    panel.innerHTML =
      '<div class="lmb-control-head">' +
      '<div class="lmb-control-brand">' +
      '<div class="lmb-control-avatar" aria-hidden="true"><span>AI</span></div>' +
      '<div>' +
      '<div class="lmb-ai-kicker">DMS Assistant</div>' +
      '<div class="lmb-control-title">' + escapeHtml(EXTENSION_TITLE) + '</div>' +
      '<div class="lmb-control-subtitle">Tự động tạo và cập nhật nhân viên trên DMS</div>' +
      '</div>' +
      '</div>' +
      buildStatusPillHtml("ready", "Sẵn sàng") +
      '</div>' +
      '<div class="lmb-control-tabs" role="tablist" aria-label="Bảng điều khiển tạo nhân viên">' +
      '<button id="lmb_tab_create" class="lmb-tab-button" type="button" role="tab" data-lmb-tab-button="create">Tạo mới</button>' +
      '<button id="lmb_tab_update" class="lmb-tab-button" type="button" role="tab" data-lmb-tab-button="update">Cập nhật</button>' +
      '<button id="lmb_tab_support" class="lmb-tab-button" type="button" role="tab" data-lmb-tab-button="support">Hỗ trợ</button>' +
      '<button id="lmb_tab_logs" class="lmb-tab-button" type="button" role="tab" data-lmb-tab-button="logs">Nhật ký</button>' +
      '</div>' +
      '<div class="lmb-control-body">' +
      '<div id="lmb_update_notice" class="lmb-update-notice" hidden></div>' +
      '<section id="lmb_panel_create" class="lmb-tab-panel" role="tabpanel" data-lmb-tab-panel="create">' +
      '<div class="lmb-module">' +
      '<div class="lmb-module-head"><div><div class="lmb-module-title">Tạo tài khoản nhân viên</div><div class="lmb-module-subtitle">Nạp danh sách Excel/CSV và chạy quy trình tự động trên DMS.</div></div></div>' +
      '<label class="lmb-field" for="lmb_control_category_choice">' +
      '<span>Ngành cần tạo</span>' +
      '<select id="lmb_control_category_choice">' +
      '<option value="Bánh" selected>Bánh - danh sách đang hoạt động</option>' +
      '<option value="Dầu">Dầu - danh sách chung</option>' +
      '</select>' +
      '</label>' +
      '<div id="lmb_oil_category_notice" class="lmb-oil-notice" hidden aria-hidden="true"><b>Lưu ý ngành Dầu</b><span>Ngành Dầu chưa được kiểm thử đầy đủ, có thể không hoạt động ổn định hoặc kết quả chưa chính xác. Vui lòng liên hệ Hưng để được hỗ trợ nâng cấp hoặc xử lý lỗi.</span></div>' +
      buildGuideStepsHtml("compact") +
      '<div class="lmb-control-actions">' +
      '<button id="lmb_employee_import_button" class="lmb-control-primary" type="button">Nhập file nhân sự<small>Excel / CSV</small></button>' +
      '</div>' +
      '</div>' +
      '</section>' +
      '<section id="lmb_panel_update" class="lmb-tab-panel" role="tabpanel" data-lmb-tab-panel="update">' +
      '<div class="lmb-module">' +
      '<div class="lmb-module-head"><div><div class="lmb-module-title">Cập nhật nhân viên theo file</div><div class="lmb-module-subtitle">Tra cứu theo mã nhân viên và cập nhật hồ sơ theo tác vụ đã chọn.</div></div></div>' +
      '<label class="lmb-field" for="lmb_update_task_choice"><span>Tác vụ</span><select id="lmb_update_task_choice"><option value="resignation">Đóng nhân viên nghỉ việc</option><option value="add_mid_autumn">Thêm ngành Trung thu</option></select></label>' +
      '<div class="lmb-support-actions">' +
      '<button id="lmb_update_template_button" class="lmb-btn" type="button">Tải template</button>' +
      '<button id="lmb_update_import_button" class="lmb-btn lmb-btn-primary" type="button">Nhập file cập nhật</button>' +
      '</div>' +
      '<div class="lmb-guide-tip">File cập nhật cần mã nhân viên và dữ liệu tương ứng với tác vụ. Hệ thống sẽ tra cứu hồ sơ, mở cửa sổ cập nhật và lưu kết quả từng dòng.</div>' +
      '</div>' +
      '</section>' +
      '<section id="lmb_panel_support" class="lmb-tab-panel" role="tabpanel" data-lmb-tab-panel="support">' +
      '<div class="lmb-module">' +
      '<div class="lmb-module-head"><div><div class="lmb-module-title">Gửi yêu cầu / báo lỗi</div><div class="lmb-module-subtitle">Đính kèm ngữ cảnh automation gần nhất để hỗ trợ nhanh hơn.</div></div></div>' +
      '<div class="lmb-command-row">' +
      '<label class="lmb-field" for="lmb_feedback_type"><span>Loại</span><select id="lmb_feedback_type"><option value="feature">Yêu cầu tính năng</option><option value="bug">Báo lỗi</option><option value="question">Cần hỗ trợ</option></select></label>' +
      '<label class="lmb-field" for="lmb_feedback_urgency"><span>Mức độ</span><select id="lmb_feedback_urgency"><option value="normal">Bình thường</option><option value="high">Gấp</option><option value="urgent">Rất gấp</option></select></label>' +
      '</div>' +
      '<label class="lmb-field" for="lmb_feedback_sender"><span>Người gửi</span><input id="lmb_feedback_sender" placeholder="Tên của bạn / bộ phận" /></label>' +
      '<label class="lmb-field" for="lmb_feedback_message"><span>Nội dung</span><textarea id="lmb_feedback_message" rows="3" placeholder="Mô tả yêu cầu, lỗi đang gặp, hoặc tính năng muốn nâng cấp"></textarea></label>' +
      '<div class="lmb-log-preview" id="lmb_latest_log_preview">Chưa có nhật ký automation.</div>' +
      '<label class="lmb-check" for="lmb_feedback_attach_latest"><input id="lmb_feedback_attach_latest" type="checkbox" disabled /><span>Đính kèm file kết quả gần nhất<small id="lmb_feedback_attach_hint">Chưa có file kết quả trong phiên hiện tại.</small></span></label>' +
      '<div class="lmb-support-actions"><button id="lmb_feedback_pick_attachment" class="lmb-btn" type="button">Chọn file kết quả</button><button id="lmb_feedback_clear_attachment" class="lmb-btn" type="button" hidden>Gỡ file</button></div>' +
      '<div class="lmb-ticket-card lmb-ticket-status-empty" id="lmb_ticket_status"><div class="lmb-ticket-title">Yêu cầu hỗ trợ</div><div class="lmb-ticket-empty">Chưa có ticket hỗ trợ.</div></div>' +
      '<div class="lmb-support-actions"><button id="lmb_ticket_refresh" class="lmb-btn" type="button">Làm mới trạng thái</button></div>' +
      '<div class="lmb-support-actions"><button id="lmb_feedback_ping" class="lmb-btn" type="button">Kiểm tra kết nối</button><button id="lmb_feedback_send" class="lmb-btn lmb-btn-primary" type="button">Gửi Telegram</button></div>' +
      '</div>' +
      '</section>' +
      '<section id="lmb_panel_logs" class="lmb-tab-panel" role="tabpanel" data-lmb-tab-panel="logs">' +
      '<div class="lmb-module">' +
      '<div class="lmb-module-head"><div><div class="lmb-module-title">Nhật ký gần nhất</div><div class="lmb-module-subtitle">Theo dõi trạng thái chạy, lỗi và file kết quả.</div></div></div>' +
      '<div class="lmb-log-panel" id="lmb_log_tab_preview">Chưa có nhật ký automation.</div>' +
      '<div class="lmb-support-actions"><button id="lmb_export_log_button" class="lmb-btn" type="button">Xuất nhật ký</button><button class="lmb-btn lmb-btn-primary" type="button" data-lmb-open-tab="support">Gửi báo cáo lỗi</button></div>' +
      '</div>' +
      '</section>' +
      '<div class="lmb-control-meta">' + buildUiFooterHtml() + '</div>' +
      '</div>';
    document.body.appendChild(panel);
    Array.prototype.forEach.call(panel.querySelectorAll("[data-lmb-tab-button]"), function(tabButton) {
      tabButton.addEventListener("click", function() {
        setControlPanelTab(tabButton.getAttribute("data-lmb-tab-button"));
      });
    });
    Array.prototype.forEach.call(panel.querySelectorAll("[data-lmb-open-tab]"), function(tabOpener) {
      tabOpener.addEventListener("click", function() {
        setControlPanelTab(tabOpener.getAttribute("data-lmb-open-tab"));
      });
    });
    setControlPanelTab(readControlPanelTab());
    refreshSupportLogPreview();
    var categoryChoice = document.getElementById("lmb_control_category_choice");
    if (categoryChoice) {
      categoryChoice.addEventListener("change", syncOilCategoryNotice);
      syncOilCategoryNotice();
    }
    var savedSender = "";
    try {
      savedSender = localStorage.getItem("lmb_feedback_sender_v1") || "";
    } catch (e) {}
    var senderInput = document.getElementById("lmb_feedback_sender");
    if (senderInput && savedSender) senderInput.value = savedSender;
    var feedbackType = document.getElementById("lmb_feedback_type");
    if (feedbackType) {
      feedbackType.addEventListener("change", refreshLatestResultAttachmentUi);
    }
    refreshLatestResultAttachmentUi();
    loadLatestResultAttachment().catch(function() {
      refreshLatestResultAttachmentUi();
    });
    refreshSupportTicketStatusView();
    startSupportTicketPolling();
    checkExtensionUpdate().catch(function() {});

    var pickAttachmentButton = document.getElementById("lmb_feedback_pick_attachment");
    if (pickAttachmentButton) {
      pickAttachmentButton.addEventListener("click", function() {
        var input = document.createElement("input");
        input.type = "file";
        input.accept = ".xls,.xlsx,.csv,.txt,text/csv,text/plain,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
        input.addEventListener("change", async function() {
          var file = input.files && input.files[0];
          if (!file) return;
          pickAttachmentButton.disabled = true;
          pickAttachmentButton.textContent = "Đang đọc file...";
          try {
            var attachment = await buildManualSupportAttachment(file);
            rememberLatestResultAttachment(attachment);
            var attachEl = document.getElementById("lmb_feedback_attach_latest");
            if (attachEl) attachEl.checked = true;
            toast("Đã sẵn sàng đính kèm file kết quả.", "ok");
          } catch (err) {
            toast("Chưa đính kèm được file: " + (err.message || err), "error");
          } finally {
            pickAttachmentButton.disabled = false;
            refreshLatestResultAttachmentUi();
          }
        });
        input.click();
      });
    }

    var clearAttachmentButton = document.getElementById("lmb_feedback_clear_attachment");
    if (clearAttachmentButton) {
      clearAttachmentButton.addEventListener("click", function() {
        rememberLatestResultAttachment(null);
        toast("Đã gỡ file đính kèm.", "ok");
      });
    }

    var updateTaskChoice = document.getElementById("lmb_update_task_choice");
    var updateTemplateButton = document.getElementById("lmb_update_template_button");
    var updateImportButton = document.getElementById("lmb_update_import_button");
    if (updateTemplateButton) {
      updateTemplateButton.addEventListener("click", function() {
        var taskType = updateTaskChoice ? updateTaskChoice.value : UPDATE_TASK_RESIGNATION;
        var filename = normalizeEmployeeUpdateTaskType(taskType) === UPDATE_TASK_MID_AUTUMN
          ? "template-them-nganh-trung-thu.csv"
          : "template-nhan-vien-nghi-viec.csv";
        downloadCsvFile(filename, buildEmployeeUpdateTemplateCsv(taskType));
        toast("Da tai template cap nhat nhan vien.", "ok");
      });
    }
    if (updateImportButton) {
      updateImportButton.addEventListener("click", function() {
        var input = document.createElement("input");
        input.type = "file";
        input.accept = ".xls,.xlsx,.csv,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
        input.addEventListener("change", async function() {
          var file = input.files && input.files[0];
          if (!file) return;
          updateImportButton.disabled = true;
          updateImportButton.textContent = "Dang doc file...";
          try {
            var taskType = updateTaskChoice ? updateTaskChoice.value : UPDATE_TASK_RESIGNATION;
            var batch = await parseEmployeeUpdateFile(file, taskType);
            if (!batch.employees.length) {
              toast("Khong tim thay ma nhan vien trong file cap nhat.", "error");
              return;
            }
            showEmployeeUpdateReview(batch);
            toast("Da doc file cap nhat: " + batch.employees.length + " nhan vien.", "ok");
          } catch (err) {
            toast("Khong doc duoc file cap nhat: " + err.message, "error");
          } finally {
            updateImportButton.disabled = false;
            updateImportButton.textContent = "Nhập file cập nhật";
          }
        });
        input.click();
      });
    }

    var ticketRefreshButton = document.getElementById("lmb_ticket_refresh");
    if (ticketRefreshButton) {
      ticketRefreshButton.addEventListener("click", async function() {
        ticketRefreshButton.disabled = true;
        ticketRefreshButton.textContent = "Đang cập nhật...";
        try {
          await pollLatestSupportTicketStatus({ manual: true });
        } catch (err) {
          toast("Chưa cập nhật được trạng thái: " + (err.message || err), "error");
        } finally {
          ticketRefreshButton.disabled = false;
          ticketRefreshButton.textContent = "Làm mới trạng thái";
        }
      });
    }

    var feedbackPing = document.getElementById("lmb_feedback_ping");
    if (feedbackPing) {
      feedbackPing.addEventListener("click", async function() {
        feedbackPing.disabled = true;
        feedbackPing.textContent = "Dang kiem tra...";
        try {
          var ping = await checkSupportWorkerConnection();
          if (ping && ping.ok) {
            var caps = ping.capabilities || {};
            toast(caps.attachments && caps.ticket_sync
              ? "Support Worker đã sẵn sàng: có đính kèm file và đồng bộ ticket."
              : "Support Worker đang hoạt động nhưng có thể là bản cũ, chưa đủ đính kèm file/ticket.", "ok");
          } else {
            toast("Support Worker chua san sang: HTTP " + (ping && ping.status ? ping.status : "unknown") + " " + ((ping && (ping.error || ping.body)) || ""), "error");
          }
        } catch (err) {
          toast("Khong kiem tra duoc Worker: " + (err.message || err), "error");
        } finally {
          feedbackPing.disabled = false;
          feedbackPing.textContent = "Kiem tra ket noi";
        }
      });
    }

    var feedbackSend = document.getElementById("lmb_feedback_send");
    if (feedbackSend) {
      feedbackSend.addEventListener("click", async function() {
        var typeEl = document.getElementById("lmb_feedback_type");
        var urgencyEl = document.getElementById("lmb_feedback_urgency");
        var messageEl = document.getElementById("lmb_feedback_message");
        var attachEl = document.getElementById("lmb_feedback_attach_latest");
        feedbackSend.disabled = true;
        feedbackSend.textContent = "Dang gui...";
        try {
          var sender = senderInput ? senderInput.value : "";
          if (sender) {
            try {
              localStorage.setItem("lmb_feedback_sender_v1", sender);
            } catch (e2) {}
          }
          var attachLatest = !!(attachEl && attachEl.checked && !attachEl.disabled);
          if (attachLatest && !latestResultAttachment) {
            await loadLatestResultAttachment();
          }
          var response = await sendSupportFeedback({
            type: typeEl ? typeEl.value : "feature",
            urgency: urgencyEl ? urgencyEl.value : "normal",
            sender: sender,
            message: messageEl ? messageEl.value : "",
            log: readLatestSupportLog(),
            url: root.location && root.location.href,
            attachment: attachLatest && latestResultAttachment ? latestResultAttachment : null
          });
          saveLatestSupportTicket(response);
          if (messageEl) messageEl.value = "";
          toast(supportFeedbackSuccessMessage(response, attachLatest), "ok");
        } catch (err) {
          toast("Chua gui duoc Telegram: " + (err.message || err), "error");
        } finally {
          feedbackSend.disabled = false;
          feedbackSend.textContent = "Gui Telegram";
        }
      });
    }
    var exportLogButton = document.getElementById("lmb_export_log_button");
    if (exportLogButton) {
      exportLogButton.addEventListener("click", function() {
        downloadTextFile("nhat-ky-auto-tao-nhan-vien-" + new Date().toISOString().slice(0, 10) + ".txt", readLatestSupportLog() || "Chua co nhat ky automation.");
        toast("Da tai nhat ky gan nhat.", "ok");
      });
    }
    var btn = document.getElementById("lmb_employee_import_button");
    btn.addEventListener("click", function() {
      var input = document.createElement("input");
      input.type = "file";
      input.accept = ".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      input.addEventListener("change", async function() {
        var file = input.files && input.files[0];
        if (!file) return;
        btn.disabled = true;
        setFabLabel(btn, "Đang đọc file...", "Vui lòng chờ");
        try {
          var batch = await parseEmployeeFile(file);
          if (!batch.employees.length) {
            toast("Khong tim thay nhan vien trong file.", "error");
            return;
          }
          var categorySelect = document.getElementById("lmb_control_category_choice");
          batch.category_choice = normalizeEmployeeCategoryChoice(categorySelect ? categorySelect.value : "Bánh");
          showEmployeeReview(batch);
          toast("Da doc file: " + batch.employees.length + " nhan vien.", "ok");
        } catch (err) {
          toast("Khong doc duoc file nhan su: " + err.message, "error");
        } finally {
          btn.disabled = false;
          setFabLabel(btn, "Nhập file nhân sự", "Excel / CSV");
        }
      });
      input.click();
    });
  }

  function isToolbarHostName(hostname) {
    return ADMIN_HOST_RE.test(String(hostname || ""));
  }

  function isToolbarHost() {
    return !!(root.location && isToolbarHostName(root.location.hostname));
  }

  function removeToolbarButtons() {
    [
      "lmb_button",
      "lmb_employee_button",
      "lmb_employee_import_button",
      "lmb_control_center"
    ].forEach(function(id) {
      var el = document.getElementById(id);
      if (el) el.remove();
    });
  }

  function renderToolbarButtons(visible) {
    removeToolbarButtons();
    if (!visible || !isToolbarHost()) return;
    installEmployeeImportButton();
  }

  async function readToolbarVisible() {
    try {
      return isToolbarVisibleSetting(await chromeStorageGet(TOOLBAR_VISIBLE_KEY));
    } catch (e) {
      return false;
    }
  }

  function setToolbarVisible(visible, notify) {
    toolbarUiVisible = !!visible;
    renderToolbarButtons(toolbarUiVisible);
    if (notify) {
      toast(toolbarUiVisible ? "Đã bật nút thao tác." : "Đã ẩn nút thao tác.", toolbarUiVisible ? "ok" : "");
    }
  }

  function initToolbarToggleListener() {
    if (toolbarToggleListenerStarted) return;
    toolbarToggleListenerStarted = true;
    var chromeApi = getExtensionChromeApi();
    if (!chromeApi) return;
    if (chromeApi.runtime && chromeApi.runtime.onMessage) {
      chromeApi.runtime.onMessage.addListener(function(message, sender, sendResponse) {
        if (!message || message.type !== "LMB_SET_TOOLBAR_VISIBLE") return false;
        setToolbarVisible(message.visible, true);
        if (sendResponse) sendResponse({ ok: true, visible: toolbarUiVisible });
        return false;
      });
    }
    if (chromeApi.storage && chromeApi.storage.onChanged) {
      chromeApi.storage.onChanged.addListener(function(changes, areaName) {
        if (areaName !== "local" || !changes || !changes[TOOLBAR_VISIBLE_KEY]) return;
        setToolbarVisible(isToolbarVisibleSetting(changes[TOOLBAR_VISIBLE_KEY].newValue), false);
      });
    }
  }

  function rawSleep(ms) {
    return new Promise(function(resolve) { setTimeout(resolve, ms); });
  }

  function isAdminAutomationControlActive() {
    return !!(adminAutomationStarted && root.location && ADMIN_HOST_RE.test(root.location.hostname));
  }

  async function readAdminControlQueue() {
    try {
      return await chromeStorageGet(EMPLOYEE_BATCH_KEY);
    } catch (err) {
      return null;
    }
  }

  async function waitForAdminRunControl() {
    if (!isAdminAutomationControlActive()) return;
    var queue = await readAdminControlQueue();
    if (adminStopRequested || shouldStopEmployeeQueue(queue) || !queue) {
      adminStopRequested = true;
      throw createAdminControlError("Da dung han automation.", "cancelled");
    }
    if (!adminPauseRequested && !isEmployeeQueuePaused(queue)) {
      adminPausePanelShown = false;
      return;
    }

    adminPauseRequested = true;
    if (!adminPausePanelShown) {
      adminPausePanelShown = true;
      adminPanel("Dang tam dung automation. Bam Tiep tuc de chay tiep hoac Dung han de huy queue.", {
        canResume: true,
        canHardStop: true,
        queue: queue
      });
    }

    while (adminPauseRequested || isEmployeeQueuePaused(queue)) {
      await rawSleep(250);
      queue = await readAdminControlQueue();
      if (adminStopRequested || shouldStopEmployeeQueue(queue) || !queue) {
        adminStopRequested = true;
        throw createAdminControlError("Da dung han automation.", "cancelled");
      }
      if (!isEmployeeQueuePaused(queue)) {
        adminPauseRequested = false;
      }
    }
    adminPausePanelShown = false;
  }

  async function sleep(ms) {
    if (!isAdminAutomationControlActive()) {
      await rawSleep(ms);
      return;
    }
    var until = Date.now() + Math.max(Number(ms) || 0, 0);
    await waitForAdminRunControl();
    while (Date.now() < until) {
      await rawSleep(Math.min(100, until - Date.now()));
      await waitForAdminRunControl();
    }
  }

  async function waitFor(fn, timeoutMs, intervalMs, options) {
    var started = Date.now();
    var sleeper = options && options.raw ? rawSleep : sleep;
    while (Date.now() - started < timeoutMs) {
      var value = fn();
      if (value) return value;
      await sleeper(intervalMs || 250);
    }
    return null;
  }

  function isVisible(el) {
    if (!el) return false;
    var rect = el.getBoundingClientRect();
    var style = root.getComputedStyle ? root.getComputedStyle(el) : null;
    return rect.width > 0 && rect.height > 0 && (!style || style.visibility !== "hidden" && style.display !== "none");
  }

  function visibleText(el) {
    return normalizeSpace(el ? el.innerText || el.textContent || "" : "");
  }

  function normalizeOptionText(value) {
    return stripAccents(value).toLowerCase().replace(/\s+/g, " ").trim();
  }

  function optionTextMatches(actual, expected) {
    var wanted = normalizeOptionText(expected);
    return !!wanted && normalizeOptionText(actual) === wanted;
  }

  function eventPoint(el) {
    var rect = el && el.getBoundingClientRect ? el.getBoundingClientRect() : null;
    return {
      x: rect ? Math.round(rect.left + Math.max(1, rect.width / 2)) : 0,
      y: rect ? Math.round(rect.top + Math.max(1, rect.height / 2)) : 0
    };
  }

  function dispatchPointerMouse(target, type, point, extra) {
    var init = Object.assign({
      bubbles: true,
      cancelable: true,
      view: root,
      clientX: point.x,
      clientY: point.y,
      button: 0,
      buttons: /up|click/i.test(type) ? 0 : 1
    }, extra || {});
    try {
      target.dispatchEvent(new MouseEvent(type, init));
    } catch (e) {
      target.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
    }
  }

  function dispatchPointer(target, type, point) {
    if (typeof PointerEvent === "undefined") return;
    try {
      target.dispatchEvent(new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        view: root,
        pointerId: 1,
        pointerType: "mouse",
        isPrimary: true,
        clientX: point.x,
        clientY: point.y,
        button: 0,
        buttons: /up/i.test(type) ? 0 : 1
      }));
    } catch (e) {}
  }

  function highFidelityClickElement(el) {
    if (!el) return false;
    var target = el.closest && el.closest("button,[role='button'],a") || el;
    if (target.scrollIntoView) {
      try { target.scrollIntoView({ block: "center", inline: "center" }); } catch (e) {}
    }
    if (target.focus) {
      try { target.focus({ preventScroll: true }); } catch (e) { try { target.focus(); } catch (ignore) {} }
    }
    var point = eventPoint(target);
    dispatchPointer(target, "pointerover", point);
    dispatchPointerMouse(target, "mouseover", point);
    dispatchPointer(target, "pointerenter", point);
    dispatchPointerMouse(target, "mouseenter", point);
    dispatchPointer(target, "pointermove", point);
    dispatchPointerMouse(target, "mousemove", point);
    dispatchPointer(target, "pointerdown", point);
    dispatchPointerMouse(target, "mousedown", point);
    dispatchPointer(target, "pointerup", point);
    dispatchPointerMouse(target, "mouseup", point);
    try { target.click(); } catch (e) {}
    return true;
  }

  function commitDropdownOption(option) {
    return highFidelityClickElement(option);
  }

  function clickElement(el) {
    return highFidelityClickElement(el);
  }

  function findClickableByExactText(text, rootEl) {
    var wanted = stripAccents(text).toLowerCase();
    var nodes = Array.from((rootEl || document).querySelectorAll("button,[role='button'],a,span,i"));
    return nodes.find(function(el) {
      return isVisible(el) && stripAccents(visibleText(el)).toLowerCase() === wanted;
    }) || null;
  }

  function findClickableContainingText(text, rootEl) {
    var wanted = stripAccents(text).toLowerCase();
    var rootNode = rootEl || document;
    var selectorGroups = [
      "button,[role='button'],a",
      "span,i",
      "div"
    ];
    for (var i = 0; i < selectorGroups.length; i += 1) {
      var nodes = Array.from(rootNode.querySelectorAll(selectorGroups[i]));
      var found = nodes.find(function(el) {
        if (!isVisible(el)) return false;
        if (selectorGroups[i] === "div" && el.querySelector("button,[role='button'],a")) return false;
        return stripAccents(visibleText(el)).toLowerCase().indexOf(wanted) >= 0;
      });
      if (found) return found;
    }
    return null;
  }

  function isOwnExtensionElement(el) {
    if (!el) return false;
    var selector = [
      "#lmb_control_center",
      "#lmb_employee_review",
      ".lmb-toast",
      ".lmb-admin-panel",
      ".lmb-control-center",
      ".lmb-review",
      ".lmb-overlay"
    ].join(",");
    if (el.closest) {
      try {
        if (el.closest(selector)) return true;
      } catch (e) {}
    }
    var id = stripAccents(el.getAttribute && el.getAttribute("id") || el.id || "").toLowerCase();
    var className = stripAccents(el.getAttribute && el.getAttribute("class") || el.className || "").toLowerCase();
    return id.indexOf("lmb_") === 0 ||
      id.indexOf("lmb-") === 0 ||
      className.indexOf("lmb-") >= 0 ||
      className.indexOf("lmb_") >= 0;
  }

  function findEmployeeModal() {
    var nodes = Array.from(document.querySelectorAll("[role='dialog'],.ant-modal,.modal,.el-dialog,body > div"));
    return nodes.find(function(el) {
      if (isOwnExtensionElement(el)) return false;
      var text = stripAccents(visibleText(el)).toLowerCase();
      return isVisible(el) && (
        text.indexOf("them nhan vien") >= 0 ||
        text.indexOf("cap nhat thong tin nhan vien") >= 0 ||
        text.indexOf("cap nhat nhan vien") >= 0
      );
    }) || null;
  }

  function findEmployeeUpdateModal() {
    var nodes = Array.from(document.querySelectorAll("[role='dialog'],.ant-modal,.modal,.el-dialog,body > div"));
    return nodes.find(function(el) {
      if (isOwnExtensionElement(el)) return false;
      var text = stripAccents(visibleText(el)).toLowerCase();
      return isVisible(el) && (
        text.indexOf("cap nhat thong tin nhan vien") >= 0 ||
        text.indexOf("cap nhat nhan vien") >= 0
      );
    }) || null;
  }

  function findEmployeeRowByCode(employeeCode) {
    var code = cleanField(employeeCode);
    if (!code || typeof document === "undefined") return null;
    var rows = Array.from(document.querySelectorAll("tbody tr,.ant-table-row,[role='row']"))
      .filter(isVisible);
    return rows.find(function(row) {
      return employeeTokenExistsInText(code, visibleText(row));
    }) || null;
  }

  function findEmployeeEditButton(row) {
    if (!row) return null;
    var nodes = Array.from(row.querySelectorAll("button,[role='button'],a,span,i,svg"));
    var edit = nodes.find(function(el) {
      if (!isVisible(el)) return false;
      var text = [
        visibleText(el),
        el.getAttribute("aria-label") || "",
        el.getAttribute("title") || "",
        el.getAttribute("class") || "",
        el.parentElement ? el.parentElement.getAttribute("aria-label") || "" : "",
        el.parentElement ? el.parentElement.getAttribute("title") || "" : "",
        el.parentElement ? el.parentElement.getAttribute("class") || "" : ""
      ].join(" ");
      var plain = stripAccents(text).toLowerCase();
      return plain.indexOf("sua") >= 0 ||
        plain.indexOf("edit") >= 0 ||
        plain.indexOf("pencil") >= 0 ||
        plain.indexOf("anticon-edit") >= 0 ||
        plain.indexOf("icon-edit") >= 0;
    });
    if (edit) return edit;
    var cells = Array.from(row.querySelectorAll("td,.ant-table-cell,[role='cell']"));
    var lastCell = cells[cells.length - 1];
    var actions = lastCell ? Array.from(lastCell.querySelectorAll("button,[role='button'],a,span,i,svg")).filter(isVisible) : [];
    return actions[0] || null;
  }

  async function clickEmployeeEditButton(employee) {
    var row = await waitFor(function() {
      return findEmployeeRowByCode(employee && employee.employee_code);
    }, 15000, 300);
    if (!row) throw new Error("Khong tim thay dong nhan vien " + cleanField(employee && employee.employee_code) + " tren trang tim kiem.");
    var edit = findEmployeeEditButton(row);
    if (!edit) throw new Error("Khong tim thay thao tac cap nhat cho nhan vien " + cleanField(employee && employee.employee_code) + ".");
    await waitForAdminRunControl();
    clickElement(edit);
    var modal = await waitFor(findEmployeeUpdateModal, 9000, 250);
    if (!modal) throw new Error("Da mo thao tac cap nhat nhung khong thay bang Cap nhat thong tin nhan vien.");
    return modal;
  }

  function findAddEmployeeButton() {
    var exactPlus = findClickableByExactText("+");
    if (exactPlus) return exactPlus;

    var nodes = Array.from(document.querySelectorAll("button,[role='button'],a,span,i,svg"));
    return nodes.find(function(el) {
      if (!isVisible(el)) return false;
      var text = [
        visibleText(el),
        el.getAttribute("aria-label") || "",
        el.getAttribute("title") || "",
        el.getAttribute("class") || "",
        el.parentElement ? el.parentElement.getAttribute("aria-label") || "" : "",
        el.parentElement ? el.parentElement.getAttribute("title") || "" : "",
        el.parentElement ? el.parentElement.getAttribute("class") || "" : ""
      ].join(" ");
      var plain = stripAccents(text).toLowerCase();
      return plain.indexOf("them salesman") >= 0 ||
        plain.indexOf("them nhan vien") >= 0 ||
        plain.indexOf("anticon-plus") >= 0 ||
        plain.indexOf("icon-plus") >= 0 ||
        plain.indexOf(" plus") >= 0 ||
        plain.indexOf("add") >= 0;
    }) || null;
  }

  async function clickAddEmployeeButton() {
    var closed = await closeOpenEmployeeModal();
    if (!closed) throw new Error("Khong dong duoc cua so Them nhan vien dang mo.");
    var plus = await waitFor(findAddEmployeeButton, 18000, 300);
    if (!plus) throw new Error("Khong tim thay nut + them nhan vien.");
    await waitForAdminRunControl();
    clickElement(plus);
    var modal = await waitFor(findEmployeeModal, 8000, 250);
    if (!modal) throw new Error("Da yeu cau them nhan vien nhung khong thay cua so Them nhan vien.");
    return modal;
  }

  function fieldTextMatches(text, term) {
    var haystack = stripAccents(text).toLowerCase().replace(/\s+/g, " ").trim();
    var needle = stripAccents(term).toLowerCase().replace(/\s+/g, " ").trim();
    return !!needle && haystack.indexOf(needle) >= 0;
  }

  function findFieldGroupByLabel(modal, labelText) {
    var terms = inputSearchTerms(labelText);
    if (terms.indexOf(labelText) < 0) terms.push(labelText);
    var selector = ".ant-form-item,.el-form-item,.form-group,.row";
    var groups = Array.from(modal.querySelectorAll(selector));
    var group = groups.find(function(el) {
      return isVisible(el) &&
        el.querySelector("input,textarea,.ant-select,.el-select,select,[role='combobox']") &&
        terms.some(function(term) { return fieldTextMatches(visibleText(el), term); });
    });
    if (group) return group;

    return Array.from(modal.querySelectorAll("div")).filter(function(el) {
      return isVisible(el) &&
        el.querySelector("input,textarea,.ant-select,.el-select,select,[role='combobox']") &&
        terms.some(function(term) { return fieldTextMatches(visibleText(el), term); });
    }).sort(function(a, b) {
      return a.getBoundingClientRect().height - b.getBoundingClientRect().height;
    })[0] || null;
  }

  function inputSearchTerms(labelText) {
    var base = cleanField(labelText);
    var plain = stripAccents(base).toLowerCase();
    var terms = [base];
    if (plain.indexOf("so dien thoai") >= 0) {
      terms.push("Số điện thoại liên hệ", "Số điện thoại", "So dien thoai lien he");
    } else if (plain.indexOf("ho va ten") >= 0) {
      terms.push("Họ và tên", "Ho va ten");
    } else if (plain.indexOf("ma nhan vien") >= 0) {
      terms.push("Mã nhân viên", "Nhap ma nhan vien");
    } else if (plain.indexOf("ma portal") >= 0) {
      terms.push("Mã Portal/SAP", "Nhap ma Portal/SAP");
    } else if (plain.indexOf("ten dang nhap") >= 0) {
      terms.push("Tên đăng nhập", "Nhap ten dang nhap");
    } else if (plain.indexOf("thoi gian bat dau") >= 0) {
      terms.push("Thời gian bắt đầu");
    } else if (plain.indexOf("thoi gian ket thuc") >= 0) {
      terms.push("Thời gian kết thúc");
    }
    var seen = {};
    return terms.filter(function(term) {
      var key = stripAccents(term).toLowerCase();
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  function findInputByPlaceholder(modal, labelText) {
    var terms = inputSearchTerms(labelText);
    var inputs = Array.from(modal.querySelectorAll("input:not([type='hidden']),textarea"));
    return inputs.find(function(input) {
      if (!isVisible(input)) return false;
      var placeholder = input.getAttribute("placeholder") || "";
      var aria = input.getAttribute("aria-label") || "";
      var title = input.getAttribute("title") || "";
      return terms.some(function(term) {
        return fieldTextMatches(placeholder, term) || fieldTextMatches(aria, term) || fieldTextMatches(title, term);
      });
    }) || null;
  }

  function findInputByLabel(modal, labelText) {
    var byPlaceholder = findInputByPlaceholder(modal, labelText);
    if (byPlaceholder) return byPlaceholder;

    var terms = inputSearchTerms(labelText);
    var groups = Array.from(modal.querySelectorAll(".ant-form-item,.form-group,.el-form-item,.row,label"));
    for (var i = 0; i < groups.length; i += 1) {
      var group = groups[i];
      var text = visibleText(group);
      if (terms.some(function(term) { return fieldTextMatches(text, term); })) {
        var input = group.querySelector("input:not([type='hidden']),textarea");
        if (input && isVisible(input)) return input;
        var parent = group.parentElement;
        for (var depth = 0; parent && depth < 6; depth += 1, parent = parent.parentElement) {
          input = parent.querySelector("input:not([type='hidden']),textarea");
          if (input && isVisible(input)) return input;
        }
      }
    }
    return null;
  }

  function setInputValue(input, value, options) {
    if (!input) return false;
    input.focus();
    var setter = Object.getOwnPropertyDescriptor(input.constructor.prototype, "value");
    if (setter && setter.set) setter.set.call(input, "");
    else input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    if (setter && setter.set) setter.set.call(input, value);
    else input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    if (!options || options.blur !== false) input.blur();
    return true;
  }

  function fillInputByLabel(modal, labelText, value, required) {
    if (!value && !required) return;
    var input = findInputByLabel(modal, labelText);
    if (!input) {
      if (required) throw new Error("Khong tim thay o " + labelText + ".");
      return;
    }
    setInputValue(input, value || "");
  }

  function findOpenDatePickerPanel() {
    var selectors = [
      ".ant-calendar-picker-container",
      ".ant-picker-dropdown",
      ".ant-calendar",
      ".ant-picker-panel",
      ".el-picker-panel",
      ".el-date-picker",
      "[class*='calendar']",
      "[class*='datepicker']"
    ].join(",");
    var panels = Array.from(document.querySelectorAll(selectors));
    return panels.find(function(panel) {
      return isVisible(panel) && parseDatePickerTitle(visibleText(panel));
    }) || null;
  }

  function isDateCellOutsideCurrentMonth(el) {
    var node = el;
    for (var depth = 0; node && depth < 4; depth += 1, node = node.parentElement) {
      var className = String(node.className || "").toLowerCase();
      if (/disabled|last-month|next-month|not-in-view/.test(className)) return true;
      if (/ant-picker-cell/.test(className) && !/ant-picker-cell-in-view/.test(className)) return true;
    }
    return false;
  }

  function findDateCell(panel, targetDate) {
    var target = parseDateParts(targetDate);
    if (!panel || !target) return null;
    var titleText = visibleText(panel);
    if (!isDateCellForTarget(String(target.day), titleText, target.value)) return null;
    var nodes = Array.from(panel.querySelectorAll(
      ".ant-calendar-date,.ant-picker-cell-inner,td,button,span,div"
    ));
    return nodes.find(function(node) {
      if (!isVisible(node) || isDateCellOutsideCurrentMonth(node)) return false;
      return String(visibleText(node)).trim() === String(target.day);
    }) || null;
  }

  async function pickDateFromOpenPicker(targetDate) {
    var target = parseDateParts(targetDate);
    if (!target) return false;
    var panel = await waitFor(findOpenDatePickerPanel, 3000, 150);
    if (!panel) return false;
    var cell = findDateCell(panel, target.value);
    if (!cell) return false;
    clickElement(cell);
    await sleep(300);
    return true;
  }

  async function fillDateByLabel(modal, labelText, value, required) {
    if (!value && !required) return;
    var target = parseDateParts(value);
    if (!target) {
      if (required) throw new Error("Ngay khong hop le o " + labelText + ": " + value);
      return;
    }
    var input = findInputByLabel(modal, labelText);
    if (!input) {
      if (required) throw new Error("Khong tim thay o " + labelText + ".");
      return;
    }
    setInputValue(input, target.value, { blur: false });
    clickElement(input);
    await sleep(400);
    var picked = await pickDateFromOpenPicker(target.value);
    if (!picked) {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", bubbles: true }));
      await sleep(200);
    }
    input.blur();
    if (required && normalizeDateText(input.value) !== target.value) {
      throw new Error("Khong chon duoc ngay " + target.value + " cho " + labelText + ".");
    }
  }

  function findSelectByLabel(modal, labelText) {
    var group = findFieldGroupByLabel(modal, labelText);
    return group ? group.querySelector(".ant-select,.el-select,select,[role='combobox']") : null;
  }

  function cleanSelectedOptionText(value) {
    return cleanField(value).replace(/\s*[×x]\s*$/i, "").trim();
  }

  function selectedOptionTextFromNode(node) {
    if (!node) return "";
    return cleanSelectedOptionText(
      node.value ||
      node.getAttribute && (node.getAttribute("title") || node.getAttribute("aria-label")) ||
      visibleText(node)
    );
  }

  function uniqueTextList(values) {
    var seen = {};
    return values.map(cleanSelectedOptionText).filter(function(value) {
      var key = normalizeOptionText(value);
      if (!key || seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  function selectSelectedTexts(select) {
    if (!select) return [];
    if (select.tagName && select.tagName.toLowerCase() === "select") {
      var selectedOptions = select.selectedOptions ? Array.from(select.selectedOptions) : [];
      if (!selectedOptions.length && select.options && select.selectedIndex >= 0) {
        selectedOptions = [select.options[select.selectedIndex]];
      }
      return uniqueTextList(selectedOptions.map(function(option) {
        return option ? option.text || "" : "";
      }));
    }

    var tagSelector = [
      ".ant-select-selection-item",
      ".ant-select-selection-item-content",
      ".ant-select-selection__choice__content",
      ".ant-select-selection__choice",
      ".el-tag .el-select__tags-text",
      ".el-select__tags-text"
    ].join(",");
    var tagNodes = select.querySelectorAll ? Array.from(select.querySelectorAll(tagSelector)) : [];
    var tagValues = uniqueTextList(tagNodes.map(selectedOptionTextFromNode));
    if (tagValues.length) return tagValues;

    var singleSelector = [
      ".ant-select-selection-selected-value",
      ".ant-select-selected-value",
      ".el-input__inner"
    ].join(",");
    var singleNodes = select.querySelectorAll ? Array.from(select.querySelectorAll(singleSelector)) : [];
    var singleValues = uniqueTextList(singleNodes.map(selectedOptionTextFromNode));
    if (singleValues.length) return singleValues;

    return uniqueTextList([
      select.getAttribute && (select.getAttribute("title") || select.getAttribute("aria-label")) || "",
      visibleText(select)
    ]);
  }

  function selectDisplayText(select) {
    if (!select) return "";
    return selectSelectedTexts(select).join(", ");
  }

  function selectValueByLabel(modal, labelText) {
    return selectDisplayText(findSelectByLabel(modal, labelText));
  }

  function selectedValueMatches(select, optionText) {
    return selectSelectedTexts(select).some(function(value) {
      return optionTextMatches(value, optionText);
    });
  }

  function visibleDropdownOptions() {
    var selectors = [
      ".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option",
      ".ant-select-dropdown:not(.ant-select-dropdown-hidden) [role='option']",
      ".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-dropdown-menu-item",
      ".rc-virtual-list-holder .ant-select-item-option",
      ".el-select-dropdown .el-select-dropdown__item",
      "[role='listbox'] [role='option']"
    ];
    var seen = [];
    return Array.from(document.querySelectorAll(selectors.join(","))).filter(function(el) {
      if (seen.indexOf(el) >= 0) return false;
      seen.push(el);
      if (!isVisible(el)) return false;
      if (el.getAttribute("aria-disabled") === "true") return false;
      if (String(el.className || "").toLowerCase().indexOf("disabled") >= 0) return false;
      return true;
    });
  }

  function findDropdownOptionByExactText(optionText) {
    return visibleDropdownOptions().find(function(el) {
      return optionTextMatches(el.getAttribute("title") || visibleText(el), optionText);
    }) || null;
  }

  function keyCodeFor(key) {
    return {
      Enter: 13,
      ArrowDown: 40,
      ArrowUp: 38,
      Home: 36,
      Escape: 27
    }[key] || 0;
  }

  function dispatchKeyboard(target, key, type) {
    if (!target) return;
    var code = keyCodeFor(key);
    var init = {
      bubbles: true,
      cancelable: true,
      key: key,
      code: key,
      keyCode: code,
      which: code
    };
    try {
      target.dispatchEvent(new KeyboardEvent(type || "keydown", init));
    } catch (e) {
      target.dispatchEvent(new Event(type || "keydown", { bubbles: true, cancelable: true }));
    }
  }

  function sendKey(target, key) {
    dispatchKeyboard(target, key, "keydown");
    if (key === "Enter") dispatchKeyboard(target, key, "keypress");
    dispatchKeyboard(target, key, "keyup");
  }

  function selectKeyboardTarget(select) {
    return select.querySelector("input:not([type='hidden']),textarea,[contenteditable='true']") ||
      document.activeElement ||
      select;
  }

  async function openDropdownForSelect(select) {
    if (visibleDropdownOptions().length) return;
    clickElement(select);
    await sleep(180);
    if (visibleDropdownOptions().length) return;
    var target = selectKeyboardTarget(select);
    if (target && target.focus) {
      try { target.focus(); } catch (e) {}
    }
    sendKey(target, "ArrowDown");
    await sleep(180);
  }

  async function searchAndCommitDropdownOption(select, optionText) {
    await openDropdownForSelect(select);
    var target = selectKeyboardTarget(select);
    var option = null;
    if (target && ("value" in target)) {
      setInputValue(target, optionText, { blur: false });
      try {
        option = await waitFor(function() {
          return findDropdownOptionByExactText(optionText);
        }, 3500, 100);
      } catch (e) {}
    } else {
      try {
        option = await waitFor(function() {
          return findDropdownOptionByExactText(optionText);
        }, 1200, 100);
      } catch (e) {}
    }
    if (option) {
      commitDropdownOption(option);
      await sleep(450);
    } else if (target) {
      sendKey(target, "Enter");
      await sleep(300);
    }
    return selectedValueMatches(select, optionText);
  }

  async function keyboardSelectDropdownOption(select, optionText) {
    await openDropdownForSelect(select);
    var options = visibleDropdownOptions();
    var index = options.findIndex(function(el) {
      return optionTextMatches(el.getAttribute("title") || visibleText(el), optionText);
    });
    var target = selectKeyboardTarget(select);
    if (target && target.focus) {
      try { target.focus(); } catch (e) {}
    }
    if (index >= 0) {
      sendKey(target, "Home");
      await sleep(80);
      for (var i = 0; i < index; i += 1) {
        sendKey(target, "ArrowDown");
        await sleep(80);
      }
      sendKey(target, "Enter");
      await sleep(300);
      if (selectedValueMatches(select, optionText)) return true;
    }
    var option = findDropdownOptionByExactText(optionText);
    if (option) {
      commitDropdownOption(option);
      await sleep(300);
    }
    return selectedValueMatches(select, optionText);
  }

  async function waitForSelectLabelValue(select, optionText) {
    return waitFor(function() {
      return selectedValueMatches(select, optionText);
    }, 2500, 100);
  }

  async function selectByLabel(modal, labelText, optionText, required) {
    if (!optionText) return;
    var select = findSelectByLabel(modal, labelText);
    if (!select) {
      if (required) throw new Error("Khong tim thay o chon " + labelText);
      return;
    }
    if (selectedValueMatches(select, optionText)) return;
    if (select.tagName && select.tagName.toLowerCase() === "select") {
      var nativeOption = Array.from(select.options).find(function(option) {
        return optionTextMatches(option.text, optionText);
      });
      if (!nativeOption) {
        if (required) throw new Error("Khong tim thay lua chon " + optionText + " cho " + labelText);
        return;
      }
      select.value = nativeOption.value;
      select.dispatchEvent(new Event("input", { bubbles: true }));
      select.dispatchEvent(new Event("change", { bubbles: true }));
      if (!selectedValueMatches(select, optionText) && required) {
        throw new Error("Chon " + labelText + " khong thanh cong: dang la " + selectDisplayText(select) + ", can " + optionText);
      }
      return;
    }
    await openDropdownForSelect(select);
    var option = null;
    try {
      option = await waitFor(function() {
        return findDropdownOptionByExactText(optionText);
      }, 1200, 100);
    } catch (e) {}
    if (option) {
      commitDropdownOption(option);
      await sleep(350);
      try {
        await waitForSelectLabelValue(select, optionText);
      } catch (err) {}
    }
    if (!selectedValueMatches(select, optionText)) {
      await searchAndCommitDropdownOption(select, optionText);
    }
    if (!selectedValueMatches(select, optionText)) {
      await keyboardSelectDropdownOption(select, optionText);
    }
    if (!selectedValueMatches(select, optionText) && required) {
      throw new Error("Chon " + labelText + " khong thanh cong: dang la " + selectDisplayText(select) + ", can " + optionText);
    }
  }

  function clickRadioText(text, modal) {
    var el = findClickableContainingText(text, modal);
    if (el) {
      clickElement(el);
      return true;
    }
    return false;
  }

  function parseGeneratedCredentials(modal) {
    var text = visibleText(modal);
    var usernameMatch = /T[eê]n\s+d[aă]ng\s+nh[aậ]p\s*:?\s*([^\s]+)/i.exec(text) ||
      /Ten\s+dang\s+nhap\s*:?\s*([^\s]+)/i.exec(stripAccents(text));
    var passwordMatch = /M[aậ]t\s+kh[aẩ]u\s+m[aặ]c\s+d[iị]nh\s*:?\s*([^\s]+)/i.exec(text) ||
      /Mat\s+khau\s+mac\s+dinh\s*:?\s*([^\s]+)/i.exec(stripAccents(text));
    return {
      generated_username: usernameMatch ? cleanField(usernameMatch[1]) : "",
      generated_password: passwordMatch ? cleanField(passwordMatch[1]) : ""
    };
  }

  function valueAfterPlainLabel(originalText, plainText, label, stopLabels) {
    var labelIndex = plainText.indexOf(label);
    if (labelIndex < 0) return "";
    var start = labelIndex + label.length;
    var afterLabel = plainText.slice(start);
    var colonOffset = afterLabel.search(/[:：]/);
    if (colonOffset >= 0 && colonOffset < 8) start += colonOffset + 1;
    while (/\s/.test(plainText.charAt(start))) start += 1;

    var end = plainText.length;
    (stopLabels || []).forEach(function(stopLabel) {
      var idx = plainText.indexOf(stopLabel, start);
      if (idx >= 0 && idx < end) end = idx;
    });
    return cleanField(originalText.slice(start, end).split(/\s+/)[0] || "");
  }

  function valueAfterCredentialLine(lines, label) {
    var wanted = stripAccents(label).toLowerCase();
    for (var i = 0; i < lines.length; i += 1) {
      var line = String(lines[i] || "");
      var plain = stripAccents(line).toLowerCase();
      if (plain.indexOf(wanted) < 0) continue;
      var colonIndex = line.search(/[:：]/);
      if (colonIndex < 0) continue;
      var value = cleanField(line.slice(colonIndex + 1)).split(/\s+/)[0] || "";
      if (value) return value;
    }
    return "";
  }

  function parseGeneratedCredentialsText(text) {
    var original = String(text || "");
    var plain = stripAccents(original).toLowerCase().replace(/\s+/g, " ");
    var lines = original.split(/\r?\n/);
    var sectionStart = -1;
    lines.forEach(function(line, index) {
      if (stripAccents(line).toLowerCase().indexOf("thong tin dang nhap") >= 0) {
        sectionStart = index + 1;
      }
    });
    var scopedLines = sectionStart >= 0 ? lines.slice(sectionStart) : lines;
    var username = valueAfterCredentialLine(scopedLines, "ten dang nhap");
    var password = valueAfterCredentialLine(scopedLines, "mat khau mac dinh");
    if (!username) {
      username = valueAfterPlainLabel(original, plain, "ten dang nhap", [
        "mat khau mac dinh",
        "mat khau nay"
      ]);
    }
    if (!password) {
      password = valueAfterPlainLabel(original, plain, "mat khau mac dinh", [
        "mat khau nay",
        "thong tin dang nhap"
      ]);
    }
    return {
      generated_username: username,
      generated_password: password
    };
  }

  function parseGeneratedCredentials(modal) {
    return parseGeneratedCredentialsText(visibleText(modal));
  }

  function inputValueByLabel(modal, labelText) {
    var input = findInputByLabel(modal, labelText);
    return input ? input.value || "" : "";
  }

  function currentEmployeeFormValues(modal) {
    return {
      full_name: inputValueByLabel(modal, "Ho va ten"),
      employee_code: inputValueByLabel(modal, "Ma nhan vien"),
      portal_sap_code: inputValueByLabel(modal, "Ma Portal/SAP"),
      position_form: selectValueByLabel(modal, "Chuc vu"),
      phone: inputValueByLabel(modal, "So dien thoai"),
      username: inputValueByLabel(modal, "Ten dang nhap"),
      main_base: selectValueByLabel(modal, "Main base"),
      start_date: inputValueByLabel(modal, "Thoi gian bat dau")
    };
  }

  function assertEmployeeFormMatches(modal, employee) {
    var mismatches = employeeFormMismatches(employee, currentEmployeeFormValues(modal));
    if (mismatches.length) {
      throw new Error("Form khong dung dong Excel: " + mismatches.join("; "));
    }
  }

  async function fillEmployeeForm(modal, employee) {
    await waitForAdminRunControl();
    fillInputByLabel(modal, "Ho va ten", employee.full_name, true);
    await waitForAdminRunControl();
    fillInputByLabel(modal, "Ma nhan vien", employee.employee_code, true);
    await waitForAdminRunControl();
    fillInputByLabel(modal, "Ma Portal/SAP", employee.portal_sap_code, true);
    await waitForAdminRunControl();
    await selectByLabel(modal, "Chuc vu", employee.position_form, true);
    await waitForAdminRunControl();
    fillInputByLabel(modal, "So dien thoai", employee.phone, true);
    await waitForAdminRunControl();
    fillInputByLabel(modal, "Email", employee.email, false);
    await waitForAdminRunControl();
    fillInputByLabel(modal, "Ten dang nhap", employee.username, true);
    await waitForAdminRunControl();
    clickRadioText(employee.status || "Đang hoạt động", modal);
    clickRadioText(employee.sales_channel || "GT", modal);
    await waitForAdminRunControl();
    if (employeeRequiresMainBase(employee)) {
      await waitForAdminRunControl();
      await waitFor(function() {
        return findSelectByLabel(modal, "Main base");
      }, 4000, 150);
      await waitForAdminRunControl();
      await selectByLabel(modal, "Main base", employee.main_base, true);
    }
    await waitForAdminRunControl();
    await fillDateByLabel(modal, "Thoi gian bat dau", employee.start_date, true);
    await waitForAdminRunControl();
    await fillDateByLabel(modal, "Thoi gian ket thuc", employee.end_date, false);
    await waitForAdminRunControl();
    assertEmployeeFormMatches(modal, employee);
  }

  async function applyEmployeeResignationUpdate(modal, item) {
    await waitForAdminRunControl();
    if (!clickRadioText("Ngung hoat dong", modal)) {
      throw new Error("Khong tim thay trang thai Ngung hoat dong.");
    }
    await waitForAdminRunControl();
    await fillDateByLabel(modal, "Thoi gian ket thuc", item.resignation_date, true);
  }

  async function applyEmployeeMidAutumnUpdate(modal) {
    await waitForAdminRunControl();
    await selectByLabel(modal, "Nganh hang", MID_AUTUMN_CATEGORY, true);
  }

  async function applyEmployeeUpdateForm(modal, item) {
    var taskType = normalizeEmployeeUpdateTaskType(item && item.update_task);
    if (taskType === UPDATE_TASK_MID_AUTUMN) {
      await applyEmployeeMidAutumnUpdate(modal);
      return;
    }
    await applyEmployeeResignationUpdate(modal, item);
  }

  function findEmployeeSaveButton(modal) {
    return findClickableByExactText("Luu", modal) ||
      findClickableContainingText("Luu", modal) ||
      findClickableByExactText("Save", modal) ||
      findClickableContainingText("Save", modal);
  }

  function readEmployeeUpdateSubmitError(modal) {
    var text = visibleText(modal);
    var plain = stripAccents(text).toLowerCase();
    if (plain.indexOf("bat buoc") >= 0 || plain.indexOf("khong hop le") >= 0 || plain.indexOf("loi") >= 0) {
      return cleanField(text).slice(0, 220);
    }
    return "";
  }

  async function waitForEmployeeUpdateSubmitOutcome(modal, timeoutMs) {
    return await waitFor(function() {
      var modalOpen = isModalStillOpen(modal) && findEmployeeUpdateModal();
      if (modalOpen) {
        var error = readEmployeeUpdateSubmitError(modal);
        if (error) return { modal_closed: false, error: error };
        return null;
      }
      return { modal_closed: true, error: "" };
    }, timeoutMs || 15000, 300);
  }

  function isEmployeeUpdateCompleteAfterSubmit(state) {
    return !!(state && state.save_clicked && state.modal_closed);
  }

  function findEmployeeModalCloseButton(modal) {
    if (!modal) return null;
    var nodes = Array.from(modal.querySelectorAll(
      ".ant-modal-close,.modal-close,.el-dialog__close,button,[role='button'],a,span,i"
    ));
    return nodes.find(function(el) {
      if (!isVisible(el)) return false;
      var text = stripAccents(visibleText(el)).toLowerCase().trim();
      var aria = stripAccents(el.getAttribute("aria-label") || "").toLowerCase();
      var title = stripAccents(el.getAttribute("title") || "").toLowerCase();
      var className = stripAccents(String(el.className || "")).toLowerCase();
      return text === "x" ||
        text === "\u00d7" ||
        text === "huy" ||
        aria.indexOf("close") >= 0 ||
        aria.indexOf("dong") >= 0 ||
        title.indexOf("close") >= 0 ||
        title.indexOf("dong") >= 0 ||
        className.indexOf("modal-close") >= 0 ||
        className.indexOf("ant-modal-close") >= 0 ||
        className.indexOf("el-dialog__close") >= 0;
    }) || null;
  }

  async function closeOpenEmployeeModal() {
    var modal = findEmployeeModal();
    if (!modal) return true;
    var closeBtn = findEmployeeModalCloseButton(modal);
    if (closeBtn) clickElement(closeBtn);
    else closeEmployeeModal(modal);
    var closed = await waitFor(function() {
      return !findEmployeeModal();
    }, 5000, 250, { raw: true });
    return !!closed;
  }

  function closeEmployeeModal(modal) {
    var closeBtn = findClickableByExactText("×", modal) || findClickableContainingText("Huy", modal);
    if (closeBtn) clickElement(closeBtn);
  }

  function isEmployeeCreateCompleteAfterSubmit(state) {
    return !!(state && state.create_clicked && (state.modal_closed || state.row_visible));
  }

  function isModalStillOpen(modal) {
    return !!(modal && document.documentElement.contains(modal) && isVisible(modal));
  }

  async function waitForEmployeeModalClosed(modal, timeoutMs) {
    return await waitFor(function() {
      return !isModalStillOpen(modal) || !findEmployeeModal();
    }, timeoutMs || 12000, 300);
  }

  function readEmployeeSubmitError(modal) {
    var text = visibleText(modal);
    if (isDuplicateEmployeeSubmitError(text)) return "Ma nhan vien hoac so dien thoai da ton tai.";
    return "";
  }

  async function waitForEmployeeSubmitOutcome(modal, employee, timeoutMs) {
    return await waitFor(function() {
      var modalOpen = isModalStillOpen(modal) && findEmployeeModal();
      if (modalOpen) {
        var error = readEmployeeSubmitError(modal);
        if (error) return { modal_closed: false, row_visible: false, error: error };
        return null;
      }
      if (employeeAlreadyVisibleOnCurrentPage(employee)) {
        return { modal_closed: true, row_visible: true, error: "" };
      }
      return { modal_closed: true, row_visible: false, error: "" };
    }, timeoutMs || 15000, 300);
  }

  async function createOneEmployee(employee) {
    var missing = employeeMissingFields(employee);
    var result = createEmployeeResultDefaults(employee);
    if (missing.length) {
      result.create_status = "Lỗi";
      result.create_error = "Thiếu/không hợp lệ: " + missing.join(", ");
      return result;
    }

    var modal = null;
    try {
      var closedBeforeCheck = await closeOpenEmployeeModal();
      if (!closedBeforeCheck) throw new Error("Khong dong duoc cua so Them nhan vien dang mo.");
      modal = await clickAddEmployeeButton();
      await fillEmployeeForm(modal, employee);
      await sleep(700);
      await waitForAdminRunControl();
      var credentials = parseGeneratedCredentials(modal);
      result.generated_username = credentials.generated_username || result.generated_username;
      result.generated_password = credentials.generated_password || result.generated_password;
      if (!result.generated_username || !result.generated_password) {
        throw new Error("Khong doc duoc ten dang nhap hoac mat khau mac dinh.");
      }
      var createBtn = findClickableByExactText("Tao moi", modal) || findClickableContainingText("Tao moi", modal);
      if (!createBtn) throw new Error("Khong tim thay nut Tao moi.");
      await waitForAdminRunControl();
      var createClicked = clickElement(createBtn);
      var outcome = await waitForEmployeeSubmitOutcome(modal, employee, 15000);
      if (outcome && outcome.error) throw new Error(outcome.error);
      var modalClosed = !!(outcome && outcome.modal_closed);
      var rowVisible = !!(outcome && outcome.row_visible);
      if (!isEmployeeCreateCompleteAfterSubmit({ create_clicked: createClicked, modal_closed: !!modalClosed, row_visible: rowVisible })) {
        throw new Error("Da gui lenh Tao moi nhung cua so chua dong/chua xac nhan tao xong.");
      }
      result.create_status = "Thành công";
      return result;
    } catch (err) {
      if (isAdminControlError(err)) throw err;
      if (isDuplicateEmployeeSubmitError(err.message)) {
        result.create_status = "Da ton tai";
        result.create_error = "";
        return result;
      }
      result.create_status = "Lỗi";
      result.create_error = err.message;
      return result;
    } finally {
      if (modal && findEmployeeModal()) {
        await closeOpenEmployeeModal();
      }
    }
  }

  async function updateOneEmployee(item) {
    var normalized = normalizeEmployeeUpdateTask(item, item && item.update_task);
    var missing = employeeUpdateMissingFields(normalized);
    var result = createEmployeeUpdateResultDefaults(normalized);
    if (missing.length) {
      result.update_status = "Lỗi";
      result.update_error = "Thiếu/không hợp lệ: " + missing.join(", ");
      return result;
    }

    var modal = null;
    try {
      var closedBeforeCheck = await closeOpenEmployeeModal();
      if (!closedBeforeCheck) throw new Error("Khong dong duoc cua so nhan vien dang mo.");
      modal = await clickEmployeeEditButton(normalized);
      await applyEmployeeUpdateForm(modal, normalized);
      await sleep(500);
      await waitForAdminRunControl();
      var saveBtn = findEmployeeSaveButton(modal);
      if (!saveBtn) throw new Error("Khong tim thay nut Luu trong bang cap nhat nhan vien.");
      var saveClicked = clickElement(saveBtn);
      var outcome = await waitForEmployeeUpdateSubmitOutcome(modal, 15000);
      if (outcome && outcome.error) throw new Error(outcome.error);
      var modalClosed = !!(outcome && outcome.modal_closed);
      if (!isEmployeeUpdateCompleteAfterSubmit({ save_clicked: saveClicked, modal_closed: modalClosed })) {
        throw new Error("Da gui lenh Luu nhung cua so cap nhat chua dong/chua xac nhan cap nhat xong.");
      }
      result.update_status = "Thành công";
      return result;
    } catch (err) {
      if (isAdminControlError(err)) throw err;
      result.update_status = "Lỗi";
      result.update_error = err.message;
      return result;
    } finally {
      if (modal && findEmployeeModal()) {
        await closeOpenEmployeeModal();
      }
    }
  }

  function downloadEmployeeResults(results) {
    downloadWorkbookFile("ket-qua-tao-nhan-vien-" + new Date().toISOString().slice(0, 10) + ".xls", buildEmployeeResultWorkbook(results));
  }

  function downloadEmployeeUpdateResults(results) {
    downloadWorkbookFile("ket-qua-cap-nhat-nhan-vien-" + new Date().toISOString().slice(0, 10) + ".xls", buildEmployeeUpdateResultWorkbook(results));
  }

  async function updateStoredEmployeeQueue(updater) {
    var queue = null;
    try {
      queue = await chromeStorageGet(EMPLOYEE_BATCH_KEY);
      if (!queue) return null;
      updater(queue);
      await chromeStorageSet((function() {
        var obj = {};
        obj[EMPLOYEE_BATCH_KEY] = queue;
        return obj;
      })());
      return queue;
    } catch (err) {
      return queue;
    }
  }

  async function requestAdminPause() {
    adminPauseRequested = true;
    adminPausePanelShown = true;
    var queue = await updateStoredEmployeeQueue(function(queue) {
      queue.pause_requested = true;
      queue.status = "paused";
      queue.paused_at = new Date().toISOString();
    });
    adminPanel("Dang tam dung automation. Bam Tiep tuc de chay tiep hoac Dung han de huy queue.", {
      canResume: true,
      canHardStop: true,
      queue: queue
    });
  }

  async function requestAdminResume() {
    adminPauseRequested = false;
    adminPausePanelShown = false;
    var queue = await updateStoredEmployeeQueue(function(item) {
      item.pause_requested = false;
      item.stop_requested = false;
      item.status = "running";
      item.resumed_at = new Date().toISOString();
    });
    if (!queue) {
      adminPanel("Khong con queue de tiep tuc. Hay import file nhan su moi.");
      return;
    }
    adminPanel("Dang tiep tuc automation tu vi tri da tam dung...", {
      canPause: true,
      canHardStop: true,
      queue: queue
    });
    if (!adminAutomationStarted && isEmployeeQueueRunnable(queue)) {
      await runAdminEmployeeQueue(queue);
    }
  }

  async function requestAdminStop() {
    adminStopRequested = true;
    adminPauseRequested = false;
    adminPausePanelShown = false;
    var stoppedQueue = null;
    try {
      var queue = await chromeStorageGet(EMPLOYEE_BATCH_KEY);
      if (queue) {
        queue.stop_requested = true;
        queue.status = "cancelled";
        queue.cancelled_at = new Date().toISOString();
        stoppedQueue = queue;
        await chromeStorageSet((function() {
          var obj = {};
          obj[EMPLOYEE_BATCH_KEY] = queue;
          return obj;
        })());
      }
    } catch (e) {}
    try {
      await chromeStorageRemove(EMPLOYEE_BATCH_KEY);
    } catch (e2) {}
    clearEmployeeQueueHash();
    try {
      await closeOpenEmployeeModal();
    } catch (e3) {}
    adminPanel("Da dung han automation. Queue cu da duoc huy. Neu muon chay lai, hay import file nhan su moi.", { status: "stopped", queue: stoppedQueue });
  }

  function employeeDashboardKind(queue) {
    return queue && queue.queue_type === EMPLOYEE_UPDATE_QUEUE_TYPE ? "update" : "create";
  }

  function employeeDashboardStatusKey(queue, options) {
    if (options && options.canResume) return "paused";
    if (options && options.status) return options.status;
    if (queue && queue.status) return queue.status;
    if (options && options.canPause) return "running";
    return "ready";
  }

  function employeeDashboardStatusLabel(statusKey) {
    if (statusKey === "paused") return "Tạm dừng";
    if (statusKey === "running") return "Đang chạy";
    if (statusKey === "done") return "Hoàn tất";
    if (statusKey === "stopped" || statusKey === "cancelled") return "Đã dừng";
    if (statusKey === "error") return "Có lỗi";
    return "Sẵn sàng";
  }

  function employeeDashboardTitle(queue, statusKey) {
    if (statusKey === "done") return "Hoàn tất phiên chạy";
    if (statusKey === "stopped" || statusKey === "cancelled") return "Đã dừng phiên chạy";
    if (statusKey === "paused") return "Tạm dừng tại dòng";
    return employeeDashboardKind(queue) === "update" ? "Đang cập nhật hồ sơ" : "Đang tạo nhân viên";
  }

  function employeeDashboardCurrentItem(queue) {
    if (!queue || !Array.isArray(queue.employees) || !queue.employees.length) return null;
    var item = employeeAtQueueIndex(queue, queue.current_index || 0) || queue.employees[queue.employees.length - 1];
    if (!item) return null;
    if (employeeDashboardKind(queue) === "update") {
      return {
        primary: cleanField(item.employee_code),
        secondary: cleanField(item.full_name),
        meta: employeeUpdateTaskLabel(item.update_task)
      };
    }
    return {
      primary: cleanField(item.employee_code),
      secondary: cleanField(item.full_name),
      meta: cleanField((item.position || "") + (item.position_form ? " -> " + item.position_form : ""))
    };
  }

  function employeeDashboardLatestError(queue) {
    var results = queue && Array.isArray(queue.results) ? queue.results : [];
    var kind = employeeDashboardKind(queue);
    for (var i = results.length - 1; i >= 0; i -= 1) {
      var item = results[i];
      var ok = kind === "update" ? isSuccessfulEmployeeUpdateResult(item) : isSuccessfulEmployeeResult(item);
      if (!ok) {
        return {
          employee_code: cleanField(item && item.employee_code),
          full_name: cleanField(item && item.full_name),
          message: cleanField(item && (item.update_error || item.create_error || item.update_status || item.create_status || "Chưa rõ lỗi"))
        };
      }
    }
    return null;
  }

  function buildEmployeeAutomationDashboardState(queue, message, options) {
    options = options || {};
    var employees = queue && Array.isArray(queue.employees) ? queue.employees : [];
    var results = queue && Array.isArray(queue.results) ? queue.results : [];
    var total = employees.length;
    var processed = Math.min(results.length, total || results.length);
    var statusKey = employeeDashboardStatusKey(queue, options);
    var successCount = results.filter(employeeDashboardKind(queue) === "update" ? isSuccessfulEmployeeUpdateResult : isSuccessfulEmployeeResult).length;
    var errorCount = Math.max(0, processed - successCount);
    return {
      total: total,
      processed: processed,
      remaining: Math.max(0, total - processed),
      successCount: successCount,
      errorCount: errorCount,
      currentItem: employeeDashboardCurrentItem(queue),
      latestError: employeeDashboardLatestError(queue),
      progressPercent: total ? Math.min(100, Math.max(0, Math.round(processed * 100 / total))) : 0,
      statusKey: statusKey,
      statusLabel: employeeDashboardStatusLabel(statusKey),
      title: employeeDashboardTitle(queue, statusKey),
      message: cleanField(message)
    };
  }

  function adminPanel(message, options) {
    ensureUiStyles();
    rememberSupportLog(message, options);
    refreshSupportLogPreview();
    var panel = document.getElementById("lmb_admin_panel");
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "lmb_admin_panel";
      document.body.appendChild(panel);
    }
    panel.innerHTML = "";
    var body = document.createElement("div");
    body.className = "lmb-admin-body";
    var close = document.createElement("button");
    close.type = "button";
    close.className = "lmb-admin-close";
    close.setAttribute("aria-label", "Dong thong bao");
    close.textContent = "x";
    close.addEventListener("click", function() {
      if (panel.parentNode) panel.remove();
    });
    var dashboard = buildEmployeeAutomationDashboardState(options && options.queue, message, options);
    var statusKey = dashboard.statusKey;
    var statusLabel = dashboard.statusLabel;
    var top = document.createElement("div");
    top.className = "lmb-admin-top";
    var title = document.createElement("div");
    title.innerHTML = '<div class="lmb-admin-title">' + escapeHtml(dashboard.title || EXTENSION_TITLE) + '</div>' +
      '<div class="lmb-admin-hint">Có thể tạm dừng để kiểm tra, hoặc dừng hẳn để hủy queue hiện tại.</div>';
    var pill = document.createElement("div");
    pill.innerHTML = buildStatusPillHtml(statusKey, statusLabel);
    top.appendChild(title);
    top.appendChild(pill.firstChild);
    var text = document.createElement("div");
    text.className = "lmb-admin-message";
    text.textContent = message;
    body.appendChild(close);
    body.appendChild(top);
    if (dashboard.total) {
      var progress = document.createElement("div");
      progress.className = "lmb-admin-progress";
      progress.innerHTML =
        '<div class="lmb-admin-progress-head"><span>' + escapeHtml(dashboard.processed + "/" + dashboard.total + " dòng") + '</span><b>' + escapeHtml(dashboard.progressPercent + "%") + '</b></div>' +
        '<div class="lmb-admin-progress-track"><div class="lmb-admin-progress-bar" style="width:' + escapeHtml(dashboard.progressPercent) + '%"></div></div>';
      body.appendChild(progress);
      var stats = document.createElement("div");
      stats.className = "lmb-admin-stats";
      stats.innerHTML =
        '<div class="lmb-admin-stat"><span>Thành công</span><b>' + escapeHtml(dashboard.successCount) + '</b></div>' +
        '<div class="lmb-admin-stat"><span>Lỗi</span><b>' + escapeHtml(dashboard.errorCount) + '</b></div>' +
        '<div class="lmb-admin-stat"><span>Còn lại</span><b>' + escapeHtml(dashboard.remaining) + '</b></div>';
      body.appendChild(stats);
      if (dashboard.currentItem) {
        var current = document.createElement("div");
        current.className = "lmb-admin-current";
        current.innerHTML =
          '<div class="lmb-admin-card-label">Đang xử lý</div>' +
          '<div class="lmb-admin-card-title">' + escapeHtml(dashboard.currentItem.primary || "-") + '</div>' +
          '<div class="lmb-admin-card-meta">' + escapeHtml([dashboard.currentItem.secondary, dashboard.currentItem.meta].filter(Boolean).join(" · ")) + '</div>';
        body.appendChild(current);
      }
      if (dashboard.latestError) {
        var latestError = document.createElement("div");
        latestError.className = "lmb-admin-error";
        latestError.innerHTML =
          '<div class="lmb-admin-card-label">Lỗi gần nhất</div>' +
          '<div class="lmb-admin-card-title">' + escapeHtml([dashboard.latestError.employee_code, dashboard.latestError.full_name].filter(Boolean).join(" · ") || "-") + '</div>' +
          '<div class="lmb-admin-card-meta">' + escapeHtml(dashboard.latestError.message || "Chưa rõ lỗi") + '</div>';
        body.appendChild(latestError);
      }
    }
    body.appendChild(text);
    if (options && (options.canPause || options.canResume || options.canHardStop)) {
      var controls = document.createElement("div");
      controls.className = "lmb-run-controls";
      var addControlButton = function(label, className, onClick) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = label;
        btn.className = "lmb-btn " + className;
        btn.addEventListener("click", function() {
          btn.disabled = true;
          onClick(btn);
        });
        controls.appendChild(btn);
      };
      if (options.canResume) {
        addControlButton("Tiếp tục", "lmb-btn-primary", function(btn) {
          btn.textContent = "Đang tiếp tục...";
          requestAdminResume();
        });
      }
      if (options.canPause) {
        addControlButton("Tạm dừng", "lmb-btn-blue", function(btn) {
          btn.textContent = "Đang tạm dừng...";
          requestAdminPause();
        });
      }
      if (options.canHardStop) {
        addControlButton("Dừng hẳn", "lmb-btn-danger", function(btn) {
          btn.textContent = "Đang dừng hẳn...";
          requestAdminStop();
        });
      }
      body.appendChild(controls);
    }
    if (false && options && options.canStop) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "Dừng";
      btn.className = "lmb-btn lmb-btn-danger";
      btn.addEventListener("click", function() {
        btn.disabled = true;
        btn.textContent = "Đang dừng...";
        requestAdminStop();
      });
      body.appendChild(btn);
    }
    if (options && (options.canReport || options.status === "error")) {
      var reportWrap = document.createElement("div");
      reportWrap.className = "lmb-support-actions";
      var reportBtn = document.createElement("button");
      reportBtn.type = "button";
      reportBtn.textContent = "Gửi báo cáo lỗi";
      reportBtn.className = "lmb-btn lmb-btn-danger";
      reportBtn.addEventListener("click", async function() {
        reportBtn.disabled = true;
        reportBtn.textContent = "Đang gửi...";
        try {
          var response = await sendSupportFeedback({
            type: "bug",
            urgency: "high",
            message: message,
            log: readLatestSupportLog(),
            url: root.location && root.location.href,
            attachment: options.reportAttachment
          });
          saveLatestSupportTicket(response);
          toast(supportFeedbackSuccessMessage(response, !!options.reportAttachment), "ok");
          reportBtn.textContent = "Đã gửi báo cáo";
        } catch (err) {
          toast("Chưa gửi được báo cáo: " + (err.message || err), "error");
          reportBtn.disabled = false;
          reportBtn.textContent = "Gửi báo cáo lỗi";
        }
      });
      reportWrap.appendChild(reportBtn);
      body.appendChild(reportWrap);
    }
    var footer = document.createElement("div");
    footer.innerHTML = buildUiFooterHtml();
    body.appendChild(footer.firstChild);
    panel.appendChild(body);
  }

  function isCurrentEmployeeSearchUrl(employeeCode) {
    if (!root.location) return false;
    try {
      var url = new URL(root.location.href);
      var wanted = cleanField(employeeCode).toUpperCase();
      var keyword = cleanField(url.searchParams.get("keyword") || "").toUpperCase();
      var status = cleanField(url.searchParams.get("status") || "").toUpperCase();
      return /\/userManager\/list$/i.test(url.pathname) && keyword === wanted && status === "ACTIVE";
    } catch (e) {
      return false;
    }
  }

  async function navigateToEmployeeUpdateItem(queue, item) {
    queue.admin_url = buildEmployeeSearchUrl(item && item.employee_code, true);
    var targetUrl = queue.admin_url;
    try {
      await chromeStorageSet((function() {
        var obj = {};
        obj[EMPLOYEE_BATCH_KEY] = queue;
        return obj;
      })());
    } catch (storageErr) {
      targetUrl = buildAdminEmployeeQueueUrl(queue, queue.admin_url);
    }
    root.location.href = targetUrl;
  }

  async function runAdminEmployeeUpdateQueue(queue) {
    if (!isEmployeeQueueRunnable(queue) || adminAutomationStarted) return;
    adminAutomationStarted = true;
    adminStopRequested = false;
    adminPauseRequested = false;
    adminPausePanelShown = false;
    queue.status = "running";
    queue.stop_requested = false;
    queue.pause_requested = false;
    await chromeStorageSet((function() {
      var obj = {};
      obj[EMPLOYEE_BATCH_KEY] = queue;
      return obj;
    })());

    var results = queue.results || [];
    var employees = queue.employees || [];
    var stopped = false;
    for (var i = queue.current_index || 0; i < employees.length; i += 1) {
      var latestQueue = await chromeStorageGet(EMPLOYEE_BATCH_KEY);
      if (latestQueue) {
        queue = latestQueue;
        results = queue.results || results;
        employees = queue.employees || employees;
      }
      if (adminPauseRequested || isEmployeeQueuePaused(queue)) {
        await waitForAdminRunControl();
      }
      if (adminStopRequested || shouldStopEmployeeQueue(queue)) {
        stopped = true;
        break;
      }

      var item = employeeAtQueueIndex(queue, i);
      if (!item) break;
      queue.current_index = i;
      if (!isCurrentEmployeeSearchUrl(item.employee_code)) {
        await navigateToEmployeeUpdateItem(queue, item);
        return;
      }

      adminPanel(
        "Dang cap nhat nhan vien " + (i + 1) + "/" + employees.length +
        ": Ma " + item.employee_code +
        " | Tac vu: " + employeeUpdateTaskLabel(item.update_task),
        { canPause: true, canHardStop: true, queue: queue }
      );
      var result = null;
      try {
        result = await updateOneEmployee(Object.assign({}, item));
      } catch (err) {
        if (isAdminControlError(err)) {
          stopped = true;
          break;
        }
        throw err;
      }
      results.push(result);
      queue.current_index = i + 1;
      queue.results = results;
      if (adminStopRequested || shouldStopEmployeeQueue(queue)) {
        stopped = true;
        break;
      }
      await chromeStorageSet((function() {
        var obj = {};
        obj[EMPLOYEE_BATCH_KEY] = queue;
        return obj;
      })());
      await sleep(500);
    }

    if (stopped) {
      queue.status = "cancelled";
      queue.stop_requested = true;
      queue.results = results;
      if (results.length) downloadEmployeeUpdateResults(results);
      await chromeStorageRemove(EMPLOYEE_BATCH_KEY);
      clearEmployeeQueueHash();
      adminPanel("Da dung han automation cap nhat. Da xu ly: " + results.length + "/" + employees.length + ". Queue cu da duoc huy.", { status: "stopped", queue: queue });
      return;
    }

    queue.status = "done";
    queue.results = results;
    await chromeStorageSet((function() {
      var obj = {};
      obj[EMPLOYEE_BATCH_KEY] = queue;
      return obj;
    })());
    downloadEmployeeUpdateResults(results);
    var updateResultAttachment = rememberLatestResultAttachment(buildEmployeeUpdateResultAttachment(results));
    await chromeStorageRemove(EMPLOYEE_BATCH_KEY);
    clearEmployeeQueueHash();
    var okCount = results.filter(isSuccessfulEmployeeUpdateResult).length;
    var errorCount = results.length - okCount;
    adminPanel("Hoan tat cap nhat nhan vien. Thanh cong: " + okCount + ", Loi: " + errorCount + ". Da tai file ket qua.", {
      status: "done",
      canReport: errorCount > 0,
      reportAttachment: errorCount > 0 ? updateResultAttachment : null,
      queue: queue
    });
  }

  async function runAdminEmployeeQueue(queue) {
    if (queue && queue.queue_type === EMPLOYEE_UPDATE_QUEUE_TYPE) {
      await runAdminEmployeeUpdateQueue(queue);
      return;
    }
    if (!isEmployeeQueueRunnable(queue) || adminAutomationStarted) return;
    adminAutomationStarted = true;
    adminStopRequested = false;
    adminPauseRequested = false;
    adminPausePanelShown = false;
    queue.status = "running";
    queue.stop_requested = false;
    queue.pause_requested = false;
    await chromeStorageSet((function() {
      var obj = {};
      obj[EMPLOYEE_BATCH_KEY] = queue;
      return obj;
    })());

    var results = queue.results || [];
    var employees = queue.employees || [];
    var stopped = false;
    for (var i = queue.current_index || 0; i < employees.length; i += 1) {
      var latestQueue = await chromeStorageGet(EMPLOYEE_BATCH_KEY);
      if (latestQueue) {
        queue = latestQueue;
        results = queue.results || results;
        employees = queue.employees || employees;
      }
      if (adminPauseRequested || isEmployeeQueuePaused(queue)) {
        await waitForAdminRunControl();
      }
      if (adminStopRequested || shouldStopEmployeeQueue(queue)) {
        stopped = true;
        break;
      }

      var employee = employeeAtQueueIndex(queue, i);
      if (!employee) break;
      adminPanel(
        "Dang tao nhan vien " + (i + 1) + "/" + employees.length +
        ": " + employee.full_name +
        " | Ma: " + employee.employee_code +
        " | CV: " + (employee.position || "") + " -> " + (employee.position_form || "") +
        " | SDT: " + employee.phone,
        { canPause: true, canHardStop: true, queue: queue }
      );
      var result = null;
      try {
        result = await createOneEmployee(Object.assign({}, employee));
      } catch (err) {
        if (isAdminControlError(err)) {
          stopped = true;
          break;
        }
        throw err;
      }
      results.push(result);
      queue.current_index = i + 1;
      queue.results = results;
      if (adminStopRequested || shouldStopEmployeeQueue(queue)) {
        stopped = true;
        break;
      }
      await chromeStorageSet((function() {
        var obj = {};
        obj[EMPLOYEE_BATCH_KEY] = queue;
        return obj;
      })());
      await sleep(800);
    }

    if (stopped) {
      queue.status = "cancelled";
      queue.stop_requested = true;
      queue.results = results;
      if (results.length) downloadEmployeeResults(results);
      await chromeStorageRemove(EMPLOYEE_BATCH_KEY);
      clearEmployeeQueueHash();
      adminPanel("Da dung han automation. Da xu ly: " + results.length + "/" + employees.length + ". Queue cu da duoc huy.", { status: "stopped", queue: queue });
      return;
    }

    queue.status = "done";
    queue.results = results;
    await chromeStorageSet((function() {
      var obj = {};
      obj[EMPLOYEE_BATCH_KEY] = queue;
      return obj;
    })());
    downloadEmployeeResults(results);
    var createResultAttachment = rememberLatestResultAttachment(buildEmployeeResultAttachment(results));
    await chromeStorageRemove(EMPLOYEE_BATCH_KEY);
    clearEmployeeQueueHash();
    var okCount = results.filter(isSuccessfulEmployeeResult).length;
    var errorCount = results.length - okCount;
    adminPanel("Hoan tat tao nhan vien. Thanh cong: " + okCount + ", Loi: " + errorCount + ". Da tai file ket qua.", {
      status: "done",
      canReport: errorCount > 0,
      reportAttachment: errorCount > 0 ? createResultAttachment : null,
      queue: queue
    });
  }

  async function initAdminAutomation() {
    if (!root.location || !ADMIN_HOST_RE.test(root.location.hostname)) return;
    try {
      var queue = decodeEmployeeQueueFromHash(root.location.hash);
      if (queue) clearEmployeeQueueHash();
      if (!queue) queue = await chromeStorageGet(EMPLOYEE_BATCH_KEY);
      if (isEmployeeQueuePaused(queue)) {
        adminPauseRequested = true;
        adminPanel("Automation dang tam dung. Bam Tiep tuc de chay tiep hoac Dung han de huy queue.", {
          canResume: true,
          canHardStop: true,
          queue: queue
        });
        return;
      }
      if (!isEmployeeQueueRunnable(queue)) {
        if (queue) {
          await chromeStorageRemove(EMPLOYEE_BATCH_KEY);
          clearEmployeeQueueHash();
        }
        return;
      }
      adminPanel(queue.queue_type === EMPLOYEE_UPDATE_QUEUE_TYPE ? "Da nhan queue cap nhat nhan vien. Dang chuan bi..." : "Da nhan queue tao nhan vien. Dang chuan bi...", { canPause: true, canHardStop: true, queue: queue });
      await sleep(1200);
      await runAdminEmployeeQueue(queue);
    } catch (err) {
      adminPanel("Loi automation nhan vien: " + err.message, { status: "error", canReport: true });
    }
  }

  async function initBrowser() {
    if (!isToolbarHost()) return;
    initToolbarToggleListener();
    setToolbarVisible(await readToolbarVisible(), false);
  }

  function initAll() {
    initBrowser();
    initAdminAutomation();
  }

  var api = {
    EXTENSION_TITLE: EXTENSION_TITLE,
    EXTENSION_AUTHOR: EXTENSION_AUTHOR,
    EXTENSION_VERSION: EXTENSION_VERSION,
    FEEDBACK_WORKER_URL: FEEDBACK_WORKER_URL,
    TOOLBAR_VISIBLE_KEY: TOOLBAR_VISIBLE_KEY,
    CONTROL_PANEL_ACTIVE_TAB_KEY: CONTROL_PANEL_ACTIVE_TAB_KEY,
    buildUiFooterHtml: buildUiFooterHtml,
    withUtf8Bom: withUtf8Bom,
    compareVersionStrings: compareVersionStrings,
    shouldShowExtensionUpdate: shouldShowExtensionUpdate,
    isExtensionUpdateRequired: isExtensionUpdateRequired,
    isExtensionAutomationLocked: isExtensionAutomationLocked,
    buildRequiredUpdateTestInfo: buildRequiredUpdateTestInfo,
    normalizeControlPanelTab: normalizeControlPanelTab,
    isToolbarVisibleSetting: isToolbarVisibleSetting,
    isToolbarHostName: isToolbarHostName,
    ADMIN_EMPLOYEE_BAKERY_URL: ADMIN_EMPLOYEE_BAKERY_URL,
    ADMIN_EMPLOYEE_OIL_URL: ADMIN_EMPLOYEE_OIL_URL,
    normalizeEmployeeCategoryChoice: normalizeEmployeeCategoryChoice,
    employeeAdminUrlForCategory: employeeAdminUrlForCategory,
    applyEmployeeCategoryChoice: applyEmployeeCategoryChoice,
    buildEmployeeSearchUrl: buildEmployeeSearchUrl,
    buildAdminEmployeeQueueUrl: buildAdminEmployeeQueueUrl,
    buildSupportFeedbackPayload: buildSupportFeedbackPayload,
    formatSupportLogLine: formatSupportLogLine,
    decodeEmployeeQueueFromHash: decodeEmployeeQueueFromHash,
    removeEmployeeQueueHashValue: removeEmployeeQueueHashValue,
    normalizeVietnamPhone: normalizeVietnamPhone,
    normalizePersonName: normalizePersonName,
    normalizeDateText: normalizeDateText,
    employeeRequiresMainBase: employeeRequiresMainBase,
    generateDHKDEmailFromName: generateDHKDEmailFromName,
    parseDateParts: parseDateParts,
    parseDatePickerTitle: parseDatePickerTitle,
    isDateCellForTarget: isDateCellForTarget,
    parseGeneratedCredentialsText: parseGeneratedCredentialsText,
    employeeAtQueueIndex: employeeAtQueueIndex,
    shouldStopEmployeeQueue: shouldStopEmployeeQueue,
    isEmployeeQueuePaused: isEmployeeQueuePaused,
    isEmployeeQueueRunnable: isEmployeeQueueRunnable,
    buildEmployeeAutomationDashboardState: buildEmployeeAutomationDashboardState,
    employeeMissingFields: employeeMissingFields,
    employeeFormMismatches: employeeFormMismatches,
    employeeAlreadyVisibleInText: employeeAlreadyVisibleInText,
    isDuplicateEmployeeSubmitError: isDuplicateEmployeeSubmitError,
    createEmployeeResultDefaults: createEmployeeResultDefaults,
    createEmployeeUpdateResultDefaults: createEmployeeUpdateResultDefaults,
    isSuccessfulEmployeeResult: isSuccessfulEmployeeResult,
    isSuccessfulEmployeeUpdateResult: isSuccessfulEmployeeUpdateResult,
    normalizeEmployee: normalizeEmployee,
    normalizeEmployeeUpdateTask: normalizeEmployeeUpdateTask,
    employeeUpdateMissingFields: employeeUpdateMissingFields,
    parseEmployeeUpdateRows: parseEmployeeUpdateRows,
    extractEmployeeBatch: extractEmployeeBatch,
    parseEmployeeCsv: parseEmployeeCsv,
    parseEmployeeUpdateCsv: parseEmployeeUpdateCsv,
    parseEmployeeUpdateHtml: parseEmployeeUpdateHtml,
    buildEmployeeResultWorkbook: buildEmployeeResultWorkbook,
    buildEmployeeResultAttachment: buildEmployeeResultAttachment,
    buildEmployeeUpdateTemplateWorkbook: buildEmployeeUpdateTemplateWorkbook,
    buildEmployeeUpdateTemplateCsv: buildEmployeeUpdateTemplateCsv,
    buildEmployeeUpdateResultWorkbook: buildEmployeeUpdateResultWorkbook,
    buildEmployeeUpdateResultAttachment: buildEmployeeUpdateResultAttachment,
    optionTextMatches: optionTextMatches,
    selectedValueMatches: selectedValueMatches,
    fieldTextMatches: fieldTextMatches,
    inputSearchTerms: inputSearchTerms,
    selectExtensionChromeApi: selectExtensionChromeApi,
    isEmployeeCreateCompleteAfterSubmit: isEmployeeCreateCompleteAfterSubmit,
    isEmployeeUpdateCompleteAfterSubmit: isEmployeeUpdateCompleteAfterSubmit,
    isOwnExtensionElement: isOwnExtensionElement
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.__EmployeeAccountCreator = api;
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", initAll);
    } else {
      initAll();
    }
  }
})(typeof window !== "undefined" ? window : globalThis);
