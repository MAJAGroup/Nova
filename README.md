# ORBIT

ORBIT is a standalone desktop browser prototype for the UB Hacking 2026 deep-space theme. It combines Chromium-backed tabs, a spatial workspace, named spaces, standard browser navigation, and an AI assistant that can use Ollama Kimi K3.1 Pro, BullsAI, or another compatible chat endpoint.

The desktop app is the primary program. The same folder also includes an optional Chrome new-tab extension prototype.

## What you need

- A computer running macOS, Windows, or Linux.
- Node.js with npm. Electron recommends the current Node.js LTS release for development. Install it from https://nodejs.org/en/download/.
- An internet connection for installing Electron and for visiting websites.
- For Kimi K3.1 Pro, an Ollama account with cloud-model access and usage credits or a plan that includes the model. Other compatible providers may require their own API access and key.

Check that Node.js and npm are installed by opening a terminal and running:

    node -v
    npm -v

Both commands should print version numbers. On Windows, use PowerShell or Command Prompt to run the desktop app rather than WSL.

## Install and launch ORBIT

1. Open Terminal, PowerShell, or Command Prompt.
2. Change to the project folder. Replace the example path with the folder where you saved this project:

       cd "/path/to/UB Hackathon"

   On Windows, a path might look like:

       cd "C:\path\to\UB Hackathon"

3. Install the project dependencies:

       npm install

   This installs Electron and electron-builder. Electron also downloads its platform binary, so this step may take a few minutes and needs access to npm and Electron's release downloads.

4. Start the browser:

       npm start

ORBIT opens to the constellation workspace with an initial web tab. Select a tab card or choose **Browse** to display its page.

## Use the browser

- **Open a page:** Enter a website address or search phrase in the top address bar and press Enter.
- **Switch tabs:** Select a card in the orbit, or use the tab strip while browsing.
- **Open a tab:** Select **New tab** or press Ctrl+T (Command+T on macOS).
- **Close a tab:** Select its × button or press Ctrl+W (Command+W on macOS). Closing the last tab opens a fresh Google page.
- **Navigate:** Use the back, forward, and reload buttons. The application menu also has these commands.
- **Return to the workspace:** Select **Overview**, or use the application menu’s **Orbit Workspace** command.
- **Organize tabs:** Choose a space in the sidebar. Drag cards to reposition them or drop them on a space. Right-click a card to move it from a menu.
- **Create a space:** Select **New space** in the sidebar.
- **Use keyboard shortcuts:** Ctrl+L / Command+L focuses the address bar. Ctrl+J / Command+J focuses the assistant. The application menu lists the main shortcuts.

ORBIT uses a persistent Chromium session for website cookies and local storage. Website links that open a new window are opened as a new ORBIT tab. Sites that request camera, microphone, location, or notification access show an ORBIT permission prompt.

## Connect Ollama Kimi K3.1 Pro

ORBIT can call Kimi through either the local Ollama API or Ollama’s direct cloud API. Both use an OpenAI-compatible chat-completions request.

### Option A: Ollama app and local API

This is the easiest option for ORBIT. The model itself runs on Ollama’s hosted service; the Ollama app on your computer exposes a local API for ORBIT to call.

1. Install Ollama for macOS, Windows, or Linux from https://ollama.com/download.
2. Sign in to your Ollama account. Cloud models need an account with model access and available usage credits or a plan that includes them.
3. In Terminal, run the model once to confirm access:

       ollama run kimi-k3.1-pro:cloud

   If prompted, send a short message. Type `/bye` to exit the chat. The cloud model does not download its 2.81T-parameter weights to your computer.
4. Open ORBIT’s gear menu and choose **Local Ollama API**. The preset fills these settings:

       URL:   http://localhost:11434/v1/chat/completions
       Model: kimi-k3.1-pro:cloud

   No API key is needed in ORBIT for this local endpoint. Ollama uses the sign-in saved by its app or CLI to access the cloud model.
5. Save the connection and send a short prompt in ORBIT.

Keep Ollama running while using this connection. To check its local API from Terminal, run:

    curl http://localhost:11434/api/tags

### Option B: Ollama’s direct cloud API

This option does not require installing Ollama. Create an API key in your Ollama account, then use **Ollama Cloud API** in ORBIT’s gear menu:

    URL:   https://ollama.com/v1/chat/completions
    Model: kimi-k3.1-pro

