#!/usr/bin/env node

/* eslint-disable node/shebang */

import greetingTime from 'greeting-time';
import { prompt } from 'inquirer';
import username from 'username';
import { join } from 'path';
import rcfile from 'rcfile';

const slseedrc = rcfile('slseed');
const choices = new Map();

choices.set('Deploy this application', join('deploy', 'index.js'));

if (slseedrc.type === 'api') {
  choices.set('Sync the database indexes', join('util', 'sync-db-indexes.js'));
}

choices.set('Update or create .env file', join('setup', 'env.js'));
choices.set('Setup the CloudFormation stack', join('setup', 'stack.js'));

(async (): Promise<void> => {
  const greeting = greetingTime(new Date());
  const name = username.sync();

  const { key } = await prompt({
    choices: Array.from(choices.keys()),
    message: `${greeting}, ${name}! What do you want to do?`,
    type: 'list',
    name: 'key'
  });

  import(join(__dirname, choices.get(key)));
})();
