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
  });

  chrome.runtime.sendMessage({
    type: 'CONTENT_READY',
    href: location.href
  });
})();
