import { resolve, join } from 'path';
import dotenv from 'dotenv';
import rcfile from 'rcfile';
import chalk from 'chalk';

import { prunePreviousVersions } from './app/prune';
import { AppDeployConfig } from './app/types';
import stageSelect from '../stage-select';

console.log(`\n${chalk.cyan.bold('Let\'s prune previous deployed versions...')}\n`);

const slseedrc = rcfile('slseed');

(async (): Promise<void> => {
  await stageSelect();

  const { error } = dotenv.config({
    path: resolve(process.cwd(), `.env.${process.env.NODE_ENV}.local`)
  });

  if (error) {
    throw error;
  }

  const file = join(slseedrc.configs, 'deploy');
  const config: AppDeployConfig = await require(file); // eslint-disable-line security/detect-non-literal-require
  const bucket = process.env[String(config.bucket)];
  const { version } = slseedrc.package;

  await prunePreviousVersions(bucket, version);
})();
