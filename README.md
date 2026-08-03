# Quip

Quip is an **invisible, always-on-top desktop AI assistant** — a translucent floating bar that gives you real-time answers, screenshot analysis, and audio insights during meetings, interviews, presentations, and focused work. It runs on **Google Gemini** or a **fully local Ollama** model, so you can choose speed or privacy.

## ✨ Features

- **Invisible overlay** — translucent, always-on-top window that hides/shows instantly with a global hotkey and stays out of the way of every app.
- **Smart screenshot analysis** — capture any content with a hotkey; Quip explains images, documents, presentations, or problems.
- **Audio intelligence** — record and transcribe audio for meeting notes and quick review.
- **Contextual chat** — ask follow-ups about whatever is on your screen, with conversation context maintained.
- **Phone remote** — pair your phone over Wi-Fi to start an autopilot run, watch the screen, and approve or stop each step from your pocket. Off by default.
- **Privacy-first** — use Ollama for 100% local processing, or Gemini for maximum performance. Screenshots are deleted after processing.
- **Cross-platform** — macOS, Windows 10/11, and most Linux distributions.

## 🚀 Quick Start

### Prerequisites
- [Node.js](https://nodejs.org) and Git installed
- **Either** a Gemini API key ([Google AI Studio](https://makersuite.google.com/app/apikey)) **or** [Ollama](https://ollama.ai) installed locally

### Installation

```bash
git clone https://github.com/adityakumthekar/invisible-quip.git
cd invisible-quip

# If you hit Sharp/Python build errors:
SHARP_IGNORE_GLOBAL_LIBVIPS=1 npm install --ignore-scripts && npm rebuild sharp
# Otherwise:
npm install
```

Create a `.env` in the project root:

```env
# Gemini (cloud)
GEMINI_API_KEY=your_api_key_here

# — or — Ollama (local/private)
USE_OLLAMA=true
OLLAMA_MODEL=llama3.2
OLLAMA_URL=http://localhost:11434
```

### Running

```bash
# Development (recommended for first run)
npm start        # Vite dev server on :5180 + Electron

# Production build → outputs to release/
npm run dist
```

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl + B` | Toggle window visibility |
| `Cmd/Ctrl + H` | Take screenshot |
| `Cmd + Enter` | Get solution |
| `Cmd/Ctrl + Arrow Keys` | Move window |
| `Cmd/Ctrl + Q` | Quit |

## 📱 Controlling Quip from your phone

Open **Settings → Remote** on the laptop, accept the remote-control notice, and
switch remote access on. Generate a pairing code, then scan the QR from your
phone (or type the code at `http://<laptop-ip>:41777`). Add it to your home
screen and it behaves like an app.

From the phone you can start an autopilot run by describing a goal, see the
laptop screen at each confirmation prompt, approve or skip individual steps, ask
Quip questions about what's on screen, and stop a run at any time.

**What it deliberately cannot do:** move the mouse or send keystrokes directly.
A paired phone can only ask autopilot to pursue a goal, and every step still
goes through autopilot's own risk policy and confirmation gates.

**Security notes — worth reading before you turn it on:**

- Remote access is **off by default** and stops when Quip quits.
- Pairing codes expire after two minutes and work once. Each phone gets its own
  token, revocable individually from Settings → Remote.
- Traffic stays on your local network but **is not encrypted**. Use it on
  networks you trust, and revoke a device you no longer have.
- The desktop `Cmd/Ctrl+Shift+Backspace` kill switch is out of reach when you're
  not at the machine — **Stop on the phone is the kill switch**, and it stays on
  screen for the whole run.
- The overlay shows an amber indicator whenever a phone is connected, so a
  remotely-drivable machine never looks like an idle one.

## 🤖 AI Providers

**Ollama (private):** 100% local, no API cost, works offline. Install from [ollama.ai](https://ollama.ai), then `ollama pull llama3.2` and set the env vars above.

**Google Gemini (fast):** latest models with vision, fastest responses. Requires an API key and internet; data is sent to Google.

## 🔧 Troubleshooting

**Sharp / Python build errors** (`gyp ERR! find Python`):
```bash
rm -rf node_modules package-lock.json
SHARP_IGNORE_GLOBAL_LIBVIPS=1 npm install --ignore-scripts && npm rebuild sharp
```

**App won't start:** make sure nothing else is using port 5180 (`lsof -i :5180`, then `kill [PID]`). Ollama users: confirm `ollama serve` is running.

## 📄 License

Licensed under the **Apache License 2.0** — see [LICENSE](LICENSE).

© 2026 Aditya Kumthekar.

This project is a substantially modified derivative of [free-cluely](https://github.com/Prat011/free-cluely), used under the Apache License 2.0.
