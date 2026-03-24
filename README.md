# Slideshow with Remote Display

A browser-based slideshow with support for displaying on a separate screen (TV, tablet, etc.) via WebSocket relay.

## Quick Start

### Option 1: Local Display (Same Device)
1. Open `slideshow.html` in your browser
2. Load photos
3. Click 📺 (Open Display) to open a clean display window
4. Works with BroadcastChannel (no server needed)

### Option 2: Remote Display (TV, Another Device)

#### Start the Relay Server
```bash
node relay-server.js
```

Server runs on:
- HTTP: http://localhost:8765
- WebSocket: ws://localhost:8765

#### On Your Controller (Phone/Laptop)
1. Open `http://localhost:8765/slideshow.html`
2. Load photos
3. Click 📡 (AirPlay/Remote) button
4. A session code will appear (e.g., `A3B7`)

#### On Your TV/Display Device
1. Open browser (Safari on Apple TV, Chrome on Android TV, etc.)
2. Navigate to: `http://<your-computer-ip>:8765/display.html?join=A3B7`
   
   Or scan the QR code shown on the controller

3. The display will connect and show images as you control them

## Network Setup for TV Access

Your TV needs to reach your computer. Options:

### Same WiFi Network
Find your computer's local IP:
```bash
# macOS
ifconfig | grep "inet " | grep -v 127.0.0.1

# Linux
ip addr show | grep "inet " | grep -v 127.0.0.1
```

Use that IP in the URL: `http://192.168.1.xxx:8765/display.html?join=CODE`

### Tailscale (Recommended for Remote Access)
If you want to control from anywhere:
1. Install [Tailscale](https://tailscale.com) on both devices
2. Use your Tailscale IP instead of local IP
3. Works across networks, encrypted

## Architecture

```
┌─────────────────┐         ┌─────────────────┐
│   Controller    │         │     Display     │
│  (slideshow.html)│         │  (display.html) │
│                 │         │                 │
│  ┌───────────┐ │         │  ┌───────────┐  │
│  │BroadcastChannel│◄──────►│  │BroadcastChannel│ │  (same device)
│  └───────────┘ │         │  └───────────┘  │
│                 │         │                 │
│  ┌───────────┐ │         │  ┌───────────┐  │
│  │ WebSocket │◄──────────►│  │ WebSocket │  │  (cross device)
│  └───────────┘ │    ws://   │  └───────────┘  │
└─────────────────┘         └─────────────────┘
         │                           │
         └───────────┬───────────────┘
                     │
            ┌────────▼────────┐
            │  relay-server.js │
            │   (WebSocket hub)  │
            └─────────────────┘
```

## Files

- `slideshow.html` - Main controller interface
- `display.html` - Clean display for TV/projector
- `remote-display.js` - WebSocket client module
- `relay-server.js` - WebSocket relay server (Node.js)

## Security Notes

- Session codes are 4 characters (36^4 = ~1.7M combinations)
- No authentication - anyone with the code can join
- Images are sent as blob URLs (not uploaded to server)
- Use Tailscale or local network for privacy

## Troubleshooting

**Display won't connect:**
- Check firewall: `sudo ufw allow 8765`
- Verify IP address is correct
- Try `http://` not `https://` for local

**Images not syncing:**
- Check WebSocket connection in browser dev tools
- Verify session code matches

**QR code not scanning:**
- Use the manual URL entry instead
- Ensure good lighting on the code

## License

MIT - Do what you want.
