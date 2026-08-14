const fs = require('fs');
const path = require('path');

function fail(message) {
  console.error(message);
  process.exit(1);
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    fail(`Could not read Google OAuth JSON: ${error.message}`);
  }
}

function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    fail('Usage: npm run credentials:import -- "C:\\path\\to\\client_secret.json"');
  }

  const resolvedInput = path.resolve(inputPath);
  const raw = readJson(resolvedInput);
  const client = raw.installed || raw.web;

  if (!client?.client_id || !client?.client_secret) {
    fail('The selected file is not a Google OAuth Desktop client JSON file.');
  }

  const credentialsPath = path.join(__dirname, '..', 'config', 'credentials.json');
  let credentials = {};
  if (fs.existsSync(credentialsPath)) {
    credentials = readJson(credentialsPath);
  }

  credentials.youtube = {
    client_id: client.client_id,
    client_secret: client.client_secret,
    redirect_uris: Array.isArray(client.redirect_uris) ? client.redirect_uris : []
  };

  fs.mkdirSync(path.dirname(credentialsPath), { recursive: true });
  fs.writeFileSync(credentialsPath, JSON.stringify(credentials, null, 2), { mode: 0o600 });
  try {
    fs.chmodSync(credentialsPath, 0o600);
  } catch {
    // Windows does not implement POSIX owner-only modes in the same way.
  }

  console.log('Google OAuth Desktop credentials imported securely.');
  console.log('Next: npm run credentials:setup');
}

main();
