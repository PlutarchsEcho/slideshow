// Remote Display Support for Slideshow
// Adds WebSocket-based cross-device sync alongside BroadcastChannel

(function() {
  'use strict';
  
  // === CONFIG ===
  const WS_URL = 'wss://relay.openclaw.ai/slideshow';
  const FALLBACK_URL = 'ws://localhost:8765';
  
  // === STATE ===
  let ws = null;
  let sessionId = null;
  let isConnected = false;
  let reconnectTimer = null;
  let remoteDisplays = 0;
  
  // === INITIALIZATION ===
  function init() {
    // Expose global API
    window.RemoteDisplay = {
      connect,
      disconnect,
      sync,
      showPanel,
      isConnected: () => isConnected,
      getSessionId: () => sessionId,
      getDisplayCount: () => remoteDisplays
    };
  }
  
  // === CONNECT ===
  function connect() {
    if (ws) return;
    
    sessionId = generateSessionId();
    const urls = [WS_URL, FALLBACK_URL];
    tryConnect(urls, 0);
    
    return sessionId;
  }
  
  function tryConnect(urls, index) {
    if (index >= urls.length) {
      console.log('All relays failed');
      return;
    }
    
    const url = urls[index];
    console.log('Connecting to', url);
    
    try {
      ws = new WebSocket(url);
      
      ws.onopen = () => {
        console.log('Connected');
        isConnected = true;
        ws.send(JSON.stringify({
          cmd: 'register',
          role: 'controller',
          sessionId: sessionId
        }));
        
        // Dispatch event for UI
        window.dispatchEvent(new CustomEvent('remoteconnected', { 
          detail: { sessionId } 
        }));
      };
      
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.cmd === 'displayJoined') {
          remoteDisplays++;
          window.dispatchEvent(new CustomEvent('remotedisplayjoined', {
            detail: { count: remoteDisplays }
          }));
        }
      };
      
      ws.onclose = () => {
        isConnected = false;
        ws = null;
        setTimeout(() => connect(), 3000);
      };
      
      ws.onerror = () => {
        ws.close();
        tryConnect(urls, index + 1);
      };
      
    } catch(e) {
      tryConnect(urls, index + 1);
    }
  }
  
  // === SYNC IMAGE ===
  function sync(url, transition = 'fade') {
    if (ws && isConnected) {
      ws.send(JSON.stringify({ cmd: 'show', url, transition }));
    }
  }
  
  // === DISCONNECT ===
  function disconnect() {
    if (ws) {
      ws.close();
      ws = null;
    }
    isConnected = false;
    remoteDisplays = 0;
  }
  
  // === SHOW PANEL ===
  function showPanel() {
    // Simple alert for now - integrate with your UI
    const code = connect();
    alert(`Open display.html on your TV\n\nSession Code: ${code}\n\nOr visit:\n${window.location.origin}/display.html?join=${code}`);
  }
  
  // === UTILS ===
  function generateSessionId() {
    return Math.random().toString(36).substring(2, 6).toUpperCase();
  }
  
  // Init
  init();
  
})();
