import { prompt } from 'inquirer';
import { join } from 'path';

const choices = new Map();

choices.set('Stack Setup', 'stack.js');
choices.set('Env Setup', 'env.js');
choices.set('Sync Database Indexes', 'sync-db-indexes.js');

(async (): Promise<void> => {
  const { key } = await prompt({
    choices: Array.from(choices.keys()),
    message: 'Select script to run',
    type: 'list',
    name: 'key'
  });

  import(join('.', choices.get(key)));
})();
