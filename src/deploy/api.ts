import { spawnSync } from 'child_process';

import stageSelect from '../stage-select';

(async (): Promise<void> => {
  await stageSelect();

  spawnSync('sls', ['deploy', '--stage', process.env.NODE_ENV], {
    stdio: 'inherit',
    shell: true
  });
})();
