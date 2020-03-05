#!/usr/bin/env node

/* eslint-disable node/shebang */

import greetingTime from 'greeting-time';
import { prompt } from 'inquirer';
import username from 'username';
import { argv } from 'yargs';
import { join } from 'path';
import chalk from 'chalk';

const tasks = new Map();

tasks.set('setup-stack', join('setup', 'stack.js'));
tasks.set('setup-env', join('setup', 'env.js'));
tasks.set('deploy', join('deploy', 'index.js'));

/**
 * Tries to execute the task provided on the "do" option.
 *
 * @returns {Promise<void>} A promise to the imported task.
 */
function processArgv(): Promise<any> {
  if (!tasks.has(argv.do)) {
    throw new Error('The task you requested does not exists!');
  }

  const task = tasks.get(argv.do);

  return import(join(__dirname, task));
}

/**
 * Asks for the task to run.
 *
 * @returns {Promise<any>} A promise to the selected task.
 */
async function processPrompt(): Promise<any> {
  const choices = new Map();

  choices.set('Deploy this application', 'deploy');
  choices.set('Update or create a .env file', 'setup-env');
  choices.set('Setup the CloudFormation stack', 'setup-stack');

  const { key } = await prompt({
    choices: Array.from(choices.keys()),
    message: 'Which task do you want to do?',
    type: 'list',
    name: 'key'
  });

  const task = choices.get(key);

  return import(join(__dirname, task));
}

(async (): Promise<void> => {
  const greeting = greetingTime(new Date());
  const name = await username();

  console.log(chalk.bold.greenBright(`${greeting}, ${name}!`));

  if (argv.do) {
    await processArgv();
    return;
  }

  await processPrompt();
})();
