# ORBIT

ORBIT is a standalone desktop browser prototype for the UB Hacking 2026 deep-space theme. It combines Chromium-backed tabs, standard browser navigation, and an AI assistant that can use a local Ollama model hosted on Empire AI Alpha, BullsAI, or another compatible chat endpoint.

## What you need

- A computer running macOS, Windows, or Linux.
- Node.js with npm. Electron recommends the current Node.js LTS release for development. Install it from https://nodejs.org/en/download/.
- An internet connection for installing Electron and for visiting websites.
- To run the AI locally on Empire AI, an active Empire AI Alpha account, an approved project Slurm account, and an SSH key registered with Empire AI. The walkthrough below uses the `su_cwang1_worlds` project account as an example; use an account listed for your own user by Slurm.

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

ORBIT opens with a local space start page filling the window. Its point-cloud galaxy reveals outward from the core, turns slowly around a dark dust lane, and responds gently to mouse movement. The galaxy uses the app’s cyan, blue and lavender palette; its visual reference is the public landing animation at https://odyssey.com/. Rendering and geometry are local, with a smaller Canvas fallback when WebGL is unavailable. Use its search box to search the web or enter a URL; GitHub, Wikipedia and YouTube shortcuts are included. The page works offline, respects reduced-motion preferences, offers a pause button, and suspends animation while hidden. Press Ctrl+Space to bring up the Orbit assistant as a Spotlight-style popup over the page.

## Use the browser

- **Open a page:** Enter a website address or search phrase in the address bar and press Enter.
- **Search suggestions:** The address bar and new-tab search combine matching history, bookmarks, open tabs and Google autocomplete. Use ↑ / ↓ to choose a result and Enter to open it; open-tab results switch to the existing tab. Escape dismisses suggestions. Local results work offline. After a short typing pause, ordinary search phrases are sent to Google for autocomplete without browser cookies; full addresses, email addresses and URL parameters stay local. History and bookmarks are matched on your device.
- **Read or edit an address:** While browsing, HTTPS addresses omit `https://`, a leading `www.`, and an empty trailing slash. Other subdomains, ports, paths, query parameters and fragments remain visible. HTTP keeps its scheme and a **Not secure** indicator. Click the address bar or press Ctrl+L / Command+L to reveal and select the full address for editing or copying; Escape restores the current page address. Trimming changes only the display.
- **Check connection security:** A lock appears only when Chromium reports a secure main-page HTTPS response with a currently valid certificate. Hover over it for the issuing authority and expiry. Navigation clears the previous lock; certificate failures and loaded insecure content never receive a lock. If verification is unavailable, ORBIT shows a neutral information icon. Electron continues to reject invalid certificates by default.
- **Switch tabs:** Use the tab strip next to the address bar.
- **Inspect tab resources:** Hover over a tab, or focus it with the keyboard, to see its live memory use, CPU use, and audio state (**Playing**, **Muted**, or **Silent**). The card updates once per second while open; Escape dismisses it, and sampling stops when it closes. Memory is the resident memory of the page's renderer processes, including iframe renderers, displayed in MB. CPU uses 100% for one logical core and can exceed 100% for multithreaded pages. When a process serves multiple tabs, the card labels its shared totals. Shared browser, GPU and audio-service processes are excluded. The page stays running while you inspect it.
- **See all tabs as a cosmos:** Select **✦** in the toolbar or press Ctrl+Shift+O (Command+Shift+O on macOS). Every open tab is a star in a 3D galaxy; tabs from the same site share a colour and the current tab has a ring around it. Drag to orbit, scroll to zoom, and select a star or its label to switch to that tab. Press Esc or select **✦** again to return to the page. Zoomed out, the cosmos shows constellation names; zoom in or select a constellation's name to see its tab titles. Double-click empty space to see everything again.
- **Group tabs into constellations:** Each group of tabs becomes its own constellation, with its stars joined by lines. To make one:
  - Right-click a tab (in the tab strip or the cosmos) and choose **New constellation with this tab** or **Add to constellation**.
  - In the cosmos, Shift-click several stars and select **Make a constellation**, then type its name.
  - Ask the assistant, for example “group github, mdn and node as Dev” or “ungroup Dev”.
  - Describe the grouping you want in your own words, for example “group my tabs by project”, “put everything about the trip to Japan together”, or “split my tabs into work and personal”. With an AI endpoint connected, the assistant sends your instruction and your open tab titles and URLs to the model, which plans the constellations; ORBIT then creates or updates them. Without an endpoint, “group my tabs by site” still works.

  Grouped tabs have a coloured line under them in the tab strip. Links opened from a grouped tab join its group. To rename a constellation, double-click its name in the cosmos or use the right-click menu. Groups last until ORBIT closes.
