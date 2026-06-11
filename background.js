const TOOLBAR_VISIBLE_KEY = "lmb_toolbar_visible_v1";
const SUPPORTED_URL_RE = /^https:\/\/admin2\.kido\.vn\//i;
const FEEDBACK_WORKER_URL = "https://kdc-employee-support.chillwithdms.workers.dev/feedback";

function setBadge(visible, tabId) {
  const badge = { text: visible ? "ON" : "" };
  if (tabId) badge.tabId = tabId;
  chrome.action.setBadgeText(badge);
  chrome.action.setBadgeBackgroundColor({ color: visible ? "#047857" : "#64748b" });
}

function canUseTab(tab) {
  return !!(tab && tab.id && tab.url && SUPPORTED_URL_RE.test(tab.url));
}

function sendToolbarMessage(tab, visible) {
  if (!canUseTab(tab)) return;
  const tabId = tab.id;
  chrome.tabs.sendMessage(tabId, {
    type: "LMB_SET_TOOLBAR_VISIBLE",
    visible: visible
  }, function() {
    const messageError = chrome.runtime.lastError;
    if (!messageError || !chrome.scripting) return;
    chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ["employee-account-creator.js"]
    }, function() {
      const injectError = chrome.runtime.lastError;
      if (injectError) return;
      chrome.tabs.sendMessage(tabId, {
        type: "LMB_SET_TOOLBAR_VISIBLE",
        visible: visible
      }, function() {
        chrome.runtime.lastError;
      });
    });
  });
}

chrome.runtime.onInstalled.addListener(function() {
  chrome.storage.local.get(TOOLBAR_VISIBLE_KEY, function(values) {
    if (typeof values[TOOLBAR_VISIBLE_KEY] === "undefined") {
      chrome.storage.local.set({ [TOOLBAR_VISIBLE_KEY]: false });
    }
    setBadge(values[TOOLBAR_VISIBLE_KEY] === true);
  });
});

chrome.action.onClicked.addListener(function(tab) {
  chrome.storage.local.get(TOOLBAR_VISIBLE_KEY, function(values) {
    const nextVisible = values[TOOLBAR_VISIBLE_KEY] !== true;
    chrome.storage.local.set({ [TOOLBAR_VISIBLE_KEY]: nextVisible }, function() {
      setBadge(nextVisible, tab && tab.id);
      sendToolbarMessage(tab, nextVisible);
    });
  });
});

chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
  if (message && message.type === "LMB_PING_SUPPORT_WORKER") {
    fetch(FEEDBACK_WORKER_URL, {
      method: "OPTIONS",
      credentials: "omit"
    })
      .then(function(res) {
        return res.text().then(function(text) {
          var parsed = null;
          try { parsed = JSON.parse(text); } catch (e) {}
          sendResponse(Object.assign({
            ok: res.ok,
            status: res.status,
            body: text.slice(0, 220)
          }, parsed || {}));
        });
      })
      .catch(function(err) {
        sendResponse({
          ok: false,
          error: err && err.message ? err.message : String(err)
        });
      });
    return true;
  }

  if (!message || message.type !== "LMB_SEND_SUPPORT_FEEDBACK") return false;

  fetch(FEEDBACK_WORKER_URL, {
    method: "POST",
    credentials: "omit",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(message.payload || {})
  })
    .then(function(res) {
      return res.text().then(function(text) {
        var parsed = null;
        try { parsed = JSON.parse(text); } catch (e) {}
        if (!res.ok) {
          sendResponse({
            ok: false,
            error: "HTTP " + res.status + ": " + text.slice(0, 220)
          });
          return;
        }
        if (!parsed || parsed.ok !== true) {
          sendResponse({
            ok: false,
            error: parsed && parsed.error ? parsed.error : text.slice(0, 220)
          });
          return;
        }
        sendResponse(parsed);
      });
    })
    .catch(function(err) {
      sendResponse({
        ok: false,
        error: "Khong ket noi duoc Support Worker: " + (err && err.message ? err.message : String(err))
      });
    });
  return true;
});
