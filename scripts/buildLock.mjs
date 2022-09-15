import chalk from 'chalk';
import fs from 'fs-extra';
import _ from 'lodash';
import moment from 'moment';
import path from 'node:path';
import process from 'node:process';
import psList from 'ps-list';
import { wd } from './dirname.mjs';

export const lockFile = path.resolve(wd, 'build.lock');

export function logToLockFile(...logs) {
  fs.appendFileSync(
    lockFile,
    `[${moment().format('YYYY-MM-DD HH:mm:ss')}] ${logs.join('\n')}\n`
  );
}

export async function unlock() {
  if (!fs.existsSync(lockFile)) return;
  const lockPID = Number(
    /<pid>(.*)<\/pid>/gm.exec(fs.readFileSync(lockFile).toString())[1]
  );
  // the process that locked last is allowed to unlock for concurrency reasons
  const hasPermissionToUnlock =
    process.pid === lockPID ||
    !(await psList()).find(({ pid }) => pid === lockPID);
  try {
    hasPermissionToUnlock && fs.unlinkSync(lockFile);
  } catch (error) {}
}

export function isLocked() {
  return fs.existsSync(lockFile);
}

export function awaitBuild() {
  return new Promise((resolve) => {
    if (isLocked()) {
      console.log(chalk.cyanBright('> waiting for build to finish...'));
      const watcher = hook((locked) => {
        if (!locked) {
          watcher.close();
          resolve();
        }
      }, 500);
    } else {
      resolve();
    }
  });
}

/**
 *
 * @param {(locked: boolean) => any} cb
 * @param {number} [debounce]
 * @returns
 */
export function hook(cb, debounce) {
  return fs.watch(
    path.dirname(lockFile),
    _.debounce((type, file) => {
      if (type === 'rename' && file === path.basename(lockFile)) {
        cb(isLocked());
      }
    }, debounce)
  );
}

export const lockFilePlugin = {
  name: 'rollup-lock-file',
  sequential: true,
  order: 'post',
  buildStart() {
    fs.writeFileSync(lockFile, '');
    logToLockFile(`build start <pid>${process.pid}</pid>`);
  },
  buildEnd(error) {
    error && logToLockFile('build error', error);
  },
  renderError(error) {
    logToLockFile('build error', error);
  },
  writeBundle() {
    return unlock();
  },
};
