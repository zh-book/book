(function () {
  const EVENT = 'MOKA_ATTENDANCE_DETAIL';

  // 尽早注入页面脚本，才能拦到 SPA 发出的首批请求
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('inject.js');
  script.onload = () => script.remove();
  (document.documentElement || document.head || document.body).appendChild(script);

  window.addEventListener(EVENT, (event) => {
    const detail = event.detail;
    if (!detail || !detail.payload) return;
    chrome.runtime.sendMessage({
      type: 'ATTENDANCE_DETAIL',
      payload: detail.payload,
      url: detail.url
    });
  });
})();
