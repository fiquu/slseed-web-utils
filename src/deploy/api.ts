import { spawnSync } from 'child_process';

import stageSelect from '../stage-select';

(async (): Promise<void> => {
  await stageSelect();

  const spawn = spawnSync('sls', ['deploy', '--stage', process.env.NODE_ENV], {
    stdio: ['inherit', 'inherit', 'pipe'],
    shell: true
  });

  if (spawn.stderr) {
    throw new Error(spawn.stderr.toString());
  }
})();