- **Open a tab:** Select **＋** or press Ctrl+T (Command+T on macOS). Each blank tab opens the local space start page with an empty address bar; explicit website links still open their destination.
- **Close a tab:** Select its × button or press Ctrl+W (Command+W on macOS). Closing the last tab opens a fresh space start page.
- **Navigate:** Use the back, forward, and reload buttons. The application menu also has these commands.
- **Use keyboard shortcuts:** Ctrl+L / Command+L focuses the address bar. Ctrl+Space opens or closes the Orbit assistant popup (Esc or a click outside also closes it). Ctrl+Shift+O / Command+Shift+O shows or hides the tab cosmos. The application menu lists the main shortcuts.

ORBIT uses a persistent Chromium session, so website cookies, site storage, and cache are retained between launches. Open **Settings → Cookies and cache** to clear cookies and site data, cached images and files, or both. Clearing cookies can sign you out of websites; saved browsing history is managed separately. Website links that open a new window are opened as a new ORBIT tab. Sites that request camera, microphone, location, or notification access show an ORBIT permission prompt.

## Bookmarks

Select the **Bookmarks** ribbon beside History in the upper-right toolbar, or press **Ctrl+Shift+B / Command+Shift+B**. Like History, Bookmarks has **Universe**, **List**, and **Timeline** views. Universe groups saved pages from the same website into constellations; Timeline follows their saved dates, and List shows the newest saved pages first. Search filters matching titles and addresses, turning list results into stars while you type.

Click the star beside the address bar or press **Ctrl+D / Command+D** to save the current website. A filled star marks a saved page; clicking it again edits its name or address. You can also edit or remove bookmarks from List or the star-details panel. Opening a bookmark returns to its existing tab when available, otherwise opening a new tab. Internal new-tab screens cannot be bookmarked.

Bookmarks are saved locally in `orbit-bookmarks.json` in the application profile and survive restarts independently of history, cookies and cache. **Clear bookmarks…** asks for confirmation. Bookmarks also appear in local address-bar and new-tab suggestions. Run `npm run test:bookmarks` for persistence, editing, duplicate handling, website constellations, keyboard/menu actions, native tab opening and the narrow layout; previews are saved to `artifacts/bookmarks-list.png`, `artifacts/bookmarks-universe.png`, and `artifacts/bookmarks-narrow.png`.

## History

Select the **History** clock icon in the upper-right toolbar, or press **Ctrl+H / Command+H**. History opens in **Universe** mode, showing the five newest connected journeys around the black hole while the sidebar retains the full history. **List** shows page visits grouped by date; **Timeline** shows up to twenty visits in chronological order. Each history entry shows its title, address, favicon and visit time.

Start typing in **Search history** to filter the sidebar and visualization. Results update on each edit. Clearing the query or pressing Escape in the search box restores the selected view. The Universe scene has no date markers; date filters remain in the sidebar.

The Universe scene shares Orbit's backdrop, black hole, favicon stars and collapsible history sidebar. Connected visits form branching constellations positioned around the black hole, with no date markers in the scene. Only actual navigation links and new-tab relationships connect visits; hidden intermediate visits never produce invented shortcuts. Choose a date in the sidebar to filter the scene. Select a star or sidebar entry for visit details, double-click a star to reopen it, and use **F / Fit journeys** to fit the results. Drag to orbit, right-drag to pan, and scroll to zoom. Timeline mode keeps the camera fixed and syncs its twenty visible stars with the chronological sidebar. Reduced-motion preferences are respected, and the WebGL scene stops animating when History is closed. The List view remains available without 3D graphics.

