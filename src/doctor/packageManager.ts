import { spawn } from 'node:child_process';
import { platform as osPlatform } from 'node:os';

export type PackageManagerName =
  | 'pacman'
  | 'apt'
  | 'dnf'
  | 'brew'
  | 'winget'
  | 'choco';

export interface PackageManager {
  name: PackageManagerName;
  /** argv to install one package, with `sudo` prepended on Linux when not root */
  installArgv(pkg: string): { cmd: string; args: string[] };
  /** human-readable form for prompts and hints */
  installCmd(pkg: string): string;
}

export async function detectPackageManager(): Promise<PackageManager | null> {
  const p = osPlatform();
  if (p === 'linux') {
    if (await binaryAvailable('pacman')) return pacman();
    if (await binaryAvailable('apt-get')) return apt();
    if (await binaryAvailable('dnf')) return dnf();
    return null;
  }
  if (p === 'darwin') {
    if (await binaryAvailable('brew')) return brew();
    return null;
  }
  if (p === 'win32') {
    if (await binaryAvailable('winget')) return winget();
    if (await binaryAvailable('choco')) return choco();
    return null;
  }
  return null;
}

function isRoot(): boolean {
  return typeof process.getuid === 'function' && process.getuid() === 0;
}

function withSudo(argv: string[]): { cmd: string; args: string[] } {
  if (isRoot()) return { cmd: argv[0]!, args: argv.slice(1) };
  return { cmd: 'sudo', args: argv };
}

function pacman(): PackageManager {
  return {
    name: 'pacman',
    installArgv: (pkg) => withSudo(['pacman', '-S', '--noconfirm', pkg]),
    installCmd: (pkg) => `sudo pacman -S ${pkg}`,
  };
}

function apt(): PackageManager {
  return {
    name: 'apt',
    installArgv: (pkg) => withSudo(['apt-get', 'install', '-y', pkg]),
    installCmd: (pkg) => `sudo apt-get install ${pkg}`,
  };
}

function dnf(): PackageManager {
  return {
    name: 'dnf',
    installArgv: (pkg) => withSudo(['dnf', 'install', '-y', pkg]),
    installCmd: (pkg) => `sudo dnf install ${pkg}`,
  };
}

function brew(): PackageManager {
  return {
    name: 'brew',
    installArgv: (pkg) => ({ cmd: 'brew', args: ['install', pkg] }),
    installCmd: (pkg) => `brew install ${pkg}`,
  };
}

function winget(): PackageManager {
  return {
    name: 'winget',
    installArgv: (pkg) => ({
      cmd: 'winget',
      args: [
        'install',
        '--id',
        pkg,
        '--silent',
        '--accept-source-agreements',
        '--accept-package-agreements',
      ],
    }),
    installCmd: (pkg) => `winget install --id ${pkg}`,
  };
}

function choco(): PackageManager {
  return {
    name: 'choco',
    installArgv: (pkg) => ({ cmd: 'choco', args: ['install', pkg, '-y'] }),
    installCmd: (pkg) => `choco install ${pkg}`,
  };
}

async function binaryAvailable(name: string): Promise<boolean> {
  return new Promise((resolve) => {
    const useShell = process.platform === 'win32';
    const child = spawn(name, ['--version'], {
      stdio: 'ignore',
      shell: useShell,
    });
    let settled = false;
    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    child.on('error', () => finish(false));
    child.on('exit', (code) => finish(code === 0));
    setTimeout(() => {
      if (!settled) {
        child.kill('SIGKILL');
        finish(false);
      }
    }, 3000);
  });
}
