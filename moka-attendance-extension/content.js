(function () {
  const SOURCE = 'MOKA_ATTENDANCE_EXT';

  window.addEventListener('message', (event) => {
    // 只接受本页发出的消息，避免被嵌入页伪造
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== SOURCE) return;

    if (data.type === 'HOOK_READY') {
      chrome.runtime.sendMessage({
        type: 'HOOK_READY',
        href: data.href || location.href
      });
      return;
    }

    if (data.type === 'ATTENDANCE_DETAIL' && data.payload) {
      chrome.runtime.sendMessage({
        type: 'ATTENDANCE_DETAIL',
        payload: data.payload,
        url: data.url,
        via: data.via || 'page'
      });
    }

    if (data.type === 'API_TEMPLATE' && data.template) {
      chrome.runtime.sendMessage({
        type: 'SAVE_API_TEMPLATE',
        template: data.template
      });
    }

    if (data.type === 'LOGIN_PROBE') {
      chrome.runtime.sendMessage({
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

  chrome.runtime.sendMessage({
    type: 'CONTENT_READY',
    href: location.href
  });
})();
