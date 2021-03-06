#!/usr/bin/env node

/* eslint-disable node/shebang */

import greetingTime from 'greeting-time';
import { prompt } from 'inquirer';
import username from 'username';
import { argv } from 'yargs';
import { join } from 'path';
import rcfile from 'rcfile';
import chalk from 'chalk';

const slseedrc = rcfile('slseed');
const tasks = new Map();

tasks.set('setup-stack', join('setup', 'stack.js'));
tasks.set('setup-env', join('setup', 'env.js'));
tasks.set('deploy', join('deploy', 'index.js'));
tasks.set('prune', join('deploy', 'prune.js'));

/**
 * Runs the given task.
 *
 * @param {string} task The task name.
 *
 * @returns {Promise<any>} A promise to the task.
 */
const runTask = task => {
  return import(join(__dirname, tasks.get(task)));
};

/**
 * Tries to execute the task provided on the "do" option.
 *
 * @returns {Promise<void>} A promise to the imported task.
 */
const processArgv = () => {
  if (!tasks.has(argv.do)) {
    throw new Error('The task you requested does not exists!');
  }

  return runTask(argv.do);
};

/**
 * Asks for the task to run.
 *
 * @returns {Promise<any>} A promise to the selected task.
 */
const processPrompt = async () => {
  const choices = [
    {
      name: 'Deploy this application',
      value: 'deploy'
    },
    {
      name: 'Update or create a .env file',
      value: 'setup-env'
    },
    {
      name: 'Setup the CloudFormation stack',
      value: 'setup-stack'
    }
  ];

  if (slseedrc.type === 'app') {
    choices.push({
      name: 'Prune previously deployed versions',
      value: 'prune'
    });
  }

  const { task } = await prompt({
    message: 'Which task do you want to run?',
    type: 'list',
    name: 'task',
    choices
  });

  return runTask(task);
};

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
