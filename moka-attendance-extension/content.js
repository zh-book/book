(function () {
  const SOURCE = 'MOKA_ATTENDANCE_EXT';

  function extensionAlive() {
    try {
      return Boolean(chrome.runtime && chrome.runtime.id);
    } catch {
      return false;
    }
  }

  function safeSendMessage(message) {
    if (!extensionAlive()) return;
    try {
      const ret = chrome.runtime.sendMessage(message);
      if (ret && typeof ret.then === 'function') {
        ret.catch(() => {
          /* Extension context invalidated after reload */
        });
      }
    } catch {
      /* ignore invalidated context */
    }
  }

  window.addEventListener('message', (event) => {
    // 只接受本页发出的消息，避免被嵌入页伪造
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== SOURCE) return;

    if (data.type === 'HOOK_READY') {
      safeSendMessage({
        type: 'HOOK_READY',
        href: data.href || location.href
      });
      return;
    }

    if (data.type === 'ATTENDANCE_DETAIL' && data.payload) {
      safeSendMessage({
        type: 'ATTENDANCE_DETAIL',
        payload: data.payload,
        url: data.url,
        via: data.via || 'page'
      });
    }

    if (data.type === 'MONTH_CALENDAR' && data.payload) {
      safeSendMessage({
        type: 'MONTH_CALENDAR',
        payload: data.payload,
        url: data.url,
        via: data.via || 'page'
      });
    }

    if (data.type === 'API_TEMPLATE' && data.template) {
      safeSendMessage({
        type: 'SAVE_API_TEMPLATE',
        template: data.template
      });
    }

    if (data.type === 'LOGIN_PROBE') {
      safeSendMessage({
        type: 'SAVE_LOGIN_PROBE',
        probe: {
          href: data.href,
          hasCookie: data.hasCookie,
          cookieLen: data.cookieLen,
          storageKeys: data.storageKeys || [],
          hasTemplate: data.hasTemplate,
          at: Date.now()
        }
      });
    }
  });

  safeSendMessage({
    type: 'CONTENT_READY',
    href: location.href
  });
})();
