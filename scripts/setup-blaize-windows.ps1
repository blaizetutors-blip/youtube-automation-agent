$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

Write-Host 'Blaize Tutors Biology - Windows pilot setup'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'Node.js is not installed. Install Node.js 22 LTS, reopen PowerShell, and run this script again.'
}

$nodeMajor = [int]((& node --version).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 18) {
    throw 'Node.js 18 or newer is required. Node.js 22 LTS is recommended.'
}
if ($nodeMajor -ne 20 -and $nodeMajor -ne 22) {
    Write-Warning 'Node.js 22 LTS is the tested Windows recommendation for this pilot.'
}

if (-not (Test-Path '.env')) {
    Copy-Item '.env.blaize.example' '.env'
}

$envText = Get-Content '.env' -Raw
if ($envText -match '(?m)^API_KEY=\s*$') {
    $randomBytes = New-Object byte[] 32
    $randomGenerator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $randomGenerator.GetBytes($randomBytes)
    } finally {
        $randomGenerator.Dispose()
    }
    $localApiKey = -join ($randomBytes | ForEach-Object { $_.ToString('x2') })
    $envText = [regex]::Replace($envText, '(?m)^API_KEY=.*$', "API_KEY=$localApiKey")
    [IO.File]::WriteAllText((Join-Path $repoRoot '.env'), $envText)
    Write-Host 'Generated the private local dashboard API key.'
}

if ($envText -notmatch '(?m)^GEMINI_API_KEY=\S+$') {
    $secureGeminiKey = Read-Host 'Paste the Gemini API key (input is hidden)' -AsSecureString
    $keyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureGeminiKey)
    try {
        $geminiKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyPointer)
        if ([string]::IsNullOrWhiteSpace($geminiKey)) {
            throw 'A Gemini API key is required for the Blaize Biology pilot.'
        }
        $envText = Get-Content '.env' -Raw
        if ($envText -match '(?m)^#?\s*GEMINI_API_KEY=') {
            $envText = [regex]::Replace($envText, '(?m)^#?\s*GEMINI_API_KEY=.*$', "GEMINI_API_KEY=$geminiKey")
        } else {
            $envText += "`r`nGEMINI_API_KEY=$geminiKey`r`n"
        }
        [IO.File]::WriteAllText((Join-Path $repoRoot '.env'), $envText)
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPointer)
    }
    Write-Host 'Saved the Gemini key to the Git-ignored local environment file.'
}

$googleClientJson = Read-Host 'Enter the full path to the downloaded Google OAuth Desktop JSON file'
if (-not (Test-Path $googleClientJson)) {
    throw 'The Google OAuth JSON file was not found at that path.'
}

node 'utils/import-google-credentials.js' $googleClientJson
npm ci --no-audit --no-fund
npx playwright install chromium
npm test

Write-Host ''
Write-Host 'Dependencies and local configuration are ready.'
Write-Host 'The browser will now request access to the Blaize Tutors YouTube channel.'
npm run credentials:setup

Write-Host ''
Write-Host 'Setup complete. Run npm start to launch the private pilot dashboard.'
