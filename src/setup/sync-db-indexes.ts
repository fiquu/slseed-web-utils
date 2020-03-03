import { join, resolve } from 'path';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import rcfile from 'rcfile';
import chalk from 'chalk';
import ora from 'ora';

import confirmPrompt from '../confirm-prompt';
import stageSelect from '../stage-select';

const slseedrc = rcfile('slseed');
const spinner = ora();

/**
 * Initializes env.
 */
async function init(): Promise<void> {
  await stageSelect();

  dotenv.config({
    path: resolve(process.cwd(), `.env.${process.env.NODE_ENV}`)
  });

  mongoose.set('debug', true);
}

/**
 * Connects to the database.
 */
async function connect(): Promise<void> {
  const { uri, options } = await import(join(slseedrc.service, 'configs', 'database'));

  spinner.info(
    `${chalk.bold('Target database:')} ${uri.replace(/^mongodb(\+srv)?:\/\/([^:]+:[^@]+@)?([^?]+).*$/, '$3')}`
  );

  spinner.start('Connecting to the database...');

  await mongoose.connect(uri, options);

  spinner.succeed('Connected to the database.');
}

/**
 * Closes the database connection.
 */
async function disconnect(): Promise<void> {
  spinner.start('Disconnecting from the database...');

  await mongoose.disconnect();

  spinner.info('Database connection closed.');
}

/**
 * Registers the schemas on the current database connection.
 */
async function registerSchemas(): Promise<void> {
  spinner.start('Registering schemas...');

  const schemas = await import(join(slseedrc.service, 'components', 'schemas'));

  schemas.register(mongoose);

  spinner.succeed('Schemas registered.');
}

/**
 * Syncs the database indexes.
 */
async function syncIndexes(): Promise<void> {
  spinner.start('Syncing indexes...');

  for (const name of mongoose.modelNames()) {
    await mongoose.model(name).syncIndexes();
  }

  spinner.succeed('Indexes synced!');
}

(async (): Promise<void> => {
  console.log(`\n${chalk.cyan.bold('Database Indexes Script')}\n`);

  try {
    await init();

    if (!(await confirmPrompt('Proceed with index syncing?'))) {
      spinner.warn('Canceled.');
      return;
    }

    await connect();
    await registerSchemas();

    await syncIndexes();

    await disconnect();
  } catch (err) {
    spinner.fail(err.message);
    throw err;
  }
})();
