"use strict";

var WORKER_VERSION = "1.2.6";
var MAX_MESSAGE_LENGTH = 5000;
var MAX_FIELD_LENGTH = 1000;
var MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024;
var MAX_PAYLOAD_LENGTH = 5 * 1024 * 1024;
var TICKET_TTL_SECONDS = 14 * 24 * 60 * 60;
var RATE_WINDOW_MS = 60 * 1000;
var RATE_LIMIT = 8;
var EXTENSION_LATEST_VERSION = "1.2.6";
var EXTENSION_MIN_SUPPORTED_VERSION = "1.2.6";
var EXTENSION_DOWNLOAD_PATH = "/extension-download";
var GITHUB_RELEASE_REPO = "hungdz2001/kido-dms-assistant-extension";
var GITHUB_RELEASE_TAG = "v" + EXTENSION_LATEST_VERSION;
var GITHUB_RELEASE_FILE = "dms-assistant-extension-v" + EXTENSION_LATEST_VERSION + ".zip";
var rateBucket = {};

function cleanText(value, max) {
  var text = String(value == null ? "" : value)
    .replace(/\u0000/g, "")
    .trim();
  return text.length > max ? text.slice(0, max) : text;
}

function normalizeChoice(value, allowed, fallback) {
  var text = cleanText(value, 64).toLowerCase();
  return allowed.indexOf(text) >= 0 ? text : fallback;
}

function ticketStore(env) {
  env = runtimeEnv(env);
  return env && env.SUPPORT_TICKETS ? env.SUPPORT_TICKETS : null;
}

function workerCapabilities(env) {
  return {
    attachments: true,
    telegram_actions: true,
    ticket_sync: !!ticketStore(env)
  };
}

function createTicketId(now, randomFn) {
  var date = now || new Date();
  var rnd = typeof randomFn === "function" ? randomFn : Math.random;
  var day = date.toISOString().slice(0, 10).replace(/-/g, "");
  var token = Math.floor(rnd() * 0xFFFFFF).toString(36).toUpperCase();
  while (token.length < 5) token = "0" + token;
  return "KIDO-" + day + "-" + token.slice(-6);
}

function ticketStatusLabel(status) {
  var key = cleanText(status || "sent", 40).toLowerCase();
  if (key === "received") return "Đã nhận";
  if (key === "processing") return "Đang xử lý";
  if (key === "need_info") return "Cần bổ sung";
  if (key === "done") return "Hoàn tất";
  return "Đã gửi";
}

function ticketKey(ticketId) {
  return "ticket:" + cleanText(ticketId, 80);
}

async function saveTicket(env, ticket) {
  var store = ticketStore(env);
  if (!store || !ticket || !ticket.ticket_id) return false;
  await store.put(ticketKey(ticket.ticket_id), JSON.stringify(ticket), { expirationTtl: TICKET_TTL_SECONDS });
  return true;
}

