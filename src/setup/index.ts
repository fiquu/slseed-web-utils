import { prompt, join } from 'inquirer';

const choices = new Map();

choices.set('Stack Setup', 'stack.js');
choices.set('Env Setup', 'env.js');
choices.set('Database Index Sync', 'sync-db-indexes.js');

(async (): Promise<void> => {
  const { key } = await prompt({
    choices: choices.keys(),
    message: 'Select setup script to run',
    type: 'list',
    name: 'key'
  });

  import(join('.', choices.get(key)));
})();
