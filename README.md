# ORBIT

ORBIT is a standalone desktop browser prototype for the UB Hacking 2026 deep-space theme. It combines Chromium-backed tabs, a spatial workspace, named spaces, standard browser navigation, and an AI assistant that can use Google Gemini, BullsAI, local Ollama, or another OpenAI-compatible chat endpoint.

The desktop app is the primary program. The same folder also includes an optional Chrome new-tab extension prototype.

## What you need

- A computer running macOS, Windows, or Linux.
- Node.js with npm. Electron recommends the current Node.js LTS release for development. Install it from https://nodejs.org/en/download/.
- An internet connection for installing Electron and for visiting websites.
- For the Gemini walkthrough below, a Google account and a Gemini API key from Google AI Studio. ORBIT can also use other OpenAI-compatible services.

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

## Connect ORBIT to Google Gemini API (free tier)

ORBIT sends chat-completions requests to Gemini's OpenAI-compatible API. No Empire AI allocation or local model is needed. Google currently lists `gemini-3.8-flash` as a stable Gemini API model with free-tier token pricing; free-tier request limits still apply.

### 1. Create a Gemini API key

1. Sign in to [Google AI Studio](https://aistudio.google.com/).
2. Open **Get API key** and create a key in a Free Tier project. New users may receive a project and key automatically.
3. Keep the project on the free tier and do not enable Cloud Billing if you want to avoid paid API usage.

See Google's [API key guide](https://ai.google.dev/gemini-api/docs/api-key) and [pricing page](https://ai.google.dev/gemini-api/docs/pricing). Free quotas are model-specific and can change; check the AI Studio usage dashboard for your project's current limits.

### 2. Configure ORBIT

1. Start the desktop app with `npm start`.
2. Open the gear menu to show **Connect an AI model**. Enter these values:

       URL:      https://generativelanguage.googleapis.com/v1beta/openai/chat/completions
       Model:    gemini-3.8-flash
       API key:  your Google AI Studio key

3. Select **Save connection**, then ask the assistant a short question.

Gemini's OpenAI-compatible endpoint uses the standard chat-completions format and accepts the API key as a Bearer token. The ORBIT settings window stores the key with Electron `safeStorage` when OS-backed encryption is available. Do not put the key in README.md, source code, or a shared Git repository. The optional Chrome extension does not provide the desktop app's protected key storage.

### Free-tier limits and privacy

- A free API key is subject to Google's per-model rate limits and quota. A `429` response usually means a rate limit was reached; check the AI Studio usage dashboard and retry later.
- Google says content sent through unpaid Gemini API services, and the generated responses, may be used to improve Google products. Human reviewers may review that data. Do not send sensitive, confidential, or personal information through the free tier. Read Google's [Gemini API terms](https://ai.google.dev/gemini-api/terms).
- ORBIT sends your prompt and open tab titles and URLs to the configured endpoint. It does not automatically send webpage text, but tab titles and URLs can still reveal sensitive information.
- Each teammate should create and enter their own API key. Do not share one key in chat or commit it to Git.

See Google's [OpenAI compatibility guide](https://ai.google.dev/gemini-api/docs/openai) for supported request behavior and model compatibility.


### Use another compatible provider

Enter an HTTPS chat-completions URL, model ID, and API key from that provider. For BullsAI, request developer access and use the endpoint, model ID, and authentication details from its developer documentation: https://www.buffalo.edu/ubit/services/BullsAI.html. The public UBIT page identifies Model Hub but does not publish those connection details.

### API key storage

In the desktop app, ORBIT stores API keys with Electron `safeStorage` when OS-backed encryption is available. The encrypted value is kept in the app’s settings file under the operating system’s ORBIT user-data folder. The renderer does not store desktop API keys in browser local storage. The Chrome extension prototype does not provide the same protected key storage; use the desktop app for direct cloud API keys.

On Linux, ORBIT requires a protected desktop keyring to save an API key. If one is unavailable, set an environment variable before starting ORBIT. For Gemini, use `GEMINI_API_KEY` (or `GOOGLE_API_KEY`); Ollama Cloud uses `OLLAMA_API_KEY`; BullsAI and other compatible providers can use `BULLSAI_API_KEY`. Environment variables take precedence over a saved key.

macOS or Linux, when using Gemini:

    export GEMINI_API_KEY="your-gemini-api-key"
    npm start

Windows PowerShell:

    $env:GEMINI_API_KEY = "your-gemini-api-key"
    npm start

Do not commit a real API key to this project or put it in README.md.

### What the assistant sends

For a regular question, ORBIT sends the prompt and open tab titles and URLs to the configured endpoint. When using Gemini, that information is sent to Google's Gemini API. ORBIT does not automatically send page text. Direct browser commands such as “open buffalo.edu,” “search for UB Hacking,” “switch to the BullsAI tab,” “close the tab called …,” “go back,” and “move the tab called … to Research” are handled locally.

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
- **Gemini returns 401 or 403:** Check the API key, the Free Tier project, and the endpoint URL. Create or rotate a key in Google AI Studio if needed.
- **Gemini returns 404:** Confirm the model ID is `gemini-3.8-flash` and use Google's OpenAI-compatible chat-completions URL.
- **Gemini returns 429:** The project reached a model rate limit or quota. Check the AI Studio usage dashboard and try again when the limit resets.
- **BullsAI returns an error:** Check developer access, endpoint URL, model ID, API key, and whether the endpoint uses the expected Bearer-token and OpenAI-compatible format.
- **Voice input is unavailable:** Check OS microphone access and the ORBIT permission prompt. Some Electron or system configurations do not provide speech recognition; typing remains available.
- **Installer build fails:** Run npm run dist on the target operating system and review the first error printed by electron-builder. Platform signing and notarization require separate credentials and setup.

## Project files

- desktop-main.js — Electron main process, Chromium tab lifecycle, navigation, permissions, and AI endpoint requests.
- desktop-preload.js — narrow, context-isolated bridge between the app UI and the main process.
- newtab.html, app.js, styles.css — ORBIT workspace, browser controls, and assistant interface.
- manifest.json — optional Chrome extension configuration.
- package.json — start and packaging scripts.