Paste your key into the API key field and save. For this direct API, use the model name without the `:cloud` suffix. Usage is metered by tokens; check current model pricing and your account balance before regular use.

### Use another compatible provider

Enter an HTTPS chat-completions URL, model ID, and API key from that provider. For BullsAI, request developer access and use the endpoint, model ID, and authentication details from its developer documentation: https://www.buffalo.edu/ubit/services/BullsAI.html. The public UBIT page identifies Model Hub but does not publish those connection details.

### API key storage

In the desktop app, ORBIT stores API keys with Electron `safeStorage` when OS-backed encryption is available. The encrypted value is kept in the app’s settings file under the operating system’s ORBIT user-data folder. The renderer does not store desktop API keys in browser local storage. The Chrome extension prototype does not provide the same protected key storage; use the desktop app for direct cloud API keys.

On Linux, ORBIT requires a protected desktop keyring to save an API key. If one is unavailable, set an environment variable before starting ORBIT. `OLLAMA_API_KEY` is used for Ollama’s direct cloud API; `BULLSAI_API_KEY` remains supported for BullsAI and compatible endpoints. Environment variables take precedence over a saved key.

macOS or Linux:

    export OLLAMA_API_KEY="your-ollama-api-key"
    npm start

Windows PowerShell:

    $env:OLLAMA_API_KEY = "your-ollama-api-key"
    npm start

Do not commit a real API key to this project or put it in README.md.

### What the assistant sends

For a regular question, ORBIT sends the prompt and open tab titles and URLs to the configured endpoint. When using Kimi through Ollama Cloud, that means the information is sent to Ollama’s hosted service. ORBIT does not automatically send page text. Direct browser commands such as “open buffalo.edu,” “search for UB Hacking,” “switch to the BullsAI tab,” “close the tab called …,” “go back,” and “move the tab called … to Research” are handled locally.

The microphone button starts voice input and sends the recognized transcript as the prompt. The adjacent voice-reply button toggles spoken assistant responses. If voice recognition is unavailable or microphone access is denied, you can continue by typing.

## Build a distributable app

Run these commands from the project folder after installing dependencies:

    npm run pack

This creates an unpacked application build for the current platform.

    npm run dist

This creates a distributable for the current platform. The project is configured for macOS, Windows (NSIS), and Linux (AppImage). Build each platform’s installer on that operating system. Code signing and notarization are not configured in this prototype.

## Optional: load the Chrome extension

To use ORBIT as a Chrome new-tab page instead of running the standalone app:

1. Open chrome://extensions in Chrome.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Choose this project folder.
5. Open a new tab.

The extension can visualize real Chrome tabs and organize them into spaces. The standalone app provides the actual Chromium browser view and is the recommended way to run the full program.

## Troubleshooting

- **npm install fails or hangs:** Confirm the computer can reach npm and Electron release downloads, then retry. Electron binary installation errors are often caused by a network, proxy, or firewall issue. See Electron’s installation guide: https://www.electronjs.org/docs/latest/tutorial/installation
- **npm start says Electron is missing:** Run npm install from the project folder and check for installation errors.
- **A website does not load:** Check your internet connection, then try entering the full address, such as https://example.com.
- **Ollama returns an error:** Confirm Ollama is running, you are signed in for cloud models, the model is spelled correctly, and your Ollama account has access/usage available. For direct cloud API access, check the API key and use `kimi-k3.1-pro` without `:cloud`.
- **BullsAI returns an error:** Check developer access, endpoint URL, model ID, API key, and whether the endpoint uses the expected Bearer-token and OpenAI-compatible format.
- **Voice input is unavailable:** Check OS microphone access and the ORBIT permission prompt. Some Electron or system configurations do not provide speech recognition; typing remains available.
- **Installer build fails:** Run npm run dist on the target operating system and review the first error printed by electron-builder. Platform signing and notarization require separate credentials and setup.

## Project files

- desktop-main.js — Electron main process, Chromium tab lifecycle, navigation, permissions, and AI endpoint requests.
- desktop-preload.js — narrow, context-isolated bridge between the app UI and the main process.
- newtab.html, app.js, styles.css — ORBIT workspace, browser controls, and assistant interface.
- manifest.json — optional Chrome extension configuration.
- package.json — start and packaging scripts.