History records top-level HTTP(S) visits, including favicons, navigation branches and closed-tab trails, and retains up to 3,000 visits locally in `orbit-history.json` under Electron's user-data directory. The Universe scene visualizes five connected journeys; Timeline shows twenty visits at a time. Search scans all retained visits, including entries not yet shown in the sidebar. Date filters can reach older matches. Back/forward returns to existing visit nodes; new navigation preserves earlier branches. Reopening loads the page's current contents. Visits from before recording was introduced cannot be reconstructed.

**Clear history…** asks for confirmation and deletes saved visit metadata without closing tabs or clearing website cookies. Titles and addresses are rendered as text. History is not sent to the assistant's model.

Run `npm run test:newtab` for the local start page, particle reveal, WebGL recovery, offline fallback and motion preferences, and `npm run test:address` (with OpenSSL installed) for address and connection states. Run `npm run test:history` for normal-list behavior, live search, native navigation, persistence and geometric checks for crossing or overlapping links. History previews are saved to `artifacts/history-list.png` and `artifacts/history-search-constellations.png`.

Run `npm run test:suggestions` for autocomplete filtering, local ranking, stale-response handling, keyboard selection, tab switching, offline history and suggestions on the new-tab page. Preview images are saved to `artifacts/address-suggestions.png` and `artifacts/newtab-suggestions.png`.

Run `npm run test:resources` for real CPU load, memory allocation, audible/muted/silent audio, renderer sharing, keyboard access, hover cleanup and closed tabs. The card preview is saved to `artifacts/tab-resources.png`.

## Run Ollama Qwen3.8:27b on Empire AI Alpha

This setup runs Ollama and Qwen3.8 on an Empire AI Alpha GPU node, then uses an SSH tunnel so the ORBIT desktop app on your Mac can call that Ollama API. It does not use Ollama Cloud. Keep the Slurm job and the SSH tunnel running while using ORBIT.

