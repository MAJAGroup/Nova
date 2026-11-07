# ORBIT

ORBIT is a standalone desktop browser prototype for the UB Hacking 2026 deep-space theme. It combines Chromium-backed tabs, a spatial workspace, named spaces, standard browser navigation, and an AI assistant that can use a local Ollama model hosted on Empire AI Alpha, BullsAI, or another compatible chat endpoint.

The desktop app is the primary program. The same folder also includes an optional Chrome new-tab extension prototype.

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

## Run Ollama Qwen3.8:27b on Empire AI Alpha

This setup runs Ollama and Qwen3.8 on an Empire AI Alpha GPU node, then uses an SSH tunnel so the ORBIT desktop app on your Mac can call that Ollama API. It does not use Ollama Cloud. Keep the Slurm job and the SSH tunnel running while using ORBIT.

The default `qwen3.8:27b` tag is a 27.3B Q4_K_M model listed at about 18 GB, with a maximum context window of 256K. A single Alpha GPU is a reasonable starting point; the scheduler routes single-GPU jobs to the RTX PRO 6000 Blackwell pool (about 96 GB VRAM). The model weights and context cache both use memory, so begin with a moderate context if you encounter memory errors. Empire AI Beta requires at least four GPUs per job and is unnecessary for this setup. See the [Ollama model details](https://ollama.com/library/qwen3.8:27b) and [Empire AI Alpha QoS guide](https://empireai.freshdesk.com/support/solutions/articles/157000374474-alpha-job-submission-and-qos-overview).

#### If your terminal shows the NVL72 Beta banner

The `pulling ... success` lines mean Ollama downloaded the model, and the `>>>` prompt means `ollama run` opened its chat prompt. It is not an error. Type `/bye` to leave Ollama, then `exit` to leave the management/login shell. Do not use the management node for inference; run Ollama inside a Slurm GPU allocation.

The banner's `aarch64` means this Beta management node uses ARM64. Alpha uses x86_64, so install the Alpha-specific Ollama binary in Step 2. The model weights do not depend on the CPU architecture. Your Beta download is usually in Ollama's home cache; Alpha may not see that cache automatically. Copy it to the persistent project directory from Beta, then point Alpha's Ollama at that same directory. Beta `/ddn/scratch` is temporary and is not the shared model store.

### 1. Connect to Alpha and check your project account

From Terminal on your Mac, connect with the SSH key registered with Empire AI. This example assumes your username is `jshin` and the key is `~/.ssh/id_empireai`; adjust these if yours differ:

    ssh -i ~/.ssh/id_empireai -o IdentitiesOnly=yes jshin@alpha1.empireai.edu

On Alpha, confirm the account and QoS available to your user:

    sacctmgr show assoc user="$USER" format=Account%20,QOS%60

Use an account shown in that output. The examples below use `su_cwang1_worlds` and the `test` QoS, which is intended for interactive GPU sessions and supports a one-hour run. If that account or QoS is not listed for you, replace it with one that is.

### 2. Install Ollama in your home directory (no root access required)

The standard Linux Ollama installer writes to system directories and requires administrator access. On Alpha, install its x86_64 Linux archive into an Alpha-specific directory in your home, so it does not overwrite an ARM64 Ollama binary you may use on Beta:

    mkdir -p "$HOME/.local/ollama-alpha"
    curl -fsSL https://ollama.com/download/ollama-linux-amd64.tar.zst | tar --zstd -xf - -C "$HOME/.local/ollama-alpha"
    export PATH="$HOME/.local/ollama-alpha/bin:$PATH"
    ollama --version

To keep the Alpha binary available in future Alpha shells, add this line to `~/.bashrc`:

    export PATH="$HOME/.local/ollama-alpha/bin:$PATH"

Empire AI recommends keeping model weights in project storage rather than the 100 GB home directory. For `su_cwang1_worlds`, the project directory is `/projects/suny/cwang1/worlds`. The examples below store Ollama weights at `/projects/suny/cwang1/worlds/models/ollama`. If that path is not writable for your user, ask the project owner which project directory to use.

### 3. Put the model in shared project storage

You already downloaded the model in Beta, so do not pull it again yet. After leaving the `ollama run` prompt with `/bye`, use the Beta shell to copy Ollama's default model cache to persistent project storage. This copy does not run inference on the management node:

    export PROJECT_OLLAMA_MODELS=/projects/suny/cwang1/worlds/models/ollama
    mkdir -p "$PROJECT_OLLAMA_MODELS"
    rsync -a "$HOME/.ollama/models/" "$PROJECT_OLLAMA_MODELS/"

If you set a custom `OLLAMA_MODELS` on Beta, use that directory as the `rsync` source instead of `$HOME/.ollama/models/`. Keep the destination on `/projects`, not Beta's temporary `/ddn/scratch`. The `/projects` path must be writable by your project account and accessible from both systems.

Then connect to Alpha, start a one-hour CPU job, and check the shared copy before requesting a GPU:

    srun --partition=cpu --account=su_cwang1_worlds --cpus-per-task=4 --mem=16G --time=01:00:00 --pty bash -l

Inside the CPU job, point the x86_64 Ollama binary at the shared cache, start the local API, and check for the model:

    export PATH="$HOME/.local/ollama-alpha/bin:$PATH"
    export OLLAMA_MODELS=/projects/suny/cwang1/worlds/models/ollama
    export OLLAMA_HOST=127.0.0.1:11434
    ollama serve > "$HOME/ollama-pull.log" 2>&1 &
    OLLAMA_SERVER_PID=$!
    sleep 3
    ollama list

If `qwen3.8:27b` appears in the list, the existing Beta download is ready for Alpha; stop the server with `kill "$OLLAMA_SERVER_PID"`, then `exit` the CPU job. If it is missing, run `ollama pull qwen3.8:27b` in that CPU job and wait for it to finish. Ollama will reuse any layers found in the shared cache and fetch only what is missing. If the Beta cache cannot be copied or the shared path is not available from Alpha, use `ollama pull` in the Alpha CPU job to download it there. The model is about 18 GB, so keep the CPU job active until the pull completes. If needed, request another CPU job and repeat the check.

### 4. Request one GPU for one hour

From the Alpha login shell, request the interactive GPU job. `test` permits up to two hours; the one-hour request below is enough for a short ORBIT session:

    srun --partition=alpha --qos=test --account=su_cwang1_worlds --gres=gpu:1 --cpus-per-task=8 --mem=32G --time=01:00:00 --pty bash -l

Once Slurm starts the job, you are on the allocated GPU node. Confirm the device and record the node name for the tunnel:

    nvidia-smi
    hostname -f

Empire AI Alpha routes a one-GPU request to its RTX PRO 6000 pool. Interactive `test` jobs are billed at half the standard service-unit rate; one GPU for one hour is nominally 0.5 SU. The project is charged for the allocated GPU time. See the current [QoS and service-unit rules](https://empireai.freshdesk.com/support/solutions/articles/157000374474-alpha-job-submission-and-qos-overview).

### 5. Start Ollama on the GPU node

Inside the allocated GPU shell, start the API on loopback so it is reachable through SSH but not exposed as a public service:

    export PATH="$HOME/.local/ollama-alpha/bin:$PATH"
    export OLLAMA_MODELS=/projects/suny/cwang1/worlds/models/ollama
    export OLLAMA_HOST=127.0.0.1:11434
    ollama serve > "$HOME/ollama-${SLURM_JOB_ID}.log" 2>&1 &
    OLLAMA_SERVER_PID=$!
    sleep 3
    curl -fsS http://127.0.0.1:11434/api/tags

Leave this allocated shell open for the duration of the session. Verify the model uses the GPU after you send a prompt with `ollama ps` and `nvidia-smi`. If the tag is missing, run `ollama pull qwen3.8:27b` inside the job and wait for it to finish.

### 6. Open an SSH tunnel from your Mac

Keep the Empire AI shell and Ollama server running. The commands below use local port `11435` so they do not conflict with an Ollama service that may already be running on your Mac at `11434`. In a second Terminal window on your Mac, replace `<COMPUTE_NODE_HOSTNAME>` with the value printed by `hostname -f` in the allocated job:

    ssh -N -L 11435:localhost:11434 \
      -i ~/.ssh/id_empireai \
      -o IdentitiesOnly=yes \
      jshin@<COMPUTE_NODE_HOSTNAME>

This forwards your Mac’s `localhost:11435` to Ollama on the allocated compute node’s `localhost:11434`. If the compute node is reachable only through the Alpha login node, use the login as a jump host:

    ssh -N -L 11435:localhost:11434 \
      -J jshin@alpha1.empireai.edu \
      -i ~/.ssh/id_empireai \
      -o IdentitiesOnly=yes \
      jshin@<COMPUTE_NODE_HOSTNAME>

Keep this SSH command running in the second Terminal window. Confirm the tunnel from your Mac:

    curl http://localhost:11435/api/tags

The response should list `qwen3.8:27b`.

### 7. Point ORBIT at the tunneled API

In the ORBIT desktop app, open the gear menu and choose **Local Ollama API**. Use these settings; change the model field because the preset may still show the previous Kimi model:

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

In the desktop app, ORBIT stores API keys with Electron `safeStorage` when OS-backed encryption is available. The encrypted value is kept in the app’s settings file under the operating system’s ORBIT user-data folder. The renderer does not store desktop API keys in browser local storage. The Chrome extension prototype does not provide the same protected key storage; use the desktop app for direct cloud API keys.

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
- **ORBIT cannot reach Ollama on Alpha:** Confirm the Slurm job is still running, `ollama serve` is active on the allocated compute node, and the SSH tunnel is still open. On your Mac, `curl http://localhost:11435/api/tags` should return the model list.
- **Ollama runs on CPU or reports an out-of-memory error:** Run Ollama inside the GPU allocation, check `nvidia-smi` and `ollama ps`, and retry with a shorter context. Make sure the model pull completed before starting the GPU job.
- **The Slurm request is rejected:** Check `sacctmgr show assoc user="$USER" format=Account%20,QOS%60` and use an account/QoS permitted for your user. Alpha requires an explicit project account; Beta is a separate system and requires at least four GPUs per job.
- **BullsAI returns an error:** Check developer access, endpoint URL, model ID, API key, and whether the endpoint uses the expected Bearer-token and OpenAI-compatible format.
- **Voice input is unavailable:** Check OS microphone access and the ORBIT permission prompt. Some Electron or system configurations do not provide speech recognition; typing remains available.
- **Installer build fails:** Run npm run dist on the target operating system and review the first error printed by electron-builder. Platform signing and notarization require separate credentials and setup.

## Project files

- desktop-main.js — Electron main process, Chromium tab lifecycle, navigation, permissions, and AI endpoint requests.
- desktop-preload.js — narrow, context-isolated bridge between the app UI and the main process.
- newtab.html, app.js, styles.css — ORBIT workspace, browser controls, and assistant interface.
- manifest.json — optional Chrome extension configuration.
- package.json — start and packaging scripts.
