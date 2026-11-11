#!/usr/bin/env node
/**
 * Runs Firestore rules tests through the Firebase emulator.
 * Prefers an existing JRE, then Homebrew OpenJDK, so keg-only installs work
 * without a sudo symlink into /Library/Java/JavaVirtualMachines.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repoRoot = path.dirname(frontendRoot);
const firebaseCli = path.join(frontendRoot, 'node_modules', 'firebase-tools', 'lib', 'bin', 'firebase.js');
const firebaseConfig = path.join(repoRoot, 'firebase.json');
/**
 * emulators:exec runs this through a shell in frontendRoot, so a relative path with no spaces
 * needs no quoting in cmd.exe, PowerShell, or sh.
 */
const rulesTestCommand = 'node --test scripts/firestore.rules.spec.mjs';

const HOMEBREW_JAVA_HOMES = [
  '/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home',
  '/opt/homebrew/opt/openjdk@21',
  '/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home',
  '/opt/homebrew/opt/openjdk',
  '/usr/local/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home',
  '/usr/local/opt/openjdk@21',
];

const WINDOWS_JAVA_VENDORS = ['Eclipse Adoptium', 'Java', 'Microsoft', 'Amazon Corretto', 'Zulu'];

function javaExecutableName() {
  return process.platform === 'win32' ? 'java.exe' : 'java';
}

function windowsJavaHomes() {
  const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA]
    .filter(Boolean);
  const homes = [];
  for (const root of roots) {
    for (const vendor of WINDOWS_JAVA_VENDORS) {
      const vendorDir = path.join(root, vendor);
      if (!existsSync(vendorDir)) {
        continue;
      }
      let entries = [];
      try {
        entries = readdirSync(vendorDir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (entry.isDirectory()) {
          homes.push(path.join(vendorDir, entry.name));
        }
      }
    }
  }
  return homes;
}

function javaWorks(env = process.env) {
  const result = spawnSync(javaExecutableName(), ['-version'], { env, encoding: 'utf8' });
  return result.status === 0;
}

function resolveJavaEnv() {
  if (javaWorks()) {
    return process.env;
  }

  const hintedHome = process.env.JAVA_HOME;
  const candidates = [
    hintedHome,
    ...(process.platform === 'win32' ? windowsJavaHomes() : HOMEBREW_JAVA_HOMES),
  ].filter(Boolean);
  for (const home of candidates) {
    if (!existsSync(path.join(home, 'bin', javaExecutableName()))) {
      continue;
    }
    const env = {
      ...process.env,
      JAVA_HOME: home,
      PATH: `${path.join(home, 'bin')}${path.delimiter}${process.env.PATH ?? ''}`,
    };
    if (javaWorks(env)) {
      return env;
    }
  }

  return null;
}

function printJavaDiagnosis() {
  console.error('Firestore emulator could not start: no usable Java runtime on PATH.');
  console.error('The Cloud Firestore emulator requires a JDK 21+.');
  if (process.platform === 'win32') {
    console.error('Install Temurin 21, then set JAVA_HOME to that JDK folder.');
    console.error('  https://adoptium.net/temurin/releases/?version=21');
  } else {
    console.error('Install one of:');
    console.error('  brew install openjdk@21');
    console.error('  brew install --cask temurin@21');
    console.error('Then either export JAVA_HOME or keep the Homebrew keg on PATH:');
    console.error('  export PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH"');
  }
  console.error('Do not point this suite at a production Firebase project.');
}

const env = resolveJavaEnv();
if (!env) {
  printJavaDiagnosis();
  process.exit(1);
}

if (!existsSync(firebaseCli)) {
  console.error('firebase-tools is not installed. Run npm install in frontend/.');
  process.exit(1);
}

/**
 * Runs firebase-tools with this Node binary and no shell, so each array element reaches it as exactly
 * one argument on every platform. Spawning firebase.cmd on Windows needs a shell, which splits the test command.
 */
const child = spawn(
  process.execPath,
  [
    firebaseCli,
    'emulators:exec',
    '--only',
    'firestore',
    '--project',
    'demo-dises',
    '--config',
    firebaseConfig,
    rulesTestCommand,
  ],
  {
    cwd: frontendRoot,
    env,
    stdio: 'inherit',
  },
);

child.on('exit', (code, signal) => {
  if (signal) {
    process.exit(1);
  }
  process.exit(code ?? 1);
});
