import rcfile from 'rcfile';

const slseedrc = rcfile('slseed');

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