async function readTicket(env, ticketId) {
  var store = ticketStore(env);
  if (!store || !ticketId) return null;
  var raw = await store.get(ticketKey(ticketId));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function ticketActionKeyboard(ticket) {
  var ticketId = ticket && ticket.ticket_id ? ticket.ticket_id : "";
  var rows = [
    [
      { text: "Đã nhận", callback_data: "ticket:" + ticketId + ":received" },
      { text: "Đang xử lý", callback_data: "ticket:" + ticketId + ":processing" }
    ],
    [
      { text: "Cần bổ sung", callback_data: "ticket:" + ticketId + ":need_info" },
      { text: "Hoàn tất", callback_data: "ticket:" + ticketId + ":done" }
    ]
  ];
  if (ticket && ticket.url) {
    rows.push([{ text: "Mở DMS", url: ticket.url }]);
  }
  return { inline_keyboard: rows };
}

function base64ByteLength(value) {
  var text = String(value || "").replace(/\s/g, "");
  if (!text) return 0;
  var padding = (text.match(/=+$/) || [""])[0].length;
  return Math.max(0, Math.floor(text.length * 3 / 4) - padding);
}

function validateAttachmentPayload(attachment) {
  if (!attachment) return { ok: true, value: null };
  if (typeof attachment !== "object") {
    return { ok: false, error: "File dinh kem khong hop le." };
  }

  var filename = cleanText(attachment.filename, 160);
  var contentBase64 = String(attachment.content_base64 || "").replace(/\s/g, "");
  if (!filename || !contentBase64) {
    return { ok: false, error: "Thieu ten file hoac noi dung file dinh kem." };
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(contentBase64)) {
    return { ok: false, error: "Noi dung file dinh kem khong phai base64 hop le." };
  }

  var sizeBytes = Number(attachment.size_bytes) || base64ByteLength(contentBase64);
  if (!sizeBytes || sizeBytes > MAX_ATTACHMENT_BYTES) {
    return { ok: false, error: "File dinh kem qua lon." };
  }

  return {
    ok: true,
    value: {
      filename: filename,
      mime_type: cleanText(attachment.mime_type || "application/octet-stream", 120),
      content_base64: contentBase64,
      size_bytes: sizeBytes,
      kind: normalizeChoice(attachment.kind, ["employee_create_result", "employee_update_result"], "employee_update_result")
    }
  };
}

function validateFeedbackPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return { ok: false, error: "Payload khong hop le." };
  }

  var message = cleanText(payload.message, MAX_MESSAGE_LENGTH + 1);
  if (!message) {
    return { ok: false, error: "Thieu noi dung phan hoi." };
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return { ok: false, error: "Noi dung phan hoi qua dai." };
  }

  var attachment = validateAttachmentPayload(payload.attachment);
  if (!attachment.ok) {
    return { ok: false, error: attachment.error };
  }

  var context = payload.context && typeof payload.context === "object" ? payload.context : {};
  var value = {
    source: cleanText(payload.source || "employee-extension", 80),
    version: cleanText(payload.version || "", 40),
    type: normalizeChoice(payload.type, ["bug", "feature", "question", "command", "other"], "other"),
    urgency: normalizeChoice(payload.urgency, ["normal", "high", "urgent"], "normal"),
    sender: cleanText(payload.sender || "Khong ghi ro", 160),
    message: message,
    context: {
      url: cleanText(context.url || "", MAX_FIELD_LENGTH),
      time: cleanText(context.time || new Date().toISOString(), 80),
      log: cleanText(context.log || "", 2500),
      command: cleanText(context.command || "", MAX_FIELD_LENGTH)
    }
  };
  if (attachment.value) value.attachment = attachment.value;
  return { ok: true, value: value };
}

function formatTelegramMessage(data) {
  var lines = [
    "[KIDO Employee Extension]",
    data.ticket_id ? "Ticket: " + data.ticket_id : "",
    data.ticket_status ? "Trang thai ticket: " + ticketStatusLabel(data.ticket_status) : "",
    "Loai: " + data.type,
    "Muc do: " + data.urgency,
    "Nguoi gui: " + data.sender,
    "Phien ban: " + (data.version || "unknown"),
    "Thoi gian: " + (data.context.time || new Date().toISOString()),
    data.context.url ? "URL: " + data.context.url : "",
    data.context.command ? "Lenh: " + data.context.command : "",
    data.attachment ? "Dinh kem: " + data.attachment.filename + " (" + Math.ceil(data.attachment.size_bytes / 1024) + " KB)" : "",
    "",
    "Noi dung:",
    data.message,
    data.context.log ? "\nLog gan nhat:\n" + data.context.log : ""
  ];
  return lines.filter(function(line) {
    return line !== "";
  }).join("\n");
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json; charset=utf-8"
  };
}

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: corsHeaders()
  });
}

function clientKey(request) {
  return request.headers.get("CF-Connecting-IP") ||
    request.headers.get("x-forwarded-for") ||
    "unknown";
}

function isRateLimited(request) {
  var key = clientKey(request);
  var now = Date.now();
  var bucket = rateBucket[key] || { count: 0, resetAt: now + RATE_WINDOW_MS };
  if (now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + RATE_WINDOW_MS };
  }
  bucket.count += 1;
  rateBucket[key] = bucket;
  return bucket.count > RATE_LIMIT;
}

function runtimeEnv(env) {
  var resolved = env || {};
  if (!resolved.TELEGRAM_BOT_TOKEN && typeof TELEGRAM_BOT_TOKEN !== "undefined") {
    resolved.TELEGRAM_BOT_TOKEN = TELEGRAM_BOT_TOKEN;
  }
  if (!resolved.TELEGRAM_CHAT_ID && typeof TELEGRAM_CHAT_ID !== "undefined") {
    resolved.TELEGRAM_CHAT_ID = TELEGRAM_CHAT_ID;
  }
  if (!resolved.SUPPORT_TICKETS && typeof SUPPORT_TICKETS !== "undefined") {
    resolved.SUPPORT_TICKETS = SUPPORT_TICKETS;
  }
  return resolved;
}

