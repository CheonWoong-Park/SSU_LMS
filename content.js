// Content Script: Isolated World에서 실행되므로 페이지 실제 JS 컨텍스트에 bypass.js를 inject함
const s = document.createElement('script');
s.src = chrome.runtime.getURL('bypass.js');
s.onload = () => s.remove();
(document.head || document.documentElement).appendChild(s);
