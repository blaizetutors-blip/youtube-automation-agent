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

Add one provider key to `.env`. Gemini can cover text, images and narration with one key; OpenAI can also cover all three. Other supported text providers need a separate media/TTS provider for a complete video.

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

The tailored build requests only upload, read-only YouTube and read-only Analytics scopes. Credential and token files are ignored by Git and saved with owner-only file permissions on supported systems.

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

The result should report `queueStatus: "awaiting_review"`. Nothing is uploaded yet.

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
