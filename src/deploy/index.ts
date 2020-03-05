import rcfile from 'rcfile';
import chalk from 'chalk';

const slseedrc = rcfile('slseed');

console.log(`\n${chalk.cyan.bold('Let\'s deploy this application...')}\n`);

switch (slseedrc.type) {
  case 'app':
    import('./app');
    break;

  case 'api':
    import('./api');
    break;

  default:
    throw new Error(`Unknown application type: "${slseedrc.type}"`);
}
