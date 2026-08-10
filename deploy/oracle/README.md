# Deploying connector-service + whatsapp-service on Oracle Cloud (Always Free)

This replaces Railway, which is no longer usable (account expired). Everything
here targets Oracle Cloud's **Always Free** tier — genuinely free forever, no
trial, no auto-shutdown — running on one Ubuntu VM via systemd (so both
services restart automatically on crash or server reboot) behind Caddy (for
free, automatic HTTPS with zero domain purchase, using the VM's own IP via
`sslip.io`).

## What you need before starting

- An Oracle Cloud account (Always Free tier) with a running Ubuntu VM —
  see the main chat for the exact instance-creation steps.
- The VM's **public IP address**.
- The **SSH private key file** Oracle gave you when creating the instance.
- Five values copied from your Vercel project's environment variables
  (Vercel dashboard → your project → Settings → Environment Variables):
  `DATABASE_URL`, `CONNECTOR_ENCRYPTION_KEY`, `CONNECTOR_SERVICE_API_KEY`,
  `ENUGU_BOOKING_ACCOUNTS`, and the app's own public URL (for
  `MAIN_APP_URL` — this is your Vercel deployment's URL, e.g.
  `https://tdislogistics.vercel.app` or your custom domain).

## 1. Connect to the VM

From PowerShell (adjust the key path and IP):

```powershell
ssh -i "C:\path\to\your-downloaded-key.key" ubuntu@YOUR_VM_PUBLIC_IP
```

If it asks "are you sure you want to continue connecting", type `yes`.

## 2. Run the one-time setup script

Once connected (you'll see a `ubuntu@...:~$` prompt), run:

```bash
curl -fsSL https://raw.githubusercontent.com/mudone1/Tdislogistics/main/deploy/oracle/setup.sh | bash
```

This installs Node.js, Caddy, Playwright's browser dependencies, clones the
repo to `/home/ubuntu/tdis`, and installs dependencies for both services.
It does **not** start anything yet — it stops partway and tells you to fill
in the two `.env` files first (next step).

## 3. Fill in the environment files

The setup script creates two empty-ish files for you to fill in:

```bash
nano /home/ubuntu/tdis/connector-service/.env
```

Paste in (replacing the placeholder values with the real ones from Vercel):

```
PORT=4100
DATABASE_URL=<paste from Vercel>
CONNECTOR_ENCRYPTION_KEY=<paste from Vercel>
CONNECTOR_SERVICE_API_KEY=<paste from Vercel>
ENUGU_BOOKING_ACCOUNTS=<paste from Vercel>
```

Save and exit nano: `Ctrl+O`, `Enter`, then `Ctrl+X`.

```bash
nano /home/ubuntu/tdis/whatsapp-service/.env
```

```
PORT=4101
MAIN_APP_URL=<your Vercel app's public URL>
BOT_MENTION_TRIGGER=@tdisbot
AUTH_DIR=/home/ubuntu/tdis/whatsapp-service/auth
```

Save and exit the same way.

## 4. Start everything

```bash
sudo bash /home/ubuntu/tdis/deploy/oracle/start.sh
```

This builds both services, installs the systemd services so they run
permanently in the background and restart automatically, sets up Caddy for
HTTPS, and starts everything.

## 5. Scan the WhatsApp QR code

Two separate web addresses are set up on your VM, both using real HTTPS
with no domain purchase needed — a `connector` one and a `whatsapp` one,
both built from your VM's IP address. Replace the dots in your IP with
dashes: if your VM's IP is `140.238.12.34`, use `140-238-12-34` below.

Open in your browser:

```
https://whatsapp.YOUR-VM-IP-WITH-DASHES.sslip.io/qr
```

Example: `https://whatsapp.140-238-12-34.sslip.io/qr`.

Scan the QR code shown there with WhatsApp (Linked Devices → Link a Device),
same as you did the very first time this bot was ever set up.

## 6. Point Vercel at the new connector-service URL

In Vercel's dashboard, update `CONNECTOR_SERVICE_URL` to:

```
https://connector.YOUR-VM-IP-WITH-DASHES.sslip.io
```

Example: `https://connector.140-238-12-34.sslip.io`. Redeploy the Vercel
app for the new value to take effect.

## Updating after a code change (redeploy)

Every time new code is merged to `main` on GitHub, log back into the VM and run:

```bash
sudo bash /home/ubuntu/tdis/deploy/oracle/deploy.sh
```

This pulls the latest code, rebuilds both services, and restarts them —
same effect Railway's auto-deploy used to have, just one manual command
instead of automatic. (A fully automatic version of this, triggered by
GitHub itself, is possible later if wanted — ask and it can be set up.)

## Checking service status / logs

```bash
sudo systemctl status connector-service
sudo systemctl status whatsapp-service
sudo journalctl -u connector-service -f   # live logs, Ctrl+C to stop watching
sudo journalctl -u whatsapp-service -f
```
