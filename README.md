# TeleDrive 🚀

TeleDrive is a cross-platform Google Drive clone backed by your own private Telegram storage. Build on top of Tauri v2, React, Vite, Tailwind CSS v4, and GramJS (MTProto client), it offers a premium, responsive cloud storage experience with unlimited storage potential.

---

## 🌟 Key Features

- **Unlimited Backup Space**: Powered by a private Telegram channel in your account.
- **Cross-Platform**: Compiles natively to Windows, macOS, Linux, and Android using Tauri v2.
- **Secure Local Vault**: Encrypts and stores API credentials and session keys locally using Tauri's Stronghold plugin (Argon2id key derivation).
- **Virtual Folder Hierarchy**: Navigable virtual directory structures managed via an in-channel pinned JSON metadata store.
- **Google Drive Aesthetics**: Clean, responsive layout supporting desktop layouts, responsive tablet layouts, and full mobile webview optimization.
- **Theme Configurations**: Persisted light, dark, and system preferred color appearances.

---

## 🏗️ Architecture

```text
teledrive/
├── src-tauri/                  ← Rust/Tauri shell + Cargo plugins
│   ├── capabilities/           ← Security capability configuration
│   └── src/                    ← Rust entry points & plugin registrations
└── src/
    ├── components/
    │   ├── layout/             ← Header, Sidebar, SearchBar layouts
    │   ├── settings/           ← Multi-panel settings (API stepper, account)
    │   └── ui/                 ← shadcn/ui custom components
    ├── hooks/                  ← useTheme, useIsMobile hooks
    ├── lib/
    │   └── secure/             ← Stronghold secret vault client wrapper
    ├── pages/                  ← Route pages (Drive, Recent, Starred, settings, etc.)
    ├── stores/                 ← Zustand auth, file, and UI stores
    └── main.tsx & App.tsx      ← App entry, routing, and initialization
```

---

## 🛠️ Technology Stack

- **Frontend**: React 18 + Vite + TypeScript
- **UI Framework**: Tailwind CSS v4 + shadcn/ui
- **Icons**: Lucide React
- **State Management**: Zustand (with persist middleware)
- **Routing**: React Router v6
- **Telegram client**: GramJS (running directly in the webview)
- **Shell**: Tauri v2
- **Secure storage**: Tauri Stronghold plugin
- **File Dialogs**: Tauri dialog + fs plugins

---

## 🚀 Getting Started

### Prerequisites

Ensure you have the following installed on your developer machine:

1. **Rust & Cargo**: Required to compile the Tauri backend. Install via [rustup.rs](https://rustup.rs/).
2. **Node.js**: Version 20.19+ or 22.12+.
3. **Android SDK / NDK** (Optional): Required for Android compilation target.

### Development Setup

1. Clone the repository and install dependencies:
   ```bash
   git clone https://github.com/senapati484/teledrive.git
   cd teledrive
   npm install
   ```

2. Start the desktop development environment:
   ```bash
   npm run tauri dev
   ```

3. (Optional) Run Android target development:
   ```bash
   npm run tauri android dev
   ```

---

## 🔒 Security & Privacy

TeleDrive is built with a zero-knowledge trust design:
1. **No External Servers**: Your files are uploaded directly from your local device to Telegram servers using MTProto.
2. **Secure Credentials Vault**: Your Telegram API credentials (api_id, api_hash) and MTProto Session keys are stored locally in an encrypted vault managed by Tauri's Stronghold plugin. The encryption key is derived using Argon2id with a device-bound key derivation salt.
3. **Control**: TeleDrive only interacts with channels it creates or you explicitly assign to it.

---

## 📜 License

TeleDrive is open-source software. Use at your own risk. This project is not affiliated with or endorsed by Telegram FZ-LLC.