function base64ToUint8Array(value) {
  var base64 = String(value || "").replace(/\s/g, "");
  var binary;
  if (typeof atob === "function") {
    binary = atob(base64);
  } else if (typeof Buffer !== "undefined") {
    binary = Buffer.from(base64, "base64").toString("binary");
  } else {
    throw new Error("Khong ho tro giai ma file dinh kem.");
  }
  var bytes = new Uint8Array(binary.length);
  for (var i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function sendTelegramMessage(data, env) {
  var body = {
    chat_id: env.TELEGRAM_CHAT_ID,
    text: formatTelegramMessage(data),
    disable_web_page_preview: true
  };
  if (data && data.ticket_id) {
    body.reply_markup = ticketActionKeyboard({
      ticket_id: data.ticket_id,
      url: data.context && data.context.url
    });
  }
  return fetch("https://api.telegram.org/bot" + env.TELEGRAM_BOT_TOKEN + "/sendMessage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

async function sendTelegramDocument(attachment, env) {
  var form = new FormData();
  var bytes = base64ToUint8Array(attachment.content_base64);
  form.append("chat_id", env.TELEGRAM_CHAT_ID);
  form.append("caption", "File ket qua automation: " + attachment.filename);
  form.append("document", new Blob([bytes], { type: attachment.mime_type }), attachment.filename);
  return fetch("https://api.telegram.org/bot" + env.TELEGRAM_BOT_TOKEN + "/sendDocument", {
    method: "POST",
    body: form
  });
}

async function callTelegramJson(method, body, env) {
  return fetch("https://api.telegram.org/bot" + env.TELEGRAM_BOT_TOKEN + "/" + method, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {})
  });
}

function buildTicketText(ticket) {
  return [
    "[KIDO Employee Extension]",
    "Ticket: " + ticket.ticket_id,
    "Trang thai ticket: " + ticketStatusLabel(ticket.status),
    ticket.latest_note ? "Phan hoi moi nhat: " + ticket.latest_note : "",
    ticket.url ? "URL: " + ticket.url : "",
    "",
    "Noi dung:",
    ticket.message || ""
  ].filter(function(line) {
    return line !== "";
  }).join("\n");
}

function parseTicketAction(data) {
  var match = /^ticket:([^:]+):(received|processing|need_info|done)$/.exec(String(data || ""));
  if (!match) return null;
  return { ticket_id: match[1], status: match[2] };
}

function ticketIdFromText(text) {
  var match = /Ticket:\s*(KIDO-\d{8}-[A-Z0-9]+)/i.exec(String(text || ""));
  return match ? match[1].toUpperCase() : "";
}

function capabilityBody(env) {
  return {
    ok: true,
    worker_version: WORKER_VERSION,
    capabilities: workerCapabilities(env),
    message: "Telegram Support Worker dang hoat dong. Hay gui feedback bang POST."
  };
}

function requestOrigin(request) {
  try {
    var url = new URL(request.url);
    return url.origin;
  } catch (e) {
    return "https://kdc-employee-support.chillwithdms.workers.dev";
  }
}

function githubReleaseUrl(path) {
  return "https://github.com/" + GITHUB_RELEASE_REPO + "/releases/" + path;
}

function extensionDownloadUrl() {
  return githubReleaseUrl("download/" + GITHUB_RELEASE_TAG + "/" + GITHUB_RELEASE_FILE);
}

function extensionUpdateInfo(request) {
  return {
    ok: true,
    latest_version: EXTENSION_LATEST_VERSION,
    min_supported_version: EXTENSION_MIN_SUPPORTED_VERSION,
    download_url: extensionDownloadUrl(),
    changelog_url: githubReleaseUrl("tag/" + GITHUB_RELEASE_TAG),
    release_title: "DMS Assistant " + EXTENSION_LATEST_VERSION,
    release_notes: [
      "Thêm nút thu nhỏ DMS Assistant thành robot nhỏ kéo thả được.",
      "Thêm nút tắt nhanh để ẩn toàn bộ UI, bật lại bằng icon extension trên Chrome.",
      "Đổi logo header sang robot CSS gọn hơn, đồng bộ với bubble thu nhỏ.",
      "Đổi footer thành Phát triển bởi HƯNG ĐẸP TRAI và giảm độ nổi để giao diện tinh tế hơn."
    ],
    updated_at: "2026-06-12T00:00:00.000Z"
  };
}

function extensionDownloadPage(request) {
  var info = extensionUpdateInfo(request);
  return new Response(null, {
    status: 302,
    headers: {
      "Location": info.download_url,
      "Cache-Control": "no-store"
    }
  });
}

function publicTicket(ticket) {
  if (!ticket) return null;
  return {
    ticket_id: ticket.ticket_id,
    status: ticket.status || "sent",
    status_label: ticketStatusLabel(ticket.status),
    latest_note: ticket.latest_note || "",
    updated_at: ticket.updated_at || ticket.created_at || "",
    url: ticket.url || ""
  };
}

async function handleTicketStatus(request, env) {
  var url = new URL(request.url);
  var ticketId = cleanText(url.searchParams.get("id") || "", 80);
  var ticket = await readTicket(env, ticketId);
  if (!ticket) {
    return jsonResponse({
      ok: false,
      error: ticketStore(env) ? "Ticket khong ton tai." : "Worker chua cau hinh SUPPORT_TICKETS.",
      worker_version: WORKER_VERSION,
      capabilities: workerCapabilities(env)
    }, 404);
  }
  return jsonResponse({
    ok: true,
    ticket: publicTicket(ticket),
    worker_version: WORKER_VERSION,
    capabilities: workerCapabilities(env)
  });
}

async function handleTelegramWebhook(request, env) {
  if (request.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
  }
  var update;
  try {
    update = JSON.parse(await request.text() || "{}");
  } catch (err) {
    return jsonResponse({ ok: false, error: "JSON khong hop le." }, 400);
  }

  if (update.callback_query) {
    var callback = update.callback_query;
    var action = parseTicketAction(callback.data);
    if (!action) return jsonResponse({ ok: true, ignored: true });
    if (env && env.TELEGRAM_BOT_TOKEN) {
      await callTelegramJson("answerCallbackQuery", {
        callback_query_id: callback.id,
        text: ticketStatusLabel(action.status)
      }, env).catch(function() {});
    }
    var ticketSync = true;
    var ticket;
    try {
      ticket = await readTicket(env, action.ticket_id) || { ticket_id: action.ticket_id };
    } catch (readErr) {
      ticketSync = false;
      ticket = { ticket_id: action.ticket_id };
    }
    ticket.status = action.status;
    ticket.updated_at = new Date().toISOString();
    ticket.updated_by = cleanText(callback.from && (callback.from.first_name || callback.from.username) || "Telegram", 120);
    try {
      ticketSync = await saveTicket(env, ticket);
    } catch (saveErr) {
      ticketSync = false;
      ticket.sync_error = cleanText(saveErr && saveErr.message || saveErr, 200);
    }
    if (env && env.TELEGRAM_BOT_TOKEN) {
      if (callback.message && callback.message.chat && callback.message.message_id) {
        await callTelegramJson("editMessageText", {
          chat_id: callback.message.chat.id,
          message_id: callback.message.message_id,
          text: buildTicketText(ticket),
          disable_web_page_preview: true,
          reply_markup: ticketActionKeyboard(ticket)
        }, env);
      }
    }
    return jsonResponse({ ok: true, ticket: publicTicket(ticket), ticket_sync: ticketSync });
  }

  if (update.message && update.message.reply_to_message) {
    var replyText = (update.message.reply_to_message.text || update.message.reply_to_message.caption || "");
    var ticketId = ticketIdFromText(replyText);
    if (!ticketId) return jsonResponse({ ok: true, ignored: true });
    var replyTicket = await readTicket(env, ticketId) || { ticket_id: ticketId };
    replyTicket.latest_note = cleanText(update.message.text || update.message.caption || "", 1000);
    replyTicket.updated_at = new Date().toISOString();
    replyTicket.updated_by = cleanText(update.message.from && (update.message.from.first_name || update.message.from.username) || "Telegram", 120);
    await saveTicket(env, replyTicket);
    return jsonResponse({ ok: true, ticket: publicTicket(replyTicket) });
  }

  return jsonResponse({ ok: true, ignored: true });
}

async function handleFeedback(request, env) {
  env = runtimeEnv(env);
  var url = new URL(request.url);
  if (url.pathname === "/ticket-status") {
    return handleTicketStatus(request, env);
  }
  if (url.pathname === "/telegram-webhook") {
    return handleTelegramWebhook(request, env);
  }
  if (url.pathname === "/extension-version") {
    return jsonResponse(extensionUpdateInfo(request));
  }
  if (url.pathname === EXTENSION_DOWNLOAD_PATH) {
    return extensionDownloadPage(request);
  }
  if (request.method === "OPTIONS") {
    return jsonResponse(capabilityBody(env));
  }
  if (url.pathname !== "/feedback") {
    return jsonResponse({ ok: false, error: "Not found" }, 404);
  }
  if (request.method === "GET") {
    return jsonResponse(capabilityBody(env));
  }
  if (request.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
  }
  if (isRateLimited(request)) {
    return jsonResponse({ ok: false, error: "Gui qua nhanh, vui long thu lai sau." }, 429);
  }

  var raw = await request.text();
  if (raw.length > MAX_PAYLOAD_LENGTH) {
    return jsonResponse({ ok: false, error: "Payload qua lon." }, 413);
  }

  var payload;
  try {
    payload = JSON.parse(raw || "{}");
  } catch (err) {
    return jsonResponse({ ok: false, error: "JSON khong hop le." }, 400);
  }

  var validated = validateFeedbackPayload(payload);
  if (!validated.ok) {
    return jsonResponse({ ok: false, error: validated.error }, 400);
  }
  if (!env || !env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    return jsonResponse({ ok: false, error: "Worker chua cau hinh TELEGRAM_BOT_TOKEN hoac TELEGRAM_CHAT_ID." }, 500);
  }

  var ticket = {
    ticket_id: createTicketId(),
    status: "sent",
    type: validated.value.type,
    urgency: validated.value.urgency,
    sender: validated.value.sender,
    message: validated.value.message,
    url: validated.value.context.url,
    attachment_filename: validated.value.attachment ? validated.value.attachment.filename : "",
    latest_note: "",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  validated.value.ticket_id = ticket.ticket_id;
  validated.value.ticket_status = ticket.status;

  var telegramRes = await sendTelegramMessage(validated.value, env);
  var telegramText = await telegramRes.text();
  if (!telegramRes.ok) {
    return jsonResponse({ ok: false, error: "Telegram API loi: " + telegramText.slice(0, 500) }, 502);
  }
  var telegramJson = null;
  try { telegramJson = JSON.parse(telegramText); } catch (e) {}
  if (telegramJson && telegramJson.result) {
    ticket.telegram_chat_id = telegramJson.result.chat && telegramJson.result.chat.id;
    ticket.telegram_message_id = telegramJson.result.message_id;
  }

  var attachmentSent = false;
  if (validated.value.attachment) {
    var documentRes = await sendTelegramDocument(validated.value.attachment, env);
    var documentText = await documentRes.text();
    if (!documentRes.ok) {
      return jsonResponse({ ok: false, error: "Da gui message nhung gui file that bai: " + documentText.slice(0, 500) }, 502);
    }
    attachmentSent = true;
  }
  var ticketSync = await saveTicket(env, ticket);

  return jsonResponse({
    ok: true,
    message: validated.value.attachment ? "Da gui Telegram kem file." : "Da gui Telegram.",
    ticket_id: ticket.ticket_id,
    ticket_status: ticket.status,
    attachment_received: !!validated.value.attachment,
    attachment_sent: attachmentSent,
    worker_version: WORKER_VERSION,
    capabilities: Object.assign({}, workerCapabilities(env), { ticket_sync: ticketSync })
  });
}

if (typeof addEventListener === "function") {
  addEventListener("fetch", function(event) {
    event.respondWith(handleFeedback(event.request, runtimeEnv(event.env || {})));
  });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    WORKER_VERSION: WORKER_VERSION,
    validateFeedbackPayload: validateFeedbackPayload,
    formatTelegramMessage: formatTelegramMessage,
    runtimeEnv: runtimeEnv,
    validateAttachmentPayload: validateAttachmentPayload,
    workerCapabilities: workerCapabilities,
    extensionUpdateInfo: extensionUpdateInfo,
    createTicketId: createTicketId,
    ticketStatusLabel: ticketStatusLabel,
    handleFeedback: handleFeedback
  };
}
