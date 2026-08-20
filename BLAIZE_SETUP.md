# Blaize Tutors Biology Automation Setup

The YouTube channel branding and channel defaults are already configured. This guide finishes the local automation safely.

## Recommended Windows pilot

Install **Node.js 22 LTS** and Git, then open PowerShell:

```powershell
git clone https://github.com/blaizetutors-blip/youtube-automation-agent.git
cd youtube-automation-agent
powershell -ExecutionPolicy Bypass -File .\scripts\setup-blaize-windows.ps1
```

The setup script generates the local dashboard key, asks for the Gemini key with hidden input, imports the downloaded Google OAuth Desktop JSON, installs Chromium/FFmpeg dependencies, runs the tests, and starts YouTube authorization.

## 1. Create the local configuration manually

```bash
cp .env.blaize.example .env
```

Generate an API key locally and paste it into `API_KEY=` in `.env`:

```bash
openssl rand -hex 32
```

Do not paste that value, an AI-provider key, a Google client secret or an OAuth token into chat or commit it to GitHub.

## 2. Choose one AI provider

Keep Gemini as the primary full-pipeline provider. For independent text resilience, optionally add `GROQ_API_KEY` and set `AI_PROVIDER_ORDER=gemini,groq`. OpenAI can also cover text, images and narration. Text-only providers still need Gemini, OpenAI, ElevenLabs or Azure for narration.

The Gemini free tier currently supports the text and TTS portions used by this pilot, but generated image availability depends on the model and billing tier. If image generation is unavailable, the video uses the Blaize Tutors heritage slide design instead of generic placeholder branding. Paid Gemini image generation is optional for the private pilot.

Blaize Biology mode refuses to fall back to the repository's generic template scripts when no AI provider is available.

## 3. Connect YouTube

In Google Cloud Console:

1. Create or select a project for Blaize Tutors.
2. Enable **YouTube Data API v3** and **YouTube Analytics API**.
3. Configure Google Auth Platform with:
   - App name: `Blaize Tutors Biology Automation`
   - Audience: External / Testing
   - Test user: `blaizetutors@gmail.com`
   - Support and developer email: `blaizetutors@gmail.com`
4. Create an OAuth 2.0 client of type **Desktop app**.
5. Download the client JSON.
6. Import it without exposing the secret:

   ```powershell
   npm run credentials:import -- "C:\path\to\client_secret.json"
   ```

7. Run `npm run credentials:setup` and complete consent in your browser.

The tailored build requests upload, playlist-management, read-only YouTube and read-only Analytics scopes. Credential and token files are ignored by Git and saved with owner-only file permissions on supported systems. Existing users must run `npm run credentials:setup` once after upgrading so the token includes playlist access.

## 4. Install and start

```bash
npm install
npm start
```

The process must keep running for scheduled work. Its cron schedule uses `Africa/Lagos`, so the daily generation task runs at 06:00 West Africa Time.

## 5. Run one private pilot

```bash
curl -X POST http://localhost:3456/generate \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{"topic":"Cell structure and organisation","style":"explainer"}'
```

The endpoint now returns HTTP 202 immediately. Save `job.id`; the job continues independently of the PowerShell window and survives restarts.

Check its progress:

```bash
curl -H "x-api-key: $API_KEY" http://localhost:3456/jobs/JOB_ID
```

Wait for `status` to become `completed` or `review_blocked`. A provider outage appears as `retry_wait`, including the next automatic retry time; do not submit a duplicate job.

On Windows PowerShell, leave `npm start` running in the first window and use a second window:

```powershell
$Headers = @{ "x-api-key" = $BlaizeApiKey }
$Body = @{ topic = "Cell structure and organisation"; style = "explainer" } | ConvertTo-Json
$Generation = Invoke-RestMethod -Method Post -Uri "http://localhost:3456/generate" -Headers $Headers -ContentType "application/json" -Body $Body
$JobId = $Generation.job.id

do {
    Start-Sleep -Seconds 10
    $Status = Invoke-RestMethod -Uri "http://localhost:3456/jobs/$JobId" -Headers $Headers
    $Status.job | Select-Object id, status, stage, progress, message, nextAttemptAt
} while ($Status.job.status -in @("queued", "running", "retry_wait"))
```

## Paid Gemini pilot budget

For one 7–10 minute lesson per day, start with Google's minimum prepaid credit and use a **$20 monthly working budget with a $25 alert**. The expected direct Gemini cost is approximately **$0.35–$0.55 per completed episode**: roughly $0.08–$0.15 for structured text, $0.21–$0.30 for narration, and about $0.067 for one 1K supplemental image. Actual usage varies with retries and lesson length.

Keep full-motion lesson visuals in the deterministic Three.js/FFmpeg renderer. Per-second generative video would cost dramatically more and is not required for defensible 3D Biology animation.

To enable paid Gemini, open [Google AI Studio billing](https://ai.google.dev/gemini-api/docs/billing), select the same project as the API key, choose **Set up billing**, link a Cloud Billing account/payment method, and keep the existing key in `.env`. Add a Google Cloud budget alert at $20 and $25; budget alerts notify you but do not necessarily hard-stop usage.

## Known dependency-audit residual risk

The v3.3 safe dependency refresh leaves 10 production audit findings (2 low, 2 moderate, 5 high and 1 critical). The highest-severity paths are inherited by SQLite 5's native build toolchain and Sharp's bundled image stack. Their available fixes require breaking major-version upgrades, so they are intentionally deferred to a separately tested Windows/rendering migration. Install only from the official repository and npm registry; do not use unofficial Gemini-cookie proxies, prebuilt binaries from unknown forks or downloadable ZIP installers.

## 6. Review before upload

```bash
curl -H "x-api-key: $API_KEY" \
  http://localhost:3456/review/PRODUCTION_ID
```

Check all of the following:

- every biological definition and causal claim;
- diagram labels, units and process order;
- WAEC/NECO/UTME/JAMB/IGCSE/GCSE alignment claimed in the lesson;
- misconception correction and exam-style question/model answer;
- practical safety and specimen-handling instructions;
- narration pronunciation, visual accuracy, captions and thumbnail;
- any claim listed under `claimsToVerify` against a syllabus, textbook or authoritative source.

## 7. Approve the private upload

```bash
curl -X POST -H "x-api-key: $API_KEY" \
  http://localhost:3456/approve/PRODUCTION_ID
```

Approval moves the video into the upload queue. The next queue cycle uploads it as **Private**. With `AUTO_PUBLIC_SCHEDULING=false`, the uploader does not send `publishAt`, so YouTube cannot release it automatically.

Watch and inspect the uploaded private video in YouTube Studio. Make the first 10–15 pilot videos public manually only after final checks. Consider automated public scheduling later, after accuracy and quality are consistently reliable.