The default `qwen3.8:27b` tag is a 27.3B Q4_K_M model listed at about 18 GB, with a maximum context window of 256K. A single Alpha GPU is a reasonable starting point; the scheduler routes single-GPU jobs to the RTX PRO 6000 Blackwell pool (about 96 GB VRAM). The model weights and context cache both use memory, so begin with a moderate context if you encounter memory errors. Empire AI Beta requires at least four GPUs per job and is unnecessary for this setup. See the [Ollama model details](https://ollama.com/library/qwen3.8:27b) and [Empire AI Alpha QoS guide](https://empireai.freshdesk.com/support/solutions/articles/157000374474-alpha-job-submission-and-qos-overview).

#### If your terminal shows the NVL72 Beta banner

The `pulling ... success` lines mean Ollama downloaded the model, and the `>>>` prompt means `ollama run` opened its chat prompt. It is not an error. Type `/bye` to leave Ollama, then `exit` to leave the management/login shell. Do not use the management node for inference; run Ollama inside a Slurm GPU allocation.

The banner's `aarch64` means this Beta management node uses ARM64. Alpha uses x86_64, so use Alpha's x86_64 Ollama binary in Step 2. Beta and Alpha have separate login and Slurm environments, and your Beta home cache may not be visible from Alpha. For the `jshin` account used in this walkthrough, the Qwen model is already staged in `$HOME/ollama-models` on Alpha. If it is not present in your Alpha home, pull it during an Alpha CPU job in Step 3. Do not run inference on a management/login node.

### 1. Connect to Alpha and check your project account

From Terminal on your Mac, connect with the SSH key registered with Empire AI. The current Alpha login host is `alpha.empire-ai.org`. This example assumes your username is `jshin` and the key is `~/.ssh/id_empireai`; adjust these if yours differ:

    ssh -i ~/.ssh/id_empireai -o IdentitiesOnly=yes jshin@alpha.empire-ai.org

On Alpha, confirm the account and QoS available to your user:

    sacctmgr show assoc user="$USER" format=Account%20,QOS%60

Use an account shown in that output. The examples below use `su_cwang1_worlds` and the `test` QoS, which is intended for interactive GPU sessions and supports a one-hour run. If that account or QoS is not listed for you, replace it with one that is.

### 2. Install Ollama in your home directory (no root access required)

On this Alpha account, the complete x86_64 Ollama package is installed at `~/.local/ollama-alpha`. Use its binary first in your shell's `PATH`. The `~/.local/ollama/bin/ollama` path contains the ARM64 Beta binary and will fail with “Exec format error” on Alpha. The standalone `~/.local/bin/ollama` CLI does not include the required `llama-server` runtime, so do not put it ahead of the complete package:

    export PATH="$HOME/.local/ollama-alpha/bin:$HOME/.local/bin:$PATH"
    ollama --version

If the complete package or its `lib/ollama/llama-server` runtime is missing, install the x86_64 Linux archive into the separate Alpha directory:

    mkdir -p "$HOME/.local/ollama-alpha"
    curl -fsSL https://ollama.com/download/ollama-linux-amd64.tar.zst | tar --zstd -xf - -C "$HOME/.local/ollama-alpha"
    export PATH="$HOME/.local/ollama-alpha/bin:$HOME/.local/bin:$PATH"

The examples use `$HOME/ollama-models`, which already contains the downloaded Qwen model for this account. The model cache is about 17 GB. Empire AI home directories have a 100 GB quota, so keep an eye on space; project storage is preferable when your account has a project path that is readable and writable.

### 3. Check or download the model before reserving a GPU

For this account, the existing Qwen model cache is at `$HOME/ollama-models`. Set `OLLAMA_MODELS` to that directory. If `ollama list` does not show `qwen3.8:27b`, pull it during a one-hour CPU job rather than using GPU time for the download:

    srun --partition=cpu --account=su_cwang1_worlds --cpus-per-task=4 --mem=16G --time=01:00:00 --pty bash -l

Inside the CPU job, start Ollama with the Alpha binary and the home cache:

    export PATH="$HOME/.local/ollama-alpha/bin:$HOME/.local/bin:$PATH"
    export OLLAMA_MODELS="$HOME/ollama-models"
    export OLLAMA_HOST=127.0.0.1:11434
    ollama serve > "$HOME/ollama-pull.log" 2>&1 &
    OLLAMA_SERVER_PID=$!
    sleep 3
    ollama list
    ollama pull qwen3.8:27b
    kill "$OLLAMA_SERVER_PID"
    exit

`ollama pull` is safe to repeat: Ollama reuses the cache and fetches only missing layers. If you downloaded the model only into Beta's home cache and it is absent from `$HOME/ollama-models` on Alpha, transfer it through a storage path available to both environments or let this Alpha CPU job download it. Keep the CPU job active until the pull finishes.

### 4. Request one GPU for one hour

From the Alpha login shell, request the interactive GPU job. `test` permits up to two hours; the one-hour request below is enough for a short ORBIT session:

    srun --partition=alpha --qos=test --account=su_cwang1_worlds --gres=gpu:1 --cpus-per-task=8 --mem=32G --time=01:00:00 --pty bash -l

Once Slurm starts the job, you are on the allocated GPU node. Confirm the device and record the node name for the tunnel:

    nvidia-smi
    hostname -f

Empire AI Alpha routes a one-GPU request to its RTX PRO 6000 pool. Interactive `test` jobs are billed at half the standard service-unit rate; one GPU for one hour is nominally 0.5 SU. The project is charged for the allocated GPU time. See the current [QoS and service-unit rules](https://empireai.freshdesk.com/support/solutions/articles/157000374474-alpha-job-submission-and-qos-overview).

### 5. Start Ollama on the GPU node

Inside the allocated GPU shell, start the API on loopback so it is reachable through SSH but not exposed as a public service:

    export PATH="$HOME/.local/ollama-alpha/bin:$HOME/.local/bin:$PATH"
    export OLLAMA_MODELS="$HOME/ollama-models"
    export OLLAMA_HOST=127.0.0.1:11434
    ollama serve > "$HOME/ollama-${SLURM_JOB_ID}.log" 2>&1 &
    OLLAMA_SERVER_PID=$!
    sleep 3
    curl -fsS http://127.0.0.1:11434/api/tags

Leave this allocated shell open for the duration of the session. Verify the model uses the GPU after you send a prompt with `ollama ps` and `nvidia-smi`. If the tag is missing, run `ollama pull qwen3.8:27b` inside the job and wait for it to finish.

### 6. Open an SSH tunnel from your Mac

Keep the Empire AI shell and Ollama server running. The commands below use local port `11435` so they do not conflict with an Ollama service that may already be running on your Mac at `11434`. The tunnel must connect through the Alpha login host to the compute node where Ollama is listening. Replace `<COMPUTE_NODE_HOSTNAME>` with the node printed in the job log or by `hostname -f` in the allocated job:

    ssh -N -L 127.0.0.1:11435:<COMPUTE_NODE_HOSTNAME>:11434 \
      -i ~/.ssh/id_empireai \
      -o IdentitiesOnly=yes \
      jshin@alpha.empire-ai.org

This forwards your Mac’s `localhost:11435` through Alpha to Ollama on the allocated compute node’s `localhost:11434`. It uses the login node only as an SSH tunnel; inference remains on the GPU node.

Keep this SSH command running in the second Terminal window. Confirm the tunnel from your Mac:

    curl http://localhost:11435/api/tags

The response should list `qwen3.8:27b`.

### 7. Point ORBIT at the tunneled API

In the ORBIT desktop app, click **⚙** in the assistant popup (or press Ctrl+, / Command+,) and choose **Local Ollama API**. Use these settings; change the model field because the preset may still show the previous Kimi model:

    URL:      http://localhost:11435/v1/chat/completions
    Model:    qwen3.8:27b
    API key:  leave blank

Save the settings and send a prompt. Ollama provides the OpenAI-compatible chat-completions route that ORBIT uses. You can also check it from your Mac with:

    curl http://localhost:11435/v1/chat/completions \
      -H "Content-Type: application/json" \
      -d '{"model":"qwen3.8:27b","messages":[{"role":"user","content":"Reply that ORBIT is connected."}]}'

ORBIT sends the prompt and open tab titles and URLs through the tunnel to the Empire AI server. It does not automatically send page text. The API is available only while the Slurm job, Ollama server, and SSH tunnel are all active. When you finish, stop the tunnel with Ctrl+C. In the allocated shell, run `kill "$OLLAMA_SERVER_PID"` and then `exit`; Slurm releases the GPU. Slurm also ends the job when its one-hour limit expires.

For current cluster guidance, see [Empire AI Alpha Interactive Slurm Quickstart](https://empireai.freshdesk.com/support/solutions/articles/157000374475-empire-ai-alpha-%E2%80%94-interactive-slurm-quickstart) and [Empire AI Alpha Jupyter, SSH & Tunnels](https://empireai.freshdesk.com/support/solutions/articles/157000374476-empire-ai-alpha-%E2%80%94-jupyter-ssh-tunnels).

### Use another compatible provider

Enter an HTTPS chat-completions URL, model ID, and API key from that provider. For BullsAI, request developer access and use the endpoint, model ID, and authentication details from its developer documentation: https://www.buffalo.edu/ubit/services/BullsAI.html. The public UBIT page identifies Model Hub but does not publish those connection details.

### API key storage

In the desktop app, ORBIT stores API keys with Electron `safeStorage` when OS-backed encryption is available. The encrypted value is kept in the app’s settings file under the operating system’s ORBIT user-data folder. The renderer does not store desktop API keys in browser local storage.

On Linux, ORBIT requires a protected desktop keyring to save an API key. If one is unavailable, set an environment variable before starting ORBIT. `OLLAMA_API_KEY` is only needed for Ollama’s direct cloud API; it is not used for the tunneled Empire AI endpoint. `BULLSAI_API_KEY` remains supported for BullsAI and compatible endpoints. Environment variables take precedence over a saved key.

macOS or Linux:

    export OLLAMA_API_KEY="your-ollama-api-key"
    npm start

Windows PowerShell:

    $env:OLLAMA_API_KEY = "your-ollama-api-key"
    npm start

Do not commit a real API key to this project or put it in README.md.

### What the assistant sends

For a regular question, ORBIT sends the prompt and open tab titles and URLs to the configured endpoint. With the Empire AI setup above, this information travels through SSH to the Alpha compute node. With another cloud provider, it is sent to that provider. ORBIT does not automatically send page text. Direct browser commands such as “open buffalo.edu,” “search for UB Hacking,” “switch to the BullsAI tab,” “close the tab called …,” “go back,” and “move the tab called … to Research” are handled locally.

The microphone button starts voice input and sends the recognized transcript as the prompt. The adjacent voice-reply button toggles spoken assistant responses. If voice recognition is unavailable or microphone access is denied, you can continue by typing.

## Build a distributable app

On Linux, build an executable AppImage with:

    ./build-appimage.sh

You can also use `npm run appimage`. The script works from any directory, installs dependencies with `npm ci` if Electron or electron-builder is missing, and builds the current source without publishing it. It writes a versioned AppImage into `dist/`, gives it executable permissions, and prints its exact launch command. For example, on x64 with version 0.2.0:

    ./dist/ORBIT-0.2.0-x64.AppImage

You can also open that AppImage from your file manager after the build finishes. The first build may download packaging tools and requires internet access.

The app window and Linux AppImage use ORBIT's cyan and lavender ringed-planet icon. Its editable SVG and 512px PNG are in `assets/`. On Linux, launching the app registers its icon and an ORBIT application entry in your user data directory (`$XDG_DATA_HOME`, or `~/.local/share`). The entry shares the app's window identity so Wayland and X11 desktops can associate its taskbar icon correctly; registration needs no administrator access.

When `/dev/fuse` is unavailable, the script prints a launch command with `--appimage-extract-and-run`, which runs the AppImage without mounting it. You can also add that flag manually if you encounter a FUSE error; see the [AppImage fallback instructions](https://docs.appimage.org/user-guide/troubleshooting/fuse.html#extract-and-run-type-2-appimages).

Run these commands from the project folder after installing dependencies:

    npm run pack

This creates an unpacked application build for the current platform.

    npm run dist

This creates a distributable for the current platform. The project is configured for macOS, Windows (NSIS), and Linux (AppImage). Build each platform’s installer on that operating system. Code signing and notarization are not configured in this prototype.

## Troubleshooting

- **npm install fails or hangs:** Confirm the computer can reach npm and Electron release downloads, then retry. Electron binary installation errors are often caused by a network, proxy, or firewall issue. See Electron’s installation guide: https://www.electronjs.org/docs/latest/tutorial/installation
- **npm start says Electron is missing:** Run npm install from the project folder and check for installation errors.
- **A website does not load:** Check your internet connection, then try entering the full address, such as https://example.com.
- **ORBIT cannot reach Ollama on Alpha:** Confirm the Slurm job is still running, `ollama serve` is active on the allocated compute node, and the SSH tunnel is still open. On your Mac, `curl http://localhost:11435/api/tags` should return the model list.
- **Ollama runs on CPU or reports an out-of-memory error:** Run Ollama inside the GPU allocation, check `nvidia-smi` and `ollama ps`, and retry with a shorter context. Make sure the model pull completed before starting the GPU job.
- **The Slurm request is rejected:** Check `sacctmgr show assoc user="$USER" format=Account%20,QOS%60` and use an account/QoS permitted for your user. Alpha requires an explicit project account; Beta is a separate system and requires at least four GPUs per job.
- **BullsAI returns an error:** Check developer access, endpoint URL, model ID, API key, and whether the endpoint uses the expected Bearer-token and OpenAI-compatible format.
- **Voice input is unavailable:** Check OS microphone access and the ORBIT permission prompt. Some Electron or system configurations do not provide speech recognition; typing remains available.
- **Installer build fails:** Run npm run dist on the target operating system and review the first error printed by electron-builder. Platform signing and notarization require separate credentials and setup.

## Project files

- desktop-main.js — Electron main process, Chromium tab lifecycle, navigation, permissions, and AI endpoint requests.
- tab-groups.js — tab group (constellation) names and colours, used by the main process.
- desktop-preload.js — narrow, context-isolated bridge between the app UI and the main process.
- connection-security.js — Chromium main-frame connection metadata, certificate validity, navigation resets, and insecure-content tracking.
- ui/newtab/ — static local start page, procedural WebGL galaxy with Canvas fallback, mouse parallax and search.
- ui/index.html — the app window's markup; ui/main.js starts the interface and wires the components together.
- ui/components/ — one file per part of the interface: toolbar, tab strip, browser view, settings dialog, toast, the assistant (panel, built-in browser commands, voice), and the 3D tab cosmos (scene, tab stars, constellations, star layout, background sky). The cosmos uses three.js, loaded from node_modules through the import map in ui/index.html.
- ui/lib/ — shared helpers: the tab list mirrored from the main process, AI settings, URL and DOM utilities.
- ui/styles/ — one stylesheet per component, plus base.css for the page layout.
- package.json — start and packaging scripts.
