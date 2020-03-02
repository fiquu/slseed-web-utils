/**
 * Serverless deploy script.
 *
 * @module deploy
 */

const { spawn } = require('child_process');
const { prompt } = require('inquirer');

(async () => {
  const { profiles } = require('../configs/aws');

  const { profile } = await prompt({
    name: 'profile',
    type: 'list',
    message: 'Select deployment target profile:',
    choices: Object.keys(profiles)
  });

  await new Promise(resolve => {
    const cmd = spawn('sls', ['deploy', '--stage', profile], {
      stdio: 'inherit',
      shell: true
    });

    cmd.on('close', () => resolve());
  });
})();
