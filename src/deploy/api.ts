import { spawnSync } from 'child_process';

import stageSelect from '../stage-select';

(async (): Promise<void> => {
  await stageSelect();

  const spawn = spawnSync('sls', ['deploy', '--stage', process.env.NODE_ENV], {
    stdio: 'inherit',
    shell: true
  });

  if (spawn.status !== 0 && spawn.stderr) {
    throw new Error(String(spawn.stderr).toString());
  }
})();
