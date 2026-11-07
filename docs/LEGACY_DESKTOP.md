# ORBIT

ORBIT is a standalone desktop browser prototype for the UB Hacking 2026 deep-space theme. It combines Chromium-backed tabs, a spatial workspace, named spaces, standard browser navigation, and a BullsAI assistant.

The desktop app is the primary program. The same folder also includes an optional Chrome new-tab extension prototype.

## What you need

- A computer running macOS, Windows, or Linux.
- Node.js with npm. Electron recommends the current Node.js LTS release for development. Install it from https://nodejs.org/en/download/.
- An internet connection for installing Electron and for visiting websites.
- For the BullsAI assistant, developer access to BullsAI Model Hub, including the endpoint URL, model ID, and API credentials.

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

## Configure BullsAI

The assistant needs developer access details; ORBIT does not include a default API endpoint or key.

1. Open the gear menu in ORBIT.
2. Enter the chat-completions URL and model ID supplied with your BullsAI developer access.
3. Paste the API key and choose **Save connection**.
4. If prompted, allow ORBIT to connect to the endpoint host.
5. Ask a question in the assistant panel.

The public UBIT BullsAI page identifies Model Hub as the developer API service, but does not publish the endpoint, model IDs, or authentication format. Request developer access and use the details in the BullsAI developer documentation: https://www.buffalo.edu/ubit/services/BullsAI.html

The current adapter expects an OpenAI-compatible chat-completions request and a response containing choices[0].message.content. It sends the API key as a Bearer token. If the endpoint supplied by BullsAI uses a different request path, authentication header, or response format, update the adapter in desktop-main.js.

### API key storage

When OS-backed encryption is available, ORBIT stores the API key using Electron safeStorage. The encrypted value is kept in the app’s settings file under the operating system’s ORBIT user-data folder; the renderer does not store the key in browser local storage.

On Linux, ORBIT requires a protected desktop keyring for saving the key. If one is unavailable, provide the key through the BULLSAI_API_KEY environment variable before starting ORBIT. This variable takes precedence over a key saved in settings.

macOS or Linux:

    export BULLSAI_API_KEY="your-developer-key"
    npm start

Windows PowerShell:

    $env:BULLSAI_API_KEY = "your-developer-key"
    npm start

Do not commit a real API key to this project or put it in README.md.

### What the assistant sends

When you submit a regular question, ORBIT sends the prompt and open tab titles and URLs to the configured BullsAI endpoint. It does not automatically send page text. Direct browser commands such as “open buffalo.edu,” “search for UB Hacking,” “switch to the BullsAI tab,” “close the tab called …,” “go back,” and “move the tab called … to Research” are handled locally.

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
- **BullsAI returns an error:** Check developer access, endpoint URL, model ID, API key, and whether the endpoint uses the expected Bearer-token and OpenAI-compatible format.
- **Voice input is unavailable:** Check OS microphone access and the ORBIT permission prompt. Some Electron or system configurations do not provide speech recognition; typing remains available.
- **Installer build fails:** Run npm run dist on the target operating system and review the first error printed by electron-builder. Platform signing and notarization require separate credentials and setup.

## Project files

- desktop-main.js — Electron main process, Chromium tab lifecycle, navigation, permissions, and BullsAI requests.
- desktop-preload.js — narrow, context-isolated bridge between the app UI and the main process.
- newtab.html, app.js, styles.css — ORBIT workspace, browser controls, and assistant interface.
- manifest.json — optional Chrome extension configuration.
- package.json — start and packaging scripts.
